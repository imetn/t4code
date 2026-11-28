import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  DEFAULT_THREAD_LIST_SECTION_ORDER,
  DEFAULT_THREAD_LIST_SORT_ORDER,
  isWorkingSectionPromoted,
  resolveThreadListSectionOrder,
  resolveThreadListSortOrder,
  type ThreadListSection,
  type ThreadListSortOrder,
} from "./threadListSort";

export function useThreadListV2ShelfPreferences() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const loaded = AsyncResult.isSuccess(preferencesResult);
  const snoozedShelfExpanded =
    loaded && preferencesResult.value.threadListSnoozedShelfExpanded === true;
  const settledShelfExpanded =
    loaded && preferencesResult.value.threadListSettledShelfExpanded === true;
  const workingShelfEnabled = loaded && preferencesResult.value.workingShelfEnabled !== false;
  const sortOrder = loaded
    ? resolveThreadListSortOrder(preferencesResult.value.threadListSortOrder)
    : DEFAULT_THREAD_LIST_SORT_ORDER;
  const sectionOrder = loaded
    ? resolveThreadListSectionOrder(preferencesResult.value.threadListSectionOrder)
    : DEFAULT_THREAD_LIST_SECTION_ORDER;
  const workingShelfExpanded =
    loaded &&
    (typeof preferencesResult.value.threadListWorkingShelfExpanded === "boolean"
      ? preferencesResult.value.threadListWorkingShelfExpanded
      : isWorkingSectionPromoted(sectionOrder));
  const completedShelfExpanded =
    !loaded || preferencesResult.value.threadListCompletedShelfExpanded !== false;
  const idleShelfExpanded =
    !loaded || preferencesResult.value.threadListIdleShelfExpanded !== false;

  // Transforms read optimistic state so same-frame presses toggle twice.
  const toggleSnoozedShelf = () => {
    if (!loaded) return;
    void savePreferences({
      transform: (current) => ({
        threadListSnoozedShelfExpanded: current.threadListSnoozedShelfExpanded !== true,
      }),
    });
  };
  const toggleSettledShelf = () => {
    if (!loaded) return;
    void savePreferences({
      transform: (current) => ({
        threadListSettledShelfExpanded: current.threadListSettledShelfExpanded !== true,
      }),
    });
  };
  const toggleWorkingShelf = () => {
    if (!loaded) return;
    void savePreferences({
      transform: (current) => {
        const currentExpanded =
          typeof current.threadListWorkingShelfExpanded === "boolean"
            ? current.threadListWorkingShelfExpanded
            : isWorkingSectionPromoted(
                resolveThreadListSectionOrder(current.threadListSectionOrder),
              );
        return { threadListWorkingShelfExpanded: !currentExpanded };
      },
    });
  };
  const toggleCompletedShelf = () => {
    if (!loaded) return;
    void savePreferences({
      transform: (current) => ({
        threadListCompletedShelfExpanded: current.threadListCompletedShelfExpanded === false,
      }),
    });
  };
  const toggleIdleShelf = () => {
    if (!loaded) return;
    void savePreferences({
      transform: (current) => ({
        threadListIdleShelfExpanded: current.threadListIdleShelfExpanded === false,
      }),
    });
  };
  const setSortOrder = (next: ThreadListSortOrder) => {
    if (!loaded) return;
    void savePreferences({ threadListSortOrder: next });
  };
  const setSectionOrder = (next: readonly ThreadListSection[]) => {
    if (!loaded) return;
    void savePreferences({ threadListSectionOrder: next });
  };

  return {
    loaded,
    settledShelfExpanded,
    snoozedShelfExpanded,
    workingShelfEnabled,
    workingShelfExpanded,
    completedShelfExpanded,
    idleShelfExpanded,
    sortOrder,
    sectionOrder,
    toggleSettledShelf,
    toggleSnoozedShelf,
    toggleWorkingShelf,
    toggleCompletedShelf,
    toggleIdleShelf,
    setSortOrder,
    setSectionOrder,
  } as const;
}
