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
});
