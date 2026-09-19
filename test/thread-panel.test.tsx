// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { TASKS_CHANGED } from "../contract";
import { ThreadPanel } from "../components/thread-panel/thread-panel";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
    {
      rpc: {
        // The collapsed project section still loads its link and project list.
        project_link_get: () => ({ twProject: null }),
        tw_projects_list: () => ({ projects: [] }),
        project_status: () => ({ exists: true, pending: 0 }),
        ...rpc,
      } as any,
      context: { projectId: "p1", threadId: "t1" },
    },
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
      expect(view.inspection.rpcCalls.find((c) => c.method === "thread_pin")?.input).toEqual({
        threadId: "t1",
        uuid: A,
      }),
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

  const enterPanel = () =>
    panel({
      thread_get: () => ({ state: { pins: [], recent: [], searches: [] } }),
      tasks_list: () => ({ tasks: [task(A, "Buy milk")] }),
      thread_record_search: () => ({ ok: true }),
    });
  const recorded = (view: ReturnType<typeof enterPanel>) =>
    view.inspection.rpcCalls.filter((c) => c.method === "thread_record_search");

  it("does not record a search on Enter with an empty box", async () => {
    const view = enterPanel();
    await waitFor(() =>
      expect(view.inspection.rpcCalls.some((c) => c.method === "thread_get")).toBe(true),
    );
    fireEvent.keyDown(view.getByLabelText("Search tasks"), { key: "Enter" });
    await new Promise((r) => setTimeout(r, 20));
    expect(recorded(view)).toEqual([]);
  });

  it("does not record a search on Enter with whitespace only", async () => {
    const view = enterPanel();
    const input = view.getByLabelText("Search tasks");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 20));
    expect(recorded(view)).toEqual([]);
  });

  it("records the trimmed query on Enter", async () => {
    const view = enterPanel();
    const input = view.getByLabelText("Search tasks");
    fireEvent.change(input, { target: { value: "  milk " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(recorded(view).map((c) => c.input)).toEqual([{ threadId: "t1", query: "milk" }]),
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

const projectOpts = (over: object = {}) => ({
  sidebarThreads: {
    status: "ready" as const,
    threads: [],
    projects: [{ id: "p1", name: "bb-plugin-taskwarrior", isPersonal: false, ...over }],
  },
});

function projectPanel(rpc: Record<string, (input: any) => unknown>, over: object = {}) {
  return renderSlot(
    { component: ThreadPanel },
    { threadId: "t1", params: null } as any,
    {
      rpc: {
        thread_get: () => ({ state: { pins: [], recent: [], searches: [] } }),
        tasks_list: () => ({ tasks: [] }),
        project_link_get: () => ({ twProject: null }),
        tw_projects_list: () => ({ projects: ["home", "taskwarrior"] }),
        ...rpc,
      } as any,
      context: { projectId: "p1", threadId: "t1" },
      ...projectOpts(over),
    },
  );
}

describe("ThreadPanel project section", () => {
  it("warns when no taskwarrior project matches the bb project name", async () => {
    const view = projectPanel({ project_status: () => ({ exists: false, pending: 0 }) });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText(/No Taskwarrior project named.*bb-plugin-taskwarrior/i));
  });

  it("says all clear (not a warning) when the project exists but nothing is pending", async () => {
    const view = projectPanel({ project_status: () => ({ exists: true, pending: 0 }) });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText(/all clear/i));
    expect(view.queryByText(/No Taskwarrior project named/i)).toBeNull();
  });

  it("lists pending tasks when the project is healthy", async () => {
    const view = projectPanel({
      project_status: () => ({ exists: true, pending: 1 }),
      tasks_list: (input: { filter: string[] }) =>
        input.filter.includes("project:bb-plugin-taskwarrior")
          ? { tasks: [{ ...task(A, "Project task"), project: "bb-plugin-taskwarrior" }] }
          : { tasks: [] },
    });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText("Project task"));
    const call = view.inspection.rpcCalls.find(
      (c) => c.method === "tasks_list" && (c.input as any).filter.includes("status:pending"),
    );
    expect((call?.input as any).filter).toEqual([
      "status:pending",
      "project:bb-plugin-taskwarrior",
    ]);
  });

  it("post-filters prefix matches so homework does not show under home", async () => {
    const view = projectPanel({
      project_link_get: () => ({ twProject: "home" }),
      project_status: () => ({ exists: true, pending: 2 }),
      tasks_list: (input: { filter: string[] }) =>
        input.filter.includes("project:home")
          ? {
              tasks: [
                { ...task(A, "Fix sink", "pending", 1), project: "home" },
                { ...task(B, "Grade essays", "pending", 2), project: "homework" },
              ],
            }
          : { tasks: [] },
    });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText("Fix sink"));
    expect(view.queryByText("Grade essays")).toBeNull();
  });

  it("uses a saved override instead of the bb project name", async () => {
    const view = projectPanel({
      project_link_get: () => ({ twProject: "taskwarrior" }),
      project_status: (input: { name: string }) => ({
        exists: input.name === "taskwarrior",
        pending: input.name === "taskwarrior" ? 1 : 0,
      }),
      tasks_list: (input: { filter: string[] }) =>
        input.filter.includes("project:taskwarrior")
          ? { tasks: [{ ...task(A, "Linked task"), project: "taskwarrior" }] }
          : { tasks: [] },
    });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText("Linked task"));
  });

  it("saves a link chosen from the picker", async () => {
    const view = projectPanel({
      project_status: () => ({ exists: false, pending: 0 }),
      project_link_set: () => ({ ok: true }),
    });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText(/No Taskwarrior project named/i));
    const select = await view.findByLabelText(/link a taskwarrior project/i);
    await waitFor(() => view.getByRole("option", { name: "home" }));
    fireEvent.change(select, { target: { value: "home" } });
    await waitFor(() =>
      expect(view.inspection.rpcCalls.find((c) => c.method === "project_link_set")?.input).toEqual({
        projectId: "p1",
        twProject: "home",
      }),
    );
  });

  it("marks the closest existing project as suggested", async () => {
    const view = projectPanel({
      project_status: () => ({ exists: false, pending: 0 }),
      tw_projects_list: () => ({ projects: ["home", "bb_plugin_taskwarrior"] }),
    });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByRole("option", { name: "bb_plugin_taskwarrior (suggested)" }));
  });

  it("adds a task into the missing project", async () => {
    const view = projectPanel({
      project_status: () => ({ exists: false, pending: 0 }),
      tasks_add: () => ({ task: task(A, "New thing", "pending", 7) }),
      tasks_modify: () => ({ task: task(A, "New thing", "pending", 7) }),
    });
    fireEvent.click(await view.findByText("Project"));
    fireEvent.click(await view.findByRole("button", { name: /add a task/i }));
    fireEvent.change(view.getByLabelText(/new task description/i), {
      target: { value: "New thing" },
    });
    fireEvent.click(view.getByRole("button", { name: /^add$/i }));
    await waitFor(() => {
      const calls = view.inspection.rpcCalls;
      expect(calls.find((c) => c.method === "tasks_add")?.input).toEqual({
        description: "New thing",
      });
      expect(calls.find((c) => c.method === "tasks_modify")?.input).toEqual({
        id: 7,
        project: "bb-plugin-taskwarrior",
      });
    });
  });

  it("pins from a project row", async () => {
    const view = projectPanel({
      project_status: () => ({ exists: true, pending: 1 }),
      tasks_list: (input: { filter: string[] }) =>
        input.filter.includes("project:bb-plugin-taskwarrior")
          ? { tasks: [{ ...task(A, "Project task"), project: "bb-plugin-taskwarrior" }] }
          : { tasks: [] },
      thread_pin: () => ({ state: { pins: [A], recent: [], searches: [] } }),
    });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText("Project task"));
    fireEvent.click(view.getByLabelText(/^pin$/i));
    await waitFor(() =>
      expect(view.inspection.rpcCalls.find((c) => c.method === "thread_pin")?.input).toEqual({
        threadId: "t1",
        uuid: A,
      }),
    );
  });

  it("has no default for the personal project", async () => {
    const view = projectPanel(
      { project_status: () => ({ exists: true, pending: 1 }) },
      { isPersonal: true },
    );
    fireEvent.click(await view.findByText("Project"));
    await view.findByLabelText(/link a taskwarrior project/i);
    expect(view.inspection.rpcCalls.some((c) => c.method === "project_status")).toBe(false);
  });
});

