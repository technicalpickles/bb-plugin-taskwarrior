// bb-plugin-taskwarrior — sidebar panel. Backs onto the same `runTask`
// bridge as `bb tw` and the taskwarrior_run agent tool via rpcContract.
//
// Route shape: the list lives at the panel root (subPath ""); clicking a
// task navigates to subPath "<id>" for a detail view.
import { useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "./contract";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pill, type PillProps } from "@/components/ui/pill";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Taskwarrior exports dates as compact UTC basic-ISO-8601:
// "20260415T000000Z". Parse that, then render with the viewer's own locale
// and timezone instead of the raw wire format.
const DATE_ONLY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const DATE_AND_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function parseTaskwarriorDate(value: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
}

function formatTaskwarriorDate(value: string): string {
  const date = parseTaskwarriorDate(value);
  if (date === null) return value;
  const atMidnightUtc =
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  return (atMidnightUtc ? DATE_ONLY : DATE_AND_TIME).format(date);
}

/** e.g. "in 3 days" / "2 months ago" — only meaningful for near-ish dates. */
function formatRelative(value: string): string | null {
  const date = parseTaskwarriorDate(value);
  if (date === null) return null;
  const diffDays = Math.round((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return RELATIVE.format(diffDays, "day");
}

function isOverdue(task: TaskRecord): boolean {
  if (task.due === undefined || task.status === "completed") return false;
  const date = parseTaskwarriorDate(task.due);
  return date !== null && date.getTime() < Date.now();
}

type PriorityCode = "H" | "M" | "L";
const PRIORITY_LABELS: Record<PriorityCode, string> = { H: "High", M: "Medium", L: "Low" };
const PRIORITY_VARIANTS: Record<PriorityCode, "destructive" | "emphasis" | "secondary"> = {
  H: "destructive",
  M: "emphasis",
  L: "secondary",
};
function isPriorityCode(value: string): value is PriorityCode {
  return value === "H" || value === "M" || value === "L";
}
function priorityLabel(priority: string): string {
  return isPriorityCode(priority) ? PRIORITY_LABELS[priority] : priority;
}
function priorityVariant(priority: string): NonNullable<PillProps["variant"]> {
  return isPriorityCode(priority) ? PRIORITY_VARIANTS[priority] : "secondary";
}

/** The nav panel page owns its full body with zero host padding/scrolling —
 * per the plugin SDK's "classic page" recipe, supply both ourselves. */
function PageScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[840px] space-y-4 p-4 md:p-5">{children}</div>
    </div>
  );
}

const DATE_FIELDS = ["due", "entry", "modified"] as const;
const STRING_FIELDS = ["description", "status", "project", "priority", "tags"] as const;
type DateSortField = (typeof DATE_FIELDS)[number];
type StringSortField = (typeof STRING_FIELDS)[number];
type SortField = DateSortField | StringSortField | "urgency";
type Sort = { field: SortField; direction: "asc" | "desc" };

const SORT_FIELD_LABELS: Record<SortField, string> = {
  urgency: "Urgency",
  description: "Name",
  status: "Status",
  project: "Project",
  priority: "Priority",
  tags: "Tags",
  due: "Due date",
  entry: "Created",
  modified: "Updated",
};

function stringSortValue(task: TaskRecord, field: StringSortField): string {
  if (field === "tags") return (task.tags ?? []).slice().sort().join(",");
  return task[field] ?? "";
}

function compareTasks(a: TaskRecord, b: TaskRecord, field: SortField): number {
  if (field === "urgency") return (a.urgency ?? 0) - (b.urgency ?? 0);
  if ((DATE_FIELDS as readonly string[]).includes(field)) {
    const dateField = field as DateSortField;
    const aValue = a[dateField];
    const bValue = b[dateField];
    const aTime = aValue !== undefined ? (parseTaskwarriorDate(aValue)?.getTime() ?? 0) : 0;
    const bTime = bValue !== undefined ? (parseTaskwarriorDate(bValue)?.getTime() ?? 0) : 0;
    return aTime - bTime;
  }
  return stringSortValue(a, field as StringSortField).localeCompare(
    stringSortValue(b, field as StringSortField),
  );
}

function sortTasks(tasks: TaskRecord[], sort: Sort): TaskRecord[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => factor * compareTasks(a, b, sort.field));
}

interface ListFilters {
  search: string;
  projects: string[];
  tags: string[];
  priorities: PriorityCode[];
  showCompleted: boolean;
  sort: Sort;
}

