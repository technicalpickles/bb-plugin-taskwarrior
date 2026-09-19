import { describe, expect, it, vi } from "vitest";
import { createThreadStore } from "../lib/thread-store";

function fakeKv() {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      data.set(key, structuredClone(value));
    },
  };
}

describe("thread store", () => {
  it("returns an empty state for an unknown thread", async () => {
    const store = createThreadStore(fakeKv(), () => {});
    expect(await store.get("t1")).toEqual({ pins: [], recent: [], searches: [] });
  });

  it("persists under threads/<id> and publishes once per mutation", async () => {
    const kv = fakeKv();
    const publish = vi.fn();
    const store = createThreadStore(kv, publish, () => 100);
    const next = await store.pin("t1", "u1");
    expect(next.pins).toEqual(["u1"]);
    expect(kv.data.get("threads/t1")).toEqual(next);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith("t1");
  });

  it("serializes concurrent mutations on one thread (no lost updates)", async () => {
    const store = createThreadStore(fakeKv(), () => {});
    await Promise.all([store.pin("t1", "a"), store.pin("t1", "b"), store.pin("t1", "c")]);
    expect((await store.get("t1")).pins.sort()).toEqual(["a", "b", "c"]);
  });

  it("records views and searches using the injected clock", async () => {
    const store = createThreadStore(fakeKv(), () => {}, () => 555);
    await store.recordView("t1", "u1");
    await store.recordSearch("t1", "milk");
    const state = await store.get("t1");
    expect(state.recent).toEqual([{ uuid: "u1", at: 555, by: "user" }]);
    expect(state.searches).toEqual([{ query: "milk", at: 555 }]);
  });

  it("stores project links without publishing", async () => {
    const kv = fakeKv();
    const publish = vi.fn();
    const store = createThreadStore(kv, publish);
    expect(await store.getProjectLink("p1")).toBeNull();
    await store.setProjectLink("p1", "home");
    expect(await store.getProjectLink("p1")).toBe("home");
    await store.setProjectLink("p1", null);
    expect(await store.getProjectLink("p1")).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });
});
