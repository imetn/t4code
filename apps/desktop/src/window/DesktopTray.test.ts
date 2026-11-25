import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  type ClientSettings,
  type DesktopTrayState,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { beforeEach, vi } from "vite-plus/test";

const electronMock = vi.hoisted(() => {
  interface FakeTray {
    setToolTip: ReturnType<typeof vi.fn>;
    setTitle: ReturnType<typeof vi.fn>;
    setContextMenu: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  }
  const trays: FakeTray[] = [];
  const resizedImage = { isEmpty: vi.fn(() => false) };
  const resize = vi.fn(() => resizedImage);
  const createFromPath = vi.fn(() => ({ resize }));
  const emptyImage = {
    addRepresentation: vi.fn(),
    setTemplateImage: vi.fn(),
  };
  const createEmpty = vi.fn(() => emptyImage);
  const createTray = function (this: FakeTray) {
    this.destroyed = false;
    this.setToolTip = vi.fn();
    this.setTitle = vi.fn();
    this.setContextMenu = vi.fn();
    this.on = vi.fn();
    this.isDestroyed = vi.fn(() => this.destroyed);
    this.destroy = vi.fn(() => {
      this.destroyed = true;
    });
    trays.push(this);
  };
  const Tray = vi.fn(createTray);
  const buildFromTemplate = vi.fn((template: ReadonlyArray<Record<string, unknown>>) => ({
    template,
  }));
  return {
    trays,
    resizedImage,
    resize,
    createFromPath,
    emptyImage,
    createEmpty,
    createTray,
    Tray,
    buildFromTemplate,
  };
});

vi.mock("electron", () => ({
  Tray: electronMock.Tray,
  Menu: { buildFromTemplate: electronMock.buildFromTemplate },
  nativeImage: {
    createFromPath: electronMock.createFromPath,
    createEmpty: electronMock.createEmpty,
  },
}));

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopTray from "./DesktopTray.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

beforeEach(() => {
  electronMock.trays.length = 0;
  electronMock.Tray.mockReset().mockImplementation(electronMock.createTray);
  electronMock.buildFromTemplate.mockClear();
  electronMock.createFromPath.mockClear();
  electronMock.createEmpty.mockClear();
  electronMock.emptyImage.addRepresentation.mockClear();
  electronMock.emptyImage.setTemplateImage.mockClear();
  electronMock.resize.mockClear();
  electronMock.resizedImage.isEmpty.mockReset().mockReturnValue(false);
});

function layerTest(input: {
  readonly platform: NodeJS.Platform;
  readonly ico?: string | undefined;
  readonly png?: string | undefined;
  readonly settings?: Option.Option<ClientSettings>;
  readonly onActivate?: () => void;
  readonly onQuit?: () => void;
}) {
  const layerDesktopEnvironment = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/dist-electron",
    homeDirectory: "/home/alice",
    platform: input.platform,
    processArch: "x64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: false,
    resourcesPath: "/repo/resources",
    runningUnderArm64Translation: false,
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))));
  return DesktopTray.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        DesktopState.layer,
        Layer.succeed(DesktopAssets.DesktopAssets, {
          iconPaths: Effect.succeed({
            ico: Option.fromNullishOr(input.ico),
            icns: Option.none<string>(),
            png: Option.fromNullishOr(input.png),
          }),
          resolveResourcePath: () => Effect.succeed(Option.none<string>()),
        } satisfies DesktopAssets.DesktopAssets["Service"]),
        layerDesktopEnvironment,
        Layer.mock(DesktopWindow.DesktopWindow)({
          activate: Effect.sync(() => {
            input.onActivate?.();
          }),
          dispatchMenuAction: () => Effect.void,
        }),
        Layer.mock(ElectronApp.ElectronApp)({
          quit: Effect.sync(() => {
            input.onQuit?.();
          }),
        }),
        DesktopClientSettings.layerTest(input.settings ?? Option.none()),
      ),
    ),
  );
}

const SAMPLE_TRAY_STATE: DesktopTrayState = {
  enabled: true,
  workingCount: 2,
  attentionCount: 1,
  activeCount: 3,
  threads: [
    {
      environmentId: EnvironmentId.make("env-1"),
      threadId: "thread-1",
      title: "Fix tray integration",
      projectName: "t4code",
      environmentLabel: "Local",
      status: "working",
    },
  ],
};

