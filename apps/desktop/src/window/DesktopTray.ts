import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Electron from "electron";
import { msg } from "gt-i18n";
import type { DesktopTrayState } from "@t3tools/contracts";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import { m, onLocaleChange } from "../i18n/messages.ts";
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

function createTrayTemplateImage(): Electron.NativeImage {
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

export class DesktopTray extends Context.Service<
  DesktopTray,
  {
    readonly configure: Effect.Effect<void>;
    readonly updateState: (state: DesktopTrayState) => Effect.Effect<void>;
    readonly dispose: Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopTray") {}

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const context = yield* Effect.context<DesktopWindow.DesktopWindow>();
  const runPromise = Effect.runPromiseWith(context);
  const runFork = Effect.runForkWith(context);

  const stateRef = yield* Ref.make<DesktopTrayState>(DEFAULT_TRAY_STATE);
  let tray: Electron.Tray | null = null;
  let subscribedLocale = false;

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

  const destroyTray = () => {
    if (tray !== null && !tray.isDestroyed()) {
      tray.destroy();
    }
    tray = null;
  };

  const renderTray = Effect.gen(function* () {
    if (environment.platform !== "darwin") return;
    const state = yield* Ref.get(stateRef);
    if (!state.enabled) {
      destroyTray();
      return;
    }

    if (tray === null || tray.isDestroyed()) {
      tray = new Electron.Tray(createTrayTemplateImage());
      tray.setToolTip(environment.displayName);
    }

    tray.setTitle(formatTrayTitle(state), { fontType: "monospacedDigit" });

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
        role: "quit",
        label: m(msg("Quit {appName}"), { appName: environment.displayName }),
      },
    );

    tray.setContextMenu(Electron.Menu.buildFromTemplate(menuTemplate));
  });

  return DesktopTray.of({
    configure: Effect.gen(function* () {
      if (environment.platform !== "darwin") return;
      yield* renderTray;
      if (!subscribedLocale) {
        subscribedLocale = true;
        onLocaleChange(() => runFork(renderTray));
      }
    }),
    updateState: Effect.fn("desktop.tray.updateState")(function* (nextState) {
      yield* Ref.set(stateRef, nextState);
      yield* renderTray;
    }),
    dispose: Effect.sync(destroyTray),
  });
});

export const layer = Layer.effect(DesktopTray, make);
