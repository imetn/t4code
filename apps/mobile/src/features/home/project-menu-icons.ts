import { AsyncResult, Atom } from "effect/reactivity";

import { resolveProjectChipIcon, resolveProjectIconSymbol } from "../../lib/projectIcon";
import { projectGlyphImageAtom, projectGlyphKey } from "../../native/ProjectChipIconImages";
import { projectFaviconUrlAtom } from "../../state/assets";
import { environmentProjects } from "../../state/projects";
import { serverEnvironment } from "../../state/server";
import type { HomeProjectScope } from "./homeThreadList";

const EMPTY_PROJECT_MENU_ICONS: ReadonlyMap<string, string> = new Map();
const EMPTY_PROJECT_MENU_ICONS_ATOM = Atom.make(EMPTY_PROJECT_MENU_ICONS).pipe(
  Atom.withLabel("mobile-project-menu-icons:empty"),
);

export function projectMenuIconsAtomKey(scopes: ReadonlyArray<HomeProjectScope>): string {
  if (scopes.length === 0) return "";
  return JSON.stringify(
    scopes.map((scope) => [
      scope.key,
      scope.representative.environmentId,
      scope.representative.id,
      scope.representative.faviconPath ?? null,
      scope.representative.projectIcon ?? null,
    ]),
  );
}

const projectFilterMenuIconsFamily = Atom.family((serialized: string) => {
  if (serialized === "") return EMPTY_PROJECT_MENU_ICONS_ATOM;
  const entries = JSON.parse(serialized) as ReadonlyArray<
    readonly [string, string, string, string | null, unknown]
  >;
  return Atom.make((get): ReadonlyMap<string, string> => {
    const icons = new Map<string, string>();
    for (const [scopeKey, environmentId, projectId] of entries) {
      const envId = environmentId as HomeProjectScope["representative"]["environmentId"];
      const projId = projectId as HomeProjectScope["representative"]["id"];
      const project = get(
        environmentProjects.projectAtom({ environmentId: envId, projectId: projId }),
      );
      if (!project) continue;
      const symbol = resolveProjectIconSymbol(project.projectIcon);
      if (symbol && typeof symbol.name === "string") {
        icons.set(scopeKey, symbol.name);
        continue;
      }
      const scratchWorkspaceRoot = get(
        serverEnvironment.configValueAtom(envId),
      )?.scratchWorkspaceRoot;
      const chip = resolveProjectChipIcon(project, scratchWorkspaceRoot, () =>
        get(
          projectFaviconUrlAtom({
            environmentId: envId,
            cwd: project.workspaceRoot,
            faviconPath: project.faviconPath,
          }),
        ),
      );
      if (!chip) continue;
      if (chip.kind === "favicon") {
        icons.set(scopeKey, chip.uri);
      } else {
        const uri = AsyncResult.getOrElse(
          get(projectGlyphImageAtom(projectGlyphKey(chip))),
          () => null,
        );
        if (uri) icons.set(scopeKey, uri);
      }
    }
    return icons;
  }).pipe(Atom.withLabel(`mobile-project-menu-icons:${serialized.length}`));
});

export function projectFilterMenuIconsAtom(scopes: ReadonlyArray<HomeProjectScope>) {
  return projectFilterMenuIconsFamily(projectMenuIconsAtomKey(scopes));
}
