import type { TaskRecord } from "../contract";
import { isPriorityCode, parseTaskwarriorDate, type PriorityCode } from "./task-format";

export const DATE_FIELDS = ["due", "entry", "modified"] as const;
export const STRING_FIELDS = ["description", "status", "project", "priority", "tags"] as const;
export type DateSortField = (typeof DATE_FIELDS)[number];
export type StringSortField = (typeof STRING_FIELDS)[number];
export type SortField = DateSortField | StringSortField | "urgency";
export type Sort = { field: SortField; direction: "asc" | "desc" };

export const SORT_FIELD_LABELS: Record<SortField, string> = {
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

export function stringSortValue(task: TaskRecord, field: StringSortField): string {
  if (field === "tags") return (task.tags ?? []).slice().sort().join(",");
  return task[field] ?? "";
}

export function compareTasks(a: TaskRecord, b: TaskRecord, field: SortField): number {
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

export function sortTasks(tasks: TaskRecord[], sort: Sort): TaskRecord[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => factor * compareTasks(a, b, sort.field));
}

export interface ListFilters {
  search: string;
  projects: string[];
  tags: string[];
  priorities: PriorityCode[];
  showCompleted: boolean;
  sort: Sort;
}

export const DEFAULT_FILTERS: ListFilters = {
  search: "",
  projects: [],
  tags: [],
  priorities: [],
  showCompleted: false,
  sort: { field: "urgency", direction: "desc" },
};

export function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((existing) => existing !== value) : [...list, value];
}

export function matchesSearch(task: TaskRecord, search: string): boolean {
  const needle = search.trim().toLowerCase();
  return needle === "" || task.description.toLowerCase().includes(needle);
}

export function matchesFilters(task: TaskRecord, filters: ListFilters): boolean {
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

export interface TaskGroup {
  label: string;
  tasks: TaskRecord[];
}

export function groupByProject(tasks: TaskRecord[]): TaskGroup[] {
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