describe("ThreadPanel project section fix round 1", () => {
  const missing = { project_status: () => ({ exists: false, pending: 0 }) };
  async function openAdd(view: ReturnType<typeof projectPanel>, text = "New thing") {
    fireEvent.click(await view.findByText("Project"));
    fireEvent.click(await view.findByRole("button", { name: /add a task/i }));
    const input = view.getByLabelText(/new task description/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: text } });
    return input;
  }
  const errors = () => vi.mocked(toast.error);

  it("keeps the input and toasts when tasks_add rejects", async () => {
    errors().mockClear();
    const view = projectPanel({
      ...missing,
      tasks_add: () => Promise.reject(new Error("boom")),
    });
    const input = await openAdd(view);
    fireEvent.click(view.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(errors()).toHaveBeenCalled());
    expect(input.value).toBe("New thing");
  });

  it("keeps the input and toasts when tasks_add returns no task", async () => {
    errors().mockClear();
    const view = projectPanel({ ...missing, tasks_add: () => ({ task: null }) });
    const input = await openAdd(view);
    fireEvent.click(view.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(errors()).toHaveBeenCalled());
    expect(input.value).toBe("New thing");
  });

  it("toasts and closes the input when setting the project fails", async () => {
    errors().mockClear();
    const view = projectPanel({
      ...missing,
      tasks_add: () => ({ task: task(A, "New thing", "pending", 7) }),
      tasks_modify: () => Promise.reject(new Error("boom")),
    });
    await openAdd(view);
    fireEvent.click(view.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(errors()).toHaveBeenCalled());
    await waitFor(() => expect(view.queryByLabelText(/new task description/i)).toBeNull());
  });

  it("ignores a second submit while the first is in flight", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const view = projectPanel({
      ...missing,
      tasks_add: () => pending,
      tasks_modify: () => ({ ok: true, task: null }),
    });
    const input = await openAdd(view);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(view.getByRole("button", { name: /^add$/i }));
    resolve({ task: task(A, "New thing", "pending", 7) });
    await waitFor(() => expect(view.queryByLabelText(/new task description/i)).toBeNull());
    expect(view.inspection.rpcCalls.filter((c) => c.method === "tasks_add")).toHaveLength(1);
  });

  it("holds the busy guard while tasks_modify is pending", async () => {
    let resolveModify!: (value: unknown) => void;
    const modify = new Promise((r) => {
      resolveModify = r;
    });
    const view = projectPanel({
      ...missing,
      tasks_add: () => ({ task: task(A, "New thing", "pending", 7) }),
      tasks_modify: () => modify,
    });
    const input = await openAdd(view);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(view.inspection.rpcCalls.some((c) => c.method === "tasks_modify")).toBe(true),
    );
    expect(input.disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(view.getByRole("button", { name: /^add$/i }));
    await new Promise((r) => setTimeout(r, 20));
    expect(view.inspection.rpcCalls.filter((c) => c.method === "tasks_add")).toHaveLength(1);
    resolveModify({ ok: true, task: null });
    await waitFor(() => expect(view.queryByLabelText(/new task description/i)).toBeNull());
    expect(view.inspection.rpcCalls.filter((c) => c.method === "tasks_add")).toHaveLength(1);
  });

  it("does not show the old project's rows under a newly linked project", async () => {
    let resolveWork!: (value: unknown) => void;
    const work = new Promise((r) => {
      resolveWork = r;
    });
    const view = projectPanel({
      project_link_get: () => ({ twProject: "home" }),
      tw_projects_list: () => ({ projects: ["home", "work"] }),
      project_link_set: () => ({ ok: true }),
      project_status: () => ({ exists: true, pending: 1 }),
      tasks_list: (input: { filter: string[] }) => {
        if (input.filter.includes("project:home"))
          return { tasks: [{ ...task(A, "Home task"), project: "home" }] };
        if (input.filter.includes("project:work")) return work;
        return { tasks: [] };
      },
    });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText("Home task"));
    fireEvent.click(view.getByRole("button", { name: /change project/i }));
    await waitFor(() => view.getByRole("option", { name: "work" }));
    fireEvent.change(view.getByLabelText(/link a taskwarrior project/i), {
      target: { value: "work" },
    });
    await waitFor(() =>
      expect(
        view.inspection.rpcCalls.some(
          (c) => c.method === "tasks_list" && (c.input as any).filter.includes("project:work"),
        ),
      ).toBe(true),
    );
    expect(view.queryByText("Home task")).toBeNull();
    resolveWork({ tasks: [{ ...task(B, "Work task", "pending", 2), project: "work" }] });
    await waitFor(() => view.getByText("Work task"));
    expect(view.queryByText("Home task")).toBeNull();
  });
});

