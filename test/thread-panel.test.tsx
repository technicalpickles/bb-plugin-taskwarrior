// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it } from "vitest";
import { ThreadPanel } from "../components/thread-panel/thread-panel";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const task = (uuid: string, description: string, status = "pending") => ({
  id: 1,
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
      tasks_list: () => ({ tasks: [task(A, "Write plan"), task(B, "Ship it", "completed")] }),
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
      tasks_list: () => ({ tasks: [task(A, "Write plan"), task(B, "Ship it")] }),
      thread_reorder_pins: () => ({ state: { ...baseState, pins: [B, A] } }),
    });
    await waitFor(() => view.getByText("Write plan"));
    fireEvent.click(view.getAllByLabelText(/move down/i)[0]);
    await waitFor(() => {
      const call = view.inspection.rpcCalls.find((c) => c.method === "thread_reorder_pins");
      expect((call?.input as any).order).toEqual([B, A]);
    });
  });
});
