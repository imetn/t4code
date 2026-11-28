import { useAtomValue } from "@effect/atom-react";
import {
  buildProjectTodoDispatchPrompt,
  buildProjectTodoSummaryDispatchPrompt,
  createProjectTodoEnvironmentAtoms,
  type ProjectTodoDailyReviewTarget,
  type ProjectTodoGetTarget,
  type ProjectTodoListTarget,
} from "@t3tools/client-runtime/t4/project-todos";
import type { EnvironmentId, ProjectTodoSummary } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useServerConfigs } from "./entities";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "./query";

export const projectTodoEnvironment = createProjectTodoEnvironmentAtoms(connectionAtomRuntime);

export interface ScopedProjectTodoSummary {
  readonly environmentId: EnvironmentId;
  readonly item: ProjectTodoSummary;
}

export interface MultiEnvironmentProjectTodoDailyReviewView {
  readonly calendarItems: ReadonlyArray<ScopedProjectTodoSummary>;
  readonly linkedActive: ReadonlyArray<ScopedProjectTodoSummary>;
  readonly staleOpen: ReadonlyArray<ScopedProjectTodoSummary>;
  readonly pinnedNotes: ReadonlyArray<ScopedProjectTodoSummary>;
  readonly calendarTruncated: boolean;
  readonly isPending: boolean;
  readonly hasLoadedAny: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

export function useEnvironmentSupportsProjectTodos(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  if (environmentId === null) return false;
  return configs.get(environmentId)?.environment.capabilities.projectTodos === true;
}

export function useProjectTodoList(target: ProjectTodoListTarget | null) {
  const supported = useEnvironmentSupportsProjectTodos(target?.environmentId ?? null);
  return useEnvironmentQuery(
    supported && target !== null ? projectTodoEnvironment.list(target) : null,
  );
}

export function useProjectTodoDetail(target: ProjectTodoGetTarget | null) {
  const supported = useEnvironmentSupportsProjectTodos(target?.environmentId ?? null);
  return useEnvironmentQuery(
    supported && target !== null ? projectTodoEnvironment.detail(target) : null,
  );
}

export function useProjectTodoDailyReview(target: ProjectTodoDailyReviewTarget | null) {
  const supported = useEnvironmentSupportsProjectTodos(target?.environmentId ?? null);
  return useEnvironmentQuery(
    supported && target !== null ? projectTodoEnvironment.dailyReview(target) : null,
  );
}

const EMPTY_MULTI_DAILY_REVIEW_ATOM = Atom.make<
  ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly result: AsyncResult.AsyncResult<
      ReturnType<typeof projectTodoEnvironment.dailyReview> extends Atom.Atom<
        AsyncResult.AsyncResult<infer A, unknown>
      >
        ? A
        : never,
      unknown
    >;
  }>
>([]).pipe(Atom.withLabel("web-project-todos:multi-daily-review:empty"));

const multiDailyReviewAtomFamily = Atom.family((serializedTargets: string) => {
  if (serializedTargets.length === 0) {
    return EMPTY_MULTI_DAILY_REVIEW_ATOM;
  }
  const targets = JSON.parse(serializedTargets) as ReadonlyArray<ProjectTodoDailyReviewTarget>;
  return Atom.make((get) =>
    targets.map((target) => ({
      environmentId: target.environmentId,
      result: get(projectTodoEnvironment.dailyReview(target)),
    })),
  ).pipe(Atom.withLabel(`web-project-todos:multi-daily-review:${serializedTargets}`));
});

export function useMultiEnvironmentProjectTodoDailyReview(
  targets: ReadonlyArray<ProjectTodoDailyReviewTarget>,
): MultiEnvironmentProjectTodoDailyReviewView {
  const configs = useServerConfigs();
  const supportedTargets = targets.filter(
    (target) => configs.get(target.environmentId)?.environment.capabilities.projectTodos === true,
  );
  const serializedTargets = supportedTargets.length > 0 ? JSON.stringify(supportedTargets) : "";
  const entries = useAtomValue(multiDailyReviewAtomFamily(serializedTargets));

  const calendarItems: ScopedProjectTodoSummary[] = [];
  const linkedActive: ScopedProjectTodoSummary[] = [];
  const staleOpen: ScopedProjectTodoSummary[] = [];
  const pinnedNotes: ScopedProjectTodoSummary[] = [];
  let calendarTruncated = false;
  let isPending = false;
  let hasLoadedAny = false;
  let firstError: string | null = null;

  for (const { environmentId, result } of entries) {
    if (result.waiting) {
      isPending = true;
    }
    const data = AsyncResult.getOrElse(result, () => null);
    if (data !== null) {
      hasLoadedAny = true;
      for (const item of data.calendarItems ?? []) {
        calendarItems.push({ environmentId, item });
      }
      for (const item of data.linkedActive) {
        linkedActive.push({ environmentId, item });
      }
      for (const item of data.staleOpen) {
        staleOpen.push({ environmentId, item });
      }
      for (const item of data.pinnedNotes) {
        pinnedNotes.push({ environmentId, item });
      }
      if (data.calendarTruncated) {
        calendarTruncated = true;
      }
    } else if (result._tag === "Failure" && firstError === null) {
      firstError = formatEnvironmentQueryError(result.cause);
    }
  }

  return {
    calendarItems,
    linkedActive,
    staleOpen,
    pinnedNotes,
    calendarTruncated,
    isPending,
    hasLoadedAny,
    error: hasLoadedAny ? null : firstError,
    refresh: () => {
      for (const target of supportedTargets) {
        appAtomRegistry.refresh(projectTodoEnvironment.dailyReview(target));
      }
    },
  };
}

export async function loadProjectTodoDispatchPrompt(
  environmentId: EnvironmentId,
  item: ProjectTodoSummary,
): Promise<string> {
  if (!item.hasBody) {
    return buildProjectTodoSummaryDispatchPrompt(item);
  }
  const detailAtom = projectTodoEnvironment.detail({
    environmentId,
    input: { projectId: item.projectId, id: item.id },
  });
  const cached = appAtomRegistry.get(detailAtom);
  if (cached._tag === "Success") {
    return buildProjectTodoDispatchPrompt(cached.value.item);
  }
  return await new Promise<string>((resolve) => {
    let settled = false;
    const finish = (prompt: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unmount();
      resolve(prompt);
    };
    const timer = setTimeout(() => {
      finish(buildProjectTodoSummaryDispatchPrompt(item));
    }, 1500);
    const unmount = appAtomRegistry.subscribe(
      detailAtom,
      (result) => {
        if (result._tag === "Success") {
          finish(buildProjectTodoDispatchPrompt(result.value.item));
        } else if (result._tag === "Failure") {
          finish(buildProjectTodoSummaryDispatchPrompt(item));
        }
      },
      { immediate: true },
    );
  });
}
