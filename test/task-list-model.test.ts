import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../contract";
import {
  DEFAULT_FILTERS,
  groupByProject,
  matchesFilters,
  matchesSearch,
  sortTasks,
} from "../lib/task-list-model";

const task = (over: Partial<TaskRecord>): TaskRecord => ({
  id: 1,
  uuid: "00000000-0000-0000-0000-000000000001",
  description: "t",
  status: "pending",
  ...over,
});

describe("sortTasks", () => {
  it("sorts by description ascending without mutating input", () => {
    const input = [task({ description: "b" }), task({ description: "a" })];
    const out = sortTasks(input, { field: "description", direction: "asc" });
    expect(out.map((t) => t.description)).toEqual(["a", "b"]);
    expect(input[0].description).toBe("b");
  });
  it("sorts by urgency descending", () => {
    const out = sortTasks(
      [task({ description: "lo", urgency: 1 }), task({ description: "hi", urgency: 9 })],
      { field: "urgency", direction: "desc" },
    );
    expect(out.map((t) => t.description)).toEqual(["hi", "lo"]);
  });
});

describe("filters", () => {
  it("matchesSearch is a case-insensitive description substring; empty matches all", () => {
    expect(matchesSearch(task({ description: "Buy Milk" }), "milk")).toBe(true);
    expect(matchesSearch(task({ description: "Buy Milk" }), "  ")).toBe(true);
    expect(matchesSearch(task({ description: "Buy Milk" }), "eggs")).toBe(false);
  });
  it("matchesFilters honors project, tag, and priority", () => {
    const t = task({ project: "home", tags: ["a"], priority: "H" });
    expect(matchesFilters(t, DEFAULT_FILTERS)).toBe(true);
    expect(matchesFilters(t, { ...DEFAULT_FILTERS, projects: ["work"] })).toBe(false);
    expect(matchesFilters(t, { ...DEFAULT_FILTERS, tags: ["a"] })).toBe(true);
    expect(matchesFilters(t, { ...DEFAULT_FILTERS, priorities: ["L"] })).toBe(false);
  });
});

describe("groupByProject", () => {
  it("sorts groups by name with 'No project' last", () => {
    const groups = groupByProject([
      task({ project: "b" }),
      task({}),
      task({ project: "a" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["a", "b", "No project"]);
  });
});
