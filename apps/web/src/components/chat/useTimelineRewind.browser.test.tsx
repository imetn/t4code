import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { useTimelineRewind } from "./useTimelineRewind";

const commands = vi.hoisted(() => ({
  fork: vi.fn(),
  waitForThreadShell: vi.fn(),
}));

vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: () => commands.fork,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  waitForThreadShell: commands.waitForThreadShell,
}));

const environmentId = EnvironmentId.make("test");
const sourceThreadId = ThreadId.make("source");
const sourcePath = "/test/source";
const runId = RunId.make("run");

function ForkButton({
  start,
  threadId = sourceThreadId,
}: {
  start: (completion: Promise<void>) => void;
  threadId?: ThreadId;
}) {
  const threadRef = scopeThreadRef(environmentId, threadId);
  const routeThreadKey = scopedThreadKey(threadRef);
  const { onForkFromRunStable } = useTimelineRewind({
    environmentId,
    routeThreadRef: threadRef,
    routeThreadKey,
    currentRouteThreadKeyRef: { current: routeThreadKey },
    serverProjection: null,
    activeThread: { id: threadId, title: "Source" } as EnvironmentThreadShell,
    timelineMessages: [],
    phase: "ready",
    isSendBusy: false,
    isRevertingCheckpoint: false,
    supportsConversationRollback: false,
    activeEnvironmentUnavailable: false,
    activeEnvironmentUnavailableLabel: null,
    promptRef: { current: "" },
    composerRef: { current: null },
    composerDraftTarget: threadRef,
    setThreadError: () => undefined,
  });

  return (
    <button
      type="button"
      onClick={() => start(onForkFromRunStable({ sourceThreadId: threadId, runId }))}
    >
      Fork from this response
    </button>
  );
}

it.each([
  { paths: ["/test/other"], destination: "/test/other" },
  { paths: ["/test/other", sourcePath], destination: sourcePath },
])("keeps $destination open after the fork finishes", async ({ paths, destination }) => {
  const shellRequested = Promise.withResolvers<void>();
  const shellReady = Promise.withResolvers<boolean>();
  commands.fork.mockResolvedValue({ _tag: "Success" });
  commands.waitForThreadShell.mockImplementation(() => {
    shellRequested.resolve();
    return shellReady.promise;
  });

  const forkFinished = Promise.withResolvers<void>();
  await using screen = await render(<ForkButton start={forkFinished.resolve} />, {
    router: sourcePath,
  });
  const router = screen.router!;
  await screen.getByRole("button", { name: "Fork from this response" }).click();
  await shellRequested.promise;

  await act(async () => {
    for (const path of paths) {
      await router.navigate({ to: path });
    }
    shellReady.resolve(true);
    await forkFinished.promise;
  });

  expect(router.state.location.pathname).toBe(destination);
});

it("skips navigation when an embedded board selection changes or closes before a fork finishes", async () => {
  for (const mode of ["switch", "roundtrip", "unmount"] as const) {
    const shellRequested = Promise.withResolvers<void>();
    const shellReady = Promise.withResolvers<boolean>();
    commands.fork.mockResolvedValue({ _tag: "Success" });
    commands.waitForThreadShell.mockImplementation(() => {
      shellRequested.resolve();
      return shellReady.promise;
    });

    const forkFinished = Promise.withResolvers<void>();
    await using screen = await render(<ForkButton start={forkFinished.resolve} />, {
      router: "/board",
    });
    const router = screen.router!;
    await screen.getByRole("button", { name: "Fork from this response" }).click();
    await shellRequested.promise;

    if (mode === "switch") {
      await screen.rerender(
        <ForkButton start={forkFinished.resolve} threadId={ThreadId.make("other")} />,
      );
    } else if (mode === "roundtrip") {
      await screen.rerender(
        <ForkButton start={forkFinished.resolve} threadId={ThreadId.make("other")} />,
      );
      await screen.rerender(<ForkButton start={forkFinished.resolve} threadId={sourceThreadId} />);
    } else {
      await screen.rerender(null);
    }

    await act(async () => {
      shellReady.resolve(true);
      await forkFinished.promise;
    });

    expect(router.state.location.pathname).toBe("/board");
  }
});
