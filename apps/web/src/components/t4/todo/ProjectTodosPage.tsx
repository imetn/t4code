import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  CalendarCheck2Icon,
  CalendarIcon,
  FolderKanbanIcon,
  ListTodoIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { SidebarInset, SidebarTrigger } from "~/components/ui/sidebar";
import { useProjects } from "~/state/entities";
import { useEnvironments, useProjectTodosSupported } from "~/state/environments";
import { useEnvironmentScope } from "~/state/session";
import { ProjectTodoFormDialog } from "./ProjectTodoFormDialog";
import { ProjectTodosCalendarView } from "./ProjectTodosCalendarView";
import { ProjectTodosDailyReview } from "./ProjectTodosDailyReview";
import { ProjectTodosSection } from "./ProjectTodosSection";

export function ProjectTodosPage() {
  const gt = useGT();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const projectTodosSupported = useProjectTodosSupported();

  const [viewMode, setViewMode] = useState<"calendar" | "daily-review" | "by-project">("calendar");
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
      !project.isScratch &&
      capableEnvIds.has(project.environmentId) &&
      (selectedEnvironmentId === null || project.environmentId === selectedEnvironmentId),
  );

  const projectByScopedKey = new Map(
    activeProjects.map((project) => [
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      project,
    ]),
  );

  const selectedProject =
    selectedProjectScopedKey !== null
      ? (projectByScopedKey.get(selectedProjectScopedKey) ?? null)
      : null;
  const backlogTargetProject = selectedProject ?? activeProjects[0] ?? null;

  const reviewEnvironmentId =
    selectedEnvironmentId ??
    selectedProject?.environmentId ??
    capableEnvironments[0]?.environmentId ??
    null;
  const reviewProjectId = selectedProject?.id ?? null;

  const captureTargetProject =
    (captureProjectKey !== null ? projectByScopedKey.get(captureProjectKey) : undefined) ??
    selectedProject ??
    activeProjects[0] ??
    null;
  const canOperateCapture = useEnvironmentScope(
    captureTargetProject?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );

  const projectChoices = activeProjects.map((project) => ({
    key: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
    label: project.title,
  }));

  const showEnvironmentFilter = capableEnvironments.length > 1;

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
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger className="md:hidden" aria-label={gt("Toggle main sidebar")} />
          <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-semibold tracking-tight">
            <T>Project todos</T>
          </h1>

          {projectTodosSupported ? (
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/20 p-0.5">
              <Button
                type="button"
                size="xs"
                variant={viewMode === "calendar" ? "secondary" : "ghost"}
                onClick={() => setViewMode("calendar")}
              >
                <CalendarIcon className="size-3" />
                <span>
                  <T>Calendar</T>
                </span>
              </Button>
              <Button
                type="button"
                size="xs"
                variant={viewMode === "daily-review" ? "secondary" : "ghost"}
                onClick={() => setViewMode("daily-review")}
              >
                <CalendarCheck2Icon className="size-3" />
                <span>
                  <T>Daily review</T>
                </span>
              </Button>
              <Button
                type="button"
                size="xs"
                variant={viewMode === "by-project" ? "secondary" : "ghost"}
                onClick={() => setViewMode("by-project")}
              >
                <FolderKanbanIcon className="size-3" />
                <span>
                  <T>By project</T>
                </span>
              </Button>
            </div>
          ) : null}
        </div>

        {captureTargetProject !== null && canOperateCapture ? (
          <Button type="button" size="sm" onClick={() => openCaptureForProject()}>
            <PlusIcon className="size-3.5" />
            <span>
              <T>New todo</T>
            </span>
          </Button>
        ) : null}
      </header>

      {!projectTodosSupported ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            <T>Project todos unavailable on this host</T>
          </p>
          <p>
            <T>Upgrade this machine to T4 Code to store project todos and agent memory notes.</T>
          </p>
        </div>
      ) : (
        <>
          {showEnvironmentFilter || activeProjects.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/50 bg-muted/10 px-4 py-2">
              {showEnvironmentFilter ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant={selectedEnvironmentId === null ? "secondary" : "ghost"}
                    onClick={() => {
                      setSelectedEnvironmentId(null);
                      setSelectedProjectScopedKey(null);
                    }}
                  >
                    <T>All environments</T>
                  </Button>
                  {capableEnvironments.map((environment) => {
                    const active = selectedEnvironmentId === environment.environmentId;
                    return (
                      <Button
                        key={environment.environmentId}
                        type="button"
                        size="xs"
                        variant={active ? "secondary" : "ghost"}
                        onClick={() => {
                          setSelectedEnvironmentId(active ? null : environment.environmentId);
                          setSelectedProjectScopedKey(null);
                        }}
                      >
                        {environment.label}
                      </Button>
                    );
                  })}
                </div>
              ) : null}

              {showEnvironmentFilter && activeProjects.length > 0 ? (
                <span className="mx-1 h-4 w-px bg-border/60" aria-hidden />
              ) : null}

              {activeProjects.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1">
                  {viewMode !== "by-project" ? (
                    <Button
                      type="button"
                      size="xs"
                      variant={selectedProjectScopedKey === null ? "secondary" : "ghost"}
                      onClick={() => setSelectedProjectScopedKey(null)}
                    >
                      <T>All projects</T>
                    </Button>
                  ) : null}
                  {activeProjects.map((project) => {
                    const key = scopedProjectKey(
                      scopeProjectRef(project.environmentId, project.id),
                    );
                    const active =
                      viewMode !== "by-project"
                        ? selectedProjectScopedKey === key
                        : backlogTargetProject?.id === project.id &&
                          backlogTargetProject?.environmentId === project.environmentId;
                    return (
                      <Button
                        key={key}
                        type="button"
                        size="xs"
                        variant={active ? "secondary" : "ghost"}
                        onClick={() =>
                          setSelectedProjectScopedKey(
                            viewMode !== "by-project" && active ? null : key,
                          )
                        }
                      >
                        <span className="max-w-40 truncate">{project.title}</span>
                      </Button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {viewMode === "calendar" ? (
            <ProjectTodosCalendarView
              environmentId={reviewEnvironmentId}
              projectId={reviewProjectId}
              onRequestNewTodo={openCaptureForProject}
            />
          ) : viewMode === "daily-review" ? (
            <ProjectTodosDailyReview
              environmentId={reviewEnvironmentId}
              projectId={reviewProjectId}
            />
          ) : (
            <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden p-4">
              {backlogTargetProject !== null ? (
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/90">
                      <T>Project backlog & memory</T>
                    </h2>
                    <Badge size="sm" variant="secondary">
                      {backlogTargetProject.title}
                    </Badge>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    <T>Draft in thread puts the prompt into the composer without sending.</T>
                  </p>
                </div>
              ) : null}
              <ProjectTodosSection
                environmentId={backlogTargetProject?.environmentId ?? null}
                projectId={backlogTargetProject?.id ?? null}
                {...(backlogTargetProject !== null
                  ? { projectName: backlogTargetProject.title }
                  : {})}
              />
            </div>
          )}
        </>
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
