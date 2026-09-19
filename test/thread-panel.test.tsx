// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it } from "vitest";
import { ThreadPanel } from "../components/thread-panel/thread-panel";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Like real Taskwarrior data: finished tasks export id 0.
const task = (uuid: string, description: string, status = "pending", id = 1) => ({
  id: status === "pending" ? id : 0,
  uuid,
  description,
  status,
});

function panel(rpc: Record<string, (input: any) => unknown>, params: unknown = null) {
  return renderSlot(
    { component: ThreadPanel },
    { threadId: "t1", params } as any,
    { rpc: rpc as any, context: { projectId: "p1", threadId: "t1" } },
  );
}

const baseState = { pins: [A, B], recent: [], searches: [] };

describe("ThreadPanel pinned section", () => {
  it("renders pinned tasks in order and strikes through finished ones", async () => {
    const view = panel({
      thread_get: () => ({ state: baseState }),
      tasks_list: () => ({ tasks: [task(A, "Write plan"), task(B, "Ship it", "completed", 2)] }),
    });
    await waitFor(() => view.getByText("Write plan"));
    expect(view.getByText("Ship it").className).toMatch(/line-through/);
  });

  it("shows a clearable row for a pinned uuid that no longer resolves", async () => {
    const view = panel({
      thread_get: () => ({ state: { ...baseState, pins: [A] } }),
      tasks_list: () => ({ tasks: [] }),
    });
    await waitFor(() => view.getByText(/no longer exists/i));
    expect(view.getByLabelText(/clear/i)).toBeTruthy();
  });

  it("unpin calls thread_unpin", async () => {
    const view = panel({
      thread_get: () => ({ state: { ...baseState, pins: [A] } }),
      tasks_list: () => ({ tasks: [task(A, "Write plan")] }),
      thread_unpin: () => ({ state: { ...baseState, pins: [] } }),
    });
    await waitFor(() => view.getByText("Write plan"));
    fireEvent.click(view.getByLabelText(/unpin/i));
    await waitFor(() =>
      expect(view.inspection.rpcCalls.some((c) => c.method === "thread_unpin")).toBe(true),
    );
  });

  it("move down reorders pins", async () => {
    const view = panel({
      thread_get: () => ({ state: baseState }),
      tasks_list: () => ({ tasks: [task(A, "Write plan"), task(B, "Ship it", "pending", 2)] }),
      thread_reorder_pins: () => ({ state: { ...baseState, pins: [B, A] } }),
    });
    await waitFor(() => view.getByText("Write plan"));
    fireEvent.click(view.getAllByLabelText(/move down/i)[0]);
    await waitFor(() => {
      const call = view.inspection.rpcCalls.find((c) => c.method === "thread_reorder_pins");
      expect((call?.input as any).order).toEqual([B, A]);
    });
  });

  it("does not open a completed pin (id 0)", async () => {
    const view = panel({
      thread_get: () => ({ state: { ...baseState, pins: [B] } }),
      tasks_list: () => ({ tasks: [task(B, "Ship it", "completed", 2)] }),
      tasks_get: () => ({ task: null }),
    });
    await waitFor(() => view.getByText("Ship it"));
    const button = view.getByText("Ship it").closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(view.inspection.rpcCalls.some((c) => c.method === "tasks_get")).toBe(false);
  });

  it("opens a pending pin by its id", async () => {
    const view = panel({
      thread_get: () => ({ state: { ...baseState, pins: [A, B] } }),
      tasks_list: () => ({ tasks: [task(A, "Write plan"), task(B, "Ship it", "pending", 2)] }),
      tasks_get: () => ({ task: null }),
      thread_record_view: () => ({}),
    });
    await waitFor(() => view.getByText("Ship it"));
    fireEvent.click(view.getByText("Ship it"));
    await waitFor(() => {
      const call = view.inspection.rpcCalls.find((c) => c.method === "tasks_get");
      expect((call?.input as any).id).toBe(2);
    });
  });

  it("does not flash 'no longer exists' before tasks_list resolves", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const view = panel({
      thread_get: () => ({ state: { ...baseState, pins: [A] } }),
      tasks_list: () => pending,
    });
    await waitFor(() =>
      expect(view.inspection.rpcCalls.some((c) => c.method === "tasks_list")).toBe(true),
    );
    expect(view.queryByText(/no longer exists/i)).toBeNull();
    resolve({ tasks: [] });
    await waitFor(() => view.getByText(/no longer exists/i));
  });

  it("clear on an unresolved pin calls thread_unpin", async () => {
    const view = panel({
      thread_get: () => ({ state: { ...baseState, pins: [A] } }),
      tasks_list: () => ({ tasks: [] }),
      thread_unpin: () => ({ state: { ...baseState, pins: [] } }),
    });
    await waitFor(() => view.getByText(/no longer exists/i));
    fireEvent.click(view.getByLabelText(/clear/i));
    await waitFor(() => {
      const call = view.inspection.rpcCalls.find((c) => c.method === "thread_unpin");
      expect(call?.input).toEqual({ threadId: "t1", uuid: A });
    });
  });
});

