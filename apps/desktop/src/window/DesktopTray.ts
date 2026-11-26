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

// macOS Menu Bar HIG template image: 22x18 pt (12.6 pt optical cap height, optically kerned T4, lifted 0.5pt to match macOS menu bar baseline).
const T4_TRAY_TEMPLATE_1X_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABYAAAASCAYAAABfJS4tAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAFqADAAQAAAABAAAAEgAAAADKabegAAABEklEQVQ4EWNgGGqAEehgSSDeTKTD9wHVlSGp7QGyHaD8C0A6BcoGUwpA8j+ReA1YB4QoRdNzGEmOgQXI+QTEU5AERYDsCCj/CZDegCQHchUIBANxJ5hFAqEHVAvzwW4s+syAYt+gav4iqUVxMRMWjfiE5IGSm4CYE4j/AXE5EGMFpBjMDzRhKxCLQ00qANI4I51Yg0FxAYo4baihk4E0COMEIA3EgH6gIheowntAejsQuwGxLFQMRAkAMUgMBA5BKFQSW+SdASqBRSgxtAKxQYFqNRE8YoPCA2gWKxbzVIBiMG+fArIDoGpeEWvwGyyGgoT4kMR/AdnPYXxsBn8HSp6FKrgNU4iD/oGk9iYONSNdGACbT0Vf3zdWxAAAAABJRU5ErkJggg==";

const T4_TRAY_TEMPLATE_2X_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACwAAAAkCAYAAADy19hsAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAALKADAAQAAAABAAAAJAAAAADv1o5YAAAB3UlEQVRYCe1XTSuFQRS+5GOpKBtLX//ARj7K1sIOSX6DZHmVBWVhQyxE/AOE/AYkd4vugoSyxsrHc/LObZp7Zsa878yrmzl1mjPPOXPOc0/z8d5CIUrsQG13oC6h34NxLsBP2UbOC03eRuBL0BbGfwrsgMEr0DCsrwA6WalQbewZ6i1Xh/8g9TpHYLyI/DNpavwFYer6YhqytCZvwv2ouQsVZ4c4OElDEn2Gsdewcgy+Fca/CmyLwQX0JAyMXdBDaLOEOZuC8DtW3hhWy4XlsBfLOhHbCuME2iaAtGMeW6IJ5PahdHWq8qYCtnkehOkuHmSIPAKbZ3AjFJrwAqpPMwxegY1CHxifEQpJeAqVuevrE/gE9MrITOMMRXgA9XY0NWeBH2t8VjgE4W5UpUPGXV/rwNesrAwBvgnTtaW7vqir1N1M4pOwuL6ow6rQfqUn+UN1uM7Fw+G6josvAqS9ywk9StwB7OSCgY1A6RWVZROTsk/C7XJ2xR5X5rZpHwJIZTnCpOxzS8jJg9mRcLDWJol97mH6f2b61OR+yxBA9XBRHH0zb5AhyTXZPgnfIx+pi3Rogp+BX3K+uIe5rvjEaq7Dv93Dt+gSd6BKGbt3p8l7njFvXB47EDvwbzvwDZThU34taYsxAAAAAElFTkSuQmCC";

const T4_TRAY_TEMPLATE_3X_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEIAAAA2CAYAAABz508/AAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAQqADAAQAAAABAAAANgAAAADHN+UiAAACnklEQVRoBe2Yu0skQRDGfT+iU/ARqol4FxqIYqJiImii+IwWuX/ASEQTETExEA0UMfCRaqB4t6LpcSAId4KRoa/A7O40O+/8SmfdWZjZKnd7Z3qgGort6f6m++vf9mz1bF6eFiWgBJSAElACUgL5LmEj6h2u6zCqG5j0n3DiKuj6Bdo4NNcC3Zskhtr/kKPkzU36Sim6vwm99qQf6rW3QCKyTEO7eBPRbtJXFEHMAcCISQg0VtRAxOB5moybLlEC0YnFr5sGkBgvKiCaYHgPUZwwbvqzyDXgLeonrmuuSum2jhGdov83o3F3e6XOagi+ICrdQpvqizDDpdvmLA2X4f7vgnnS+Yh8+qQ0uYVoQ+S82PwbMY/VD+WcgDOBrSDG4W9KAOFeoBFJbATRBedrAvdfoVkS6EQS20B8hGtJmjyHbhjxV7RKgcgmEDXwS2mygvF9h/5exAOje1e3LSAoTe4jGhj3j+gnCDeM7t3dNoCgNLmNaGXc02GLXrZ+MLqMum0AsQDngwL3E9AcCnQZScIG8RmuJwXOV6BZFugyloQJohuuVwXOaRfQbshpCQvEJ6xqF+F+6fNa6E80jiKevDpNtoUBohYLoDT5gVkIvQ0bT5N+cwYNohxGDhD1foacdjojEASCEUjhtqZpE2MYsEUwKJ0YdwS6aoGGfof++Ohm0E7nF/YZ9bk/4+ZC4Z10uuROmMKh0v55VJkYJOhHIzGvdZ8KwvlKFISCSH06dUc4PIJOn0eYty/1u8jqagB3x5gRZtF/5qOhk+tLCRrEFWalMFXoHy2unEIQ50T6aDiEFISCSH1YdEfojtAdkUrAucomfdI/TJeeoyYbTabK5KjJ2jGqv5KXnrULz1ZtVAJKQAkoASWgBJSAEjBL4BmD0oM38AUkCwAAAABJRU5ErkJggg==";

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
    width: 22,
    height: 18,
    buffer: Buffer.from(T4_TRAY_TEMPLATE_1X_BASE64, "base64"),
  });
  image.addRepresentation({
    scaleFactor: 2,
    width: 44,
    height: 36,
    buffer: Buffer.from(T4_TRAY_TEMPLATE_2X_BASE64, "base64"),
  });
  image.addRepresentation({
    scaleFactor: 3,
    width: 66,
    height: 54,
    buffer: Buffer.from(T4_TRAY_TEMPLATE_3X_BASE64, "base64"),
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
