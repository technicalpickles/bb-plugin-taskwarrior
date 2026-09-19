import type { TaskRecord } from "../contract";
import type { PillProps } from "@/components/ui/pill";

// Taskwarrior exports dates as compact UTC basic-ISO-8601:
// "20260415T000000Z". Parse that, then render with the viewer's own locale
// and timezone instead of the raw wire format.
export const DATE_ONLY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
export const DATE_AND_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
export const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function parseTaskwarriorDate(value: string): Date | null {
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

export function formatTaskwarriorDate(value: string): string {
  const date = parseTaskwarriorDate(value);
  if (date === null) return value;
  const atMidnightUtc =
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  return (atMidnightUtc ? DATE_ONLY : DATE_AND_TIME).format(date);
}

/** e.g. "in 3 days" / "2 months ago" — only meaningful for near-ish dates. */
export function formatRelative(value: string): string | null {
  const date = parseTaskwarriorDate(value);
  if (date === null) return null;
  const diffDays = Math.round((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return RELATIVE.format(diffDays, "day");
}

export function isOverdue(task: TaskRecord): boolean {
  if (task.due === undefined || task.status === "completed") return false;
  const date = parseTaskwarriorDate(task.due);
  return date !== null && date.getTime() < Date.now();
}

export type PriorityCode = "H" | "M" | "L";
export const PRIORITY_LABELS: Record<PriorityCode, string> = { H: "High", M: "Medium", L: "Low" };
export const PRIORITY_VARIANTS: Record<PriorityCode, "destructive" | "emphasis" | "secondary"> = {
  H: "destructive",
  M: "emphasis",
  L: "secondary",
};
export function isPriorityCode(value: string): value is PriorityCode {
  return value === "H" || value === "M" || value === "L";
}
export function priorityLabel(priority: string): string {
  return isPriorityCode(priority) ? PRIORITY_LABELS[priority] : priority;
}
export function priorityVariant(priority: string): NonNullable<PillProps["variant"]> {
  return isPriorityCode(priority) ? PRIORITY_VARIANTS[priority] : "secondary";
}