describe("ThreadPanel uuid map stability", () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("pinning a project row keeps the Project section mounted and expanded", async () => {
    const projectTask = { ...task(A, "Project task"), project: "bb-plugin-taskwarrior" };
    let pins: string[] = [];
    const view = projectPanel({
      thread_get: () => ({ state: { pins, recent: [], searches: [] } }),
      project_status: () => ({ exists: true, pending: 1 }),
      tasks_list: (input: { filter: string[] }) =>
        input.filter.includes("project:bb-plugin-taskwarrior") || input.filter.includes(A)
          ? { tasks: [projectTask] }
          : { tasks: [] },
      thread_pin: () => {
        pins = [A];
        return { state: { pins, recent: [], searches: [] } };
      },
    });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText("Project task"));
    const count = (method: string) =>
      view.inspection.rpcCalls.filter((c) => c.method === method).length;
    const projectsBefore = count("tw_projects_list");
    const statusBefore = count("project_status");
    const linkBefore = count("project_link_get");
    fireEvent.click(view.getByLabelText(/^pin$/i));
    await waitFor(() =>
      expect(view.inspection.rpcCalls.some((c) => c.method === "thread_pin")).toBe(true),
    );
    await settle();
    // The Project section must not unmount: the row is still there, still expanded.
    expect(view.getAllByText("Project task").length).toBeGreaterThan(0);
    expect(count("tw_projects_list")).toBe(projectsBefore);
    expect(count("project_status")).toBe(statusBefore);
    expect(count("project_link_get")).toBe(linkBefore);
  });

  it("shows a Loading row for an unresolved uuid, never 'no longer exists'", async () => {
    const projectTask = { ...task(A, "Project task"), project: "bb-plugin-taskwarrior" };
    let pins: string[] = [];
    let resolvePins!: (value: unknown) => void;
    const pinFetch = new Promise((r) => {
      resolvePins = r;
    });
    const view = projectPanel({
      thread_get: () => ({ state: { pins, recent: [], searches: [] } }),
      project_status: () => ({ exists: true, pending: 1 }),
      tasks_list: (input: { filter: string[] }) => {
        if (input.filter.includes("project:bb-plugin-taskwarrior")) return { tasks: [projectTask] };
        if (input.filter.includes(A)) return pinFetch;
        return { tasks: [] };
      },
      thread_pin: () => {
        pins = [A];
        return { state: { pins, recent: [], searches: [] } };
      },
    });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText("Project task"));
    fireEvent.click(view.getByLabelText(/^pin$/i));
    await waitFor(() => view.getByText(/loading/i));
    expect(view.queryByText(/no longer exists/i)).toBeNull();
    resolvePins({ tasks: [projectTask] });
    await waitFor(() => expect(view.getAllByText("Project task")).toHaveLength(2));
    expect(view.queryByText(/no longer exists/i)).toBeNull();
    expect(view.queryByText(/loading/i)).toBeNull();
  });

  it("keeps the newest uuid fetch when responses resolve out of order", async () => {
    const deferred: ((value: unknown) => void)[] = [];
    let calls = 0;
    const view = panel({
      thread_get: () => ({ state: { pins: [A], recent: [], searches: [] } }),
      tasks_list: () => {
        calls += 1;
        if (calls === 1) return { tasks: [task(A, "First")] };
        return new Promise((r) => deferred.push(r));
      },
    });
    await waitFor(() => view.getByText("First"));
    await view.behavior.emitRealtime(TASKS_CHANGED, { reason: "test" });
    await view.behavior.emitRealtime(TASKS_CHANGED, { reason: "test" });
    await waitFor(() => expect(deferred).toHaveLength(2));
    deferred[1]({ tasks: [task(A, "Newest")] });
    await waitFor(() => view.getByText("Newest"));
    deferred[0]({ tasks: [task(A, "Stale")] });
    await settle();
    expect(view.queryByText("Stale")).toBeNull();
    expect(view.getByText("Newest")).toBeTruthy();
  });

  it("reordering pins does not refetch tasks_list", async () => {
    let pins = [A, B];
    const view = panel({
      thread_get: () => ({ state: { pins, recent: [], searches: [] } }),
      tasks_list: () => ({ tasks: [task(A, "Write plan"), task(B, "Ship it", "pending", 2)] }),
      thread_reorder_pins: (input: { order: string[] }) => {
        pins = input.order;
        return { state: { pins, recent: [], searches: [] } };
      },
    });
    await waitFor(() => view.getByText("Write plan"));
    const before = view.inspection.rpcCalls.filter((c) => c.method === "tasks_list").length;
    fireEvent.click(view.getAllByLabelText(/move down/i)[0]);
    await waitFor(() =>
      expect(view.inspection.rpcCalls.some((c) => c.method === "thread_reorder_pins")).toBe(true),
    );
    await settle();
    expect(view.inspection.rpcCalls.filter((c) => c.method === "tasks_list")).toHaveLength(before);
  });

  it("toasts instead of swallowing a failed unpin", async () => {
    vi.mocked(toast.error).mockClear();
    const view = panel({
      thread_get: () => ({ state: { pins: [A], recent: [], searches: [] } }),
      tasks_list: () => ({ tasks: [task(A, "Write plan")] }),
      thread_unpin: () => Promise.reject(new Error("boom")),
    });
    await waitFor(() => view.getByText("Write plan"));
    fireEvent.click(view.getByLabelText(/^unpin$/i));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Could not update pins"),
    );
  });
});

