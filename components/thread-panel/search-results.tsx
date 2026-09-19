import { useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "../../contract";
import { matchesSearch } from "../../lib/task-list-model";
import { CompactTaskRow } from "./compact-task-row";

export function SearchResults({
  query,
  pinnedUuids,
  actions,
}: {
  query: string;
  pinnedUuids: string[];
  actions: { open(task: TaskRecord): void; togglePin(uuid: string): void };
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);

  async function refresh() {
    const { tasks: next } = await rpc.call("tasks_list", { filter: ["status:pending"] });
    setTasks(next);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRealtime(TASKS_CHANGED, () => {
    void refresh();
  });

  if (tasks === null) return <p className="px-3 py-4 text-xs text-muted-foreground">Loading…</p>;
  const matches = tasks.filter((task) => matchesSearch(task, query));
  if (matches.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">No matching tasks.</p>;
  }
  return (
    <div className="divide-y divide-border">
      {matches.map((task) => (
        <CompactTaskRow
          key={task.uuid}
          uuid={task.uuid}
          task={task}
          pinned={pinnedUuids.includes(task.uuid)}
          onOpen={() => actions.open(task)}
          onTogglePin={() => actions.togglePin(task.uuid)}
        />
      ))}
    </div>
  );
}
