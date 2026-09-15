// bb-plugin-taskwarrior — sidebar panel. Backs onto the same `runTask`
// bridge as `bb tw` and the taskwarrior_run agent tool via rpcContract.
//
// Route shape: the list lives at the panel root (subPath ""); clicking a
// task navigates to subPath "<id>" for a detail view. Both share one
// `filter` state (project/tag chips), kept in memory only — it resets when
// you leave the panel, same as most ad hoc list filters.
import { useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "./contract";

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
      {task.due !== undefined && <span>due {task.due}</span>}
    </p>
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
              <button
                type="button"
                aria-label={`Complete task ${task.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleComplete(task.id);
                }}
                disabled={busyId === task.id}
                className="h-4 w-4 shrink-0 rounded-sm border border-border disabled:opacity-50"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground">{task.description}</p>
                <TaskMeta task={task} onFilter={onFilter} />
              </div>
              <button
                type="button"
                aria-label={`Delete task ${task.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleDelete(task.id);
                }}
                disabled={busyId === task.id}
                className="shrink-0 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                Delete
              </button>
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
                <dd className="text-foreground">{task.entry}</dd>
              </>
            )}
            {task.modified !== undefined && (
              <>
                <dt className="text-muted-foreground">Modified</dt>
                <dd className="text-foreground">{task.modified}</dd>
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
                    {annotation.entry}: {annotation.description}
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
