// bb-plugin-taskwarrior — sidebar panel. Backs onto the same `runTask`
// bridge as `bb tw` and the taskwarrior_run agent tool via rpcContract.
//
// Route shape: the list lives at the panel root (subPath ""); clicking a
// task navigates to subPath "<id>" for a detail view. Both share one
// `filter` state (project/tag chips), kept in memory only — it resets when
// you leave the panel, same as most ad hoc list filters.
import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "./contract";

// Taskwarrior exports dates as compact UTC basic-ISO-8601:
// "20260415T000000Z". Parse that, then render with the viewer's own locale
// and timezone instead of the raw wire format.
const DATE_ONLY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const DATE_AND_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function parseTaskwarriorDate(value: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
}

function formatTaskwarriorDate(value: string): string {
  const date = parseTaskwarriorDate(value);
  if (date === null) return value;
  const atMidnightUtc =
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  return (atMidnightUtc ? DATE_ONLY : DATE_AND_TIME).format(date);
}

/** e.g. "in 3 days" / "2 months ago" — only meaningful for near-ish dates. */
function formatRelativeDays(value: string): string | null {
  const date = parseTaskwarriorDate(value);
  if (date === null) return null;
  const diffDays = Math.round((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return RELATIVE.format(diffDays, "day");
}

function toggleFilter(filter: string[], token: string): string[] {
  if (filter.includes(token)) return filter.filter((existing) => existing !== token);
  if (token.startsWith("project:")) {
    return [...filter.filter((existing) => !existing.startsWith("project:")), token];
  }
  return [...filter, token];
}

function FilterChips({
  filter,
  onClear,
  onRemove,
}: {
  filter: string[];
  onClear: () => void;
  onRemove: (token: string) => void;
}) {
  if (filter.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Filter:</span>
      {filter.map((token) => (
        <button
          key={token}
          type="button"
          onClick={() => onRemove(token)}
          className="rounded-full border border-border bg-card px-2 py-0.5 text-foreground hover:bg-accent"
          title="Remove filter"
        >
          {token} ✕
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="text-muted-foreground underline-offset-2 hover:underline"
      >
        Clear
      </button>
    </div>
  );
}

function TaskMeta({
  task,
  onFilter,
}: {
  task: TaskRecord;
  onFilter: (token: string) => void;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span>#{task.id}</span>
      {task.project !== undefined && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onFilter(`project:${task.project}`);
          }}
          className="hover:text-foreground hover:underline"
        >
          {task.project}
        </button>
      )}
      {(task.tags ?? []).map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onFilter(`+${tag}`);
          }}
          className="hover:text-foreground hover:underline"
        >
          +{tag}
        </button>
      ))}
      {task.due !== undefined && (
        <span>
          due {formatTaskwarriorDate(task.due)}
          {formatRelativeDays(task.due) !== null && ` (${formatRelativeDays(task.due)})`}
        </span>
      )}
    </p>
  );
}

/** "…" menu: Complete/Delete stay out of the way until asked for, and
 * Delete always confirms — there's no undo for a Taskwarrior delete. */
