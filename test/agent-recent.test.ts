import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";

const FAKE_TASK = resolve(__dirname, "fixtures/fake-task.mjs");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const dirs: string[] = [];
async function boot(tasks: object[]) {
  const dir = mkdtempSync(join(tmpdir(), "tw-"));
  dirs.push(dir);
  writeFileSync(join(dir, "db.json"), JSON.stringify({ tasks }));
  const host = createFakePluginHost({ pluginId: "taskwarrior" });
  await plugin(host.bb);
  await host.harness.behavior.setSettings({ binPath: FAKE_TASK, taskdata: dir });
  return host;
}

const hosts: { harness: { lifecycle: { dispose(): Promise<void> } } }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (hosts.length > 0) await hosts.pop()!.harness.lifecycle.dispose();
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const ctx = { threadId: "t1", projectId: "p1" };

async function recent(host: Awaited<ReturnType<typeof boot>>) {
  const out = (await host.harness.behavior.callRpc("thread_get", { threadId: "t1" })) as any;
  return out.state.recent as { uuid: string; by: string }[];
}

async function run(host: Awaited<ReturnType<typeof boot>>, args: string[]) {
  const out = await host.harness.behavior.callAgentTool("taskwarrior_run", { args }, ctx);
  return out as unknown as { content: unknown; isError?: boolean };
}

const changed = (host: Awaited<ReturnType<typeof boot>>) =>
  host.harness.inspection.realtimeSignals.filter((s) => s.channel === "tasks-changed");

describe("taskwarrior_run feeds Recent", () => {
  it("records a task the agent completes, using its uuid resolved before the run", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    const result = await run(host, ["1", "done"]);
    expect(result.isError).toBeFalsy();
    expect(await recent(host)).toEqual([expect.objectContaining({ uuid: A, by: "agent" })]);
    expect(changed(host)).toHaveLength(1);
  });

  it("records a task the agent adds", async () => {
    const host = await boot([]);
    hosts.push(host);
    await run(host, ["add", "New thing"]);
    const list = await recent(host);
    expect(list).toHaveLength(1);
    expect(list[0].by).toBe("agent");
    expect(changed(host)).toHaveLength(1);
  });

  it("does not record report output or publish", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    await run(host, ["list"]);
    expect(await recent(host)).toEqual([]);
    expect(changed(host)).toHaveLength(0);
  });

  it("returns the command result untouched when the ref matches nothing", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    const result = await run(host, ["99", "done"]);
    expect(result.content).toBeDefined();
    expect(await recent(host)).toEqual([]);
  });

  it("never fails a successful command when the thread store write fails", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    vi.spyOn(host.bb.storage.kv, "set").mockRejectedValue(new Error("boom"));
    const result = await run(host, ["1", "done"]);
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).not.toContain("boom");
    expect(
      host.harness.inspection.logEntries.some((e) => e.level === "warn" && e.message.includes("boom")),
    ).toBe(true);
  });

  it("still publishes when the thread store write fails", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    vi.spyOn(host.bb.storage.kv, "set").mockRejectedValue(new Error("boom"));
    const result = await run(host, ["1", "done"]);
    expect(result.isError).toBeFalsy();
    expect(changed(host)).toHaveLength(1);
  });
});

describe("taskwarrior_run publishes for every mutation", () => {
  it("publishes once for a filter-led modify and records nothing", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending", project: "home" }]);
    hosts.push(host);
    const result = await run(host, ["project:home", "modify", "priority:H"]);
    expect(result.isError).toBeFalsy();
    expect(changed(host)).toHaveLength(1);
    expect(await recent(host)).toEqual([]);
  });

  it("publishes for a tag-led done", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    const result = await run(host, ["+urgent", "done"]);
    expect(result.isError).toBeFalsy();
    expect(changed(host)).toHaveLength(1);
  });

  it("publishes for undo, which names no task at all", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    const result = await run(host, ["undo"]);
    expect(result.isError).toBeFalsy();
    expect(changed(host)).toHaveLength(1);
  });

  it("publishes nothing when the command fails", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    const result = await run(host, ["purge"]);
    expect(result.isError).toBe(true);
    expect(changed(host)).toHaveLength(0);
  });
});
