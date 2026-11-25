import { useEffect, useRef } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useDelegatedUnderParent, useProjects, useQuietThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { buildDesktopTrayState, partitionTaskBoardThreads } from "../board/taskBoard.logic";

export function DesktopTrayCoordinator() {
  const enabled = useClientSettings((settings) => settings.menuBarIconEnabled);
  const threads = useQuietThreadShells();
  const projects = useProjects();
  const delegatedUnderParent = useDelegatedUnderParent();
  const { environments } = useEnvironments();
  const lastPayloadRef = useRef<string | null>(null);

  const projectNameByScopedKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title] as const),
  );
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );

  const columns = partitionTaskBoardThreads({
    threads,
    delegatedUnderParent,
    projectNameByScopedKey,
    environmentLabelById,
  });

  const trayState = buildDesktopTrayState({
    enabled,
    columns,
  });
  const serialized = JSON.stringify(trayState);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs live thread counts and items to the Electron menu bar tray via IPC
  useEffect(() => {
    const updateTrayState = window.desktopBridge?.updateTrayState;
    if (typeof updateTrayState !== "function") return;
    if (lastPayloadRef.current === serialized) return;
    lastPayloadRef.current = serialized;
    void updateTrayState(trayState);
  }, [serialized, trayState]);

  return null;
}
