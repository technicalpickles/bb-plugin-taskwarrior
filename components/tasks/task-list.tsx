import { useEffect, useMemo, useState } from "react";
import { useRpc, useRealtime, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "../../contract";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  formatRelative,
  formatTaskwarriorDate,
  isOverdue,
  PRIORITY_LABELS,
  priorityLabel,
  priorityVariant,
  type PriorityCode,
} from "../../lib/task-format";
import {
  groupByProject,
  matchesFilters,
  matchesSearch,
  SORT_FIELD_LABELS,
  sortTasks,
  toggleValue,
  type ListFilters,
  type SortField,
  type TaskGroup,
} from "../../lib/task-list-model";
import { PageScroll } from "./page-scroll";

function FilterPopover({
  projects,
  tags,
  filters,
  onToggleProject,
  onToggleTag,
  onTogglePriority,
}: {
  projects: string[];
  tags: string[];
  filters: ListFilters;
  onToggleProject: (project: string) => void;
  onToggleTag: (tag: string) => void;
  onTogglePriority: (priority: PriorityCode) => void;
}) {
  const activeCount = filters.projects.length + filters.tags.length + filters.priorities.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm text-foreground hover:bg-state-hover">
        Filter
        {activeCount > 0 && <Badge variant="secondary">{activeCount}</Badge>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Project</DropdownMenuLabel>
        {projects.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No projects</p>
        )}
        {projects.map((project) => (
          <DropdownMenuCheckboxItem
            key={project}
            checked={filters.projects.includes(project)}
            onCheckedChange={() => onToggleProject(project)}
            onSelect={(event) => event.preventDefault()}
          >
            {project}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tag</DropdownMenuLabel>
        {tags.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No tags</p>}
        {tags.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag}
            checked={filters.tags.includes(tag)}
            onCheckedChange={() => onToggleTag(tag)}
            onSelect={(event) => event.preventDefault()}
          >
            +{tag}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Priority</DropdownMenuLabel>
        {(["H", "M", "L"] as const).map((priority) => (
          <DropdownMenuCheckboxItem
            key={priority}
            checked={filters.priorities.includes(priority)}
            onCheckedChange={() => onTogglePriority(priority)}
            onSelect={(event) => event.preventDefault()}
          >
            {PRIORITY_LABELS[priority]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

function FilterChipsRow({ chips, onClearAll }: { chips: FilterChip[]; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Button key={chip.key} variant="outline" size="sm" onClick={chip.onRemove} className="h-7 gap-1">
          {chip.label}
          <Icon name="X" className="size-3.5" />
        </Button>
      ))}
      <Button variant="ghost" size="sm" onClick={onClearAll} className="h-7">
        Clear all
      </Button>
    </div>
  );
}

function BulkActionBar({
  count,
  busy,
  onComplete,
  onDelete,
  onCancel,
}: {
  count: number;
  busy: boolean;
  onComplete: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm">
      <span className="text-muted-foreground">{count} selected</span>
      <div className="flex gap-2">
        <Button size="sm" onClick={onComplete} disabled={busy} className="gap-1.5">
          <Icon name="CircleCheck" className="size-4" />
          Complete
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} disabled={busy} className="gap-1.5">
          <Icon name="Trash2" className="size-4" />
          Delete
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  selectMode,
  selected,
  busy,
  onToggleLead,
  onOpen,
  onComplete,
  onDelete,
}: {
  task: TaskRecord;
  selectMode: boolean;
  selected: boolean;
  busy: boolean;
  onToggleLead: () => void;
  onOpen: () => void;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const completed = task.status === "completed";
  const leadingChecked = selectMode ? selected : completed;
  const overdue = isOverdue(task);
  const blocked = (task.blockedBy?.length ?? 0) > 0;

  function handleDeleteClick() {
    if (window.confirm(`Delete task #${task.id}: "${task.description}"? This can't be undone.`)) {
      onDelete();
    }
  }

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 hover:bg-state-hover">
      <button
        type="button"
        aria-label={
          selectMode
            ? `Select task ${task.id}`
            : completed
              ? `Task ${task.id} completed`
              : `Complete task ${task.id}`
        }
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onToggleLead();
        }}
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md border disabled:opacity-50",
          leadingChecked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
        )}
      >
        {leadingChecked && <Icon name="Check" className="size-3" />}
      </button>

      <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
        <div className="flex items-center gap-1.5">
          <p
            className={cn(
              "truncate text-sm",
              completed ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {task.description}
          </p>
          {task.priority !== undefined && (
            <Pill variant={priorityVariant(task.priority)} size="sm">
              {priorityLabel(task.priority)}
            </Pill>
          )}
          {blocked && (
            <Pill variant="outline" size="sm">
              Blocked
            </Pill>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span>#{task.id}</span>
          {(task.tags?.length ?? 0) > 0 && <span>{(task.tags ?? []).map((tag) => `+${tag}`).join(" ")}</span>}
          {task.due !== undefined && (
            <span className={overdue ? "font-medium text-destructive" : undefined}>
              due {formatTaskwarriorDate(task.due)}
              {formatRelative(task.due) !== null && ` (${formatRelative(task.due)})`}
            </span>
          )}
          {task.entry !== undefined && <span>created {formatRelative(task.entry) ?? task.entry}</span>}
        </p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for task ${task.id}`}
          disabled={busy}
          onClick={(event) => event.stopPropagation()}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem onClick={onComplete}>
            <Icon name="CircleCheck" className="size-4" />
            Complete
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDeleteClick} className="text-destructive">
            <Icon name="Trash2" className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TaskGroupSection({
  group,
  renderTask,
}: {
  group: TaskGroup;
  renderTask: (task: TaskRecord) => React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen className="group">
      <div className="overflow-hidden rounded-md border border-border">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 bg-surface-raised px-3 py-2 text-left hover:bg-state-hover">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Icon name="Folder" className="size-4" />
            {group.label}
            <Pill variant="outline" size="sm">
              {group.tasks.length}
            </Pill>
          </span>
          <Icon name="ChevronDown" className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y divide-border">{group.tasks.map(renderTask)}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function TaskList({
  filters,
  setFilters,
}: {
  filters: ListFilters;
  setFilters: (updater: (prev: ListFilters) => ListFilters) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function refresh() {
    const { tasks: next } = await rpc.call("tasks_list", {
      filter: filters.showCompleted ? [] : ["status:pending"],
    });
    setTasks(next);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.showCompleted]);
  useRealtime(TASKS_CHANGED, () => {
    refresh();
  });

  const projects = useMemo(
    () =>
      [...new Set((tasks ?? []).map((task) => task.project).filter((p): p is string => p !== undefined))].sort(),
    [tasks],
  );
  const tags = useMemo(
    () => [...new Set((tasks ?? []).flatMap((task) => task.tags ?? []))].sort(),
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    if (tasks === null) return null;
    const filtered = tasks.filter((task) => matchesSearch(task, filters.search) && matchesFilters(task, filters));
    return sortTasks(filtered, filters.sort);
  }, [tasks, filters]);

  const groups = useMemo(() => (visibleTasks === null ? [] : groupByProject(visibleTasks)), [visibleTasks]);

  function toggleProject(project: string) {
    setFilters((prev) => ({ ...prev, projects: toggleValue(prev.projects, project) }));
  }
  function toggleTag(tag: string) {
    setFilters((prev) => ({ ...prev, tags: toggleValue(prev.tags, tag) }));
  }
  function togglePriority(priority: PriorityCode) {
    setFilters((prev) => ({ ...prev, priorities: toggleValue(prev.priorities, priority) }));
  }
  function clearFilters() {
    setFilters((prev) => ({ ...prev, projects: [], tags: [], priorities: [] }));
  }

  const chips: FilterChip[] = [
    ...filters.projects.map((project) => ({ key: `project:${project}`, label: project, onRemove: () => toggleProject(project) })),
    ...filters.tags.map((tag) => ({ key: `tag:${tag}`, label: `+${tag}`, onRemove: () => toggleTag(tag) })),
    ...filters.priorities.map((priority) => ({
      key: `priority:${priority}`,
      label: PRIORITY_LABELS[priority],
      onRemove: () => togglePriority(priority),
    })),
  ];

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const description = draft.trim();
    if (description === "") return;
    setAdding(true);
    try {
      await rpc.call("tasks_add", { description });
      setDraft("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add task");
    } finally {
      setAdding(false);
    }
  }

  async function handleComplete(id: number) {
    setBusyId(id);
    try {
      const { ok } = await rpc.call("tasks_complete", { id });
      if (!ok) toast.error(`Could not complete task ${id}`);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    try {
      const { ok } = await rpc.call("tasks_delete", { id });
      if (!ok) toast.error(`Could not delete task ${id}`);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  function toggleSelectMode() {
    setSelectMode((value) => !value);
    setSelectedIds([]);
  }
  function toggleSelectTask(id: number) {
    setSelectedIds((ids) => toggleValue(ids, id));
  }

  async function bulkComplete() {
    setBulkBusy(true);
    try {
      const results = await Promise.all(selectedIds.map((id) => rpc.call("tasks_complete", { id })));
      if (results.some((result) => !result.ok)) toast.error("Some tasks could not be completed");
      setSelectedIds([]);
      setSelectMode(false);
      await refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    if (!window.confirm(`Delete ${selectedIds.length} task(s)? This can't be undone.`)) return;
    setBulkBusy(true);
    try {
      const results = await Promise.all(selectedIds.map((id) => rpc.call("tasks_delete", { id })));
      if (results.some((result) => !result.ok)) toast.error("Some tasks could not be deleted");
      setSelectedIds([]);
      setSelectMode(false);
      await refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  function renderTaskRow(task: TaskRecord) {
    const completed = task.status === "completed";
    return (
      <TaskRow
        key={task.uuid}
        task={task}
        selectMode={selectMode}
        selected={selectedIds.includes(task.id)}
        busy={busyId === task.id}
        onToggleLead={() => {
          if (selectMode) toggleSelectTask(task.id);
          else if (!completed) void handleComplete(task.id);
        }}
        onOpen={() => {
          if (selectMode) toggleSelectTask(task.id);
          else navigate.toPluginPanel("tasks", { subPath: String(task.id) });
        }}
        onComplete={() => handleComplete(task.id)}
        onDelete={() => handleDelete(task.id)}
      />
    );
  }

  const hasActiveFilters = chips.length > 0;
  const emptyMessage =
    filters.search.trim() !== "" || hasActiveFilters
      ? "No tasks match your search or filters."
      : "No tasks yet. Add one above to get started.";

  return (
    <PageScroll>
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          placeholder="Add a task… e.g. project:home +errand due:friday"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={adding}
          className="flex-1"
        />
        <Button type="submit" disabled={adding || draft.trim() === ""}>
          Add
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search tasks…"
          value={filters.search}
          onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          className="h-8 max-w-[200px]"
        />

        <FilterPopover
          projects={projects}
          tags={tags}
          filters={filters}
          onToggleProject={toggleProject}
          onToggleTag={toggleTag}
          onTogglePriority={togglePriority}
        />

        <Select
          value={filters.sort.field}
          onValueChange={(value) =>
            setFilters((prev) => ({ ...prev, sort: { ...prev.sort, field: value as SortField } }))
          }
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_FIELD_LABELS) as SortField[]).map((field) => (
              <SelectItem key={field} value={field}>
                {SORT_FIELD_LABELS[field]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setFilters((prev) => ({
              ...prev,
              sort: { ...prev.sort, direction: prev.sort.direction === "asc" ? "desc" : "asc" },
            }))
          }
        >
          {filters.sort.direction === "asc" ? "↑ Asc" : "↓ Desc"}
        </Button>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={filters.showCompleted}
            onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, showCompleted: checked }))}
            aria-label="Show completed tasks"
          />
          <span>Completed</span>
        </div>

        <Button variant={selectMode ? "secondary" : "outline"} size="sm" onClick={toggleSelectMode}>
          {selectMode ? "Cancel" : "Select"}
        </Button>
      </div>

      <FilterChipsRow chips={chips} onClearAll={clearFilters} />

      {selectMode && selectedIds.length > 0 && (
        <BulkActionBar
          count={selectedIds.length}
          busy={bulkBusy}
          onComplete={bulkComplete}
          onDelete={bulkDelete}
          onCancel={() => setSelectedIds([])}
        />
      )}

      {visibleTasks === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <TaskGroupSection key={group.label} group={group} renderTask={renderTaskRow} />
          ))}
        </div>
      )}
    </PageScroll>
  );
}
