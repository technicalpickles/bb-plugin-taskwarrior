import { useState } from "react";
import { experimental_useSidebarThreads, useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, type TaskRecord } from "../../contract";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectSection } from "./project-section";
import { PinnedSection } from "./pinned-section";
import { RecentSection } from "./recent-section";
import { SearchResults } from "./search-results";
import { useTasksByUuid } from "./use-tasks-by-uuid";
import { useThreadState } from "./use-thread-state";

export interface ThreadPanelParams {
  query?: string;
  mode?: "pin" | "add";
}

function AddTaskForm() {
  const rpc = useRpc<typeof rpcContract>();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = description.trim();
    if (trimmed === "" || busy) return;
    setBusy(true);
    try {
      let added: TaskRecord | null;
      try {
        ({ task: added } = await rpc.call("tasks_add", { description: trimmed }));
      } catch {
        toast.error("Could not add the task");
        return;
      }
      if (added === null) {
        toast.error("Task was added but could not be read back");
        return;
      }
      setDescription("");
      toast.success("Task added");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex gap-2 p-3 pb-0"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="New task"
        aria-label="New task description"
      />
      <Button type="submit" size="sm" disabled={busy}>
        Add
      </Button>
    </form>
  );
}

export function ThreadPanel({
  threadId,
  params,
}: {
  threadId: string;
  params: ThreadPanelParams | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const { projectId } = useBbContext();
  const { projects } = experimental_useSidebarThreads();
  const bbProject = projects.find((p) => p.id === projectId);
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
        {params?.mode === "add" && <AddTaskForm />}
        <div className="p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              const trimmed = query.trim();
              if (trimmed !== "") void thread.recordSearch(trimmed);
            }}
          />
        </div>
        {query.trim() !== "" || params?.mode === "pin" ? (
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
            {thread.state !== null && tasks !== null && (
              <ProjectSection
                projectId={projectId}
                bbProjectName={bbProject?.name ?? null}
                isPersonal={bbProject?.isPersonal ?? false}
                pinnedUuids={pins}
                actions={{ open: openTask, togglePin }}
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
