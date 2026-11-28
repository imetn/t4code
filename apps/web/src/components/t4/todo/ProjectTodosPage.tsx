import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  CalendarDaysIcon,
  CalendarIcon,
  ChevronDownIcon,
  FolderKanbanIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { Button } from "~/components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { SidebarInset } from "~/components/ui/sidebar";
import { isElectron } from "~/env";
import { useProjects, useQuietThreadShells, useServerConfigs } from "~/state/entities";
import { useEnvironments, useProjectTodosSupported } from "~/state/environments";
import { useEnvironmentScope } from "~/state/session";
import { ProjectTodoFormDialog } from "./ProjectTodoFormDialog";
import { ProjectTodosCalendarView } from "./ProjectTodosCalendarView";
import { ProjectTodosSection } from "./ProjectTodosSection";
import { ProjectTodosTimelineView } from "./ProjectTodosTimelineView";

const ALL_PROJECTS_VALUE = "__all__";

export function ProjectTodosPage() {
  const gt = useGT();
  const projects = useProjects();
  const threads = useQuietThreadShells();
  const serverConfigs = useServerConfigs();
  const { environments } = useEnvironments();
  const projectTodosSupported = useProjectTodosSupported();

  const [viewMode, setViewMode] = useState<"calendar" | "timeline" | "by-project">("calendar");
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(null);
  const [selectedProjectScopedKey, setSelectedProjectScopedKey] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureProjectKey, setCaptureProjectKey] = useState<string | null>(null);

  const capableEnvironments = environments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.projectTodos === true,
  );
  const capableEnvIds = new Set(
    capableEnvironments.map((environment) => environment.environmentId),
  );

  const activeProjects = projects.filter(
    (project) =>
      project.archivedAt === null &&
      !isScratchProject(project, serverConfigs.get(project.environmentId)?.scratchWorkspaceRoot) &&
      capableEnvIds.has(project.environmentId) &&
      (selectedEnvironmentId === null || project.environmentId === selectedEnvironmentId),
  );

  const projectByScopedKey = new Map(
    activeProjects.map((project) => [
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      project,
    ]),
  );

  let mostRecentProjectKey: string | null = null;
  let mostRecentUpdatedAt = "";
  for (const thread of threads) {
    if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
    const key = scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
    if (!projectByScopedKey.has(key)) continue;
    if (thread.updatedAt > mostRecentUpdatedAt) {
      mostRecentUpdatedAt = thread.updatedAt;
      mostRecentProjectKey = key;
    }
  }
  const preferredDefaultProject =
    (mostRecentProjectKey !== null ? projectByScopedKey.get(mostRecentProjectKey) : undefined) ??
    activeProjects[0] ??
    null;

  const selectedProject =
    selectedProjectScopedKey !== null
      ? (projectByScopedKey.get(selectedProjectScopedKey) ?? null)
      : null;
  const backlogTargetProject = selectedProject ?? preferredDefaultProject;

  const reviewEnvironmentId =
    selectedEnvironmentId ??
    selectedProject?.environmentId ??
    preferredDefaultProject?.environmentId ??
    capableEnvironments[0]?.environmentId ??
    null;
  const reviewProjectId = selectedProject?.id ?? null;

  const captureTargetProject =
    (captureProjectKey !== null ? projectByScopedKey.get(captureProjectKey) : undefined) ??
    selectedProject ??
    preferredDefaultProject;
  const canOperateCapture = useEnvironmentScope(
    captureTargetProject?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );

  const projectChoices = activeProjects.map((project) => ({
    key: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
    label: project.title,
  }));

  const currentProjectMenuValue =
    viewMode === "by-project"
      ? backlogTargetProject !== null
        ? scopedProjectKey(
            scopeProjectRef(backlogTargetProject.environmentId, backlogTargetProject.id),
          )
        : ALL_PROJECTS_VALUE
      : (selectedProjectScopedKey ?? ALL_PROJECTS_VALUE);

  const currentProjectMenuLabel =
    viewMode === "by-project"
      ? (backlogTargetProject?.title ?? gt("Project"))
      : (selectedProject?.title ?? gt("All projects"));

  const openCaptureForProject = (projectId?: ProjectId) => {
    const preferred =
      projectId !== undefined
        ? activeProjects.find((candidate) => candidate.id === projectId)
        : captureTargetProject;
    const target = preferred ?? captureTargetProject;
    if (target === null) return;
    setCaptureProjectKey(scopedProjectKey(scopeProjectRef(target.environmentId, target.id)));
    setCaptureOpen(true);
  };

  return (
    <SidebarInset className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
      <WorkspacePageHeader electron={isElectron} className="relative bg-background">
        <WorkspaceBreadcrumb ariaLabel={gt("Project todos breadcrumb")}>
          <WorkspaceBreadcrumbItem current>
            <h1 className="truncate">
              <T>Project todos</T>
            </h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>

        <div className="min-w-0 flex-1" />

        {projectTodosSupported ? (
          <div className="flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                size="xs"
                variant={viewMode === "calendar" ? "secondary" : "ghost"}
                onClick={() => setViewMode("calendar")}
              >
                <CalendarIcon className="size-3.5" />
                <span>
                  <T>Calendar</T>
                </span>
              </Button>
              <Button
                type="button"
                size="xs"
                variant={viewMode === "timeline" ? "secondary" : "ghost"}
                onClick={() => setViewMode("timeline")}
              >
                <CalendarDaysIcon className="size-3.5" />
                <span>
                  <T>Timeline</T>
                </span>
              </Button>
              <Button
                type="button"
                size="xs"
                variant={viewMode === "by-project" ? "secondary" : "ghost"}
                onClick={() => setViewMode("by-project")}
              >
                <FolderKanbanIcon className="size-3.5" />
                <span>
                  <T>By project</T>
                </span>
              </Button>
            </div>

            {activeProjects.length > 1 || capableEnvironments.length > 1 ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button type="button" size="xs" variant="outline">
                      <span className="max-w-32 truncate">{currentProjectMenuLabel}</span>
                      <ChevronDownIcon className="size-3 opacity-70" />
                    </Button>
                  }
                />
                <MenuPopup align="end">
                  {capableEnvironments.length > 1 ? (
                    <MenuRadioGroup
                      value={selectedEnvironmentId ?? ALL_PROJECTS_VALUE}
                      onValueChange={(value) => {
                        setSelectedEnvironmentId(
                          value === ALL_PROJECTS_VALUE ? null : (value as EnvironmentId),
                        );
                        setSelectedProjectScopedKey(null);
                      }}
                    >
                      <MenuRadioItem value={ALL_PROJECTS_VALUE}>
                        <T>All environments</T>
                      </MenuRadioItem>
                      {capableEnvironments.map((environment) => (
                        <MenuRadioItem
                          key={environment.environmentId}
                          value={environment.environmentId}
                        >
                          {environment.label}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  ) : null}
                  <MenuRadioGroup
                    value={currentProjectMenuValue}
                    onValueChange={(value) => {
                      setSelectedProjectScopedKey(value === ALL_PROJECTS_VALUE ? null : value);
                    }}
                  >
                    {viewMode !== "by-project" ? (
                      <MenuRadioItem value={ALL_PROJECTS_VALUE}>
                        <T>All projects</T>
                      </MenuRadioItem>
                    ) : null}
                    {activeProjects.map((project) => {
                      const key = scopedProjectKey(
                        scopeProjectRef(project.environmentId, project.id),
                      );
                      return (
                        <MenuRadioItem key={key} value={key}>
                          {project.title}
                        </MenuRadioItem>
                      );
                    })}
                  </MenuRadioGroup>
                </MenuPopup>
              </Menu>
            ) : null}

            {captureTargetProject !== null && canOperateCapture ? (
              <Button type="button" size="xs" onClick={() => openCaptureForProject()}>
                <PlusIcon className="size-3.5" />
                <span>
                  <T>New todo</T>
                </span>
              </Button>
            ) : null}
          </div>
        ) : null}
      </WorkspacePageHeader>

      {!projectTodosSupported ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            <T>Project todos unavailable on this host</T>
          </p>
          <p>
            <T>Upgrade this machine to T4 Code to store project todos and agent memory notes.</T>
          </p>
        </div>
      ) : viewMode === "calendar" ? (
        <ProjectTodosCalendarView
          environmentId={reviewEnvironmentId}
          projectId={reviewProjectId}
          defaultProjectId={preferredDefaultProject?.id ?? null}
          onRequestNewTodo={openCaptureForProject}
        />
      ) : viewMode === "timeline" ? (
        <ProjectTodosTimelineView environmentId={reviewEnvironmentId} projectId={reviewProjectId} />
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden px-5 pt-2 pb-5">
          <ProjectTodosSection
            environmentId={backlogTargetProject?.environmentId ?? null}
            projectId={backlogTargetProject?.id ?? null}
            {...(backlogTargetProject !== null ? { projectName: backlogTargetProject.title } : {})}
          />
        </div>
      )}

      {captureTargetProject !== null ? (
        <ProjectTodoFormDialog
          open={captureOpen}
          onOpenChange={setCaptureOpen}
          environmentId={captureTargetProject.environmentId}
          projectId={captureTargetProject.id}
          projectName={captureTargetProject.title}
          projectChoices={projectChoices}
          selectedProjectKey={scopedProjectKey(
            scopeProjectRef(captureTargetProject.environmentId, captureTargetProject.id),
          )}
          onSelectProjectKey={setCaptureProjectKey}
        />
      ) : null}
    </SidebarInset>
  );
}
