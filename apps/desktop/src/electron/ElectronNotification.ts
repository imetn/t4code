import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

export interface DesktopNotificationOptions {
  readonly title: string;
  readonly body: string;
  readonly onClick?: () => void;
}

export class ElectronNotification extends Context.Service<
  ElectronNotification,
  {
    readonly show: (options: DesktopNotificationOptions) => Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/electron/ElectronNotification") {}

/** @public */
export const make = ElectronNotification.of({
  show: Effect.fn("ElectronNotification.show")(function (options) {
    return Effect.sync(() => {
      if (!Electron.Notification.isSupported()) return false;
      const notification = new Electron.Notification({
        title: options.title,
        body: options.body,
      });
      if (options.onClick) {
        notification.on("click", options.onClick);
      }
      notification.show();
      return true;
    });
  }),
});

export const layer = Layer.succeed(ElectronNotification, make);
