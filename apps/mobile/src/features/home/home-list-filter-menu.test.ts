import type { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import type { WorkspaceEnvironment } from "../../state/workspaceModel";
import { buildHomeListFilterMenuItems, homeListFilterEnvironments } from "./home-list-filter-menu";

function environment(
  environmentId: string,
  environmentLabel: string,
  isEnabled: boolean,
): WorkspaceEnvironment {
  return {
    environmentId: environmentId as EnvironmentId,
    environmentLabel,
    displayUrl: "",
    isRelayManaged: false,
    isEnabled,
    connectionState: isEnabled ? "connected" : "available",
    connectionError: null,
    connectionErrorTraceId: null,
  };
}

it("offers only switched-on environments, sorted by label", () => {
  expect(
    homeListFilterEnvironments([
      environment("env-studio", "Studio", true),
      environment("env-laptop", "Laptop", false),
      environment("env-desk", "Desk", true),
    ]),
  ).toEqual([
    { environmentId: "env-desk", label: "Desk", connectionState: "connected" },
    { environmentId: "env-studio", label: "Studio", connectionState: "connected" },
  ]);
});

it("includes sort order and group order menus when sort options are provided", () => {
  const sortOrders: string[] = [];
  const sectionOrders: readonly (readonly string[])[] = [];
  const items = buildHomeListFilterMenuItems({
    environments: [],
    projects: [],
    selectedEnvironmentId: null,
    selectedProjectKey: null,
    onEnvironmentChange: () => {},
    onProjectChange: () => {},
    sort: {
      sortOrder: "updated_at",
      sectionOrder: ["completed", "working", "idle"],
      workingShelfEnabled: true,
      onSortOrderChange: (order) => {
        sortOrders.push(order);
      },
      onSectionOrderChange: (order) => {
        (sectionOrders as Array<readonly string[]>).push(order);
      },
    },
  });
  expect(items.map((item) => item.id)).toEqual(["environment", "sort", "section-order"]);
  const sortGroup = items.find((item) => item.id === "sort");
  expect(sortGroup && "items" in sortGroup ? sortGroup.items.map((entry) => entry.id) : []).toEqual(
    ["sort:updated_at", "sort:created_at", "sort:manual"],
  );
  if (sortGroup && "items" in sortGroup) {
    const createdItem = sortGroup.items.find((entry) => entry.id === "sort:created_at");
    if (createdItem && "onPress" in createdItem) createdItem.onPress();
  }
  expect(sortOrders).toEqual(["created_at"]);
});
