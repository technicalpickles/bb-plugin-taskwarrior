import { describe, expect, it } from "vitest";
import { belongsToProject, closestProject, effectiveProject, projectHealth } from "../lib/project-link";

describe("effectiveProject", () => {
  it("prefers a non-empty override", () => {
    expect(effectiveProject("work", "bb-plugin", false)).toBe("work");
  });
  it("falls back to the bb project name", () => {
    expect(effectiveProject(null, "bb-plugin", false)).toBe("bb-plugin");
    expect(effectiveProject("", "bb-plugin", false)).toBe("bb-plugin");
  });
  it("has no default for the personal project or an unknown name", () => {
    expect(effectiveProject(null, "Personal", true)).toBeNull();
    expect(effectiveProject(null, null, false)).toBeNull();
  });
  it("still honors an override on the personal project", () => {
    expect(effectiveProject("home", "Personal", true)).toBe("home");
  });
});

describe("projectHealth", () => {
  it("is unlinked with no project", () => {
    expect(projectHealth(null, null)).toBe("unlinked");
  });
  it("is missing when no tasks exist under the name", () => {
    expect(projectHealth("x", { exists: false, pending: 0 })).toBe("missing");
  });
  it("is empty when the project exists with nothing pending", () => {
    expect(projectHealth("x", { exists: true, pending: 0 })).toBe("empty");
  });
  it("is ok when there are pending tasks", () => {
    expect(projectHealth("x", { exists: true, pending: 3 })).toBe("ok");
  });
  it("treats an unresolved status as ok so we never flash a false warning", () => {
    expect(projectHealth("x", null)).toBe("ok");
  });
});

describe("closestProject", () => {
  it("matches ignoring case and punctuation", () => {
    expect(closestProject("BB-Plugin", ["home", "bb_plugin"])).toBe("bb_plugin");
  });
  it("matches by containment, preferring the closest length", () => {
    expect(closestProject("taskwarrior", ["bb-plugin-taskwarrior", "taskwarrior-x", "home"])).toBe(
      "taskwarrior-x",
    );
  });
  it("returns null when nothing is close", () => {
    expect(closestProject("zzz", ["home", "work"])).toBeNull();
  });
});

describe("belongsToProject", () => {
  it("matches the exact name", () => {
    expect(belongsToProject("home", "home")).toBe(true);
  });
  it("matches dotted children", () => {
    expect(belongsToProject("home.kitchen", "home")).toBe(true);
  });
  it("rejects sibling prefixes", () => {
    expect(belongsToProject("homework", "home")).toBe(false);
  });
  it("rejects tasks without a project", () => {
    expect(belongsToProject(undefined, "home")).toBe(false);
  });
  it("rejects an empty name", () => {
    expect(belongsToProject("home", "")).toBe(false);
    expect(belongsToProject(undefined, "")).toBe(false);
  });
});
