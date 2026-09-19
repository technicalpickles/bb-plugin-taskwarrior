import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "../../contract";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  belongsToProject,
  closestProject,
  effectiveProject,
  projectHealth,
  type ProjectStatus,
} from "../../lib/project-link";
import { CompactTaskRow } from "./compact-task-row";
import { useAddTask } from "./use-add-task";
import { useProjectLink } from "./use-project-link";

export interface ProjectActions {
  open(task: TaskRecord): void;
  togglePin(uuid: string): void;
}

function ProjectPicker({
  value,
  suggested,
  projects,
  onPick,
}: {
  value: string | null;
  suggested: string | null;
  projects: string[];
  onPick(name: string): void;
}) {
  return (
    <select
      aria-label="Link a Taskwarrior project"
      className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
      value={value !== null && projects.includes(value) ? value : ""}
      onChange={(event) => {
        if (event.target.value !== "") onPick(event.target.value);
      }}
    >
      <option value="">Link a project...</option>
      {projects.map((name) => (
        <option key={name} value={name}>
          {name === suggested ? `${name} (suggested)` : name}
        </option>
      ))}
    </select>
  );
}

function AddTask({ project, onAdded }: { project: string; onAdded(): void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const { busy, add } = useAddTask();

  async function submit() {
    const result = await add(description, async (added) => {
      try {
        const { ok } = await rpc.call("tasks_modify", { id: added.id, project });
        if (!ok) toast.error("Task added, but could not set its project");
      } catch {
        toast.error("Task added, but could not set its project");
      }
    });
    if (result.status !== "added") return;
    setDescription("");
    setOpen(false);
    onAdded();
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Add a task
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Task description"
        aria-label="New task description"
        disabled={busy}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) void submit();
        }}
      />
      <Button size="sm" disabled={busy} onClick={() => void submit()}>
        Add
      </Button>
    </div>
  );
}

function ProjectTasks({
  project,
  pinnedUuids,
  actions,
}: {
  project: string;
  pinnedUuids: string[];
  actions: ProjectActions;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);

  const latest = useRef(0);

  async function refresh() {
    const request = ++latest.current;
    const out = await rpc.call("tasks_list", {
      filter: ["status:pending", `project:${project}`],
    });
    // Ignore responses that were superseded by a newer request or project.
    if (request !== latest.current) return;
    // Taskwarrior's project: filter is a prefix match (home also returns homework).
    setTasks(out.tasks.filter((task) => belongsToProject(task.project, project)));
  }

  useEffect(() => {
    setTasks(null);
    void refresh();
    return () => {
      latest.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  useRealtime(TASKS_CHANGED, () => {
    void refresh();
  });

  if (tasks === null) return null;
  return (
    <div className="divide-y divide-border">
      {tasks.map((task) => (
        <CompactTaskRow
          key={task.uuid}
          task={task}
          pinned={pinnedUuids.includes(task.uuid)}
          onOpen={() => actions.open(task)}
          onTogglePin={() => actions.togglePin(task.uuid)}
        />
      ))}
    </div>
  );
}

export function ProjectSection({
  projectId,
  bbProjectName,
  isPersonal,
  pinnedUuids,
  actions,
}: {
  projectId: string | null;
  bbProjectName: string | null;
  isPersonal: boolean;
  pinnedUuids: string[];
  actions: ProjectActions;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const link = useProjectLink(projectId);
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [status, setStatus] = useState<{ project: string; value: ProjectStatus } | null>(null);
  const [version, setVersion] = useState(0);

  const project = link.loaded ? effectiveProject(link.twProject, bbProjectName, isPersonal) : null;

  useEffect(() => {
    void rpc.call("tw_projects_list", {}).then((out) => setProjects(out.projects));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (project === null) return;
    let cancelled = false;
    void rpc.call("project_status", { name: project }).then((value) => {
      if (!cancelled) setStatus({ project, value });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, version]);

  useRealtime(TASKS_CHANGED, () => setVersion((v) => v + 1));

  const current = status !== null && status.project === project ? status.value : null;
  // Until status loads for the effective project, render nothing rather than guess.
  const ready = link.loaded && (project === null || current !== null);
  const health = projectHealth(project, current);
  const suggested = closestProject(project ?? bbProjectName ?? "", projects);

  const picker = (
    <ProjectPicker
      value={link.twProject}
      suggested={suggested}
      projects={projects}
      onPick={(name) => {
        setChanging(false);
        void link.setLink(name);
      }}
    />
  );
  const changeLink = changing ? (
    picker
  ) : (
    <Button variant="ghost" size="sm" onClick={() => setChanging(true)}>
      Change project
    </Button>
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="@container">
      <CollapsibleTrigger className="flex w-full items-center gap-1 px-3 pb-1 pt-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon name={open ? "ChevronDown" : "ChevronRight"} />
        <span>Project</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {ready && (
          <div className="flex flex-col gap-2 px-3 pb-2">
            {health === "unlinked" && picker}
            {health === "missing" && project !== null && (
              <>
                <p role="alert" className="text-xs text-destructive">
                  {`No Taskwarrior project named \`${project}\`. Name mismatch, or nothing created yet?`}
                </p>
                {picker}
                <AddTask project={project} onAdded={() => setVersion((v) => v + 1)} />
              </>
            )}
            {health === "empty" && (
              <>
                <p className="text-xs text-muted-foreground">All clear.</p>
                {changeLink}
              </>
            )}
            {health === "ok" && project !== null && (
              <>
                <ProjectTasks project={project} pinnedUuids={pinnedUuids} actions={actions} />
                {changeLink}
              </>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