describe("ThreadPanel project section readiness", () => {
  const noProjectPanel = (options: object) =>
    renderSlot(
      { component: ThreadPanel },
      { threadId: "t1", params: null } as any,
      {
        rpc: {
          thread_get: () => ({ state: { pins: [], recent: [], searches: [] } }),
          tasks_list: () => ({ tasks: [] }),
          project_link_get: () => ({ twProject: null }),
          tw_projects_list: () => ({ projects: ["home"] }),
          project_status: () => ({ exists: false, pending: 0 }),
        } as any,
        ...options,
      },
    );

  it("renders no Project section for a thread with no project", async () => {
    const view = noProjectPanel({
      context: { projectId: null, threadId: "t1" },
      ...projectOpts(),
    });
    await waitFor(() => view.getByText("Recent"));
    expect(view.queryByText("Project")).toBeNull();
    expect(view.queryByLabelText(/link a taskwarrior project/i)).toBeNull();
    expect(view.inspection.rpcCalls.some((c) => c.method === "tw_projects_list")).toBe(false);
  });

  it("renders no Project section until the sidebar threads are ready", async () => {
    const view = noProjectPanel({
      context: { projectId: "p1", threadId: "t1" },
      sidebarThreads: { status: "loading" as const },
    });
    await waitFor(() => view.getByText("Recent"));
    expect(view.queryByText("Project")).toBeNull();
    expect(view.queryByLabelText(/link a taskwarrior project/i)).toBeNull();
  });
});