describe("ThreadPanel recent section", () => {
  const withRecent = {
    pins: [],
    recent: [
      { uuid: A, at: 2, by: "agent" as const },
      { uuid: B, at: 1, by: "user" as const },
    ],
    searches: [{ query: "milk", at: 3 }],
  };

  it("badges rows by who touched them and lists past searches", async () => {
    const view = panel({
      thread_get: () => ({ state: withRecent }),
      tasks_list: () => ({
        tasks: [task(A, "Agent did this", "completed"), task(B, "You viewed this", "pending", 2)],
      }),
    });
    await waitFor(() => view.getByText("Agent did this"));
    expect(view.getAllByText("agent").length).toBeGreaterThan(0);
    expect(view.getAllByText("you").length).toBeGreaterThan(0);
    expect(view.getByText("milk")).toBeTruthy();
  });

  it("pins from a recent row", async () => {
    const view = panel({
      thread_get: () => ({ state: withRecent }),
      tasks_list: () => ({ tasks: [task(A, "Agent did this")] }),
      thread_pin: () => ({ state: { ...withRecent, pins: [A] } }),
    });
    await waitFor(() => view.getByText("Agent did this"));
    fireEvent.click(view.getAllByLabelText(/^pin$/i)[0]);
    await waitFor(() =>
      expect(view.inspection.rpcCalls.some((c) => c.method === "thread_pin")).toBe(true),
    );
  });

  it("a finished task in Recent is not openable but can be pinned and unpinned", async () => {
    const state = { pins: [], recent: [{ uuid: A, at: 2, by: "agent" as const }], searches: [] };
    const view = panel({
      thread_get: () => ({ state }),
      tasks_list: () => ({ tasks: [task(A, "Agent finished this", "completed")] }),
      tasks_get: () => ({ task: null }),
      thread_pin: () => ({ state: { ...state, pins: [A] } }),
      thread_unpin: () => ({ state }),
    });
    await waitFor(() => view.getByText("Agent finished this"));
    const button = view.getByText("Agent finished this").closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(view.inspection.rpcCalls.some((c) => c.method === "tasks_get")).toBe(false);
    fireEvent.click(view.getByLabelText(/^pin$/i));
    await waitFor(() =>
      expect(view.inspection.rpcCalls.some((c) => c.method === "thread_pin")).toBe(true),
    );
  });

  it("unpins a pinned finished task from Recent", async () => {
    const state = { pins: [A], recent: [{ uuid: A, at: 2, by: "agent" as const }], searches: [] };
    const view = panel({
      thread_get: () => ({ state }),
      tasks_list: () => ({ tasks: [task(A, "Agent finished this", "completed")] }),
      thread_unpin: () => ({ state: { ...state, pins: [] } }),
    });
    await waitFor(() => view.getAllByText("Agent finished this"));
    // Pinned section and Recent section both show it; both offer Unpin.
    fireEvent.click(view.getAllByLabelText(/^unpin$/i)[1]);
    await waitFor(() =>
      expect(view.inspection.rpcCalls.find((c) => c.method === "thread_unpin")?.input).toEqual({
        threadId: "t1",
        uuid: A,
      }),
    );
  });

  it("clicking a past-search chip fills the search box", async () => {
    const view = panel({
      thread_get: () => ({ state: withRecent }),
      tasks_list: () => ({ tasks: [task(A, "Buy milk")] }),
    });
    await waitFor(() => view.getByText("milk"));
    fireEvent.click(view.getByText("milk"));
    expect((view.getByLabelText("Search tasks") as HTMLInputElement).value).toBe("milk");
  });
});

describe("ThreadPanel search", () => {
  it("shows matching pending tasks and records the search on Enter", async () => {
    const view = panel({
      thread_get: () => ({ state: { pins: [], recent: [], searches: [] } }),
      tasks_list: () => ({ tasks: [task(A, "Buy milk"), task(B, "Write plan", "pending", 2)] }),
      thread_record_search: () => ({ ok: true }),
    });
    const input = view.getByLabelText("Search tasks");
    fireEvent.change(input, { target: { value: "milk" } });
    await waitFor(() => view.getByText("Buy milk"));
    expect(view.queryByText("Write plan")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(
        view.inspection.rpcCalls.find((c) => c.method === "thread_record_search")?.input,
      ).toEqual({ threadId: "t1", query: "milk" }),
    );
  });

  it("starts with params.query", async () => {
    const view = panel(
      {
        thread_get: () => ({ state: { pins: [], recent: [], searches: [] } }),
        tasks_list: () => ({ tasks: [task(A, "Buy milk")] }),
      },
      { query: "milk" },
    );
    await waitFor(() => view.getByText("Buy milk"));
    expect((view.getByLabelText("Search tasks") as HTMLInputElement).value).toBe("milk");
  });
});
