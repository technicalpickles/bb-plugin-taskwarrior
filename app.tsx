// bb-plugin-taskwarrior — sidebar panel. Backs onto the same `runTask`
// bridge as `bb tw` and the taskwarrior_run agent tool via rpcContract.
import { useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useRealtime,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "./contract";

function TasksPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const { tasks: next } = await rpc.call("tasks_list", null);
    setTasks(next);
  }

  useEffect(() => {
    refresh();
  }, []);
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

      {tasks === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending tasks.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tasks.map((task) => (
            <li
              key={task.uuid}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <button
                type="button"
                aria-label={`Complete task ${task.id}`}
                onClick={() => handleComplete(task.id)}
                disabled={busyId === task.id}
                className="h-4 w-4 shrink-0 rounded-sm border border-border disabled:opacity-50"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground">{task.description}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    `#${task.id}`,
                    task.project,
                    ...(task.tags ?? []).map((tag) => `+${tag}`),
                    task.due,
                  ]
                    .filter(Boolean)
                    .join("  ·  ")}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Delete task ${task.id}`}
                onClick={() => handleDelete(task.id)}
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

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Taskwarrior",
    icon: "ListTodo",
    path: "tasks",
    component: TasksPanel,
  });
});
