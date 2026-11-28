import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import { msg } from "gt-react-native";

import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import { m, type MessageResolver } from "../../i18n/messages";
import type { WorkspaceEnvironment } from "../../state/workspaceModel";
import {
  THREAD_LIST_SECTION_PRESETS,
  THREAD_LIST_SORT_OPTIONS,
  sameThreadListSectionOrder,
  type ThreadListSection,
  type ThreadListSortOrder,
} from "../threads/threadListSort";

// Kept pure (no react-native imports) so filter menu tests run in Node.
const MACHINE_KIND_MENU_ICON: Record<EnvironmentMachineKind, string> = {
  server: "server.rack",
  cloud: "cloud",
  linux: "terminal",
  desktop: "desktopcomputer",
  laptop: "laptopcomputer",
  "mac-mini": "macmini",
  "mac-studio": "macstudio",
};

export interface HomeListFilterMenuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machineKind?: EnvironmentMachineKind | null;
}

export function homeListFilterEnvironments(environments: ReadonlyArray<WorkspaceEnvironment>) {
  return Arr.sort(
    environments
      .filter((environment) => environment.isEnabled)
      .map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.environmentLabel,
        connectionState: environment.connectionState,
      })),
    Order.mapInput(Order.String, (environment: { readonly label: string }) => environment.label),
  );
}

export interface HomeListFilterMenuProject {
  readonly key: string;
  readonly label: string;
  readonly icon?: string | null;
}

export interface HomeListFilterMenuSort {
  readonly sortOrder: ThreadListSortOrder;
  readonly sectionOrder: readonly ThreadListSection[];
  readonly workingShelfEnabled: boolean;
  readonly onSortOrderChange: (order: ThreadListSortOrder) => void;
  readonly onSectionOrderChange: (order: readonly ThreadListSection[]) => void;
  readonly onOpenSortSettings?: () => void;
}

export function buildHomeListFilterMenuItems(
  props: {
    readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
    readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
    readonly selectedEnvironmentId: EnvironmentId | null;
    readonly selectedProjectKey: string | null;
    readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
    readonly onProjectChange: (projectKey: string | null) => void;
    readonly sort?: HomeListFilterMenuSort;
  },
  resolve: MessageResolver = m,
): AppBarMenuItem[] {
  const items: AppBarMenuItem[] = [
    {
      id: "environment",
      title: resolve(msg("Environment", { $context: "filter menu heading" })),
      items: [
        {
          id: "environment:all",
          title: resolve(msg("All environments")),
          subtitle: resolve(msg("Show threads from every environment")),
          selected: props.selectedEnvironmentId === null,
          onPress: () => props.onEnvironmentChange(null),
        },
        ...props.environments.map((environment) => ({
          id: `environment:${environment.environmentId}`,
          title: environment.label,
          icon: environment.machineKind
            ? MACHINE_KIND_MENU_ICON[environment.machineKind]
            : "desktopcomputer",
          selected: props.selectedEnvironmentId === environment.environmentId,
          onPress: () => props.onEnvironmentChange(environment.environmentId),
        })),
      ],
    },
  ];

  if (props.projects.length > 0) {
    items.push({
      id: "project",
      title: resolve(msg("Project", { $context: "filter menu heading" })),
      items: [
        {
          id: "project:all",
          title: resolve(msg("All projects")),
          subtitle: resolve(msg("Show threads from every project")),
          selected: props.selectedProjectKey === null,
          onPress: () => props.onProjectChange(null),
        },
        ...props.projects.map((project) => ({
          id: `project:${project.key}`,
          title: project.label,
          selected: props.selectedProjectKey === project.key,
          onPress: () => props.onProjectChange(project.key),
        })),
      ],
    });
  }

  if (props.sort) {
    const sort = props.sort;
    items.push({
      id: "sort",
      title: resolve(msg("Sort by", { $context: "chat list sort menu heading" })),
      items: THREAD_LIST_SORT_OPTIONS.map((option) => ({
        id: `sort:${option.order}`,
        title: resolve(option.label),
        selected: sort.sortOrder === option.order,
        onPress: () => sort.onSortOrderChange(option.order),
      })),
    });
    if (sort.workingShelfEnabled && sort.sortOrder !== "manual") {
      items.push({
        id: "section-order",
        title: resolve(msg("Group order", { $context: "chat list status group order heading" })),
        items: [
          ...THREAD_LIST_SECTION_PRESETS.map((preset) => ({
            id: `preset:${preset.id}`,
            title: resolve(preset.label),
            selected: sameThreadListSectionOrder(sort.sectionOrder, preset.order),
            onPress: () => sort.onSectionOrderChange(preset.order),
          })),
          ...(sort.onOpenSortSettings
            ? [
                {
                  id: "sort:settings",
                  title: resolve(msg("Go to Settings")),
                  onPress: sort.onOpenSortSettings,
                },
              ]
            : []),
        ],
      });
    }
  }

  return items;
}
