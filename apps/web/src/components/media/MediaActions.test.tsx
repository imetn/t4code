import {
  AuthFilesystemReadScope,
  EnvironmentId,
  ThreadId,
  type AuthSessionState,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { createElement, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const state = vi.hoisted(() => ({
  sessions: new Map<string, Pick<AuthSessionState, "authenticated" | "scopes">>(),
  mint: vi.fn(),
  download: vi.fn(),
  png: vi.fn(),
  imageFile: vi.fn(),
  quoteImage: vi.fn(),
  quoted: vi.fn(),
  quoteContext: null as ((file: File) => boolean | Promise<boolean>) | null,
  showMenu: vi.fn(),
  openFile: vi.fn(),
  clipboard: vi.fn(),
  copyText: vi.fn(),
  menuFinished: null as (() => void) | null,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <A,>(callback: A) => callback,
  useContext: () => state.quoteContext,
  useRef: <A,>(current: A) => ({ current }),
  useState: <A,>(initial: A) => [initial, () => {}],
}));
vi.mock("../../hooks/useCopyToClipboard", () => ({ writeTextToClipboard: state.copyText }));
vi.mock("../../localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: state.showMenu } }),
}));
vi.mock("../../state/assets", () => ({ assetEnvironment: { createUrl: {} } }));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.mint }));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: (environmentId: string) => environmentId },
  readPreparedConnection: () => ({ httpBaseUrl: "https://host.test" }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (environmentId: string) => ({
    data: state.sessions.get(environmentId) ?? null,
    error: null,
  }),
}));
vi.mock("../../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (environmentId: string) => {
      const session = state.sessions.get(environmentId);
      return session === undefined ? AsyncResult.initial() : AsyncResult.success(session);
    },
  },
}));
vi.mock("./mediaContent", () => ({
  downloadMedia: state.download,
  readMediaImageFile: state.imageFile,
  readMediaPng: state.png,
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: "Tooltip",
  TooltipTrigger: "TooltipTrigger",
  TooltipPopup: "TooltipPopup",
}));
vi.mock("../ui/toast", () => ({
  stackedThreadToast: <A,>(toast: A) => toast,
  toastManager: {
    add: (toast: { type: string }) => {
      if (toast.type !== "loading") state.menuFinished?.();
      return "toast";
    },
    close: () => {},
    update: () => state.menuFinished?.(),
  },
}));

import { MediaActions, useMediaActions, type MediaActionSource } from "./MediaActions";

const environmentId = EnvironmentId.make("media-environment");
const threadId = ThreadId.make("media-thread");
const granted: Pick<AuthSessionState, "authenticated" | "scopes"> = {
  authenticated: true,
  scopes: [AuthFilesystemReadScope],
};
const denied: Pick<AuthSessionState, "authenticated" | "scopes"> = {
  authenticated: true,
  scopes: [],
};

function hostSource(_tag: "workspace-file" | "media-file" = "media-file"): MediaActionSource {
  return {
    kind: "image",
    name: "image.png",
    src: null,
    asset: { environmentId, resource: { _tag, threadId, path: "/repo/image.png" } },
    reference: { kind: "file", path: "/repo/image.png", relativePath: "image.png" },
    onOpenFile: state.openFile,
  };
}

function openMenu(source: MediaActionSource) {
  const find = (node: ReactNode): ((event: unknown) => void) | undefined => {
    if (Array.isArray(node)) return node.map(find).find((handler) => handler !== undefined);
    if (!isValidElement<{ children?: ReactNode; onContextMenu?: (event: unknown) => void }>(node))
      return undefined;
    return node.props.onContextMenu ?? find(node.props.children);
  };
  const handler = find(MediaActions({ source, children: createElement("img") }));
  if (!handler) throw new Error("Media menu handler missing");
  handler({
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
    currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) },
    type: "contextmenu",
    button: 2,
    clientX: 1,
    clientY: 1,
  });
}

