import {
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
  type ServerNpmRelease,
} from "@t3tools/contracts";
import {
  cliReleaseChannelOf,
  cliReleaseIndexPageUrl,
  cliReleaseTagUrl,
  type CliReleaseChannel,
} from "@t3tools/shared/cliRelease";
import * as Cache from "effect/Cache";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

const RELEASE_LOOKUP_TIMEOUT = Duration.seconds(15);
const RELEASE_INDEX_MAX_PAGES = 5;
const VERSION_TAG_PATTERN = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const DATABASE_MIGRATION_MARKER = /^\s*t3code-database-migration:\s*(\d+)\s*$/m;

const GitHubReleaseEntry = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.optional(Schema.Boolean),
  body: Schema.optional(Schema.NullOr(Schema.String)),
});
type GitHubReleaseEntry = typeof GitHubReleaseEntry.Type;

const decodeReleaseEntry = Schema.decodeUnknownOption(Schema.fromJsonString(GitHubReleaseEntry));
const decodeReleaseIndex = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(GitHubReleaseEntry)),
);
const decodeInput = Schema.decodeUnknownEffect(ServerNpmReleaseInput);

export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("t3/cloud/npmRelease") {}

function parseReleaseDatabaseMigration(body: string | null | undefined): number | undefined {
  if (!body) return undefined;
  const raw = DATABASE_MIGRATION_MARKER.exec(body)?.[1];
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function toServerRelease(version: string, entry: GitHubReleaseEntry): ServerNpmRelease {
  const databaseMigration = parseReleaseDatabaseMigration(entry.body);
  return {
    version,
    ...(databaseMigration === undefined ? {} : { databaseMigration }),
  };
}

function newestChannelRelease(
  releases: ReadonlyArray<GitHubReleaseEntry>,
  channel: CliReleaseChannel,
): ServerNpmRelease | null {
  for (const release of releases) {
    if (release.draft) continue;
    const version = VERSION_TAG_PATTERN.exec(release.tag_name)?.[1];
    if (version === undefined) continue;
    if (cliReleaseChannelOf(version) === channel) {
      return toServerRelease(version, release);
    }
  }
  return null;
}

export const make = Effect.fn("NpmRelease.make")(function* () {
  const http = yield* HttpClient.HttpClient;
  const ghToken = yield* Config.NonEmptyString("GH_TOKEN").pipe(
    Config.orElse(() => Config.NonEmptyString("GITHUB_TOKEN")),
    Config.option,
  );
  const lookupPermits = yield* Semaphore.make(2);

  const fetchJson = Effect.fn("NpmRelease.fetchJson")(function* (url: string) {
    const unavailable = new ServerNpmReleaseError({
      reason: "Could not reach T4 Code releases on GitHub.",
    });
    const rateLimited = new ServerNpmReleaseError({
      reason: "GitHub API rate limit reached while checking T4 Code releases. Try again later.",
    });
    const baseRequest = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
      HttpClientRequest.setHeader("User-Agent", "t4code"),
    );
    const execute = (request: HttpClientRequest.HttpClientRequest) =>
      http.execute(request).pipe(Effect.timeout(RELEASE_LOOKUP_TIMEOUT));

    return yield* lookupPermits.withPermits(1)(
      Effect.gen(function* () {
        let response = yield* Option.match(ghToken, {
          onNone: () => execute(baseRequest),
          onSome: (token) =>
            execute(HttpClientRequest.setHeader(baseRequest, "Authorization", `Bearer ${token}`)),
        }).pipe(Effect.mapError(() => unavailable));

        // Public GitHub releases still work without auth if a local token expired.
        if (response.status === 401 && Option.isSome(ghToken)) {
          response = yield* execute(baseRequest).pipe(Effect.mapError(() => unavailable));
        }
        if (response.status === 404) return Option.none<string>();
        if (
          response.status === 429 ||
          (response.status === 403 && response.headers["x-ratelimit-remaining"] === "0")
        ) {
          return yield* rateLimited;
        }
        if (response.status < 200 || response.status >= 300) return yield* unavailable;
        return Option.some(
          yield* response.text.pipe(
            Effect.timeout(RELEASE_LOOKUP_TIMEOUT),
            Effect.mapError(() => unavailable),
          ),
        );
      }),
    );
  });

  const lookupChannel = Effect.fn("NpmRelease.lookupChannel")(function* (
    channel: CliReleaseChannel,
  ) {
    for (let page = 1; page <= RELEASE_INDEX_MAX_PAGES; page += 1) {
      const json = yield* fetchJson(cliReleaseIndexPageUrl(page));
      if (Option.isNone(json)) return null;
      const releases = Option.getOrUndefined(decodeReleaseIndex(json.value));
      if (releases === undefined) {
        return yield* new ServerNpmReleaseError({
          reason: "GitHub returned invalid release metadata.",
        });
      }
      const match = newestChannelRelease(releases, channel);
      if (match !== null) return match;
      if (releases.length < 100) break;
    }
    return null;
  });

  const lookupExactVersion = Effect.fn("NpmRelease.lookupExactVersion")(function* (
    version: string,
  ) {
    const json = yield* fetchJson(cliReleaseTagUrl(version));
    if (Option.isNone(json)) return null;
    const entry = Option.getOrUndefined(decodeReleaseEntry(json.value));
    if (entry === undefined) {
      return yield* new ServerNpmReleaseError({
        reason: "GitHub returned invalid release metadata.",
      });
    }
    if (entry.draft) return null;
    const tagVersion = VERSION_TAG_PATTERN.exec(entry.tag_name)?.[1];
    if (tagVersion !== version) {
      return yield* new ServerNpmReleaseError({
        reason: "GitHub returned invalid release metadata.",
      });
    }
    return toServerRelease(version, entry);
  });

  const cache = yield* Cache.make({
    capacity: 32,
    timeToLive: Duration.minutes(1),
    lookup: Effect.fn("NpmRelease.lookup")(function* (spec: string) {
      if (spec === "latest") return yield* lookupChannel("stable");
      if (spec === "nightly") return yield* lookupChannel("nightly");
      return yield* lookupExactVersion(spec);
    }),
  });

  return NpmRelease.of({
    get: Effect.fn("NpmRelease.get")(function* (input) {
      const { spec } = yield* decodeInput(input).pipe(
        Effect.mapError(
          () => new ServerNpmReleaseError({ reason: "Invalid release version or track." }),
        ),
      );
      return yield* Cache.get(cache, spec);
    }),
  });
});

export const layer = Layer.effect(NpmRelease, make()).pipe(Layer.provide(FetchHttpClient.layer));
