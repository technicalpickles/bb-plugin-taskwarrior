import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, type TaskRecord } from "../../contract";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { PinnedSection } from "./pinned-section";
import { RecentSection } from "./recent-section";
import { SearchResults } from "./search-results";
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
  const recentUuids = thread.state?.recent.map((entry) => entry.uuid) ?? [];
  const tasks = useTasksByUuid([...new Set([...pins, ...recentUuids])]);

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

  function togglePin(uuid: string) {
    void (pins.includes(uuid) ? thread.unpin(uuid) : thread.pin(uuid));
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
            onKeyDown={(event) => {
              if (event.key === "Enter") void thread.recordSearch(query);
            }}
          />
        </div>
        {query.trim() !== "" ? (
          <SearchResults
            query={query}
            pinnedUuids={pins}
            actions={{ open: openTask, togglePin }}
          />
        ) : (
          <>
            <h3 className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pinned
            </h3>
            {thread.state !== null && tasks !== null && (
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
            <h3 className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recent
            </h3>
            {thread.state !== null && tasks !== null && (
              <RecentSection
                state={thread.state}
                tasks={tasks}
                pinnedUuids={pins}
                actions={{ open: openTask, togglePin, rerun: setQuery }}
              />
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
