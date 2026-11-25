import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DesktopTrayStateSchema } from "@t3tools/contracts";

import * as DesktopTray from "../../window/DesktopTray.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { UPDATE_TRAY_STATE_CHANNEL } from "../channels.ts";

export const updateTrayState = DesktopIpc.makeIpcMethod({
  channel: UPDATE_TRAY_STATE_CHANNEL,
  payload: DesktopTrayStateSchema,
  result: Schema.Void,
  handler: (state) => Effect.flatMap(DesktopTray.DesktopTray, (tray) => tray.updateState(state)),
});
