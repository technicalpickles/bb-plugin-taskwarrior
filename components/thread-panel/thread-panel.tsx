import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, type TaskRecord } from "../../contract";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { PinnedSection } from "./pinned-section";
import { useTasksByUuid } from "./use-tasks-by-uuid";
import { useThreadState } from "./use-thread-state";

export interface ThreadPanelParams {
  query?: string;
  mode?: "pin";
}

export function ThreadPanel({
  threadId,
  params,
}: {
  threadId: string;
  params: ThreadPanelParams | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const thread = useThreadState(threadId);
  const [query, setQuery] = useState(params?.query ?? "");
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const pins = thread.state?.pins ?? [];
  const tasks = useTasksByUuid(pins);

  if (openTaskId !== null) {
    return (
      <TooltipProvider>
        <TaskDetail
          id={openTaskId}
          onOpenTask={setOpenTaskId}
          onClose={() => setOpenTaskId(null)}
        />
      </TooltipProvider>
    );
  }

  async function completeTask(task: TaskRecord) {
    const { ok } = await rpc.call("tasks_complete", { id: task.id });
    if (!ok) toast.error(`Could not complete "${task.description}"`);
  }

  function openTask(task: TaskRecord) {
    void thread.recordView(task.uuid);
    setOpenTaskId(task.id);
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-y-auto">
        <div className="p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
          />
        </div>
        <h3 className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Pinned
        </h3>
        {thread.state !== null && (
          <PinnedSection
            threadId={threadId}
            state={thread.state}
            tasks={tasks}
            actions={{
              open: openTask,
              unpin: (uuid) => void thread.unpin(uuid),
              reorder: (order) => void thread.reorder(order),
              complete: (task) => void completeTask(task),
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
