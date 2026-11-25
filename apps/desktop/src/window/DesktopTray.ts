import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Electron from "electron";
import { msg } from "gt-i18n";
import type { DesktopTrayState } from "@t3tools/contracts";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import { m, onLocaleChange } from "../i18n/messages.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

const T4_TRAY_TEMPLATE_1X_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAEqADAAQAAAABAAAAEgAAAAC5YZBvAAAA0klEQVQ4EWNgGAWEQoARqsAcSPPgUPwBKH4WSY4TyLaC8o8D6W9IcgwXgJz/OPBhJIUgi1cjqdOAybFAGS1AWhiIOYB4AlQsA0o/h9Igqh2IQ5D4OJkg78Fchq4oBSp3B0i/hbLhLkJXjMsgF6DC31AD1ID0YyAGWUiSQdpADaAA/wnE9kAMAmQZ1AvUCPMuyFUgDOP/AbLBMQoLbCAfJ7gMlNmAJusB5HMA8X4gBsljAFxhhK4Qw2voLgI5eyoQg5yODywASgoC8Xt8ikblUEMAAIvdOur0cqApAAAAAElFTkSuQmCC";

const T4_TRAY_TEMPLATE_2X_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAJKADAAQAAAABAAAAJAAAAAAJxsHGAAABk0lEQVRYCe1WPUsDQRA9v7HVShubaGXjD9BfYGGjlSDYW1qGdP6AFKm0EOytBLGyshPBQrSwEEQrUVAQgl9vTBbeDsu6d2wkxQxM9r3ZuZnNzNxyRWFiFbAKWAWsAl4FBoitAi8QLwNP4XwSeaCGvU21fwB+pWwe3Qf7rqg7XiSfTIDeBOKu+G4dNhgyZrSNItYhdC415jA53gFfEBc4Ap1XNu0j2w/Kx9E9gCVHcqxTCMJt/CoRtKGe5TiCgy37K37VA62rw3yCvyhb8EC9mKFFJJZWsWyDRN8odo7hshWaRbAnKLen1U1wpuw9r9AkEh5B5TV3cgyw5UjKmqtlY0gmr7dUyMklwBpU5idZch1IZkZmx8kjwDL01RlyrSkzNI1kPDOCP6DvSuXKYL827e8C/wpfjM6WYx1CENGYyKUrKuLWIlfLOmEz/Oao0DPOsZFwljp8auTXBD7v8luyR2HKDEUD0Oa/30OUuzrsuxniL8bQ35IZ476Lz3XIMcE2A59x8rsHfiNu0CpgFbAK9EUFfgDLYnEWm6pPhQAAAABJRU5ErkJggg==";

const DEFAULT_TRAY_STATE: DesktopTrayState = {
  enabled: true,
  workingCount: 0,
  attentionCount: 0,
  activeCount: 0,
  threads: [],
};

const { logWarning: logTrayWarning } = makeComponentLogger("desktop-tray");

function createMacTrayTemplateImage(): Electron.NativeImage {
  const image = Electron.nativeImage.createEmpty();
  image.addRepresentation({
    scaleFactor: 1,
    width: 18,
    height: 18,
    buffer: Buffer.from(T4_TRAY_TEMPLATE_1X_BASE64, "base64"),
  });
  image.addRepresentation({
    scaleFactor: 2,
    width: 36,
    height: 36,
    buffer: Buffer.from(T4_TRAY_TEMPLATE_2X_BASE64, "base64"),
  });
  image.setTemplateImage(true);
  return image;
}

function formatTrayTitle(state: DesktopTrayState): string {
  if (state.workingCount === 0 && state.attentionCount === 0) return "";
  if (state.workingCount > 0 && state.attentionCount > 0) {
    return ` ${state.workingCount} · !${state.attentionCount}`;
  }
  if (state.attentionCount > 0) {
    return ` !${state.attentionCount}`;
  }
  return ` ${state.workingCount}`;
}

function truncateMenuLabel(value: string, maxLength = 52): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function isTrayAlive(target: Electron.Tray | null): target is Electron.Tray {
  return target !== null && (typeof target.isDestroyed !== "function" || !target.isDestroyed());
}

