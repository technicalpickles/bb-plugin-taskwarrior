// bb-plugin-taskwarrior — sidebar panel. Backs onto the same `runTask`
// bridge as `bb tw` and the taskwarrior_run agent tool via rpcContract.
//
// Route shape: the list lives at the panel root (subPath ""); clicking a
// task navigates to subPath "<id>" for a detail view.
import { useState } from "react";
import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { DEFAULT_FILTERS, type ListFilters } from "./lib/task-list-model";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskList } from "@/components/tasks/task-list";
import { paletteActions } from "./lib/palette-actions";
import { ThreadPanel, type ThreadPanelParams } from "@/components/thread-panel/thread-panel";

// Route of the nav panel: /plugins/<pluginId>/<path> (SDK PluginNavPanelProps).
// pluginId "taskwarrior" is inferred from `bb plugin reload taskwarrior` in the
// README, not confirmed in a running bb. Fix here if the route differs.
const NAV_PANEL_ROUTE = "/plugins/taskwarrior/tasks";

function TasksPanel({ subPath }: { subPath: string }) {
  const navigate = useBbNavigate();
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const taskId = subPath === "" ? null : Number(subPath);
  if (taskId !== null && Number.isFinite(taskId)) {
    return (
      <TaskDetail
        id={taskId}
        onOpenTask={(id) => navigate.toPluginPanel("tasks", { subPath: String(id) })}
        onClose={() => navigate.toPluginPanel("tasks", { subPath: "" })}
      />
    );
  }
  return <TaskList filters={filters} setFilters={setFilters} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Taskwarrior",
    icon: "ListTodo",
    path: "tasks",
    component: TasksPanel,
  });
  app.slots.threadPanelAction({
    id: "tasks",
    title: "Tasks",
    icon: "ListTodo",
    layout: "flush",
    component: (props) => (
      <ThreadPanel threadId={props.threadId} params={props.params as ThreadPanelParams | null} />
    ),
  });
  for (const row of paletteActions(() => window.location.assign(NAV_PANEL_ROUTE))) {
    app.slots.commandPaletteAction(row);
  }
});