function RowActions({
  taskId,
  description,
  busy,
  onComplete,
  onDelete,
}: {
  taskId: number;
  description: string;
  busy: boolean;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function handleDeleteClick() {
    setOpen(false);
    if (window.confirm(`Delete task #${taskId}: "${description}"? This can't be undone.`)) {
      onDelete();
    }
  }

  return (
    <div
      ref={ref}
      className="relative shrink-0"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={`Actions for task ${taskId}`}
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-32 rounded-md border border-border bg-card py-1 text-xs shadow-md">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onComplete();
            }}
            className="block w-full px-3 py-1.5 text-left text-foreground hover:bg-accent"
          >
            Complete
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            className="block w-full px-3 py-1.5 text-left text-destructive hover:bg-accent"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function TaskList({
  filter,
  setFilter,
}: {
  filter: string[];
  setFilter: (next: string[]) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const { tasks: next } = await rpc.call("tasks_list", { filter });
    setTasks(next);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  useRealtime(TASKS_CHANGED, () => {
    refresh();
  });

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const description = draft.trim();
    if (description === "") return;
    setAdding(true);
    try {
      await rpc.call("tasks_add", { description });
      setDraft("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add task");
    } finally {
      setAdding(false);
    }
  }

  async function handleComplete(id: number) {
    setBusyId(id);
    try {
      const { ok } = await rpc.call("tasks_complete", { id });
      if (!ok) toast.error(`Could not complete task ${id}`);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    try {
      const { ok } = await rpc.call("tasks_delete", { id });
      if (!ok) toast.error(`Could not delete task ${id}`);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  function onFilter(token: string) {
    setFilter(toggleFilter(filter, token));
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-5">
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          placeholder="Add a task…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={adding}
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          disabled={adding || draft.trim() === ""}
        >
          Add
        </button>
      </form>

      <FilterChips filter={filter} onClear={() => setFilter([])} onRemove={onFilter} />

      {tasks === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching tasks.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tasks.map((task) => (
            <li
              key={task.uuid}
              onClick={() => navigate.toPluginPanel("tasks", { subPath: String(task.id) })}
              className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground">{task.description}</p>
                <TaskMeta task={task} onFilter={onFilter} />
              </div>
              <RowActions
                taskId={task.id}
                description={task.description}
                busy={busyId === task.id}
                onComplete={() => handleComplete(task.id)}
                onDelete={() => handleDelete(task.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskDetail({
  id,
  filter,
  setFilter,
}: {
  id: number;
  filter: string[];
  setFilter: (next: string[]) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [task, setTask] = useState<TaskRecord | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const { task: next } = await rpc.call("tasks_get", { id });
    setTask(next);
  }

  useEffect(() => {
    setTask(undefined);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useRealtime(TASKS_CHANGED, () => {
    refresh();
  });

  function backToList() {
    navigate.toPluginPanel("tasks", { subPath: "" });
  }

  function onFilter(token: string) {
    setFilter(toggleFilter(filter, token));
    backToList();
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
    if (!window.confirm(`Delete task #${id}: "${task.description}"? This can't be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const { ok } = await rpc.call("tasks_delete", { id });
      if (!ok) toast.error(`Could not delete task ${id}`);
      else backToList();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-5">
      <button
        type="button"
        onClick={backToList}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to tasks
      </button>

      {task === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : task === null ? (
        <p className="text-sm text-muted-foreground">Task #{id} not found.</p>
      ) : (
        <div className="space-y-4 rounded-md border border-border p-4">
          <div>
            <p className="text-base text-foreground">{task.description}</p>
            <TaskMeta task={task} onFilter={onFilter} />
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-foreground">{task.status}</dd>
            {task.priority !== undefined && (
              <>
                <dt className="text-muted-foreground">Priority</dt>
                <dd className="text-foreground">{task.priority}</dd>
              </>
            )}
            {task.urgency !== undefined && (
              <>
                <dt className="text-muted-foreground">Urgency</dt>
                <dd className="text-foreground">{task.urgency.toFixed(2)}</dd>
              </>
            )}
            {task.entry !== undefined && (
              <>
                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-foreground">{formatTaskwarriorDate(task.entry)}</dd>
              </>
            )}
            {task.modified !== undefined && (
              <>
                <dt className="text-muted-foreground">Modified</dt>
                <dd className="text-foreground">{formatTaskwarriorDate(task.modified)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">UUID</dt>
            <dd className="truncate text-foreground">{task.uuid}</dd>
          </dl>

          {task.annotations !== undefined && task.annotations.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Annotations
              </p>
              <ul className="space-y-0.5 text-xs text-foreground">
                {task.annotations.map((annotation) => (
                  <li key={annotation.entry}>
                    {formatTaskwarriorDate(annotation.entry)}: {annotation.description}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleComplete}
              disabled={busy}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
            >
              Complete
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-destructive disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TasksPanel({ subPath }: { subPath: string }) {
  const [filter, setFilter] = useState<string[]>([]);
  const taskId = subPath === "" ? null : Number(subPath);
  if (taskId !== null && Number.isFinite(taskId)) {
    return <TaskDetail id={taskId} filter={filter} setFilter={setFilter} />;
  }
  return <TaskList filter={filter} setFilter={setFilter} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Taskwarrior",
    icon: "ListTodo",
    path: "tasks",
    component: TasksPanel,
  });
});
