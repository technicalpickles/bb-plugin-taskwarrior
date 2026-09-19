import { useEffect, useState } from "react";
import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "../../contract";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  formatRelative,
  formatTaskwarriorDate,
  isOverdue,
  isPriorityCode,
  parseTaskwarriorDate,
  priorityLabel,
  priorityVariant,
  type PriorityCode,
} from "../../lib/task-format";
import { PageScroll } from "./page-scroll";

type EditPriority = "none" | PriorityCode;

export function TaskDetail({
  id,
  onOpenTask,
  onClose,
}: {
  id: number;
  onOpenTask: (id: number) => void;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [task, setTask] = useState<TaskRecord | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editPriority, setEditPriority] = useState<EditPriority>("none");
  const [editProject, setEditProject] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editDue, setEditDue] = useState("");

  async function refresh() {
    const { task: next } = await rpc.call("tasks_get", { id });
    setTask(next);
  }

  useEffect(() => {
    setTask(undefined);
    setEditing(false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useRealtime(TASKS_CHANGED, () => {
    refresh();
  });

  function backToList() {
    onClose();
  }

  function startEdit() {
    if (task === null || task === undefined) return;
    setEditPriority(task.priority !== undefined && isPriorityCode(task.priority) ? task.priority : "none");
    setEditProject(task.project ?? "");
    setEditTags((task.tags ?? []).join(", "));
    setEditDue(task.due !== undefined ? (parseTaskwarriorDate(task.due)?.toISOString().slice(0, 10) ?? "") : "");
    setEditing(true);
  }

  async function saveEdit() {
    setBusy(true);
    try {
      const tags = editTags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== "");
      const project = editProject.trim();
      const { ok } = await rpc.call("tasks_modify", {
        id,
        priority: editPriority === "none" ? null : editPriority,
        project: project === "" ? null : project,
        tags,
        due: editDue === "" ? null : editDue,
      });
      if (!ok) {
        toast.error(`Could not save task ${id}`);
        return;
      }
      setEditing(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    setBusy(true);
    try {
      const { ok } = await rpc.call("tasks_complete", { id });
      if (!ok) toast.error(`Could not complete task ${id}`);
      else backToList();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (task === null || task === undefined) return;
    if (!window.confirm(`Delete task #${id}: "${task.description}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const { ok } = await rpc.call("tasks_delete", { id });
      if (!ok) toast.error(`Could not delete task ${id}`);
      else backToList();
    } finally {
      setBusy(false);
    }
  }

  async function copyUuid() {
    if (task === null || task === undefined) return;
    await navigator.clipboard.writeText(task.uuid);
    toast.success("UUID copied");
  }

  return (
    <PageScroll>
      <Button variant="ghost" size="sm" onClick={backToList} className="w-fit">
        ← Back to tasks
      </Button>

      {task === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : task === null ? (
        <p className="text-sm text-muted-foreground">Task not found.</p>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle>{task.description}</CardTitle>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>#{task.id}</span>
                  {task.entry !== undefined && <span>created {formatRelative(task.entry) ?? task.entry}</span>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Pill variant="secondary" size="sm">
                    {task.status === "completed" ? "Completed" : "Pending"}
                  </Pill>
                  {task.priority !== undefined && (
                    <Pill variant={priorityVariant(task.priority)} size="sm">
                      {priorityLabel(task.priority)}
                    </Pill>
                  )}
                  {(task.blockedBy?.length ?? 0) > 0 && (
                    <Pill variant="outline" size="sm" className="gap-1">
                      <Icon name="AlertTriangle" className="size-3.5" />
                      Blocked
                    </Pill>
                  )}
                  {(task.tags ?? []).map((tag) => (
                    <Pill key={tag} variant="outline" size="sm">
                      +{tag}
                    </Pill>
                  ))}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="More actions"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
                >
                  <Icon name="MoreHorizontal" className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                    <Icon name="Trash2" className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>

          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
                <span className="text-muted-foreground">Priority</span>
                {editing ? (
                  <Select value={editPriority} onValueChange={(value) => setEditPriority(value as EditPriority)}>
                    <SelectTrigger className="h-8 w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="H">High</SelectItem>
                      <SelectItem value="M">Medium</SelectItem>
                      <SelectItem value="L">Low</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-foreground">
                    {task.priority !== undefined ? priorityLabel(task.priority) : "None"}
                  </span>
                )}

                <span className="text-muted-foreground">Project</span>
                {editing ? (
                  <Input
                    value={editProject}
                    onChange={(event) => setEditProject(event.target.value)}
                    placeholder="No project"
                    className="h-8 max-w-[220px]"
                  />
                ) : (
                  <span className="text-foreground">{task.project ?? "None"}</span>
                )}

                <span className="text-muted-foreground">Tags</span>
                {editing ? (
                  <Input
                    value={editTags}
                    onChange={(event) => setEditTags(event.target.value)}
                    placeholder="comma, separated"
                    className="h-8 max-w-[220px]"
                  />
                ) : (
                  <span className="text-foreground">
                    {(task.tags?.length ?? 0) > 0 ? (task.tags ?? []).map((tag) => `+${tag}`).join(" ") : "None"}
                  </span>
                )}

                <span className="text-muted-foreground">Due</span>
                {editing ? (
                  <input
                    type="date"
                    value={editDue}
                    onChange={(event) => setEditDue(event.target.value)}
                    className="h-8 max-w-[160px] rounded-md border border-input bg-card px-2 text-sm text-foreground"
                  />
                ) : (
                  <span className={isOverdue(task) ? "font-medium text-destructive" : "text-foreground"}>
                    {task.due !== undefined
                      ? `${formatTaskwarriorDate(task.due)}${
                          formatRelative(task.due) !== null ? ` (${formatRelative(task.due)})` : ""
                        }`
                      : "None"}
                  </span>
                )}

                <span className="text-muted-foreground">Urgency</span>
                <span className="text-foreground">{task.urgency !== undefined ? task.urgency.toFixed(2) : "—"}</span>

                <span className="text-muted-foreground">Created</span>
                <span className="text-foreground">
                  {task.entry !== undefined ? formatTaskwarriorDate(task.entry) : "—"}
                </span>

                <span className="text-muted-foreground">Modified</span>
                <span className="text-foreground">
                  {task.modified !== undefined ? formatTaskwarriorDate(task.modified) : "—"}
                </span>

                <span className="text-muted-foreground">UUID</span>
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-xs text-foreground">{task.uuid}</span>
                  <Button variant="ghost" size="icon" aria-label="Copy UUID" onClick={copyUuid} className="size-7">
                    <Icon name="Copy" className="size-3.5" />
                  </Button>
                </div>
              </div>

              {(task.blockedBy?.length ?? 0) > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Blocked by</p>
                  {(task.blockedBy ?? []).map((blocker) => (
                    <button
                      key={blocker.id}
                      type="button"
                      onClick={() => onOpenTask(blocker.id)}
                      className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-xs hover:bg-state-hover"
                    >
                      <Icon name="AlertTriangle" className="size-3.5" />
                      <span className="truncate text-foreground">
                        #{blocker.id} {blocker.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {task.annotations !== undefined && task.annotations.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground">Annotations</p>
                  <ul className="flex flex-col gap-0.5 text-xs text-foreground">
                    {task.annotations.map((annotation) => (
                      <li key={annotation.entry}>
                        {formatTaskwarriorDate(annotation.entry)}: {annotation.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>

          <CardFooter className="justify-end gap-2">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveEdit} disabled={busy}>
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={startEdit} disabled={busy}>
                  Edit
                </Button>
                <Button size="sm" onClick={handleComplete} disabled={busy} className="gap-1.5">
                  <Icon name="CircleCheck" className="size-4" />
                  Complete
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      )}
    </PageScroll>
  );
}
