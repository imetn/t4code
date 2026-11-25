import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  PROJECT_LAST_SESSION_STORAGE_KEY,
  readProjectLastSession,
  recordProjectLastSession,
} from "./projectLastSessionMemory";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("projectLastSessionMemory", () => {
  const envId = EnvironmentId.make("env-1");
  const projectId = ProjectId.make("proj-1");
  const codex = ProviderInstanceId.make("codex");
  const claude = ProviderInstanceId.make("claudeAgent");

  it("records and merges model, interactionMode, and runtimeMode per project", () => {
    const storage = createMemoryStorage();
    recordProjectLastSession(
      ["repo:t4code", `${envId}:${projectId}`],
      {
        modelSelection: { instanceId: codex, model: "gpt-6.2-sol" },
        interactionMode: "plan",
      },
      storage,
    );
    recordProjectLastSession(
      ["repo:t4code"],
      {
        runtimeMode: "full-access",
      },
      storage,
    );

    const remembered = readProjectLastSession({
      projectKeys: ["repo:t4code", `${envId}:${projectId}`],
      targetProjectRef: { environmentId: envId, projectId },
      fallbackThreads: [],
      storage,
    });

    expect(remembered?.modelSelection).toEqual({ instanceId: codex, model: "gpt-6.2-sol" });
    expect(remembered?.interactionMode).toBe("plan");
    expect(remembered?.runtimeMode).toBe("full-access");
    expect(storage.getItem(PROJECT_LAST_SESSION_STORAGE_KEY)).toBeTruthy();
  });

  it("falls back to the most recently updated started thread in the same project", () => {
    const storage = createMemoryStorage();
    const remembered = readProjectLastSession({
      projectKeys: ["repo:t4code"],
      targetProjectRef: { environmentId: envId, projectId },
      fallbackThreads: [
        {
          environmentId: envId,
          projectId,
          archivedAt: null,
          deletedAt: null,
          modelSelection: { instanceId: claude, model: "claude-opus-5-5" },
          interactionMode: "default",
          runtimeMode: "auto",
          updatedAt: "2026-11-25T10:00:00.000Z",
          latestRun: null,
          itemCount: 3,
        },
        {
          environmentId: envId,
          projectId,
          archivedAt: null,
          deletedAt: null,
          modelSelection: { instanceId: codex, model: "gpt-6.2-sol" },
          interactionMode: "plan",
          runtimeMode: "full-access",
          updatedAt: "2026-11-25T12:00:00.000Z",
          latestRun: null,
          itemCount: 5,
        },
      ],
      storage,
    });

    expect(remembered?.modelSelection).toEqual({ instanceId: codex, model: "gpt-6.2-sol" });
    expect(remembered?.interactionMode).toBe("plan");
    expect(remembered?.runtimeMode).toBe("full-access");
  });
});
