import { useGT, useMessages } from "gt-react-native";
import { Platform, Pressable, ScrollView } from "react-native";
import type { MenuAction } from "@react-native-menu/menu";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ENVIRONMENT_MACHINE_SYMBOLS } from "../../components/EnvironmentMachineSymbol";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  DEFAULT_THREAD_LIST_SECTION_ORDER,
  DEFAULT_THREAD_LIST_SORT_ORDER,
  THREAD_LIST_SECTION_PRESETS,
  THREAD_LIST_SORT_OPTIONS,
  isThreadListSortOrder,
  sameThreadListSectionOrder,
  type ThreadListSection,
  type ThreadListSortOrder,
} from "../threads/threadListSort";
import type {
  HomeListFilterMenuEnvironment,
  HomeListFilterMenuProject,
} from "./home-list-filter-menu";

export function ThreadListFilters(props: {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly sortOrder: ThreadListSortOrder;
  readonly sectionOrder: readonly ThreadListSection[];
  readonly workingShelfEnabled: boolean;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly onSortOrderChange: (order: ThreadListSortOrder) => void;
  readonly onSectionOrderChange: (order: readonly ThreadListSection[]) => void;
  readonly onOpenSortSettings?: () => void;
  /** List padding the scroller bleeds through so pills start where row content does. */
  readonly gutter: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const selectedEnvironment = props.environments.find(
    (environment) => environment.environmentId === props.selectedEnvironmentId,
  );
  const selectedProject = props.projects.find(
    (project) => project.key === props.selectedProjectKey,
  );
  const activeSortOption =
    THREAD_LIST_SORT_OPTIONS.find((option) => option.order === props.sortOrder) ??
    THREAD_LIST_SORT_OPTIONS[0]!;
  const sortCustomized =
    props.sortOrder !== DEFAULT_THREAD_LIST_SORT_ORDER ||
    (props.workingShelfEnabled &&
      props.sortOrder !== "manual" &&
      !sameThreadListSectionOrder(props.sectionOrder, DEFAULT_THREAD_LIST_SECTION_ORDER));
  const sortActions: MenuAction[] = [
    ...THREAD_LIST_SORT_OPTIONS.map((option) => ({
      id: `sort:${option.order}`,
      title: m(option.label),
      state: option.order === props.sortOrder ? ("on" as const) : ("off" as const),
    })),
    ...(props.workingShelfEnabled && props.sortOrder !== "manual"
      ? [
          {
            id: "section-order",
            title: gt("Group order", { $context: "chat list status group order heading" }),
            displayInline: true,
            subactions: THREAD_LIST_SECTION_PRESETS.map((preset) => ({
              id: `preset:${preset.id}`,
              title: m(preset.label),
              state: sameThreadListSectionOrder(props.sectionOrder, preset.order)
                ? ("on" as const)
                : ("off" as const),
            })),
          },
        ]
      : []),
    ...(props.onOpenSortSettings
      ? [
          {
            id: "sort:settings",
            title: gt("Go to Settings"),
            image: Platform.OS === "ios" ? "gearshape" : undefined,
          },
        ]
      : []),
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -props.gutter, overflow: "visible" }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 2, paddingBottom: 10, gap: 8 }}
    >
      <ListFilterMenu
        label={m(activeSortOption.shortLabel)}
        accessibilityLabel={gt("Sort threads")}
        active={sortCustomized}
        actions={sortActions}
        onSelect={(id) => {
          if (id === "sort:settings") {
            props.onOpenSortSettings?.();
            return;
          }
          if (id.startsWith("sort:")) {
            const candidate = id.slice("sort:".length);
            if (isThreadListSortOrder(candidate)) props.onSortOrderChange(candidate);
            return;
          }
          if (id.startsWith("preset:")) {
            const presetId = id.slice("preset:".length);
            const preset = THREAD_LIST_SECTION_PRESETS.find(
              (candidate) => candidate.id === presetId,
            );
            if (preset) props.onSectionOrderChange(preset.order);
          }
        }}
      />
      <ListFilterMenu
        label={selectedEnvironment?.label ?? gt("All environments")}
        accessibilityLabel={gt("Filter threads by environment")}
        active={selectedEnvironment !== undefined}
        actions={[
          {
            id: "all",
            title: gt("All environments"),
            image: "square.stack",
            state: props.selectedEnvironmentId === null ? "on" : "off",
          },
          ...props.environments.map((environment) => ({
            id: JSON.stringify(environment.environmentId),
            title: environment.label,
            image: environment.machineKind
              ? ENVIRONMENT_MACHINE_SYMBOLS[environment.machineKind]
              : "desktopcomputer",
            state:
              environment.environmentId === props.selectedEnvironmentId
                ? ("on" as const)
                : ("off" as const),
          })),
        ]}
        onSelect={(id) => {
          if (id === "all") props.onEnvironmentChange(null);
          else {
            const environment = props.environments.find(
              (candidate) => JSON.stringify(candidate.environmentId) === id,
            );
            if (environment) props.onEnvironmentChange(environment.environmentId);
          }
        }}
      />
      <ListFilterMenu
        label={selectedProject?.label ?? gt("All projects")}
        accessibilityLabel={gt("Filter threads by project")}
        active={selectedProject !== undefined}
        actions={[
          {
            id: "all",
            title: gt("All projects"),
            image: "folder",
            state: props.selectedProjectKey === null ? "on" : "off",
          },
          ...props.projects.map((project) => ({
            id: JSON.stringify(project.key),
            title: project.label,
            image: project.icon ?? "folder",
            state: project.key === props.selectedProjectKey ? ("on" as const) : ("off" as const),
          })),
        ]}
        onSelect={(id) => {
          if (id === "all") props.onProjectChange(null);
          else {
            const project = props.projects.find(
              (candidate) => JSON.stringify(candidate.key) === id,
            );
            if (project) props.onProjectChange(project.key);
          }
        }}
      />
      {props.selectedEnvironmentId !== null || props.selectedProjectKey !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Reset thread filters")}
          className="h-8 w-8 items-center justify-center"
          onPress={() => {
            props.onEnvironmentChange(null);
            props.onProjectChange(null);
          }}
        >
          <SymbolView name="xmark.circle.fill" size={18} tintColorClassName="accent-icon-muted" />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
