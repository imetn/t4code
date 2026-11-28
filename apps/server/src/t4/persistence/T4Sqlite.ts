import { ProjectTodoUnavailableError } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import * as ServerConfig from "../../config.ts";

const T4_SQLITE_BUSY_TIMEOUT_MS = 1000;
const T4_WAL_SIZE_LIMIT_BYTES = 32 * 1024 * 1024;

class T4SqliteMigrationMismatchError extends Schema.TaggedError<T4SqliteMigrationMismatchError>()(
  "T4SqliteMigrationMismatchError",
  {
    id: Schema.Number,
    expected: Schema.String,
    found: Schema.String,
  },
) {
  override get message(): string {
    return `T4 SQLite migration ${this.id} mismatch: expected '${this.expected}', found '${this.found}'.`;
  }
}

interface T4Migration {
  readonly id: number;
  readonly name: string;
  readonly up: (sql: SqlClient.SqlClient) => Effect.Effect<void, SqlError.SqlError>;
}

const migrateProjectTodos = Effect.fn("T4Sqlite.migration.001_ProjectTodos")(function* (
  sql: SqlClient.SqlClient,
) {
  yield* sql`
    CREATE TABLE IF NOT EXISTS t4_project_todos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('todo', 'note')),
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
      pinned INTEGER NOT NULL DEFAULT 0,
      source_thread_id TEXT,
      linked_thread_id TEXT,
      file_refs_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'agent')),
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      archived_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_t4_todos_project_order
    ON t4_project_todos (project_id, created_at DESC, id DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_t4_todos_project_active
    ON t4_project_todos (project_id, archived_at, pinned DESC, completed_at, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_t4_todos_created_at
    ON t4_project_todos (created_at DESC, id DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_t4_todos_completed_at
    ON t4_project_todos (completed_at DESC, id DESC)
    WHERE completed_at IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_t4_todos_linked_thread
    ON t4_project_todos (linked_thread_id)
    WHERE linked_thread_id IS NOT NULL
  `;
});

const migrateSyncedComposerDrafts = Effect.fn("T4Sqlite.migration.002_SyncedComposerDrafts")(
  function* (sql: SqlClient.SqlClient) {
    yield* sql`
      CREATE TABLE IF NOT EXISTS t4_synced_composer_drafts (
        thread_id TEXT PRIMARY KEY,
        text TEXT NOT NULL DEFAULT '',
        attachments_json TEXT NOT NULL DEFAULT '[]',
        revision INTEGER NOT NULL DEFAULT 1,
        source_client_id TEXT,
        updated_at TEXT NOT NULL
      )
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_t4_synced_drafts_updated_at
      ON t4_synced_composer_drafts (updated_at DESC)
    `;
  },
);

const T4_MIGRATIONS: ReadonlyArray<T4Migration> = [
  {
    id: 1,
    name: "001_ProjectTodos",
    up: migrateProjectTodos,
  },
  {
    id: 2,
    name: "002_SyncedComposerDrafts",
    up: migrateSyncedComposerDrafts,
  },
];

export class T4Sqlite extends Context.Service<
  T4Sqlite,
  {
    readonly getClient: Effect.Effect<SqlClient.SqlClient, ProjectTodoUnavailableError>;
  }
>()("t3/t4/persistence/T4Sqlite") {}

const configureAndMigrate = Effect.fn("T4Sqlite.configureAndMigrate")(function* (
  sql: SqlClient.SqlClient,
  isMemory: boolean,
) {
  yield* sql.unsafe(`PRAGMA busy_timeout = ${T4_SQLITE_BUSY_TIMEOUT_MS};`);
  yield* sql`PRAGMA foreign_keys = ON;`;
  if (!isMemory) {
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* sql`PRAGMA synchronous = NORMAL;`;
    yield* sql`PRAGMA temp_store = MEMORY;`;
    yield* sql.unsafe(`PRAGMA journal_size_limit = ${T4_WAL_SIZE_LIMIT_BYTES};`);
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS t4_schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `;

  const applied = yield* sql<{ readonly id: number; readonly name: string }>`
    SELECT id, name FROM t4_schema_migrations ORDER BY id ASC
  `;
  const appliedById = new Map(applied.map((row) => [Number(row.id), row.name]));

  for (const migration of T4_MIGRATIONS) {
    const existingName = appliedById.get(migration.id);
    if (existingName !== undefined) {
      if (existingName !== migration.name) {
        return yield* new T4SqliteMigrationMismatchError({
          id: migration.id,
          expected: migration.name,
          found: existingName,
        });
      }
      continue;
    }
    const appliedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* migration.up(sql);
        yield* sql`
          INSERT INTO t4_schema_migrations (id, name, applied_at)
          VALUES (${migration.id}, ${migration.name}, ${appliedAt})
        `;
      }),
    );
  }
});

const openT4SqliteLayer = (options: { readonly filename: string; readonly isMemory: boolean }) =>
  Layer.effect(
    T4Sqlite,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* configureAndMigrate(sql, options.isMemory);
      return T4Sqlite.of({ getClient: Effect.succeed(sql) });
    }),
  ).pipe(
    // Private SqlClient stays inside T4Sqlite so upstream statev2.sqlite's SqlClient tag is untouched.
    Layer.provide(
      NodeSqliteClient.layer({
        filename: options.filename,
        ...(options.isMemory
          ? {}
          : {
              writerWorker: true,
              readerWorker: false,
              spanAttributes: {
                "db.name": "t4.sqlite",
                "service.name": "t3code-server",
              },
            }),
      }),
    ),
  );

export const layerMemory: Layer.Layer<T4Sqlite> = openT4SqliteLayer({
  filename: ":memory:",
  isMemory: true,
}).pipe(Layer.orDie);

export const layerFromPath = (
  dbPath: string,
): Layer.Layer<T4Sqlite, never, FileSystem.FileSystem | Path.Path> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.dirname(dbPath);
      const dirReady = yield* fs.makeDirectory(dir, { recursive: true }).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.logWarning("Failed to create T4 SQLite directory.", { dbPath, cause }).pipe(
            Effect.as(false),
          ),
        ),
      );
      if (!dirReady) {
        return Layer.succeed(
          T4Sqlite,
          T4Sqlite.of({
            getClient: Effect.fail(
              new ProjectTodoUnavailableError({
                detail: `Project todos database directory could not be initialized at ${dir}.`,
              }),
            ),
          }),
        );
      }

      return openT4SqliteLayer({ filename: dbPath, isMemory: false }).pipe(
        Layer.catch((cause) =>
          Layer.effect(
            T4Sqlite,
            Effect.logWarning("Project todos database failed to open; todos are unavailable.", {
              dbPath,
              cause,
            }).pipe(
              Effect.as(
                T4Sqlite.of({
                  getClient: Effect.fail(
                    new ProjectTodoUnavailableError({
                      detail: `Project todos database at ${dbPath} is unavailable. Check disk permissions or remove a damaged file and restart.`,
                    }),
                  ),
                }),
              ),
            ),
          ),
        ),
      );
    }),
  );

export const layerConfig: Layer.Layer<
  T4Sqlite,
  never,
  ServerConfig.ServerConfig | FileSystem.FileSystem | Path.Path
> = Layer.unwrap(
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerFromPath(path.join(stateDir, "t4", "t4.sqlite"));
  }),
);