describe("ThreadPanel modes", () => {
  const empty = { state: { pins: [], recent: [], searches: [] } };

  it("pin mode shows search results with a Pin action", async () => {
    const view = panel(
      {
        thread_get: () => empty,
        tasks_list: () => ({ tasks: [task(A, "Pickable")] }),
        thread_pin: () => ({ state: { pins: [A], recent: [], searches: [] } }),
      },
      { mode: "pin" },
    );
    await waitFor(() => view.getByText("Pickable"));
    fireEvent.click(view.getByLabelText(/^pin$/i));
    await waitFor(() =>
      expect(view.inspection.rpcCalls.some((c) => c.method === "thread_pin")).toBe(true),
    );
  });

  it("add mode shows an add form that calls tasks_add", async () => {
    const view = panel(
      { thread_get: () => empty, tasks_add: () => ({ task: task(A, "New") }) },
      { mode: "add" },
    );
    const input = (await view.findByLabelText("New task description")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(view.inspection.rpcCalls.find((c) => c.method === "tasks_add")?.input).toEqual({
        description: "New",
      }),
    );
    await waitFor(() => expect(input.value).toBe(""));
    expect(toast.success).toHaveBeenCalledWith("Task added");
  });

  it("add mode keeps the input and toasts when tasks_add rejects", async () => {
    const view = panel(
      {
        thread_get: () => empty,
        tasks_add: () => {
          throw new Error("boom");
        },
      },
      { mode: "add" },
    );
    const input = (await view.findByLabelText("New task description")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Keep me" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(input.value).toBe("Keep me");
  });

  it("add mode keeps the input when tasks_add returns no task", async () => {
    const view = panel(
      { thread_get: () => empty, tasks_add: () => ({ task: null }) },
      { mode: "add" },
    );
    const input = (await view.findByLabelText("New task description")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Keep me" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(input.value).toBe("Keep me");
  });

  it("add mode ignores a blank description", async () => {
    const view = panel({ thread_get: () => empty, tasks_add: () => ({ task: null }) }, { mode: "add" });
    const input = await view.findByLabelText("New task description");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    await new Promise((r) => setTimeout(r, 20));
    expect(view.inspection.rpcCalls.some((c) => c.method === "tasks_add")).toBe(false);
  });
});

describe("ThreadPanel mode exit", () => {
  const seeded = {
    state: { pins: [A], recent: [{ uuid: B, at: 1, by: "user" as const }], searches: [] },
  };

  it("pin mode offers Done, which brings back the Pinned and Recent sections", async () => {
    const view = panel(
      { thread_get: () => seeded, tasks_list: () => ({ tasks: [task(A, "Pickable")] }) },
      { mode: "pin" },
    );
    await waitFor(() => view.getByText("Pickable"));
    expect(view.queryByText("Pinned")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: /^done$/i }));
    await waitFor(() => view.getByText("Pinned"));
    expect(view.getByText("Recent")).toBeTruthy();
    expect(view.queryByText(/pick a task to pin/i)).toBeNull();
    expect(view.queryByRole("button", { name: /^done$/i })).toBeNull();
  });

  it("add mode Done hides the add form", async () => {
    const view = panel(
      { thread_get: () => seeded, tasks_list: () => ({ tasks: [task(A, "Pickable")] }) },
      { mode: "add" },
    );
    await view.findByLabelText("New task description");
    fireEvent.click(view.getByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(view.queryByLabelText("New task description")).toBeNull());
    expect(view.getByText("Pinned")).toBeTruthy();
  });

  it("shows no Done control without a mode param", async () => {
    const view = panel(
      { thread_get: () => seeded, tasks_list: () => ({ tasks: [task(A, "Pickable")] }) },
      null,
    );
    await waitFor(() => view.getByText("Pinned"));
    expect(view.queryByRole("button", { name: /^done$/i })).toBeNull();
  });
});

