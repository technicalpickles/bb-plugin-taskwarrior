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
import { useAddTask } from "./use-add-task";
import { useTasksByUuid } from "./use-tasks-by-uuid";
import { useThreadState } from "./use-thread-state";

export interface ThreadPanelParams {
  query?: string;
  mode?: "pin" | "add";
}

/** `params.mode` seeds this once; after that it is purely local, so the pin
 * picker and the add form have a way out and do not stick to the tab. */
type PanelMode = "normal" | "pin" | "add";

/** Fire-and-forget with feedback: a rejected pin mutation must surface, not
 * become an unhandled rejection. */
function guardPins(promise: Promise<unknown>) {
  void promise.catch(() => toast.error("Could not update pins"));
}

/** Fire-and-forget bookkeeping (recording views/searches): worth swallowing,
 * but never worth an unhandled rejection. */
function quietly(promise: Promise<unknown>) {
  void promise.catch(() => undefined);
}

function AddTaskForm({ onAdded }: { onAdded(task: TaskRecord): void }) {
  const [description, setDescription] = useState("");
  const { busy, add } = useAddTask();

  async function submit() {
    const result = await add(description);
    if (result.status !== "added") return;
    setDescription("");
    onAdded(result.task);
    toast.success("Task added");
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
  const sidebarThreads = experimental_useSidebarThreads();
  const sidebarReady = sidebarThreads.status === "ready";
  const bbProject = sidebarReady
    ? sidebarThreads.projects.find((p) => p.id === projectId)
    : undefined;
  const thread = useThreadState(threadId);
  const [query, setQuery] = useState(params?.query ?? "");
  const [mode, setMode] = useState<PanelMode>(params?.mode ?? "normal");
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const pins = thread.state?.pins ?? [];
  const recentUuids = thread.state?.recent.map((entry) => entry.uuid) ?? [];
  // `null` = the uuid set is not known yet, so the hook must not guess.
  const tasks = useTasksByUuid(
    thread.state === null ? null : [...new Set([...pins, ...recentUuids])],
  );

  function openTaskById(id: number) {
    setOpenTaskId(id);
    // Blocker links only carry an integer id; look the uuid up so the jump
    // still lands in Recent. Best-effort: a failure must not break navigation.
    void (async () => {
      try {
        const { task } = await rpc.call("tasks_get", { id });
        if (task !== null) await thread.recordView(task.uuid);
      } catch {
        // Recording is best-effort.
      }
    })();
  }

  if (openTaskId !== null) {
    return (
      <TooltipProvider>
        <TaskDetail
          id={openTaskId}
          onOpenTask={openTaskById}
          onClose={() => setOpenTaskId(null)}
        />
      </TooltipProvider>
    );
  }

  async function completeTask(task: TaskRecord) {
    try {
      const { ok } = await rpc.call("tasks_complete", { id: task.id });
      if (!ok) toast.error(`Could not complete "${task.description}"`);
    } catch {
      toast.error(`Could not complete "${task.description}"`);
    }
  }

  function togglePin(uuid: string) {
    guardPins(pins.includes(uuid) ? thread.unpin(uuid) : thread.pin(uuid));
  }

  function openTask(task: TaskRecord) {
    quietly(thread.recordView(task.uuid));
    setOpenTaskId(task.id);
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-y-auto">
        {mode !== "normal" && (
          <div className="flex items-center justify-between px-3 pt-3 text-xs text-muted-foreground">
            <span>{mode === "pin" ? "Pick a task to pin" : "Add a task"}</span>
            <Button variant="ghost" size="sm" onClick={() => setMode("normal")}>
              Done
            </Button>
          </div>
        )}
        {mode === "add" && (
          <AddTaskForm onAdded={(task) => quietly(thread.recordView(task.uuid))} />
        )}
        <div className="p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
            autoFocus={params?.query !== undefined || mode === "pin"}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              const trimmed = query.trim();
              if (trimmed !== "") quietly(thread.recordSearch(trimmed));
            }}
          />
        </div>
        {query.trim() !== "" || mode === "pin" ? (
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
                state={thread.state}
                tasks={tasks.tasks}
                resolved={tasks.resolved}
                actions={{
                  open: openTask,
                  unpin: (uuid) => guardPins(thread.unpin(uuid)),
                  reorder: (order) => guardPins(thread.reorder(order)),
                  complete: (task) => void completeTask(task),
                }}
              />
            )}
            {/* Gated on thread state only: the Project section does not read
                the uuid map, so a refetch must not unmount it. No bb project
                (or a sidebar that has not loaded) means no section at all —
                the picker could not save a link anyway. */}
            {thread.state !== null && projectId !== null && sidebarReady && (
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
                tasks={tasks.tasks}
                resolved={tasks.resolved}
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
