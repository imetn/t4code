import {
  buildProjectTodoDispatchPrompt,
  buildProjectTodoSummaryDispatchPrompt,
  createProjectTodoEnvironmentAtoms,
  type ProjectTodoDailyReviewTarget,
  type ProjectTodoGetTarget,
  type ProjectTodoListTarget,
} from "@t3tools/client-runtime/t4/project-todos";
import type { EnvironmentId, ProjectTodoSummary } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useServerConfigs } from "./entities";
import { useEnvironmentQuery } from "./query";

export const projectTodoEnvironment = createProjectTodoEnvironmentAtoms(connectionAtomRuntime);

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
