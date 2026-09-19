import { describe, expect, it } from "vitest";
import { extractTaskRefs, parseCreatedTaskId } from "../lib/task-refs";

const UUID = "3f2a9c1e-1111-4222-8333-444455556666";

describe("extractTaskRefs", () => {
  it("finds a leading numeric id", () => {
    expect(extractTaskRefs(["12", "done"])).toEqual(["12"]);
  });
  it("finds a uuid", () => {
    expect(extractTaskRefs([UUID, "modify", "priority:H"])).toEqual([UUID]);
  });
  it("expands lists and ranges", () => {
    expect(extractTaskRefs(["1,3", "done"])).toEqual(["1", "3"]);
    expect(extractTaskRefs(["4-6", "delete"])).toEqual(["4", "5", "6"]);
  });
  it("skips filter tokens but keeps scanning", () => {
    expect(extractTaskRefs(["project:home", "7", "done"])).toEqual(["7"]);
  });
  it("stops at the first command word", () => {
    expect(extractTaskRefs(["list"])).toEqual([]);
    expect(extractTaskRefs(["modify", "12"])).toEqual([]);
  });
  it("ignores add/log descriptions", () => {
    expect(extractTaskRefs(["add", "12"])).toEqual([]);
    expect(extractTaskRefs(["log", "12"])).toEqual([]);
  });
  it("caps expanded ranges", () => {
    expect(extractTaskRefs(["1-500", "done"])).toHaveLength(50);
  });
});

describe("parseCreatedTaskId", () => {
  it("reads the id from taskwarrior's confirmation", () => {
    expect(parseCreatedTaskId("Created task 42.\n")).toBe("42");
  });
  it("returns null when absent", () => {
    expect(parseCreatedTaskId("nothing here")).toBeNull();
  });
});
