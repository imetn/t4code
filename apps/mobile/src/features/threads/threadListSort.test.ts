import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_THREAD_LIST_SECTION_ORDER,
  DEFAULT_THREAD_LIST_SORT_ORDER,
  isWorkingSectionPromoted,
  moveThreadListSection,
  resolveThreadListSectionOrder,
  resolveThreadListSortOrder,
  sameThreadListSectionOrder,
} from "./threadListSort";

describe("threadListSort", () => {
  it("defaults to updated_at sort and completed-first section order", () => {
    expect(resolveThreadListSortOrder(undefined)).toBe(DEFAULT_THREAD_LIST_SORT_ORDER);
    expect(resolveThreadListSortOrder("unknown")).toBe("updated_at");
    expect(resolveThreadListSortOrder("created_at")).toBe("created_at");
    expect(resolveThreadListSortOrder("manual")).toBe("manual");

    expect(resolveThreadListSectionOrder(undefined)).toEqual(["completed", "working", "idle"]);
    expect(resolveThreadListSectionOrder([])).toEqual(DEFAULT_THREAD_LIST_SECTION_ORDER);
  });

  it("fills missing sections and drops duplicates or invalid entries", () => {
    expect(resolveThreadListSectionOrder(["working", "bogus", "working", null])).toEqual([
      "working",
      "completed",
      "idle",
    ]);
  });

  it("moves a section without disturbing the relative order of the rest", () => {
    expect(moveThreadListSection(undefined, "working", 0)).toEqual([
      "working",
      "completed",
      "idle",
    ]);
    expect(moveThreadListSection(undefined, "working", 2)).toEqual([
      "completed",
      "idle",
      "working",
    ]);
    expect(moveThreadListSection(["completed", "idle", "working"], "working", 1)).toEqual([
      "completed",
      "working",
      "idle",
    ]);
  });

  it("treats working as promoted whenever it appears ahead of idle", () => {
    expect(isWorkingSectionPromoted(["completed", "working", "idle"])).toBe(true);
    expect(isWorkingSectionPromoted(["working", "completed", "idle"])).toBe(true);
    expect(isWorkingSectionPromoted(["completed", "idle", "working"])).toBe(false);
    expect(
      sameThreadListSectionOrder(
        ["completed", "working", "idle"],
        DEFAULT_THREAD_LIST_SECTION_ORDER,
      ),
    ).toBe(true);
    expect(
      sameThreadListSectionOrder(
        ["working", "completed", "idle"],
        DEFAULT_THREAD_LIST_SECTION_ORDER,
      ),
    ).toBe(false);
  });
});
