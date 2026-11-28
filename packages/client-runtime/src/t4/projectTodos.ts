import {
  IsoDateTime,
  type EnvironmentId,
  type ProjectId,
  type ProjectTodoDailyReviewInput,
  type ProjectTodoGetInput,
  type ProjectTodoItem,
  type ProjectTodoListInput,
  type ProjectTodoSummary,
  WS_METHODS,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

export interface ProjectTodoListTarget {
  readonly environmentId: EnvironmentId;
  readonly input: ProjectTodoListInput;
}

export interface ProjectTodoGetTarget {
  readonly environmentId: EnvironmentId;
  readonly input: ProjectTodoGetInput;
}

export interface ProjectTodoDailyReviewTarget {
  readonly environmentId: EnvironmentId;
  readonly input: ProjectTodoDailyReviewInput;
}

export interface LocalCalendarDay {
  readonly year: number;
  /** 1-based month (1..12). */
  readonly month: number;
  readonly day: number;
}

export interface CalendarMonthCell extends LocalCalendarDay {
  readonly key: string;
  readonly inMonth: boolean;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function localCalendarDayKey(day: LocalCalendarDay): string {
  return `${day.year}-${pad2(day.month)}-${pad2(day.day)}`;
}

export function todayLocalCalendarDay(
  reference: DateTime.DateTime = DateTime.nowUnsafe(),
): LocalCalendarDay {
  const parts = DateTime.toParts(DateTime.setZone(reference, DateTime.zoneMakeLocal()));
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function localDateKeyFromIso(iso: IsoDateTime): string {
  const parsed = DateTime.make(iso);
  if (Option.isNone(parsed)) return iso.slice(0, 10);
  const parts = DateTime.toParts(DateTime.setZone(parsed.value, DateTime.zoneMakeLocal()));
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function localZonedStartOfDay(day: LocalCalendarDay): DateTime.Zoned {
  const zone = DateTime.zoneMakeLocal();
  const zoned = DateTime.makeZonedUnsafe(
    { year: day.year, month: day.month, day: day.day },
    { timeZone: zone },
  );
  return DateTime.startOf(zoned, "day");
}

/** Local calendar day bounds `[dayStartIso, dayEndIso)`, safe across DST transitions. */
export function localDayWindow(reference: DateTime.DateTime = DateTime.nowUnsafe()): {
  readonly dayStartIso: IsoDateTime;
  readonly dayEndIso: IsoDateTime;
} {
  const local = DateTime.setZone(reference, DateTime.zoneMakeLocal());
  const start = DateTime.startOf(local, "day");
  const end = DateTime.startOf(DateTime.add(start, { days: 1 }), "day");
  return {
    dayStartIso: IsoDateTime.make(DateTime.formatIso(DateTime.toUtc(start))),
    dayEndIso: IsoDateTime.make(DateTime.formatIso(DateTime.toUtc(end))),
  };
}

/** Local calendar day bounds for a chosen calendar date, safe across DST transitions. */
export function localDayWindowForCalendarDay(day: LocalCalendarDay): {
  readonly dayStartIso: IsoDateTime;
  readonly dayEndIso: IsoDateTime;
} {
  const start = localZonedStartOfDay(day);
  const end = DateTime.startOf(DateTime.add(start, { days: 1 }), "day");
  return {
    dayStartIso: IsoDateTime.make(DateTime.formatIso(DateTime.toUtc(start))),
    dayEndIso: IsoDateTime.make(DateTime.formatIso(DateTime.toUtc(end))),
  };
}

/** Full visible 42-day grid range `[rangeStartIso, rangeEndIso)` for calendar activity dots. */
export function localMonthRangeForCalendar(
  year: number,
  month: number,
): {
  readonly rangeStartIso: IsoDateTime;
  readonly rangeEndIso: IsoDateTime;
} {
  const cells = buildCalendarMonthGrid(year, month);
  const first = cells[0]!;
  const last = cells[cells.length - 1]!;
  const start = localZonedStartOfDay(first);
  const end = DateTime.startOf(DateTime.add(localZonedStartOfDay(last), { days: 1 }), "day");
  return {
    rangeStartIso: IsoDateTime.make(DateTime.formatIso(DateTime.toUtc(start))),
    rangeEndIso: IsoDateTime.make(DateTime.formatIso(DateTime.toUtc(end))),
  };
}

export function shiftLocalCalendarDay(day: LocalCalendarDay, deltaDays: number): LocalCalendarDay {
  const shifted = DateTime.add(localZonedStartOfDay(day), { days: deltaDays });
  const parts = DateTime.toParts(shifted);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function shiftLocalCalendarMonth(
  year: number,
  month: number,
  deltaMonths: number,
): { readonly year: number; readonly month: number } {
  const zeroBased = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = (((zeroBased % 12) + 12) % 12) + 1;
  return { year: nextYear, month: nextMonth };
}

/** Builds a 6-week (42-cell) Monday-first month grid for the given 1-based month. */
export function buildCalendarMonthGrid(
  year: number,
  month: number,
): ReadonlyArray<CalendarMonthCell> {
  const firstOfMonth = localZonedStartOfDay({ year, month, day: 1 });
  const firstWeekdaySun0 = DateTime.toParts(firstOfMonth).weekDay;
  // Convert Sunday=0..Saturday=6 into Monday=0..Sunday=6 offset.
  const leadingDays = (firstWeekdaySun0 + 6) % 7;
  const gridStart = DateTime.subtract(firstOfMonth, { days: leadingDays });
  const cells: CalendarMonthCell[] = [];
  for (let offset = 0; offset < 42; offset++) {
    const cellZoned = DateTime.add(gridStart, { days: offset });
    const parts = DateTime.toParts(cellZoned);
    const cellDay: LocalCalendarDay = { year: parts.year, month: parts.month, day: parts.day };
    cells.push({
      ...cellDay,
      key: localCalendarDayKey(cellDay),
      inMonth: parts.year === year && parts.month === month,
    });
  }
  return cells;
}

/** Formats a todo or note into a clean initial prompt for `handleNewThread`. */
export function buildProjectTodoDispatchPrompt(
  item: Pick<ProjectTodoItem, "kind" | "title" | "body" | "fileRefs">,
): string {
  const sections: string[] = [item.title.trim()];
  const trimmedBody = item.body.trim();
  if (trimmedBody.length > 0) {
    sections.push(trimmedBody);
  }
  if (item.fileRefs.length > 0) {
    sections.push(`Relevant files:\n${item.fileRefs.map((ref) => `- ${ref}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

/** Formats a summary item when full detail is not yet fetched. */
export function buildProjectTodoSummaryDispatchPrompt(
  item: Pick<ProjectTodoSummary, "title" | "bodyPreview" | "fileRefs">,
): string {
  const sections: string[] = [item.title.trim()];
  const preview = item.bodyPreview.trim();
  if (preview.length > 0) {
    sections.push(preview);
  }
  if (item.fileRefs.length > 0) {
    sections.push(`Relevant files:\n${item.fileRefs.map((ref) => `- ${ref}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

export function createProjectTodoEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:project-todos:list",
    tag: WS_METHODS.projectTodosList,
    staleTimeMs: 15_000,
  });

  const detail = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:project-todos:get",
    tag: WS_METHODS.projectTodosGet,
    staleTimeMs: 15_000,
  });

  const dailyReview = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:project-todos:daily-review",
    tag: WS_METHODS.projectTodosDailyReview,
    staleTimeMs: 15_000,
  });

  const trackedListTargets = new Map<string, ProjectTodoListTarget>();
  const trackedDailyReviewTargets = new Map<string, ProjectTodoDailyReviewTarget>();

  const listAtom = (target: ProjectTodoListTarget) => {
    trackedListTargets.set(JSON.stringify(target), target);
    return list(target);
  };

  const dailyReviewAtom = (target: ProjectTodoDailyReviewTarget) => {
    trackedDailyReviewTargets.set(JSON.stringify(target), target);
    return dailyReview(target);
  };

  const refreshEnvironmentProject = (
    registry: AtomRegistry.AtomRegistry,
    environmentId: EnvironmentId,
    projectId: ProjectId,
  ) =>
    Effect.sync(() => {
      for (const target of trackedListTargets.values()) {
        if (target.environmentId === environmentId && target.input.projectId === projectId) {
          registry.refresh(list(target));
        }
      }
      for (const target of trackedDailyReviewTargets.values()) {
        if (
          target.environmentId === environmentId &&
          (target.input.projectId === undefined || target.input.projectId === projectId)
        ) {
          registry.refresh(dailyReview(target));
        }
      }
    });

  const create = createEnvironmentRpcCommand(runtime, {
    label: "environment-command:project-todos:create",
    tag: WS_METHODS.projectTodosCreate,
    onSuccess: (target, registry) =>
      refreshEnvironmentProject(registry, target.environmentId, target.input.projectId),
  });

  const update = createEnvironmentRpcCommand(runtime, {
    label: "environment-command:project-todos:update",
    tag: WS_METHODS.projectTodosUpdate,
    onSuccess: (target, registry) =>
      Effect.all([
        refreshEnvironmentProject(registry, target.environmentId, target.input.projectId),
        Effect.sync(() => {
          registry.refresh(
            detail({
              environmentId: target.environmentId,
              input: { projectId: target.input.projectId, id: target.input.id },
            }),
          );
        }),
      ]).pipe(Effect.asVoid),
  });

  const remove = createEnvironmentRpcCommand(runtime, {
    label: "environment-command:project-todos:delete",
    tag: WS_METHODS.projectTodosDelete,
    onSuccess: (target, registry) =>
      refreshEnvironmentProject(registry, target.environmentId, target.input.projectId),
  });

  return {
    list: listAtom,
    detail,
    dailyReview: dailyReviewAtom,
    create,
    update,
    remove,
    refreshEnvironmentProject,
  };
}