const DEFAULT_FILTERS: ListFilters = {
  search: "",
  projects: [],
  tags: [],
  priorities: [],
  showCompleted: false,
  sort: { field: "urgency", direction: "desc" },
};

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((existing) => existing !== value) : [...list, value];
}

function matchesSearch(task: TaskRecord, search: string): boolean {
  const needle = search.trim().toLowerCase();
  return needle === "" || task.description.toLowerCase().includes(needle);
}

function matchesFilters(task: TaskRecord, filters: ListFilters): boolean {
  if (filters.projects.length > 0 && (task.project === undefined || !filters.projects.includes(task.project))) {
    return false;
  }
  if (filters.tags.length > 0) {
    const tags = task.tags ?? [];
    if (!tags.some((tag) => filters.tags.includes(tag))) return false;
  }
  if (filters.priorities.length > 0) {
    if (task.priority === undefined || !isPriorityCode(task.priority) || !filters.priorities.includes(task.priority)) {
      return false;
    }
  }
  return true;
}

interface TaskGroup {
  label: string;
  tasks: TaskRecord[];
}

function groupByProject(tasks: TaskRecord[]): TaskGroup[] {
  const map = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    const label = task.project ?? "No project";
    const group = map.get(label);
    if (group !== undefined) group.push(task);
    else map.set(label, [task]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === "No project") return 1;
      if (b === "No project") return -1;
      return a.localeCompare(b);
    })
    .map(([label, groupTasks]) => ({ label, tasks: groupTasks }));
}

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