export class DesktopTray extends Context.Service<
  DesktopTray,
  {
    readonly initialize: Effect.Effect<void>;
    readonly configure: (keepRunningInTray: boolean) => Effect.Effect<void>;
    readonly updateState: (state: DesktopTrayState) => Effect.Effect<void>;
    readonly dispose: Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopTray") {}

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const desktopState = yield* DesktopState.DesktopState;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronApp = yield* ElectronApp.ElectronApp;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);

  const trayStateRef = yield* Ref.make<DesktopTrayState>(DEFAULT_TRAY_STATE);
  const configureMutex = yield* Semaphore.make(1);
  let tray: Electron.Tray | null = null;

  const dispatchAction = (action: string) => {
    void runPromise(
      desktopWindow
        .dispatchMenuAction(action, { reveal: true })
        .pipe(
          Effect.catchCause((cause) =>
            logTrayWarning("Desktop tray action failed", { action, cause }),
          ),
        ),
    );
  };

  const activateApp = () => {
    void runPromise(
      desktopWindow.activate.pipe(
        Effect.catchCause((cause) => logTrayWarning("Desktop tray activate failed", { cause })),
      ),
    );
  };

  const quitApp = () => {
    void runPromise(electronApp.quit);
  };

  const destroyTray = Effect.sync(() => {
    const previous = tray;
    tray = null;
    if (isTrayAlive(previous)) {
      previous.destroy();
    }
  });

  const cleanup = Ref.set(desktopState.closeToTray, false).pipe(Effect.andThen(destroyTray));

  yield* Effect.addFinalizer(() => cleanup);

  const buildMenuTemplate = (state: DesktopTrayState): Electron.MenuItemConstructorOptions[] => {
    const statusSummary =
      state.workingCount === 0 && state.attentionCount === 0
        ? m(msg("{appName}: Idle"), { appName: environment.displayName })
        : [
            state.workingCount > 0
              ? m(msg("{count} working"), { count: String(state.workingCount) })
              : null,
            state.attentionCount > 0
              ? m(msg("{count} waiting"), { count: String(state.attentionCount) })
              : null,
          ]
            .filter((part): part is string => part !== null)
            .join(" · ");

    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
      {
        label: statusSummary,
        enabled: false,
      },
    ];

    if (state.threads.length > 0) {
      menuTemplate.push({ type: "separator" });
      for (const thread of state.threads) {
        const prefix =
          thread.status === "attention" ? "!" : thread.status === "working" ? "●" : "○";
        const meta = [thread.projectName, thread.environmentLabel].filter(Boolean).join(" · ");
        const title = truncateMenuLabel(thread.title || m(msg("Untitled thread")), 42);
        const label = meta
          ? `${prefix} ${title}  (${truncateMenuLabel(meta, 24)})`
          : `${prefix} ${title}`;
        menuTemplate.push({
          label,
          click: () =>
            dispatchAction(
              `tray:open-thread:${encodeURIComponent(thread.environmentId)}:${encodeURIComponent(thread.threadId)}`,
            ),
        });
      }
    }

    menuTemplate.push(
      { type: "separator" },
      {
        label: m(msg("Open {appName}"), { appName: environment.displayName }),
        click: activateApp,
      },
      {
        label: m(msg("Task board")),
        click: () => dispatchAction("open-board"),
      },
      {
        label: m(msg("New thread")),
        click: () => dispatchAction("new-thread"),
      },
      {
        label: m(msg("Usage")),
        click: () => dispatchAction("open-usage"),
      },
      {
        label: m(msg("Settings...")),
        click: () => dispatchAction("open-settings"),
      },
      { type: "separator" },
      {
        label: m(msg("Quit {appName}"), { appName: environment.displayName }),
        click: quitApp,
      },
    );

    return menuTemplate;
  };

  const applyTrayPresentation = (targetTray: Electron.Tray, state: DesktopTrayState) => {
    if (environment.platform === "darwin") {
      targetTray.setTitle(formatTrayTitle(state), { fontType: "monospacedDigit" });
    }
    targetTray.setContextMenu(Electron.Menu.buildFromTemplate(buildMenuTemplate(state)));
  };

  const syncMacTray = Effect.gen(function* () {
    const state = yield* Ref.get(trayStateRef);
    if (!state.enabled) {
      yield* destroyTray;
      return;
    }

    let creating = false;
    let currentTray: Electron.Tray;
    if (isTrayAlive(tray)) {
      currentTray = tray;
    } else {
      creating = true;
      currentTray = yield* Effect.sync(() => {
        const nextTray = new Electron.Tray(createMacTrayTemplateImage());
        tray = nextTray;
        return nextTray;
      });
    }

    yield* Effect.sync(() => {
      if (creating) {
        currentTray.setToolTip(environment.displayName);
      }
      applyTrayPresentation(currentTray, state);
    }).pipe(
      Effect.catchCause((cause) =>
        (creating
          ? destroyTray.pipe(
              Effect.catchCause((cleanupCause) =>
                logTrayWarning("failed to destroy the unfinished tray", { cause: cleanupCause }),
              ),
            )
          : Effect.void
        ).pipe(Effect.andThen(logTrayWarning("failed to configure the menu bar tray", { cause }))),
      ),
    );
  }).pipe(
    Effect.catchCause((cause) =>
      destroyTray.pipe(
        Effect.catchCause((cleanupCause) =>
          logTrayWarning("failed to destroy the unfinished tray", { cause: cleanupCause }),
        ),
        Effect.andThen(logTrayWarning("failed to configure the menu bar tray", { cause })),
      ),
    ),
  );

  const applyCloseToTrayEnabled = Effect.gen(function* () {
    if (environment.platform === "darwin" || isTrayAlive(tray)) return;
    const iconPaths = yield* assets.iconPaths;
    // Tray icons need a real image; a missing or undecodable asset leaves the
    // feature off so window close keeps its normal quit behavior.
    const created = yield* Effect.sync(() => {
      if (environment.platform === "win32") {
        const icoPath = Option.getOrNull(iconPaths.ico);
        return icoPath === null ? null : new Electron.Tray(icoPath);
      }
      const pngPath = Option.getOrNull(iconPaths.png);
      if (pngPath === null) return null;
      const image = Electron.nativeImage.createFromPath(pngPath).resize({ width: 32, height: 32 });
      return image.isEmpty() ? null : new Electron.Tray(image);
    });
    if (created === null) {
      yield* logTrayWarning("no tray icon image is available; close to tray stays off");
      return;
    }
    tray = created;
    const state = yield* Ref.get(trayStateRef);
    yield* Effect.sync(() => {
      created.setToolTip(environment.displayName);
      applyTrayPresentation(created, state);
      created.on("click", activateApp);
    });
    yield* Ref.set(desktopState.closeToTray, true);
  }).pipe(
    Effect.catchCause((cause) =>
      Ref.set(desktopState.closeToTray, false).pipe(
        Effect.andThen(
          destroyTray.pipe(
            Effect.catchCause((cleanupCause) =>
              logTrayWarning("failed to destroy the unfinished tray", { cause: cleanupCause }),
            ),
          ),
        ),
        Effect.andThen(logTrayWarning("failed to configure the system tray", { cause })),
      ),
    ),
  );

  const applyCloseToTrayDisabled = Effect.gen(function* () {
    if (environment.platform === "darwin") return;
    if (tray === null) return;
    yield* Ref.set(desktopState.closeToTray, false);
    yield* destroyTray;
  });

  const refreshActiveTray = Effect.gen(function* () {
    if (!isTrayAlive(tray)) return;
    const currentTray = tray;
    const state = yield* Ref.get(trayStateRef);
    yield* Effect.sync(() => applyTrayPresentation(currentTray, state));
  }).pipe(
    Effect.catchCause((cause) => logTrayWarning("failed to refresh the system tray", { cause })),
  );

  yield* Effect.acquireRelease(
    Effect.sync(() =>
      onLocaleChange(() => {
        void runPromise(configureMutex.withPermits(1)(refreshActiveTray));
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );

  return DesktopTray.of({
    initialize: clientSettings.get.pipe(
      Effect.flatMap((stored) => {
        if (environment.platform === "darwin") {
          const enabled = Option.isSome(stored) ? stored.value.menuBarIconEnabled : true;
          return configureMutex.withPermits(1)(
            Ref.update(trayStateRef, (current) => ({ ...current, enabled })).pipe(
              Effect.andThen(syncMacTray),
            ),
          );
        }
        return Option.isSome(stored) && stored.value.keepRunningInTray
          ? configureMutex.withPermits(1)(applyCloseToTrayEnabled)
          : Effect.void;
      }),
      Effect.catch((error) =>
        logTrayWarning("could not read client settings for the tray", {
          message: error.message,
        }),
      ),
      Effect.withSpan("desktop.tray.initialize"),
    ),
    configure: Effect.fn("desktop.tray.configure")(function* (keepRunningInTray) {
      if (environment.platform === "darwin") return;
      yield* configureMutex
        .withPermits(1)(keepRunningInTray ? applyCloseToTrayEnabled : applyCloseToTrayDisabled)
        .pipe(
          Effect.catchCause((cause) =>
            logTrayWarning("failed to update the system tray", { cause }),
          ),
        );
    }),
    updateState: Effect.fn("desktop.tray.updateState")(function* (nextState) {
      yield* configureMutex.withPermits(1)(
        Effect.gen(function* () {
          yield* Ref.set(trayStateRef, nextState);
          if (environment.platform === "darwin") {
            yield* syncMacTray;
          } else if (isTrayAlive(tray)) {
            const currentTray = tray;
            yield* Effect.sync(() => applyTrayPresentation(currentTray, nextState)).pipe(
              Effect.catchCause((cause) =>
                logTrayWarning("failed to update the system tray menu", { cause }),
              ),
            );
          }
        }),
      );
    }),
    dispose: cleanup,
  });
});

export const layer = Layer.effect(DesktopTray, make);
