import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import plugin from "../server";

const FAKE_TASK = resolve(__dirname, "fixtures/fake-task.mjs");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function boot(tasks: object[]) {
  const dir = mkdtempSync(join(tmpdir(), "tw-"));
  writeFileSync(join(dir, "db.json"), JSON.stringify({ tasks }));
  const host = createFakePluginHost({ pluginId: "taskwarrior" });
  await plugin(host.bb);
  await host.harness.behavior.setSettings({ binPath: FAKE_TASK, taskdata: dir });
  return host;
}

const hosts: { harness: { lifecycle: { dispose(): Promise<void> } } }[] = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.harness.lifecycle.dispose();
});

describe("thread rpc", () => {
  it("pins, reads, and unpins", async () => {
    const host = await boot([]);
    hosts.push(host);
    const call = host.harness.behavior.callRpc;
    await call("thread_pin", { threadId: "t1", uuid: A });
    expect(await call("thread_get", { threadId: "t1" })).toMatchObject({
      state: { pins: [A] },
    });
    await call("thread_unpin", { threadId: "t1", uuid: A });
    expect(await call("thread_get", { threadId: "t1" })).toMatchObject({ state: { pins: [] } });
  });

  it("records views and searches", async () => {
    const host = await boot([]);
    hosts.push(host);
    const call = host.harness.behavior.callRpc;
    await call("thread_record_view", { threadId: "t1", uuid: A });
    await call("thread_record_search", { threadId: "t1", query: "milk" });
    const { state } = (await call("thread_get", { threadId: "t1" })) as any;
    expect(state.recent[0]).toMatchObject({ uuid: A, by: "user" });
    expect(state.searches[0]).toMatchObject({ query: "milk" });
  });
});

describe("project rpc", () => {
  it("round-trips a project link", async () => {
    const host = await boot([]);
    hosts.push(host);
    const call = host.harness.behavior.callRpc;
    expect(await call("project_link_get", { projectId: "p1" })).toEqual({ twProject: null });
    await call("project_link_set", { projectId: "p1", twProject: "home" });
    expect(await call("project_link_get", { projectId: "p1" })).toEqual({ twProject: "home" });
  });

  it("reports project status: missing, empty, and ok", async () => {
    const host = await boot([
      { uuid: A, description: "a", status: "pending", project: "live" },
      { uuid: B, description: "b", status: "completed", project: "done-only" },
    ]);
    hosts.push(host);
    const call = host.harness.behavior.callRpc;
    expect(await call("project_status", { name: "nope" })).toEqual({ exists: false, pending: 0 });
    expect(await call("project_status", { name: "done-only" })).toEqual({ exists: true, pending: 0 });
    expect(await call("project_status", { name: "live" })).toEqual({ exists: true, pending: 1 });
  });

  it("lists taskwarrior projects", async () => {
    const host = await boot([
      { uuid: A, description: "a", status: "pending", project: "beta" },
      { uuid: B, description: "b", status: "pending", project: "alpha" },
    ]);
    hosts.push(host);
    expect(await host.harness.behavior.callRpc("tw_projects_list", {})).toEqual({
      projects: ["alpha", "beta"],
    });
  });
});

describe("uuid lookup via tasks_list", () => {
  it("returns pinned tasks of any status", async () => {
    const host = await boot([
      { uuid: A, description: "a", status: "pending" },
      { uuid: B, description: "b", status: "completed" },
    ]);
    hosts.push(host);
    const out = (await host.harness.behavior.callRpc("tasks_list", { filter: [A, B] })) as any;
    expect(out.tasks.map((t: any) => t.uuid).sort()).toEqual([A, B]);
  });
});
