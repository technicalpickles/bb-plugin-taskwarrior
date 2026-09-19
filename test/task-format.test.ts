import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../contract";
import {
  isOverdue,
  isPriorityCode,
  parseTaskwarriorDate,
  priorityLabel,
} from "../lib/task-format";

const task = (over: Partial<TaskRecord>): TaskRecord => ({
  id: 1,
  uuid: "00000000-0000-0000-0000-000000000001",
  description: "t",
  status: "pending",
  ...over,
});

describe("parseTaskwarriorDate", () => {
  it("parses compact UTC basic ISO", () => {
    expect(parseTaskwarriorDate("20260415T120000Z")?.toISOString()).toBe(
      "2026-04-15T12:00:00.000Z",
    );
  });
  it("returns null for anything else", () => {
    expect(parseTaskwarriorDate("2026-04-15")).toBeNull();
  });
});

describe("priority helpers", () => {
  it("labels known codes and passes unknown through", () => {
    expect(priorityLabel("H")).toBe("High");
    expect(priorityLabel("X")).toBe("X");
    expect(isPriorityCode("M")).toBe(true);
    expect(isPriorityCode("X")).toBe(false);
  });
});

describe("isOverdue", () => {
  it("is true for a past due date on a pending task", () => {
    expect(isOverdue(task({ due: "20000101T000000Z" }))).toBe(true);
  });
  it("is false when completed or undated", () => {
    expect(isOverdue(task({ due: "20000101T000000Z", status: "completed" }))).toBe(false);
    expect(isOverdue(task({}))).toBe(false);
  });
});
