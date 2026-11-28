import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { dashboardIconUrl } from "@t3tools/shared/dashboardIcons";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";

import {
  projectAutoMonogram,
  resolveProjectIconGlyph,
  resolveProjectIconSymbol,
  type ProjectIconGlyph,
} from "../../lib/projectIcon";
import { projectGlyphImageAtom, projectGlyphKey } from "../../native/ProjectChipIconImages";
import { projectFaviconUrlAtom } from "../../state/assets";
import { environmentProjects } from "../../state/projects";
import { serverEnvironment } from "../../state/server";
import type { HomeProjectScope } from "./homeThreadList";

const EMPTY_PROJECT_MENU_ICONS: ReadonlyMap<string, string> = new Map();
const EMPTY_PROJECT_MENU_ICONS_ATOM = Atom.make(EMPTY_PROJECT_MENU_ICONS).pipe(
  Atom.withLabel("mobile-project-menu-icons:empty"),
);

const DIRECT_RASTER_DATA_URI = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i;
const MENU_ICON_RASTER_SIZE = 60;

async function rasterizeMenuIconUri(uri: string): Promise<string | null> {
  try {
    const { Image } = await import("expo-image");
    const cacheKey = `t4-menu-icon:${MENU_ICON_RASTER_SIZE}:${uri}`;
    const existing = await Image.getCachePathAsync(cacheKey);
    if (existing) {
      return existing.startsWith("file:") ? existing : `file://${existing}`;
    }
    const decoded = await Image.loadAsync(uri, {
      maxWidth: MENU_ICON_RASTER_SIZE,
      maxHeight: MENU_ICON_RASTER_SIZE,
    });
    try {
      await Image.writeToCacheAsync(decoded, cacheKey);
      const path = await Image.getCachePathAsync(cacheKey);
      if (!path) return null;
      return path.startsWith("file:") ? path : `file://${path}`;
    } finally {
      decoded.release();
    }
  } catch {
    return null;
  }
}

const rasterizedMenuIconAtom = Atom.family((uri: string) =>
  Atom.make(Effect.promise(() => rasterizeMenuIconUri(uri))).pipe(
    Atom.keepAlive,
    Atom.withLabel(`mobile-project-menu-icon-raster:${uri.length}`),
  ),
);

type SerializedMember = readonly [string, string, string | null, unknown];
type SerializedScope = readonly [string, string, ReadonlyArray<SerializedMember>];

export function projectMenuIconsAtomKey(scopes: ReadonlyArray<HomeProjectScope>): string {
  if (scopes.length === 0) return "";
  const payload: SerializedScope[] = scopes.map((scope) => {
    const seen = new Set<string>();
    const ordered = [scope.representative, ...scope.projects].filter((project) => {
      const k = `${project.environmentId}:${project.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return [
      scope.key,
      scope.title,
      ordered.map((project) => [
        project.environmentId,
        project.id,
        project.faviconPath ?? null,
        project.projectIcon ?? null,
      ]),
    ];
  });
  return JSON.stringify(payload);
}

const projectFilterMenuIconsFamily = Atom.family((serialized: string) => {
  if (serialized === "") return EMPTY_PROJECT_MENU_ICONS_ATOM;
  const entries = JSON.parse(serialized) as ReadonlyArray<SerializedScope>;
  return Atom.make((get): ReadonlyMap<string, string> => {
    const icons = new Map<string, string>();
    for (const [scopeKey, scopeTitle, members] of entries) {
      let resolvedSymbol: string | null = null;
      let resolvedGlyph: ProjectIconGlyph | null = null;
      let resolvedFaviconUri: string | null = null;
      let allScratch = members.length > 0;

      for (const [environmentId, projectId] of members) {
        const envId = environmentId as HomeProjectScope["representative"]["environmentId"];
        const projId = projectId as HomeProjectScope["representative"]["id"];
        const project = get(
          environmentProjects.projectAtom({ environmentId: envId, projectId: projId }),
        );
        if (!project) continue;
        const scratchWorkspaceRoot = get(
          serverEnvironment.configValueAtom(envId),
        )?.scratchWorkspaceRoot;
        if (isScratchProject(project, scratchWorkspaceRoot)) {
          continue;
        }
        allScratch = false;

        const symbol = resolveProjectIconSymbol(project.projectIcon);
        if (symbol && typeof symbol.name === "string") {
          resolvedSymbol = symbol.name;
          break;
        }
        if (project.projectIcon?.kind === "dashboard-icon") {
          resolvedFaviconUri = dashboardIconUrl(project.projectIcon, "light");
          break;
        }
        const explicitGlyph = resolveProjectIconGlyph(project.projectIcon, project.title);
        if (explicitGlyph) {
          resolvedGlyph = explicitGlyph;
          break;
        }
        if (resolvedFaviconUri === null) {
          const url = get(
            projectFaviconUrlAtom({
              environmentId: envId,
              cwd: project.workspaceRoot,
              faviconPath: project.faviconPath,
            }),
          );
          if (url && !isProjectFaviconFallbackUrl(url)) {
            resolvedFaviconUri = url;
          }
        }
      }

      if (allScratch) continue;

      if (resolvedSymbol) {
        icons.set(scopeKey, resolvedSymbol);
        continue;
      }

      if (resolvedFaviconUri) {
        if (DIRECT_RASTER_DATA_URI.test(resolvedFaviconUri)) {
          icons.set(scopeKey, resolvedFaviconUri);
          continue;
        }
        const rasterized = AsyncResult.getOrElse(
          get(rasterizedMenuIconAtom(resolvedFaviconUri)),
          () => null,
        );
        if (rasterized) {
          icons.set(scopeKey, rasterized);
          continue;
        }
      }

      const glyph = resolvedGlyph ?? projectAutoMonogram(scopeTitle);
      if (glyph) {
        const uri = AsyncResult.getOrElse(
          get(projectGlyphImageAtom(projectGlyphKey(glyph))),
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