describe("ThreadPanel records what it opens", () => {
  it("records the task created in add mode so it lands in Recent", async () => {
    const view = panel(
      {
        thread_get: () => ({ state: { pins: [], recent: [], searches: [] } }),
        tasks_list: () => ({ tasks: [] }),
        tasks_add: () => ({ task: task(A, "New") }),
        thread_record_view: () => ({ ok: true }),
      },
      { mode: "add" },
    );
    const input = (await view.findByLabelText("New task description")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(
        view.inspection.rpcCalls.find((c) => c.method === "thread_record_view")?.input,
      ).toEqual({ threadId: "t1", uuid: A }),
    );
  });

  it("records a blocker opened from the detail view", async () => {
    const blocked = { ...task(A, "Blocked thing"), blockedBy: [{ id: 9, description: "Blocker" }] };
    const view = panel({
      thread_get: () => ({ state: { pins: [A], recent: [], searches: [] } }),
      tasks_list: () => ({ tasks: [blocked] }),
      tasks_get: (input: { id: number }) =>
        input.id === 9 ? { task: task(B, "Blocker", "pending", 9) } : { task: blocked },
      thread_record_view: () => ({ ok: true }),
    });
    await waitFor(() => view.getByText("Blocked thing"));
    fireEvent.click(view.getByText("Blocked thing"));
    fireEvent.click(await view.findByText(/#9 Blocker/));
    await waitFor(() =>
      expect(
        view.inspection.rpcCalls.some(
          (c) => c.method === "thread_record_view" && (c.input as any).uuid === B,
        ),
      ).toBe(true),
    );
  });
});

describe("ThreadPanel search focus and add guard", () => {
  const empty = { state: { pins: [], recent: [], searches: [] } };

  it("focuses the search box when launched with a query param", async () => {
    const view = panel({ thread_get: () => empty, tasks_list: () => ({ tasks: [] }) }, { query: "" });
    const input = await view.findByLabelText("Search tasks");
    expect(document.activeElement).toBe(input);
  });

  it("does not focus the search box without params", async () => {
    const view = panel({ thread_get: () => empty, tasks_list: () => ({ tasks: [] }) }, null);
    const input = await view.findByLabelText("Search tasks");
    expect(document.activeElement).not.toBe(input);
  });

  it("add mode ignores a second submit while tasks_add is pending", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const view = panel({ thread_get: () => empty, tasks_add: () => pending }, { mode: "add" });
    const input = await view.findByLabelText("New task description");
    fireEvent.change(input, { target: { value: "Once" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(view.inspection.rpcCalls.filter((c) => c.method === "tasks_add")).toHaveLength(1),
    );
    fireEvent.submit(input.closest("form")!);
    await new Promise((r) => setTimeout(r, 20));
    expect(view.inspection.rpcCalls.filter((c) => c.method === "tasks_add")).toHaveLength(1);
    resolve({ task: task(A, "Once") });
  });
});