function TaskList({
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

type EditPriority = "none" | PriorityCode;

function TaskDetail({ id }: { id: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [task, setTask] = useState<TaskRecord | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editPriority, setEditPriority] = useState<EditPriority>("none");
  const [editProject, setEditProject] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editDue, setEditDue] = useState("");

  async function refresh() {
    const { task: next } = await rpc.call("tasks_get", { id });
    setTask(next);
  }

  useEffect(() => {
    setTask(undefined);
    setEditing(false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useRealtime(TASKS_CHANGED, () => {
    refresh();
  });

  function backToList() {
    navigate.toPluginPanel("tasks", { subPath: "" });
  }

  function startEdit() {
    if (task === null || task === undefined) return;
    setEditPriority(task.priority !== undefined && isPriorityCode(task.priority) ? task.priority : "none");
    setEditProject(task.project ?? "");
    setEditTags((task.tags ?? []).join(", "));
    setEditDue(task.due !== undefined ? (parseTaskwarriorDate(task.due)?.toISOString().slice(0, 10) ?? "") : "");
    setEditing(true);
  }

  async function saveEdit() {
    setBusy(true);
    try {
      const tags = editTags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== "");
      const project = editProject.trim();
      const { ok } = await rpc.call("tasks_modify", {
        id,
        priority: editPriority === "none" ? null : editPriority,
        project: project === "" ? null : project,
        tags,
        due: editDue === "" ? null : editDue,
      });
      if (!ok) {
        toast.error(`Could not save task ${id}`);
        return;
      }
      setEditing(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    setBusy(true);
    try {
      const { ok } = await rpc.call("tasks_complete", { id });
      if (!ok) toast.error(`Could not complete task ${id}`);
      else backToList();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (task === null || task === undefined) return;
    if (!window.confirm(`Delete task #${id}: "${task.description}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const { ok } = await rpc.call("tasks_delete", { id });
      if (!ok) toast.error(`Could not delete task ${id}`);
      else backToList();
    } finally {
      setBusy(false);
    }
  }

  async function copyUuid() {
    if (task === null || task === undefined) return;
    await navigator.clipboard.writeText(task.uuid);
    toast.success("UUID copied");
  }

  return (
    <PageScroll>
      <Button variant="ghost" size="sm" onClick={backToList} className="w-fit">
        ← Back to tasks
      </Button>

      {task === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : task === null ? (
        <p className="text-sm text-muted-foreground">Task not found.</p>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle>{task.description}</CardTitle>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>#{task.id}</span>
                  {task.entry !== undefined && <span>created {formatRelative(task.entry) ?? task.entry}</span>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Pill variant="secondary" size="sm">
                    {task.status === "completed" ? "Completed" : "Pending"}
                  </Pill>
                  {task.priority !== undefined && (
                    <Pill variant={priorityVariant(task.priority)} size="sm">
                      {priorityLabel(task.priority)}
                    </Pill>
                  )}
                  {(task.blockedBy?.length ?? 0) > 0 && (
                    <Pill variant="outline" size="sm" className="gap-1">
                      <Icon name="AlertTriangle" className="size-3.5" />
                      Blocked
                    </Pill>
                  )}
                  {(task.tags ?? []).map((tag) => (
                    <Pill key={tag} variant="outline" size="sm">
                      +{tag}
                    </Pill>
                  ))}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="More actions"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
                >
                  <Icon name="MoreHorizontal" className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                    <Icon name="Trash2" className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>

          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
                <span className="text-muted-foreground">Priority</span>
                {editing ? (
                  <Select value={editPriority} onValueChange={(value) => setEditPriority(value as EditPriority)}>
                    <SelectTrigger className="h-8 w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="H">High</SelectItem>
                      <SelectItem value="M">Medium</SelectItem>
                      <SelectItem value="L">Low</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-foreground">
                    {task.priority !== undefined ? priorityLabel(task.priority) : "None"}
                  </span>
                )}

                <span className="text-muted-foreground">Project</span>
                {editing ? (
                  <Input
                    value={editProject}
                    onChange={(event) => setEditProject(event.target.value)}
                    placeholder="No project"
                    className="h-8 max-w-[220px]"
                  />
                ) : (
                  <span className="text-foreground">{task.project ?? "None"}</span>
                )}

                <span className="text-muted-foreground">Tags</span>
                {editing ? (
                  <Input
                    value={editTags}
                    onChange={(event) => setEditTags(event.target.value)}
                    placeholder="comma, separated"
                    className="h-8 max-w-[220px]"
                  />
                ) : (
                  <span className="text-foreground">
                    {(task.tags?.length ?? 0) > 0 ? (task.tags ?? []).map((tag) => `+${tag}`).join(" ") : "None"}
                  </span>
                )}

                <span className="text-muted-foreground">Due</span>
                {editing ? (
                  <input
                    type="date"
                    value={editDue}
                    onChange={(event) => setEditDue(event.target.value)}
                    className="h-8 max-w-[160px] rounded-md border border-input bg-card px-2 text-sm text-foreground"
                  />
                ) : (
                  <span className={isOverdue(task) ? "font-medium text-destructive" : "text-foreground"}>
                    {task.due !== undefined
                      ? `${formatTaskwarriorDate(task.due)}${
                          formatRelative(task.due) !== null ? ` (${formatRelative(task.due)})` : ""
                        }`
                      : "None"}
                  </span>
                )}

                <span className="text-muted-foreground">Urgency</span>
                <span className="text-foreground">{task.urgency !== undefined ? task.urgency.toFixed(2) : "—"}</span>

                <span className="text-muted-foreground">Created</span>
                <span className="text-foreground">
                  {task.entry !== undefined ? formatTaskwarriorDate(task.entry) : "—"}
                </span>

                <span className="text-muted-foreground">Modified</span>
                <span className="text-foreground">
                  {task.modified !== undefined ? formatTaskwarriorDate(task.modified) : "—"}
                </span>

                <span className="text-muted-foreground">UUID</span>
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-xs text-foreground">{task.uuid}</span>
                  <Button variant="ghost" size="icon" aria-label="Copy UUID" onClick={copyUuid} className="size-7">
                    <Icon name="Copy" className="size-3.5" />
                  </Button>
                </div>
              </div>

              {(task.blockedBy?.length ?? 0) > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Blocked by</p>
                  {(task.blockedBy ?? []).map((blocker) => (
                    <button
                      key={blocker.id}
                      type="button"
                      onClick={() => navigate.toPluginPanel("tasks", { subPath: String(blocker.id) })}
                      className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-xs hover:bg-state-hover"
                    >
                      <Icon name="AlertTriangle" className="size-3.5" />
                      <span className="truncate text-foreground">
                        #{blocker.id} {blocker.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {task.annotations !== undefined && task.annotations.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground">Annotations</p>
                  <ul className="flex flex-col gap-0.5 text-xs text-foreground">
                    {task.annotations.map((annotation) => (
                      <li key={annotation.entry}>
                        {formatTaskwarriorDate(annotation.entry)}: {annotation.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>

          <CardFooter className="justify-end gap-2">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveEdit} disabled={busy}>
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={startEdit} disabled={busy}>
                  Edit
                </Button>
                <Button size="sm" onClick={handleComplete} disabled={busy} className="gap-1.5">
                  <Icon name="CircleCheck" className="size-4" />
                  Complete
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      )}
    </PageScroll>
  );
}

function TasksPanel({ subPath }: { subPath: string }) {
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const taskId = subPath === "" ? null : Number(subPath);
  if (taskId !== null && Number.isFinite(taskId)) {
    return <TaskDetail id={taskId} />;
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