beforeEach(() => {
  state.sessions.clear();
  state.sessions.set(environmentId, denied);
  state.mint
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ relativeUrl: "/api/assets/image.png", expiresAt: 1 }));
  state.download.mockReset().mockResolvedValue(undefined);
  state.png.mockReset().mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  state.imageFile
    .mockReset()
    .mockResolvedValue(new File(["png"], "image.png", { type: "image/png" }));
  state.quoteImage.mockReset().mockResolvedValue(true);
  state.quoted.mockReset();
  state.quoteContext = null;
  state.showMenu.mockReset().mockResolvedValue(null);
  state.openFile.mockReset();
  state.copyText.mockReset().mockResolvedValue(true);
  state.menuFinished = null;
  class TestClipboardItem {
    constructor(readonly items: Record<string, Promise<Blob>>) {}
  }
  state.clipboard.mockReset().mockImplementation(async (items: TestClipboardItem[]) => {
    await Promise.all(items.flatMap((item) => Object.values(item.items)));
  });
  vi.stubGlobal("ClipboardItem", TestClipboardItem);
  vi.stubGlobal("navigator", { clipboard: { write: state.clipboard } });
});

afterEach(() => vi.unstubAllGlobals());

it.each(["workspace-file", "media-file"] as const)(
  "disables denied %s byte actions and prevents imperative requests",
  async (_tag) => {
    const source = hostSource(_tag);
    openMenu(source);
    expect(state.showMenu).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "save", disabled: true }),
        expect.objectContaining({ id: "copy-image", disabled: true }),
        expect.objectContaining({ id: "open-file", disabled: true }),
      ]),
      { x: 1, y: 1 },
      "mouse",
    );
    await expect(useMediaActions(source).save()).rejects.toThrow("cannot read host files");
    await expect(useMediaActions(source).copyImage()).rejects.toThrow("cannot read host files");
    expect(state.mint).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.clipboard).not.toHaveBeenCalled();
  },
);

it.each(["save", "copy-image", "open-file"])(
  "rechecks access when %s is selected from an already open native menu",
  async (action) => {
    state.sessions.set(environmentId, granted);
    const choice = deferred<string>();
    const completed = deferred<void>();
    state.showMenu.mockReturnValue(choice.promise);
    state.menuFinished = () => completed.resolve();
    state.openFile.mockImplementation(() => completed.resolve());
    openMenu(hostSource());

    state.sessions.set(environmentId, denied);
    choice.resolve(action);
    await completed.promise;

    expect(state.mint).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.clipboard).not.toHaveBeenCalled();
    expect(state.openFile).not.toHaveBeenCalled();
  },
);

it("quotes an image into the composer when QuoteMediaContext is provided", async () => {
  state.sessions.set(environmentId, granted);
  const completed = deferred<void>();
  state.quoteImage.mockImplementation(async () => {
    completed.resolve();
    return true;
  });
  state.quoteContext = state.quoteImage;
  state.showMenu.mockResolvedValue("quote-image");

  openMenu({ ...hostSource(), onQuoted: state.quoted });
  await completed.promise;
  await Promise.resolve();

  expect(state.showMenu).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ id: "quote-image", disabled: false })]),
    { x: 1, y: 1 },
    "mouse",
  );
  expect(state.imageFile).toHaveBeenCalledWith(
    "https://host.test/api/assets/image.png",
    "image.png",
    undefined,
  );
  expect(state.quoteImage).toHaveBeenCalledWith(expect.any(File));
  expect(state.quoted).toHaveBeenCalledOnce();
});

it("omits Quote image for videos or when no quote handler is active", () => {
  state.sessions.set(environmentId, granted);
  openMenu(hostSource());
  expect(
    state.showMenu.mock.calls[0]?.[0].some((item: { id: string }) => item.id === "quote-image"),
  ).toBe(false);

  state.showMenu.mockClear();
  state.quoteContext = state.quoteImage;
  openMenu({ ...hostSource(), kind: "video" });
  expect(
    state.showMenu.mock.calls[0]?.[0].some((item: { id: string }) => item.id === "quote-image"),
  ).toBe(false);
});
