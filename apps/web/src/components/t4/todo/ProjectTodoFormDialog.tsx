import {
  PROJECT_TODO_MAX_BODY_BYTES,
  PROJECT_TODO_MAX_FILE_REFS,
  PROJECT_TODO_MAX_TITLE_LENGTH,
  ProjectTodoId,
  ThreadId,
  utf8ByteLength,
  type EnvironmentId,
  type ProjectId,
  type ProjectTodoItem,
  type ProjectTodoKind,
  type ProjectTodoPriority,
  type ProjectTodoSummary,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { BookmarkIcon, CheckSquareIcon, Link2Icon, PinIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { randomUUID } from "~/lib/utils";
import { useQuietThreadShells } from "~/state/entities";
import { projectTodoEnvironment, useProjectTodoDetail } from "~/state/projectTodos";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

export function newProjectTodoId(): ProjectTodoId {
  return ProjectTodoId.make(`todo_${randomUUID()}`);
}

interface ProjectTodoFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectName?: string;
  readonly projectChoices?: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
  }>;
  readonly selectedProjectKey?: string;
  readonly onSelectProjectKey?: (key: string) => void;
  readonly sourceThreadId?: ThreadId | null;
  readonly editSummary?: ProjectTodoSummary | null;
  readonly initialKind?: ProjectTodoKind;
  readonly onSaved?: (item: ProjectTodoItem) => void;
  readonly onDeleted?: () => void;
}

function parseFileRefsText(raw: string): ReadonlyArray<string> {
  return raw
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, PROJECT_TODO_MAX_FILE_REFS);
}