describe("DesktopTray", () => {
  it.effect("creates one tray on win32, then destroys it when the setting turns off", () =>
    Effect.gen(function* () {
      const tray = yield* DesktopTray.DesktopTray;
      const state = yield* DesktopState.DesktopState;

      yield* tray.configure(true);
      assert.equal(electronMock.trays.length, 1);
      assert.isTrue(yield* Ref.get(state.closeToTray));

      yield* tray.configure(true);
      assert.equal(electronMock.trays.length, 1);

      yield* tray.configure(false);
      assert.equal(electronMock.trays[0]!.destroy.mock.calls.length, 1);
      assert.isFalse(yield* Ref.get(state.closeToTray));
    }).pipe(
      Effect.provide(layerTest({ platform: "win32", ico: "C:\\icons\\t3.ico" })),
      Effect.scoped,
    ),
  );

  it.effect(
    "refreshes the active win32 tray menu on updateState without duplicating the tray",
    () => {
      const activate = vi.fn();
      const quit = vi.fn();
      return Effect.gen(function* () {
        const tray = yield* DesktopTray.DesktopTray;
        const state = yield* DesktopState.DesktopState;

        // Live thread updates do not create a tray while keepRunningInTray is off.
        yield* tray.updateState(SAMPLE_TRAY_STATE);
        assert.equal(electronMock.trays.length, 0);
        assert.isFalse(yield* Ref.get(state.closeToTray));

        yield* tray.configure(true);
        assert.equal(electronMock.trays.length, 1);
        assert.isTrue(yield* Ref.get(state.closeToTray));

        const beforeMenuCalls = electronMock.trays[0]!.setContextMenu.mock.calls.length;
        yield* tray.updateState({ ...SAMPLE_TRAY_STATE, workingCount: 3 });
        assert.equal(electronMock.trays.length, 1);
        assert.equal(electronMock.trays[0]!.setContextMenu.mock.calls.length, beforeMenuCalls + 1);
        assert.equal(electronMock.trays[0]!.setTitle.mock.calls.length, 0);

        const clickCall = electronMock.trays[0]!.on.mock.calls.find(
          (call) => call[0] === "click",
        ) as [string, () => void] | undefined;
        assert.isDefined(clickCall);
        clickCall[1]();
        assert.equal(activate.mock.calls.length, 1);

        const lastTemplate = electronMock.buildFromTemplate.mock.calls.at(-1)?.[0] ?? [];
        const quitItem = lastTemplate.find(
          (item) => typeof item.label === "string" && item.label.startsWith("Quit "),
        ) as { click?: () => void } | undefined;
        const quitClick = quitItem?.click;
        assert.isDefined(quitClick);
        quitClick();
        assert.equal(quit.mock.calls.length, 1);

        yield* tray.dispose;
        assert.equal(electronMock.trays[0]!.destroy.mock.calls.length, 1);
        assert.isFalse(yield* Ref.get(state.closeToTray));
      }).pipe(
        Effect.provide(
          layerTest({
            platform: "win32",
            ico: "C:\\icons\\t3.ico",
            onActivate: activate,
            onQuit: quit,
          }),
        ),
        Effect.scoped,
      );
    },
  );

  it.effect("resizes the png icon on linux and stays off when the decoded image is empty", () =>
    Effect.gen(function* () {
      const tray = yield* DesktopTray.DesktopTray;
      const state = yield* DesktopState.DesktopState;

      electronMock.resizedImage.isEmpty.mockReturnValueOnce(true);
      yield* tray.configure(true);
      assert.equal(electronMock.trays.length, 0);
      assert.isFalse(yield* Ref.get(state.closeToTray));

      yield* tray.configure(true);
      assert.equal(electronMock.trays.length, 1);
      assert.isTrue(yield* Ref.get(state.closeToTray));
      assert.deepEqual(electronMock.resize.mock.calls.at(-1), [{ width: 32, height: 32 }]);
    }).pipe(Effect.provide(layerTest({ platform: "linux", png: "/icons/t3.png" })), Effect.scoped),
  );

  it.effect.each(["initialize", "configure"] as const)(
    "recovers from menu setup failure during %s",
    (operation) =>
      Effect.gen(function* () {
        const tray = yield* DesktopTray.DesktopTray;
        const state = yield* DesktopState.DesktopState;
        electronMock.buildFromTemplate.mockImplementationOnce(() => {
          throw new Error("menu unavailable");
        });
        yield* operation === "initialize" ? tray.initialize : tray.configure(true);
        assert.isFalse(yield* Ref.get(state.closeToTray));
        assert.equal(electronMock.trays[0]!.destroy.mock.calls.length, 1);
        yield* tray.configure(true);
        assert.equal(electronMock.trays.length, 2);
        assert.isTrue(yield* Ref.get(state.closeToTray));
      }).pipe(
        Effect.provide(
          layerTest({
            platform: "win32",
            ico: "icon.ico",
            settings: Option.some({ ...DEFAULT_CLIENT_SETTINGS, keepRunningInTray: true }),
          }),
        ),
        Effect.scoped,
      ),
  );

  it.effect.each([
    {
      name: "darwin configure never creates a close-to-tray icon",
      platform: "darwin" as const,
      ico: "icon.ico",
      png: "icon.png",
      throwOnConstruct: false,
    },
    {
      name: "a missing icon path never creates a tray",
      platform: "win32" as const,
      ico: undefined,
      png: undefined,
      throwOnConstruct: false,
    },
    {
      name: "a throwing Tray constructor never creates a tray",
      platform: "win32" as const,
      ico: "icon.ico",
      png: undefined,
      throwOnConstruct: true,
    },
  ])("$name and leaves closeToTray off", ({ platform, ico, png, throwOnConstruct }) =>
    Effect.gen(function* () {
      if (throwOnConstruct) {
        electronMock.Tray.mockImplementation(function () {
          throw new Error("tray unavailable");
        });
      }
      const tray = yield* DesktopTray.DesktopTray;
      const state = yield* DesktopState.DesktopState;

      yield* tray.configure(true);
      yield* tray.configure(true);

      assert.equal(electronMock.trays.length, 0);
      assert.isFalse(yield* Ref.get(state.closeToTray));
    }).pipe(Effect.provide(layerTest({ platform, ico, png })), Effect.scoped),
  );

  it.effect.each([
    {
      name: "turns closeToTray on when the setting is enabled",
      settings: Option.some<ClientSettings>({
        ...DEFAULT_CLIENT_SETTINGS,
        keepRunningInTray: true,
      }),
      expected: true,
    },
    {
      name: "stays off without stored settings",
      settings: Option.none<ClientSettings>(),
      expected: false,
    },
  ])("initialize on win32 $name", ({ settings, expected }) =>
    Effect.gen(function* () {
      const tray = yield* DesktopTray.DesktopTray;
      const state = yield* DesktopState.DesktopState;

      yield* tray.initialize;

      assert.equal(yield* Ref.get(state.closeToTray), expected);
      assert.equal(electronMock.trays.length, expected ? 1 : 0);
    }).pipe(
      Effect.provide(layerTest({ platform: "win32", ico: "icon.ico", settings })),
      Effect.scoped,
    ),
  );

  it.effect(
    "keeps a single macOS menu bar tray with live title/menu while leaving closeToTray off",
    () =>
      Effect.gen(function* () {
        const tray = yield* DesktopTray.DesktopTray;
        const state = yield* DesktopState.DesktopState;

        yield* tray.initialize;
        assert.equal(electronMock.trays.length, 1);
        assert.isFalse(yield* Ref.get(state.closeToTray));
        assert.equal(electronMock.emptyImage.setTemplateImage.mock.calls.length, 1);

        // Enabling keepRunningInTray does not duplicate the tray or enable closeToTray on macOS.
        yield* tray.configure(true);
        assert.equal(electronMock.trays.length, 1);
        assert.isFalse(yield* Ref.get(state.closeToTray));

        yield* tray.updateState(SAMPLE_TRAY_STATE);
        assert.equal(electronMock.trays.length, 1);
        assert.deepEqual(electronMock.trays[0]!.setTitle.mock.calls.at(-1), [
          " 2 · !1",
          { fontType: "monospacedDigit" },
        ]);

        yield* tray.updateState({ ...SAMPLE_TRAY_STATE, enabled: false });
        assert.equal(electronMock.trays[0]!.destroy.mock.calls.length, 1);
      }).pipe(
        Effect.provide(
          layerTest({
            platform: "darwin",
            settings: Option.some({
              ...DEFAULT_CLIENT_SETTINGS,
              menuBarIconEnabled: true,
              keepRunningInTray: true,
            }),
          }),
        ),
        Effect.scoped,
      ),
  );
});
