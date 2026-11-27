import { ProviderInstanceId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const ProviderInstanceOrder = Schema.Array(ProviderInstanceId);

interface OrderableInstance {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
}

/** Enabled providers stay above disabled ones; the saved order ranks each group. */
export function orderProviderInstances<Row extends OrderableInstance>(
  rows: readonly Row[],
  savedOrder: readonly ProviderInstanceId[],
): Row[] {
  const positions = new Map(savedOrder.map((instanceId, index) => [instanceId, index]));
  const rank = (row: Row) => positions.get(row.instanceId) ?? savedOrder.length;
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        Number(!a.row.enabled) - Number(!b.row.enabled) ||
        rank(a.row) - rank(b.row) ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}

/** Returns the next saved order, or undefined when nothing moves. */
export function moveProviderInstance(
  ordered: readonly OrderableInstance[],
  fromId: ProviderInstanceId,
  toId: ProviderInstanceId,
): ProviderInstanceId[] | undefined {
  const from = ordered.findIndex((row) => row.instanceId === fromId);
  let to = ordered.findIndex((row) => row.instanceId === toId);
  const moving = ordered[from];
  if (moving === undefined || to === -1) return undefined;
  // Dropping across the enabled/disabled boundary lands at the edge of the provider's own group.
  if (ordered[to]?.enabled !== moving.enabled) {
    to = moving.enabled
      ? ordered.findLastIndex((row) => row.enabled)
      : ordered.findIndex((row) => !row.enabled);
  }
  if (to === from) return undefined;
  const next = ordered.map((row) => row.instanceId);
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}