export function ProjectTodoFormDialog(props: ProjectTodoFormDialogProps) {
  const gt = useGT();
  const isEditing = props.editSummary != null;

  const detailQuery = useProjectTodoDetail(
    props.open && props.editSummary != null
      ? {
          environmentId: props.environmentId,
          input: { projectId: props.projectId, id: props.editSummary.id },
        }
      : null,
  );

  const loadedItem = detailQuery.data?.item ?? null;
  const seedKey = isEditing
    ? `${props.editSummary.id}:${loadedItem?.revision ?? props.editSummary.revision}:${loadedItem !== null ? "full" : "summary"}`
    : `new:${props.projectId}:${props.initialKind ?? "todo"}:${props.open ? "open" : "closed"}`;

  const [formState, setFormState] = useState<{
    seedKey: string;
    draftId: ProjectTodoId;
    title: string;
    body: string;
    kind: ProjectTodoKind;
    priority: ProjectTodoPriority;
    pinned: boolean;
    linkedThreadId: string;
    fileRefsText: string;
    errorMessage: string | null;
  }>(() => ({
    seedKey: "",
    draftId: newProjectTodoId(),
    title: "",
    body: "",
    kind: props.initialKind ?? "todo",
    priority: "normal",
    pinned: false,
    linkedThreadId: "",
    fileRefsText: "",
    errorMessage: null,
  }));

  if (!props.open && formState.seedKey !== "") {
    setFormState((prev) => ({ ...prev, seedKey: "" }));
  } else if (props.open && formState.seedKey !== seedKey) {
    const source = loadedItem ?? props.editSummary ?? null;
    setFormState({
      seedKey,
      draftId: source?.id ?? newProjectTodoId(),
      title: source?.title ?? "",
      body: loadedItem?.body ?? props.editSummary?.bodyPreview ?? "",
      kind: source?.kind ?? props.initialKind ?? "todo",
      priority: source?.priority ?? "normal",
      pinned: source?.pinned ?? false,
      linkedThreadId: source?.linkedThreadId ?? "",
      fileRefsText: source ? source.fileRefs.join("\n") : "",
      errorMessage: null,
    });
  }

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createCommand = useAtomCommand(projectTodoEnvironment.create, { reportFailure: false });
  const updateCommand = useAtomCommand(projectTodoEnvironment.update, { reportFailure: false });
  const removeCommand = useAtomCommand(projectTodoEnvironment.remove, { reportFailure: false });

  const threads = useQuietThreadShells();
  const sameProjectThreads = threads
    .filter(
      (thread) =>
        thread.environmentId === props.environmentId &&
        thread.projectId === props.projectId &&
        thread.deletedAt === null &&
        thread.archivedAt === null,
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 40);

  const bodyBytes = utf8ByteLength(formState.body);
  const bodyOverLimit = bodyBytes > PROJECT_TODO_MAX_BODY_BYTES;
  const titleTrimmed = formState.title.trim();
  const titleValid =
    titleTrimmed.length > 0 && titleTrimmed.length <= PROJECT_TODO_MAX_TITLE_LENGTH;
  const waitingForDetail = isEditing && loadedItem === null && detailQuery.isPending;

  const handleSubmit = async () => {
    if (!titleValid || bodyOverLimit || isSubmitting || waitingForDetail) return;
    setFormState((prev) => ({ ...prev, errorMessage: null }));
    const fileRefs = parseFileRefsText(formState.fileRefsText);
    const linkedThreadId =
      formState.linkedThreadId.trim().length > 0
        ? ThreadId.make(formState.linkedThreadId.trim())
        : null;

    if (!isEditing) {
      setIsSubmitting(true);
      const result = await createCommand({
        environmentId: props.environmentId,
        input: {
          id: formState.draftId,
          projectId: props.projectId,
          title: titleTrimmed,
          body: formState.body,
          kind: formState.kind,
          priority: formState.priority,
          pinned: formState.pinned,
          sourceThreadId: props.sourceThreadId ?? null,
          linkedThreadId,
          fileRefs,
        },
      });
      setIsSubmitting(false);
      if (result._tag === "Success") {
        toastManager.add({
          type: "success",
          title: formState.kind === "note" ? gt("Project note saved") : gt("Project todo added"),
        });
        props.onSaved?.(result.value.item);
        props.onOpenChange(false);
        return;
      }
      setFormState((prev) => ({
        ...prev,
        errorMessage: formatEnvironmentQueryError(result.cause),
      }));
      return;
    }

    const expectedRevision = loadedItem?.revision ?? props.editSummary!.revision;
    setIsSubmitting(true);
    const result = await updateCommand({
      environmentId: props.environmentId,
      input: {
        id: props.editSummary!.id,
        projectId: props.projectId,
        expectedRevision,
        title: titleTrimmed,
        body: formState.body,
        kind: formState.kind,
        priority: formState.priority,
        pinned: formState.pinned,
        linkedThreadId,
        fileRefs,
      },
    });
    setIsSubmitting(false);
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: gt("Changes saved") });
      props.onSaved?.(result.value.item);
      props.onOpenChange(false);
      return;
    }
    setFormState((prev) => ({
      ...prev,
      errorMessage: formatEnvironmentQueryError(result.cause),
    }));
  };

  const handleConfirmDelete = async () => {
    if (!isEditing || isSubmitting) return;
    const expectedRevision = loadedItem?.revision ?? props.editSummary!.revision;
    setIsSubmitting(true);
    const result = await removeCommand({
      environmentId: props.environmentId,
      input: {
        id: props.editSummary!.id,
        projectId: props.projectId,
        expectedRevision,
      },
    });
    setIsSubmitting(false);
    setConfirmDeleteOpen(false);
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: gt("Todo deleted") });
      props.onDeleted?.();
      props.onOpenChange(false);
      return;
    }
    setFormState((prev) => ({
      ...prev,
      errorMessage: formatEnvironmentQueryError(result.cause),
    }));
  };

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? <T>Edit project item</T> : <T>New project todo or note</T>}
            </DialogTitle>
            <DialogDescription>
              {props.projectName
                ? gt("Saved for {project} without starting a thread.", {
                    project: props.projectName,
                  })
                : gt("Capture a follow-up idea or project memory note without starting a thread.")}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
            <div className="flex flex-col gap-3">
              {!isEditing &&
              props.projectChoices !== undefined &&
              props.projectChoices.length > 1 &&
              props.onSelectProjectKey !== undefined ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="t4-todo-project-choice">
                    <T>Project</T>
                  </Label>
                  <select
                    id="t4-todo-project-choice"
                    value={props.selectedProjectKey ?? ""}
                    onChange={(event) => props.onSelectProjectKey?.(event.currentTarget.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
                  >
                    {props.projectChoices.map((choice) => (
                      <option key={choice.key} value={choice.key}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant={formState.kind === "todo" ? "secondary" : "ghost"}
                    onClick={() => setFormState((prev) => ({ ...prev, kind: "todo" }))}
                  >
                    <CheckSquareIcon className="size-3.5" />
                    <span>
                      <T>Todo</T>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant={formState.kind === "note" ? "secondary" : "ghost"}
                    onClick={() => setFormState((prev) => ({ ...prev, kind: "note" }))}
                  >
                    <BookmarkIcon className="size-3.5" />
                    <span>
                      <T>Memory note</T>
                    </span>
                  </Button>
                </div>

                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant={formState.priority === "high" ? "secondary" : "ghost"}
                    onClick={() =>
                      setFormState((prev) => ({
                        ...prev,
                        priority: prev.priority === "high" ? "normal" : "high",
                      }))
                    }
                  >
                    <T>High priority</T>
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant={formState.pinned ? "secondary" : "ghost"}
                    onClick={() => setFormState((prev) => ({ ...prev, pinned: !prev.pinned }))}
                  >
                    <PinIcon className="size-3.5" />
                    <span>{formState.pinned ? gt("Pinned") : gt("Pin")}</span>
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="t4-todo-title">
                  <T>Title</T>
                </Label>
                <Input
                  id="t4-todo-title"
                  value={formState.title}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setFormState((prev) => ({ ...prev, title: value }));
                  }}
                  placeholder={
                    formState.kind === "note"
                      ? gt("Key decision, invariant, or pitfall...")
                      : gt("Idea, refactor, or follow-up task...")
                  }
                  maxLength={PROJECT_TODO_MAX_TITLE_LENGTH}
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="t4-todo-body">
                    <T>Details (Markdown)</T>
                  </Label>
                  <Badge size="sm" variant={bodyOverLimit ? "error" : "secondary"}>
                    {gt("{used} / {max} bytes", {
                      used: bodyBytes,
                      max: PROJECT_TODO_MAX_BODY_BYTES,
                    })}
                  </Badge>
                </div>
                <Textarea
                  id="t4-todo-body"
                  rows={5}
                  value={formState.body}
                  disabled={waitingForDetail}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setFormState((prev) => ({ ...prev, body: value }));
                  }}
                  placeholder={gt("Optional context, edge cases, or acceptance notes...")}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="t4-todo-files">
                  <T>Related files (one per line)</T>
                </Label>
                <Textarea
                  id="t4-todo-files"
                  rows={2}
                  value={formState.fileRefsText}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setFormState((prev) => ({ ...prev, fileRefsText: value }));
                  }}
                  placeholder={gt("apps/web/src/components/board/TaskBoardPage.tsx")}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="t4-todo-thread">
                  <span className="inline-flex items-center gap-1.5">
                    <Link2Icon className="size-3.5 text-muted-foreground" />
                    <span>
                      <T>Linked thread (same project)</T>
                    </span>
                  </span>
                </Label>
                <select
                  id="t4-todo-thread"
                  value={formState.linkedThreadId}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setFormState((prev) => ({ ...prev, linkedThreadId: value }));
                  }}
                  className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
                >
                  <option value="">{gt("No linked thread")}</option>
                  {sameProjectThreads.map((thread) => (
                    <option key={thread.id} value={thread.id}>
                      {thread.title}
                    </option>
                  ))}
                </select>
              </div>

              {formState.errorMessage ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <span>{formState.errorMessage}</span>
                  {isEditing ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => detailQuery.refresh()}
                    >
                      <T>Refresh</T>
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </DialogPanel>

          <DialogFooter className="flex items-center justify-between">
            {isEditing ? (
              <Button
                type="button"
                size="sm"
                variant="destructive-outline"
                disabled={isSubmitting}
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <Trash2Icon className="size-3.5" />
                <span>
                  <T>Delete</T>
                </span>
              </Button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => props.onOpenChange(false)}
              >
                <T>Cancel</T>
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!titleValid || bodyOverLimit || isSubmitting || waitingForDetail}
                onClick={() => void handleSubmit()}
              >
                {isEditing ? <T>Save</T> : <T>Add</T>}
              </Button>
            </div>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>Delete this project item?</T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>
                This permanently removes the todo or note from this project. Use Archive if you may
                want it back later.
              </T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button size="sm" variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isSubmitting}
              onClick={() => void handleConfirmDelete()}
            >
              <T>Delete permanently</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
