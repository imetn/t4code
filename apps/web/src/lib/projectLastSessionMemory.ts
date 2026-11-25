import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ScopedProjectRef,
} from "@t3tools/contracts";

export const PROJECT_LAST_SESSION_STORAGE_KEY = "t3code:project-last-session:v1";
const MAX_STORED_PROJECTS = 200;

export interface ProjectLastSessionEntry {
  readonly modelSelection?: ModelSelection;
  readonly interactionMode?: ProviderInteractionMode;
  readonly runtimeMode?: RuntimeMode;
  readonly updatedAt: string;
}

type StoredProjectLastSessionMap = Record<string, ProjectLastSessionEntry>;

function isValidInteractionMode(value: unknown): value is ProviderInteractionMode {
  return value === "default" || value === "plan";
}

function isValidRuntimeMode(value: unknown): value is RuntimeMode {
  return (
    value === "approval-required" ||
    value === "auto-accept-edits" ||
    value === "auto" ||
    value === "full-access"
  );
}

function isValidModelSelection(value: unknown): value is ModelSelection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.instanceId === "string" &&
    candidate.instanceId.length > 0 &&
    typeof candidate.model === "string" &&
    candidate.model.length > 0
  );
}

function readStorageMap(storage: Storage | undefined): StoredProjectLastSessionMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(PROJECT_LAST_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: StoredProjectLastSessionMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key || typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      const updatedAt =
        typeof entry.updatedAt === "string" && Number.isFinite(Date.parse(entry.updatedAt))
          ? entry.updatedAt
          : new Date(0).toISOString();
      const sanitized: ProjectLastSessionEntry = {
        ...(isValidModelSelection(entry.modelSelection)
          ? { modelSelection: entry.modelSelection }
          : {}),
        ...(isValidInteractionMode(entry.interactionMode)
          ? { interactionMode: entry.interactionMode }
          : {}),
        ...(isValidRuntimeMode(entry.runtimeMode) ? { runtimeMode: entry.runtimeMode } : {}),
        updatedAt,
      };
      if (
        sanitized.modelSelection !== undefined ||
        sanitized.interactionMode !== undefined ||
        sanitized.runtimeMode !== undefined
      ) {
        result[key] = sanitized;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeStorageMap(storage: Storage | undefined, map: StoredProjectLastSessionMap): void {
  if (!storage) return;
  try {
    const entries = Object.entries(map);
    const trimmed =
      entries.length <= MAX_STORED_PROJECTS
        ? map
        : Object.fromEntries(
            entries
              .toSorted(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
              .slice(0, MAX_STORED_PROJECTS),
          );
    storage.setItem(PROJECT_LAST_SESSION_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
}

function defaultStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function recordProjectLastSession(
  projectKeys: readonly string[],
  patch: {
    readonly modelSelection?: ModelSelection | null;
    readonly interactionMode?: ProviderInteractionMode | null;
    readonly runtimeMode?: RuntimeMode | null;
  },
  storage: Storage | undefined = defaultStorage(),
): void {
  const uniqueKeys = [...new Set(projectKeys.filter((key) => key.length > 0))];
  if (uniqueKeys.length === 0) return;
  if (
    patch.modelSelection === undefined &&
    patch.interactionMode === undefined &&
    patch.runtimeMode === undefined
  ) {
    return;
  }
  const map = readStorageMap(storage);
  const now = new Date().toISOString();
  let changed = false;
  for (const key of uniqueKeys) {
    const previous = map[key];
    const next: ProjectLastSessionEntry = {
      ...(patch.modelSelection !== undefined
        ? patch.modelSelection !== null
          ? { modelSelection: patch.modelSelection }
          : {}
        : previous?.modelSelection !== undefined
          ? { modelSelection: previous.modelSelection }
          : {}),
      ...(patch.interactionMode !== undefined
        ? patch.interactionMode !== null
          ? { interactionMode: patch.interactionMode }
          : {}
        : previous?.interactionMode !== undefined
          ? { interactionMode: previous.interactionMode }
          : {}),
      ...(patch.runtimeMode !== undefined
        ? patch.runtimeMode !== null
          ? { runtimeMode: patch.runtimeMode }
          : {}
        : previous?.runtimeMode !== undefined
          ? { runtimeMode: previous.runtimeMode }
          : {}),
      updatedAt: now,
    };
    if (
      next.modelSelection === undefined &&
      next.interactionMode === undefined &&
      next.runtimeMode === undefined
    ) {
      continue;
    }
    map[key] = next;
    changed = true;
  }
  if (changed) {
    writeStorageMap(storage, map);
  }
}

export function readProjectLastSession(input: {
  readonly projectKeys: readonly string[];
  readonly targetProjectRef: ScopedProjectRef;
  readonly fallbackThreads: ReadonlyArray<
    Pick<
      EnvironmentThreadShell,
      | "environmentId"
      | "projectId"
      | "archivedAt"
      | "deletedAt"
      | "modelSelection"
      | "interactionMode"
      | "runtimeMode"
      | "updatedAt"
      | "latestRun"
      | "itemCount"
    >
  >;
  readonly storage?: Storage | undefined;
}): ProjectLastSessionEntry | null {
  const map = readStorageMap(input.storage ?? defaultStorage());
  let bestStored: ProjectLastSessionEntry | null = null;
  for (const key of input.projectKeys) {
    const entry = map[key];
    if (!entry) continue;
    if (bestStored === null || entry.updatedAt > bestStored.updatedAt) {
      bestStored = entry;
    }
  }
  if (bestStored !== null) {
    return bestStored;
  }

  const targetKey = scopedProjectKey(input.targetProjectRef);
  let latestThread: (typeof input.fallbackThreads)[number] | null = null;
  for (const thread of input.fallbackThreads) {
    if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
    if (scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)) !== targetKey) {
      continue;
    }
    if (thread.latestRun === null && thread.itemCount === 0) continue;
    if (latestThread === null || thread.updatedAt > latestThread.updatedAt) {
      latestThread = thread;
    }
  }
  if (latestThread === null) return null;

  return {
    ...(latestThread.modelSelection ? { modelSelection: latestThread.modelSelection } : {}),
    interactionMode: latestThread.interactionMode,
    runtimeMode: latestThread.runtimeMode,
    updatedAt: latestThread.updatedAt,
  };
}
