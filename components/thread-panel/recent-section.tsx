import type { TaskRecord, ThreadState } from "../../contract";
import { Pill } from "@/components/ui/pill";
import { CompactTaskRow } from "./compact-task-row";

export function RecentSection({
  state,
  tasks,
  resolved,
  pinnedUuids,
  actions,
}: {
  state: ThreadState;
  tasks: Map<string, TaskRecord>;
  resolved: Set<string>;
  pinnedUuids: string[];
  actions: { open(task: TaskRecord): void; togglePin(uuid: string): void; rerun(query: string): void };
}) {
  if (state.recent.length === 0 && state.searches.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">Nothing yet.</p>;
  }
  return (
    <div>
      {state.searches.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {state.searches.map((search) => (
            <button key={search.query} type="button" onClick={() => actions.rerun(search.query)}>
              <Pill variant="outline" size="sm">
                {search.query}
              </Pill>
            </button>
          ))}
        </div>
      )}
      <div className="divide-y divide-border">
        {state.recent.map((entry) => {
          const task = tasks.get(entry.uuid);
          return (
            <CompactTaskRow
              key={entry.uuid}
              task={task}
              loading={task === undefined && !resolved.has(entry.uuid)}
              pinned={pinnedUuids.includes(entry.uuid)}
              badge={
                <Pill variant={entry.by === "agent" ? "emphasis" : "secondary"} size="sm">
                  {entry.by === "agent" ? "agent" : "you"}
                </Pill>
              }
              onOpen={task ? () => actions.open(task) : undefined}
              onTogglePin={task ? () => actions.togglePin(entry.uuid) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
