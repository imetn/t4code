import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ListTodoIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useProjects, useServerConfigs } from "~/state/entities";
import { useEnvironmentSupportsProjectTodos } from "~/state/projectTodos";
import { useEnvironmentScope } from "~/state/session";
import { ProjectTodoFormDialog } from "./ProjectTodoFormDialog";
import { ProjectTodosSection } from "./ProjectTodosSection";

interface ProjectTodosHeaderTriggerProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly threadId: ThreadId;
}

export function ProjectTodosHeaderTrigger(props: ProjectTodosHeaderTriggerProps) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const supported = useEnvironmentSupportsProjectTodos(props.environmentId);

  if (!supported) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Project todos & memory")}
              onClick={() => setOpen(true)}
            />
          }
        >
          <ListTodoIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          <T>Project todos & memory</T>
        </TooltipPopup>
      </Tooltip>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetPopup side="right" layer="dialog" className="w-full max-w-md">
          <SheetHeader>
            <SheetTitle>
              <span className="inline-flex min-w-0 items-center gap-2">
                <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{props.projectName}</span>
              </span>
            </SheetTitle>
            <SheetDescription>
              <T>Capture deferred ideas and pinned memory notes for this project.</T>
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            <ProjectTodosSection
              environmentId={props.environmentId}
              projectId={props.projectId}
              projectName={props.projectName}
              sourceThreadId={props.threadId}
              compact
              onAfterDispatch={() => setOpen(false)}
            />
          </div>
        </SheetPopup>
      </Sheet>
    </>
  );
}

interface QuickTodoCaptureDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly defaultEnvironmentId?: EnvironmentId | null;
  readonly defaultProjectId?: ProjectId | null;
  readonly sourceThreadId?: ThreadId | null;
}

export function QuickTodoCaptureDialog(props: QuickTodoCaptureDialogProps) {
  const gt = useGT();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();

  const capableProjects = projects.filter((project) => {
    const serverConfig = serverConfigs.get(project.environmentId);
    return (
      project.archivedAt === null &&
      !isScratchProject(project, serverConfig?.scratchWorkspaceRoot) &&
      serverConfig?.environment.capabilities.projectTodos === true
    );
  });

  const defaultKey =
    props.defaultEnvironmentId != null && props.defaultProjectId != null
      ? scopedProjectKey(scopeProjectRef(props.defaultEnvironmentId, props.defaultProjectId))
      : null;

  const [chosenKey, setChosenKey] = useState<string | null>(defaultKey);
  const selectedProject =
    capableProjects.find(
      (project) =>
        scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === chosenKey,
    ) ??
    (defaultKey !== null
      ? capableProjects.find(
          (project) =>
            scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === defaultKey,
        )
      : undefined) ??
    capableProjects[0] ??
    null;

  const canOperate = useEnvironmentScope(
    selectedProject?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );

  if (!props.open) return null;

  if (selectedProject === null || !canOperate) {
    return (
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              <T>Quick capture project todo</T>
            </DialogTitle>
            <DialogDescription>
              {selectedProject === null
                ? gt("Add a project on a T4 Code host first to capture project todos.")
                : gt("You do not have permission to create todos in this environment.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" size="sm" onClick={() => props.onOpenChange(false)}>
              <T>Close</T>
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    );
  }

  const selectedKey = scopedProjectKey(
    scopeProjectRef(selectedProject.environmentId, selectedProject.id),
  );
  const projectChoices = capableProjects.map((project) => ({
    key: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
    label: project.title,
  }));

  return (
    <ProjectTodoFormDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      environmentId={selectedProject.environmentId}
      projectId={selectedProject.id}
      projectName={selectedProject.title}
      projectChoices={projectChoices}
      selectedProjectKey={selectedKey}
      onSelectProjectKey={setChosenKey}
      sourceThreadId={
        selectedProject.environmentId === props.defaultEnvironmentId &&
        selectedProject.id === props.defaultProjectId
          ? (props.sourceThreadId ?? null)
          : null
      }
    />
  );
}
