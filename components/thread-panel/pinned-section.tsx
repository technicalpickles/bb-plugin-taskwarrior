import type { TaskRecord, ThreadState } from "../../contract";
import { CompactTaskRow } from "./compact-task-row";

export interface PinnedActions {
  open(task: TaskRecord): void;
  unpin(uuid: string): void;
  reorder(order: string[]): void;
  complete(task: TaskRecord): void;
}

export function PinnedSection({
  state,
  tasks,
  resolved,
  actions,
}: {
  state: ThreadState;
  tasks: Map<string, TaskRecord>;
  resolved: Set<string>;
  actions: PinnedActions;
}) {
  if (state.pins.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        Nothing pinned yet. Pin a task from Recent or search to keep it here.
      </p>
    );
  }
  const move = (index: number, delta: -1 | 1) => {
    const order = [...state.pins];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    actions.reorder(order);
  };
  return (
    <div className="divide-y divide-border">
      {state.pins.map((uuid, index) => {
        const task = tasks.get(uuid);
        const loading = task === undefined && !resolved.has(uuid);
        return (
          <CompactTaskRow
            key={uuid}
            task={task}
            loading={loading}
            pinned
            onOpen={task ? () => actions.open(task) : undefined}
            onComplete={task ? () => actions.complete(task) : undefined}
            onTogglePin={() => actions.unpin(uuid)}
            onMoveUp={index > 0 ? () => move(index, -1) : undefined}
            onMoveDown={index < state.pins.length - 1 ? () => move(index, 1) : undefined}
            onClear={() => actions.unpin(uuid)}
          />
        );
      })}
    </div>
  );
}
