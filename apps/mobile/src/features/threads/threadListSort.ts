import { msg } from "gt-react-native";

export const THREAD_LIST_SORT_ORDERS = ["updated_at", "created_at", "manual"] as const;
export type ThreadListSortOrder = (typeof THREAD_LIST_SORT_ORDERS)[number];
export const DEFAULT_THREAD_LIST_SORT_ORDER: ThreadListSortOrder = "updated_at";

export const THREAD_LIST_SECTION_ORDER = ["completed", "working", "idle"] as const;
export type ThreadListSection = (typeof THREAD_LIST_SECTION_ORDER)[number];
export const DEFAULT_THREAD_LIST_SECTION_ORDER: readonly ThreadListSection[] =
  THREAD_LIST_SECTION_ORDER;

export const THREAD_LIST_GROUPING_MODES = ["status", "project", "none"] as const;
export type ThreadListGroupingMode = (typeof THREAD_LIST_GROUPING_MODES)[number];
export const DEFAULT_THREAD_LIST_GROUPING_MODE: ThreadListGroupingMode = "status";

export function isThreadListGroupingMode(value: unknown): value is ThreadListGroupingMode {
  return THREAD_LIST_GROUPING_MODES.some((mode) => mode === value);
}

export function resolveThreadListGroupingMode(
  mode: unknown,
  legacyWorkingShelfEnabled?: boolean,
): ThreadListGroupingMode {
  if (isThreadListGroupingMode(mode)) return mode;
  return legacyWorkingShelfEnabled === false ? "none" : DEFAULT_THREAD_LIST_GROUPING_MODE;
}

export function isThreadListSortOrder(value: unknown): value is ThreadListSortOrder {
  return THREAD_LIST_SORT_ORDERS.some((order) => order === value);
}

export function resolveThreadListSortOrder(saved: unknown): ThreadListSortOrder {
  return isThreadListSortOrder(saved) ? saved : DEFAULT_THREAD_LIST_SORT_ORDER;
}

export function isThreadListSection(value: unknown): value is ThreadListSection {
  return THREAD_LIST_SECTION_ORDER.some((section) => section === value);
}

/** Fill missing sections and drop unknown or duplicate entries without losing saved order. */
export function resolveThreadListSectionOrder(
  saved?: readonly unknown[],
): readonly ThreadListSection[] {
  if (!saved?.length) return DEFAULT_THREAD_LIST_SECTION_ORDER;
  return [...new Set([...saved.filter(isThreadListSection), ...THREAD_LIST_SECTION_ORDER])];
}

export function moveThreadListSection(
  saved: readonly unknown[] | undefined,
  section: ThreadListSection,
  position: number,
): readonly ThreadListSection[] {
  const order = [...resolveThreadListSectionOrder(saved)];
  const from = order.indexOf(section);
  const to = Math.max(0, Math.min(order.length - 1, position));
  order.splice(from, 1);
  order.splice(to, 0, section);
  return order;
}

export function sameThreadListSectionOrder(
  left: readonly ThreadListSection[],
  right: readonly ThreadListSection[],
): boolean {
  return left.length === right.length && left.every((section, index) => section === right[index]);
}

/** True when Working is placed ahead of Other active threads, so it defaults to expanded. */
export function isWorkingSectionPromoted(order: readonly ThreadListSection[]): boolean {
  return order.indexOf("working") < order.indexOf("idle");
}

export const THREAD_LIST_SORT_OPTIONS: ReadonlyArray<{
  readonly order: ThreadListSortOrder;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}> = [
  {
    order: "updated_at",
    label: msg("Recent activity", { $context: "chat list sort order" }),
    shortLabel: msg("Recent", { $context: "short chat list sort pill label" }),
    description: msg("Order threads by their latest reply or update."),
  },
  {
    order: "created_at",
    label: msg("Newest created", { $context: "chat list sort order" }),
    shortLabel: msg("Created", { $context: "short chat list sort pill label" }),
    description: msg("Order threads by when they were created."),
  },
  {
    order: "manual",
    label: msg("Manual order", { $context: "chat list sort order" }),
    shortLabel: msg("Manual", { $context: "short chat list sort pill label" }),
    description: msg("Drag or move active threads to arrange them yourself."),
  },
];

export const THREAD_LIST_SECTION_META: Readonly<
  Record<
    ThreadListSection,
    {
      readonly label: string;
      readonly dividerLabel: string;
      readonly description: string;
    }
  >
> = {
  completed: {
    label: msg("Completed & attention", { $context: "chat list status group name" }),
    dividerLabel: msg("Completed", { $context: "thread list section" }),
    description: msg("Finished runs, approvals, questions, and failures."),
  },
  working: {
    label: msg("In progress", { $context: "chat list status group name" }),
    dividerLabel: msg("Working", { $context: "thread list section" }),
    description: msg("Threads where an agent is currently running."),
  },
  idle: {
    label: msg("Other active", { $context: "chat list status group name" }),
    dividerLabel: msg("Other", { $context: "thread list section" }),
    description: msg("Already-read active threads."),
  },
};

export const THREAD_LIST_SECTION_PRESETS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly order: readonly ThreadListSection[];
}> = [
  {
    id: "completed-working-idle",
    label: msg("Completed first", { $context: "chat list group order preset" }),
    order: ["completed", "working", "idle"],
  },
  {
    id: "working-completed-idle",
    label: msg("In progress first", { $context: "chat list group order preset" }),
    order: ["working", "completed", "idle"],
  },
  {
    id: "completed-idle-working",
    label: msg("In progress at bottom", { $context: "chat list group order preset" }),
    order: ["completed", "idle", "working"],
  },
];
