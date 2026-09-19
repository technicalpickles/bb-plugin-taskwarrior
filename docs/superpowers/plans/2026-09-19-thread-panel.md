# Thread panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-thread "Tasks" side-panel tab (pins, project tasks, recent views/searches/agent touches) and command palette rows to the Taskwarrior bb plugin.

**Architecture:** Pure, Node-free model modules in `lib/` (thread state, task refs, project link, palette actions) are unit-tested without a host. A small KV-backed store (`lib/thread-store.ts`) and new RPC methods expose them; `server.ts` wires them and feeds Recent from `taskwarrior_run`. The panel is a `threadPanelAction` React tree that reuses extracted formatters and `TaskDetail`.

**Tech Stack:** TypeScript, React 19, `@get-bb/plugin-sdk` (0.4.87), zod 4, vitest + jsdom + `@testing-library/react`, Taskwarrior CLI.

**Spec:** `docs/superpowers/specs/2026-09-19-thread-panel-design.md`

## Global Constraints

- Tasks are referenced by **UUID only** in stored state; never persist integer task IDs.
- `contract.ts` must stay free of Node built-ins (it is bundled into the browser).
- Recording Recent from `taskwarrior_run` is best-effort: it must never turn a successful `task` command into an error.
- Palette rows are static (title + `run`); they cannot list tasks.
- Cap `recent` at 20 entries and `searches` at 10.
- Thread panel uses `layout: "flush"`. Use Tailwind container queries, not viewport hooks, for panel responsiveness.
- Reference plan steps and commits by slug (`core-extraction`, `thread-state-model`, ...), never by ordinal.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

## Deviations from the spec (decided while planning)

These narrow the spec after reading the real code. Task `spec-sync` writes them back into the spec.

- `TaskList`/`TaskRow` stay page-only (they are coupled to select-mode, bulk actions, and `toPluginPanel`). The panel gets its own `CompactTaskRow`. Shared: formatters (`lib/task-format.ts`), list model (`lib/task-list-model.ts`), and `TaskDetail`.
- Pin/unpin lives in the panel (rows + detail) and via the palette pin-picker. The full page has no "current thread", so no pin button there.
- Pin reordering uses up/down buttons in v1. Drag-and-drop is deferred.
- Build order gains `thread-panel-recent` (the Recent section UI was missing from the spec's order).
- `tooltip.tsx` imports `overlay-trigger.js`, so adopting tooltip pulls that file in. It is no longer "skip".

## File Structure

| File | Responsibility |
|---|---|
| `vitest.config.ts`, `test/**` | Test harness and all tests |
| `test/fixtures/fake-task.mjs` | Fake `task` binary backed by `$TASKDATA/db.json` for server tests |
| `lib/task-format.ts` | Date parsing/formatting, priority helpers, `isOverdue` (moved from `app.tsx`) |
| `lib/task-list-model.ts` | Sort/filter/group model (moved from `app.tsx`) |
| `components/tasks/page-scroll.tsx` | `PageScroll` wrapper (moved) |
| `components/tasks/task-list.tsx` | `TaskList` and its private helpers (moved) |
| `components/tasks/task-detail.tsx` | `TaskDetail` (moved, decoupled from `navigate`) |
| `lib/thread-state.ts` | Pure thread-state transitions |
| `lib/task-refs.ts` | Extract task refs from `task` argv; parse `Created task N.` |
| `lib/project-link.ts` | Effective project, health classification, closest-name match |
| `lib/thread-store.ts` | KV-backed, per-key-serialized store over the pure model |
| `lib/palette-actions.ts` | Palette row definitions as plain testable functions |
| `contract.ts` | New schemas, channel, RPC methods |
| `server.ts` | Wire store + RPC + agent-tool recording |
| `components/thread-panel/*` | `use-thread-state`, `use-tasks-by-uuid`, `compact-task-row`, section components, `thread-panel` |
| `app.tsx` | Slim: registrations only |

---

### test-harness

**Files:**
- Modify: `package.json`, `tsconfig.json`
- Create: `vitest.config.ts`, `test/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` (vitest run), `npm run typecheck` (tsc). `@/` alias resolves to repo root in tests. Frontend tests opt into jsdom with `// @vitest-environment jsdom` on line 1.

- [ ] **Step 1: Install test dependencies**

```bash
cd /Users/technicalpickles/github.com/technicalpickles/bb-plugin-taskwarrior
npm ls react react-dom
npm install --save-dev vitest jsdom @testing-library/react cron-parser
```
If `npm ls` shows `react`/`react-dom` missing at the top level, also `npm install --save-dev react react-dom`.

- [ ] **Step 2: Add scripts to `package.json`**

Add a `"scripts"` block (top level, next to `"dependencies"`):

```json
"scripts": {
  "test": "vitest run",
  "typecheck": "tsc --noEmit"
},
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Extend `tsconfig.json` `include`**

Add `"test"` and `"vitest.config.ts"` to the `include` array.

- [ ] **Step 5: Write the smoke test**

`test/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("harness", () => {
  it("resolves the @ alias", () => {
    expect(cn("a", "b")).toBe("a b");
  });
});
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: 1 test passes; `tsc` exits 0. If `tsc` was already failing before this task, record the baseline error count and only require no *new* errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts test/smoke.test.ts
git commit -m "test-harness: add vitest, jsdom, and testing-library"
```

---

### core-extraction

**Files:**
- Create: `lib/task-format.ts`, `lib/task-list-model.ts`, `components/tasks/page-scroll.tsx`, `components/tasks/task-list.tsx`, `components/tasks/task-detail.tsx`, `test/task-format.test.ts`, `test/task-list-model.test.ts`
- Modify: `app.tsx`

**Interfaces:**
- Produces from `lib/task-format.ts`: `parseTaskwarriorDate(value: string): Date | null`, `formatTaskwarriorDate(value: string): string`, `formatRelative(value: string): string | null`, `isOverdue(task: TaskRecord): boolean`, `type PriorityCode`, `PRIORITY_LABELS`, `isPriorityCode`, `priorityLabel(p: string): string`, `priorityVariant(p: string)`.
- Produces from `lib/task-list-model.ts`: `SortField`, `Sort`, `SORT_FIELD_LABELS`, `sortTasks(tasks, sort)`, `ListFilters`, `DEFAULT_FILTERS`, `toggleValue`, `matchesSearch(task, search)`, `matchesFilters(task, filters)`, `TaskGroup`, `groupByProject(tasks)`.
- Produces from `components/tasks/task-detail.tsx`: `TaskDetail({ id, onOpenTask, onClose }: { id: number; onOpenTask: (id: number) => void; onClose: () => void })`.
- Produces from `components/tasks/task-list.tsx`: `TaskList({ filters, setFilters })` (same props as today).
- Produces from `components/tasks/page-scroll.tsx`: `PageScroll({ children })`.

This is a **move**, not a rewrite. Locate blocks by symbol name (line numbers drift). Behavior must not change.

- [ ] **Step 1: Baseline**

Run: `npm run typecheck` and note the result (must be clean or a known baseline).

- [ ] **Step 2: Create `lib/task-format.ts`**

Move from `app.tsx`, verbatim, and `export` each: `DATE_ONLY`, `DATE_AND_TIME`, `RELATIVE`, `parseTaskwarriorDate`, `formatTaskwarriorDate`, `formatRelative`, `isOverdue`, `PriorityCode`, `PRIORITY_LABELS`, `PRIORITY_VARIANTS`, `isPriorityCode`, `priorityLabel`, `priorityVariant`. File header imports:

```ts
import type { TaskRecord } from "../contract";
import type { PillProps } from "@/components/ui/pill";
```
(Keep the explanatory comment about Taskwarrior's basic-ISO-8601 dates above `DATE_ONLY`.)

- [ ] **Step 3: Create `lib/task-list-model.ts`**

Move from `app.tsx`, verbatim, exporting all of: `DATE_FIELDS`, `STRING_FIELDS`, `DateSortField`, `StringSortField`, `SortField`, `Sort`, `SORT_FIELD_LABELS`, `stringSortValue`, `compareTasks`, `sortTasks`, `ListFilters`, `DEFAULT_FILTERS`, `toggleValue`, `matchesSearch`, `matchesFilters`, `TaskGroup`, `groupByProject`. Imports:

```ts
import type { TaskRecord } from "../contract";
import { isPriorityCode, parseTaskwarriorDate, type PriorityCode } from "./task-format";
```

- [ ] **Step 4: Write characterization tests**

`test/task-format.test.ts`:

```ts
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
```

`test/task-list-model.test.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS (these characterize existing behavior; a failure means the move changed logic, so fix the move, not the test).

- [ ] **Step 6: Create the component files**

- `components/tasks/page-scroll.tsx`: move `PageScroll` (with its doc comment), `export function PageScroll`.
- `components/tasks/task-list.tsx`: move `FilterPopover`, `FilterChip`, `FilterChipsRow`, `BulkActionBar`, `TaskRow`, `TaskGroupSection`, `TaskList`. Only `TaskList` is exported. Bring the imports each block needs (`react`, `sonner`, `@get-bb/plugin-sdk/app` hooks, `../../contract`, `@/lib/utils`, the `@/components/ui/*` used, `../../lib/task-format`, `../../lib/task-list-model`, `./page-scroll`). `tsc` reports any missing import.
- `components/tasks/task-detail.tsx`: move `EditPriority` and `TaskDetail`. Change the signature to `TaskDetail({ id, onOpenTask, onClose })` and replace the two navigation sites:
  - `backToList()` body `navigate.toPluginPanel("tasks", { subPath: "" })` becomes `onClose()`.
  - the blocker button `onClick` `navigate.toPluginPanel("tasks", { subPath: String(blocker.id) })` becomes `onOpenTask(blocker.id)`.
  - Remove the now-unused `useBbNavigate` import and `navigate` const in this file.

- [ ] **Step 7: Slim `app.tsx`**

`app.tsx` keeps only the header comment, `TasksPanel`, and `definePluginApp`. New body:

```tsx
import { useState } from "react";
import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { DEFAULT_FILTERS, type ListFilters } from "./lib/task-list-model";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskList } from "@/components/tasks/task-list";

function TasksPanel({ subPath }: { subPath: string }) {
  const navigate = useBbNavigate();
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const taskId = subPath === "" ? null : Number(subPath);
  if (taskId !== null && Number.isFinite(taskId)) {
    return (
      <TaskDetail
        id={taskId}
        onOpenTask={(id) => navigate.toPluginPanel("tasks", { subPath: String(id) })}
        onClose={() => navigate.toPluginPanel("tasks", { subPath: "" })}
      />
    );
  }
  return <TaskList filters={filters} setFilters={setFilters} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Taskwarrior",
    icon: "ListTodo",
    path: "tasks",
    component: TasksPanel,
  });
});
```
Keep the existing top-of-file comment and the `setFilters` updater typing exactly as `TaskList` expects (`(updater: (prev: ListFilters) => ListFilters) => void`); if `useState`'s setter does not satisfy that, keep whatever `app.tsx` did before.

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test`
Expected: clean typecheck (matching baseline), all tests pass. Then open the plugin's page in bb and confirm list, filters, sort, detail view, back, and blocker links still work.

- [ ] **Step 9: Commit**

```bash
git add lib components/tasks app.tsx test
git commit -m "core-extraction: move formatters, list model, list, and detail out of app.tsx"
```

---

### thread-state-model

**Files:**
- Create: `lib/thread-state.ts`, `test/thread-state.test.ts`
- Modify: `contract.ts` (add `threadStateSchema` and type only in this task)

**Interfaces:**
- Produces from `contract.ts`: `threadStateSchema`, `type ThreadState = { pins: string[]; recent: { uuid: string; at: number; by: "user" | "agent" }[]; searches: { query: string; at: number }[] }`.
- Produces from `lib/thread-state.ts`: `RECENT_CAP = 20`, `SEARCH_CAP = 10`, `emptyThreadState()`, `pin(state, uuid)`, `unpin(state, uuid)`, `reorderPins(state, order)`, `recordTouch(state, uuid, by, at)`, `recordSearch(state, query, at)`. All pure, none mutate their input.

- [ ] **Step 1: Add the schema to `contract.ts`**

Below `TASKS_CHANGED`:

```ts
/** Realtime channel the thread panel listens on; payload `{ threadId }`. */
export const THREAD_STATE_CHANGED = "thread-state-changed";

export const threadStateSchema = z.object({
  pins: z.array(z.string()),
  recent: z.array(
    z.object({
      uuid: z.string(),
      at: z.number(),
      by: z.enum(["user", "agent"]),
    }),
  ),
  searches: z.array(z.object({ query: z.string(), at: z.number() })),
});
export type ThreadState = z.infer<typeof threadStateSchema>;
```

- [ ] **Step 2: Write the failing tests**

`test/thread-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RECENT_CAP,
  SEARCH_CAP,
  emptyThreadState,
  pin,
  recordSearch,
  recordTouch,
  reorderPins,
  unpin,
} from "../lib/thread-state";

describe("pins", () => {
  it("appends and dedupes", () => {
    let s = emptyThreadState();
    s = pin(s, "a");
    s = pin(s, "b");
    s = pin(s, "a");
    expect(s.pins).toEqual(["a", "b"]);
  });
  it("unpin removes and ignores unknown", () => {
    const s = pin(pin(emptyThreadState(), "a"), "b");
    expect(unpin(s, "a").pins).toEqual(["b"]);
    expect(unpin(s, "zzz").pins).toEqual(["a", "b"]);
  });
  it("reorderPins applies the order, drops strangers, keeps omitted pins at the end", () => {
    const s = { ...emptyThreadState(), pins: ["a", "b", "c"] };
    expect(reorderPins(s, ["c", "x", "a"]).pins).toEqual(["c", "a", "b"]);
  });
  it("does not mutate input", () => {
    const s = emptyThreadState();
    pin(s, "a");
    expect(s.pins).toEqual([]);
  });
});

describe("recordTouch", () => {
  it("puts the newest first and dedupes by uuid with latest 'by' winning", () => {
    let s = emptyThreadState();
    s = recordTouch(s, "a", "user", 1);
    s = recordTouch(s, "b", "user", 2);
    s = recordTouch(s, "a", "agent", 3);
    expect(s.recent).toEqual([
      { uuid: "a", at: 3, by: "agent" },
      { uuid: "b", at: 2, by: "user" },
    ]);
  });
  it("caps at RECENT_CAP, dropping the oldest", () => {
    let s = emptyThreadState();
    for (let i = 0; i < RECENT_CAP + 5; i++) s = recordTouch(s, `u${i}`, "user", i);
    expect(s.recent).toHaveLength(RECENT_CAP);
    expect(s.recent[0].uuid).toBe(`u${RECENT_CAP + 4}`);
    expect(s.recent.at(-1)?.uuid).toBe("u5");
  });
});

describe("recordSearch", () => {
  it("trims, ignores blanks, dedupes by query, newest first", () => {
    let s = emptyThreadState();
    s = recordSearch(s, "  milk ", 1);
    s = recordSearch(s, "   ", 2);
    s = recordSearch(s, "eggs", 3);
    s = recordSearch(s, "milk", 4);
    expect(s.searches).toEqual([
      { query: "milk", at: 4 },
      { query: "eggs", at: 3 },
    ]);
  });
  it("caps at SEARCH_CAP", () => {
    let s = emptyThreadState();
    for (let i = 0; i < SEARCH_CAP + 3; i++) s = recordSearch(s, `q${i}`, i);
    expect(s.searches).toHaveLength(SEARCH_CAP);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/thread-state.test.ts`
Expected: FAIL (cannot resolve `../lib/thread-state`).

- [ ] **Step 4: Implement `lib/thread-state.ts`**

```ts
// Pure transitions over a thread's UI state. No I/O, no mutation, so the
// store and the tests can both lean on them.
import type { ThreadState } from "../contract";

export const RECENT_CAP = 20;
export const SEARCH_CAP = 10;

export function emptyThreadState(): ThreadState {
  return { pins: [], recent: [], searches: [] };
}

export function pin(state: ThreadState, uuid: string): ThreadState {
  if (state.pins.includes(uuid)) return state;
  return { ...state, pins: [...state.pins, uuid] };
}

export function unpin(state: ThreadState, uuid: string): ThreadState {
  if (!state.pins.includes(uuid)) return state;
  return { ...state, pins: state.pins.filter((existing) => existing !== uuid) };
}

/** Apply `order` to the current pins: unknown uuids are dropped, pins the
 * caller omitted keep their relative order at the end. */
export function reorderPins(state: ThreadState, order: string[]): ThreadState {
  const current = new Set(state.pins);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const uuid of order) {
    if (current.has(uuid) && !seen.has(uuid)) {
      ordered.push(uuid);
      seen.add(uuid);
    }
  }
  for (const uuid of state.pins) if (!seen.has(uuid)) ordered.push(uuid);
  return { ...state, pins: ordered };
}

export function recordTouch(
  state: ThreadState,
  uuid: string,
  by: "user" | "agent",
  at: number,
): ThreadState {
  const rest = state.recent.filter((entry) => entry.uuid !== uuid);
  return { ...state, recent: [{ uuid, at, by }, ...rest].slice(0, RECENT_CAP) };
}

export function recordSearch(state: ThreadState, query: string, at: number): ThreadState {
  const trimmed = query.trim();
  if (trimmed === "") return state;
  const rest = state.searches.filter((entry) => entry.query !== trimmed);
  return { ...state, searches: [{ query: trimmed, at }, ...rest].slice(0, SEARCH_CAP) };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/thread-state.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add contract.ts lib/thread-state.ts test/thread-state.test.ts
git commit -m "thread-state-model: pure pin/recent/search transitions"
```

---

### task-refs

**Files:**
- Create: `lib/task-refs.ts`, `test/task-refs.test.ts`

**Interfaces:**
- Produces: `extractTaskRefs(args: string[]): string[]` (numeric IDs and UUIDs, as strings, that the argv names as its filter), `parseCreatedTaskId(stdout: string): string | null`.

Rules: scan leading tokens. UUIDs and ID lists (`12`, `1,2,3`, `4-6`) are refs. Filter-looking tokens (contain `:`, or start with `+`/`-`) are skipped. The first bare word (a command like `done`, `modify`, `list`) stops the scan. `add` and `log` as first token return `[]` (their argument is a description). Ranges expand, capped at 50 refs.

- [ ] **Step 1: Write the failing tests**

`test/task-refs.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/task-refs.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/task-refs.ts`**

```ts
// Which existing tasks does a `task` argv name? Used to attribute agent
// tool calls to the tasks they touched. Deliberately conservative: only the
// leading filter's ids/uuids count, never report output.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_LIST = /^\d+(?:[,-]\d+)*$/;
const RANGE_CAP = 50;

function expandIdList(token: string): string[] {
  const refs: string[] = [];
  for (const part of token.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range === null) {
      refs.push(String(Number(part)));
    } else {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let id = from; id <= to && refs.length < RANGE_CAP; id++) refs.push(String(id));
    }
    if (refs.length >= RANGE_CAP) break;
  }
  return refs.slice(0, RANGE_CAP);
}

export function extractTaskRefs(args: string[]): string[] {
  if (args[0] === "add" || args[0] === "log") return [];
  const refs: string[] = [];
  for (const token of args) {
    if (UUID.test(token)) {
      refs.push(token);
    } else if (ID_LIST.test(token)) {
      refs.push(...expandIdList(token));
    } else if (token.includes(":") || token.startsWith("+") || token.startsWith("-")) {
      continue;
    } else {
      break;
    }
    if (refs.length >= RANGE_CAP) break;
  }
  return refs.slice(0, RANGE_CAP);
}

export function parseCreatedTaskId(stdout: string): string | null {
  const match = /Created task (\d+)\./.exec(stdout);
  return match === null ? null : match[1];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/task-refs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/task-refs.ts test/task-refs.test.ts
git commit -m "task-refs: extract touched task refs from task argv"
```

---

### project-link-model

**Files:**
- Create: `lib/project-link.ts`, `test/project-link.test.ts`

**Interfaces:**
- Produces: `effectiveProject(override: string | null | undefined, bbName: string | null, isPersonal: boolean): string | null`, `type ProjectStatus = { exists: boolean; pending: number }`, `type ProjectHealth = "unlinked" | "missing" | "empty" | "ok"`, `projectHealth(project: string | null, status: ProjectStatus | null): ProjectHealth`, `closestProject(name: string, projects: string[]): string | null`.

- [ ] **Step 1: Write the failing tests**

`test/project-link.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { closestProject, effectiveProject, projectHealth } from "../lib/project-link";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/project-link.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/project-link.ts`**

```ts
export interface ProjectStatus {
  exists: boolean;
  pending: number;
}

export type ProjectHealth = "unlinked" | "missing" | "empty" | "ok";

export function effectiveProject(
  override: string | null | undefined,
  bbName: string | null,
  isPersonal: boolean,
): string | null {
  if (override !== null && override !== undefined && override !== "") return override;
  if (isPersonal || bbName === null || bbName === "") return null;
  return bbName;
}

export function projectHealth(project: string | null, status: ProjectStatus | null): ProjectHealth {
  if (project === null) return "unlinked";
  if (status === null) return "ok";
  if (!status.exists) return "missing";
  if (status.pending === 0) return "empty";
  return "ok";
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function closestProject(name: string, projects: string[]): string | null {
  const target = normalize(name);
  if (target === "") return null;
  const exact = projects.find((project) => normalize(project) === target);
  if (exact !== undefined) return exact;
  let best: string | null = null;
  let bestGap = Infinity;
  for (const project of projects) {
    const candidate = normalize(project);
    if (candidate === "") continue;
    if (candidate.includes(target) || target.includes(candidate)) {
      const gap = Math.abs(candidate.length - target.length);
      if (gap < bestGap) {
        best = project;
        bestGap = gap;
      }
    }
  }
  return best;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/project-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/project-link.ts test/project-link.test.ts
git commit -m "project-link-model: effective project, health, closest-name match"
```

---

### thread-store

**Files:**
- Create: `lib/thread-store.ts`, `test/thread-store.test.ts`

**Interfaces:**
- Consumes: `lib/thread-state.ts` transitions; `ThreadState` from `contract.ts`.
- Produces: `interface KvLike { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void>; }`, `createThreadStore(kv: KvLike, publish: (threadId: string) => void, now?: () => number)` returning `{ get(threadId): Promise<ThreadState>; pin(threadId, uuid); unpin(threadId, uuid); reorder(threadId, order); recordView(threadId, uuid, by?); recordSearch(threadId, query); getProjectLink(projectId): Promise<string | null>; setProjectLink(projectId, twProject: string | null): Promise<void> }`. Mutators return the new `ThreadState`, except `recordView`/`recordSearch`/`setProjectLink` which return `void`. Each mutation is serialized per thread, persists under `threads/<threadId>`, then calls `publish(threadId)`. Project links persist under `projects/<projectId>` as `{ twProject }` and do not publish.

- [ ] **Step 1: Write the failing tests**

`test/thread-store.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/thread-store.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/thread-store.ts`**

```ts
// KV-backed persistence for thread and project UI state. Mutations are
// read-modify-write, so they are serialized per key to avoid lost updates
// when the panel fires several RPCs at once.
import type { ThreadState } from "../contract";
import {
  emptyThreadState,
  pin,
  recordSearch,
  recordTouch,
  reorderPins,
  unpin,
} from "./thread-state";

export interface KvLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const threadKey = (threadId: string) => `threads/${threadId}`;
const projectKey = (projectId: string) => `projects/${projectId}`;

export function createThreadStore(
  kv: KvLike,
  publish: (threadId: string) => void,
  now: () => number = Date.now,
) {
  const chains = new Map<string, Promise<unknown>>();

  function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    chains.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  async function load(threadId: string): Promise<ThreadState> {
    return (await kv.get<ThreadState>(threadKey(threadId))) ?? emptyThreadState();
  }

  function mutate(threadId: string, change: (state: ThreadState) => ThreadState) {
    return serialized(threadKey(threadId), async () => {
      const next = change(await load(threadId));
      await kv.set(threadKey(threadId), next);
      publish(threadId);
      return next;
    });
  }

  return {
    get: load,
    pin: (threadId: string, uuid: string) => mutate(threadId, (s) => pin(s, uuid)),
    unpin: (threadId: string, uuid: string) => mutate(threadId, (s) => unpin(s, uuid)),
    reorder: (threadId: string, order: string[]) =>
      mutate(threadId, (s) => reorderPins(s, order)),
    recordView: async (threadId: string, uuid: string, by: "user" | "agent" = "user") => {
      await mutate(threadId, (s) => recordTouch(s, uuid, by, now()));
    },
    recordSearch: async (threadId: string, query: string) => {
      await mutate(threadId, (s) => recordSearch(s, query, now()));
    },
    async getProjectLink(projectId: string): Promise<string | null> {
      const record = await kv.get<{ twProject: string | null }>(projectKey(projectId));
      return record?.twProject ?? null;
    },
    setProjectLink(projectId: string, twProject: string | null): Promise<void> {
      return serialized(projectKey(projectId), () => kv.set(projectKey(projectId), { twProject }));
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/thread-store.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/thread-store.ts test/thread-store.test.ts
git commit -m "thread-store: serialized KV persistence for thread and project state"
```

---

### rpc-wiring

**Files:**
- Modify: `contract.ts`, `server.ts`
- Create: `test/fixtures/fake-task.mjs`, `test/server-rpc.test.ts`

**Interfaces:**
- Consumes: `createThreadStore` (Task `thread-store`), `threadStateSchema`, `THREAD_STATE_CHANGED`.
- Produces RPC methods (all registered in `rpcContract`):
  - `thread_get({ threadId }) -> { state }`
  - `thread_pin({ threadId, uuid }) -> { state }`, `thread_unpin({ threadId, uuid }) -> { state }`
  - `thread_reorder_pins({ threadId, order }) -> { state }`
  - `thread_record_view({ threadId, uuid }) -> { ok: boolean }`
  - `thread_record_search({ threadId, query }) -> { ok: boolean }`
  - `project_link_get({ projectId }) -> { twProject: string | null }`
  - `project_link_set({ projectId, twProject }) -> { ok: boolean }`
  - `project_status({ name }) -> { exists: boolean; pending: number }`
  - `tw_projects_list({}) -> { projects: string[] }`
- Pinned tasks are resolved by the existing `tasks_list({ filter: [uuid, ...] })` (a UUID filter returns any status), so no new by-uuid RPC.

- [ ] **Step 1: Create the fake `task` binary**

`test/fixtures/fake-task.mjs` (make executable: `chmod +x`). It keeps state in `$TASKDATA/db.json` as `{ "tasks": [...] }` where each task has `uuid`, `description`, `status`, optional `project`. Supports: `<filter...> export`, `add <desc>`, `<ref> done`, `_projects`. `rc.*` args are ignored. IDs are 1-based positions among `pending` tasks (completed/deleted get id 0).

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const dbPath = join(process.env.TASKDATA ?? ".", "db.json");
const args = process.argv.slice(2).filter((a) => !a.startsWith("rc."));
const db = JSON.parse(readFileSync(dbPath, "utf8"));

function withIds() {
  let n = 0;
  return db.tasks.map((t) => ({ ...t, id: t.status === "pending" ? ++n : 0 }));
}
function save() {
  writeFileSync(dbPath, JSON.stringify(db));
}
function matches(task, tokens) {
  const refs = tokens.filter((t) => /^\d+$/.test(t) || /^[0-9a-f-]{36}$/i.test(t));
  const filters = tokens.filter((t) => t.includes(":"));
  if (refs.length > 0 && !refs.some((r) => String(task.id) === r || task.uuid === r)) return false;
  return filters.every((f) => {
    const [key, value] = [f.slice(0, f.indexOf(":")), f.slice(f.indexOf(":") + 1)];
    if (key === "project") return task.project === value || String(task.project ?? "").startsWith(`${value}.`);
    if (key === "status") return task.status === value;
    return true;
  });
}

const command = args.at(-1);
if (command === "export") {
  const out = withIds().filter((t) => matches(t, args.slice(0, -1)));
  process.stdout.write(JSON.stringify(out));
} else if (args[0] === "add") {
  const task = { uuid: randomUUID(), description: args.slice(1).join(" "), status: "pending" };
  db.tasks.push(task);
  save();
  process.stdout.write(`Created task ${withIds().find((t) => t.uuid === task.uuid).id}.\n`);
} else if (command === "done") {
  const target = withIds().filter((t) => matches(t, args.slice(0, -1)));
  for (const t of target) db.tasks.find((x) => x.uuid === t.uuid).status = "completed";
  save();
  process.stdout.write(`Completed ${target.length} task(s).\n`);
} else if (command === "_projects") {
  const names = new Set(
    withIds().filter((t) => t.status === "pending" && t.project).map((t) => t.project),
  );
  process.stdout.write([...names].sort().join("\n") + "\n");
} else {
  process.stderr.write(`fake-task: unsupported args: ${args.join(" ")}\n`);
  process.exit(1);
}
```

- [ ] **Step 2: Write the failing server tests**

`test/server-rpc.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/server-rpc.test.ts`
Expected: FAIL (unknown RPC methods `thread_pin` etc.).

- [ ] **Step 4: Extend `rpcContract` in `contract.ts`**

Append these entries inside `defineRpcContract({ ... })`:

```ts
  thread_get: {
    input: z.object({ threadId: z.string() }),
    output: z.object({ state: threadStateSchema }),
  },
  thread_pin: {
    input: z.object({ threadId: z.string(), uuid: z.string() }),
    output: z.object({ state: threadStateSchema }),
  },
  thread_unpin: {
    input: z.object({ threadId: z.string(), uuid: z.string() }),
    output: z.object({ state: threadStateSchema }),
  },
  thread_reorder_pins: {
    input: z.object({ threadId: z.string(), order: z.array(z.string()) }),
    output: z.object({ state: threadStateSchema }),
  },
  thread_record_view: {
    input: z.object({ threadId: z.string(), uuid: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  thread_record_search: {
    input: z.object({ threadId: z.string(), query: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  project_link_get: {
    input: z.object({ projectId: z.string() }),
    output: z.object({ twProject: z.string().nullable() }),
  },
  project_link_set: {
    input: z.object({ projectId: z.string(), twProject: z.string().nullable() }),
    output: z.object({ ok: z.boolean() }),
  },
  project_status: {
    input: z.object({ name: z.string() }),
    output: z.object({ exists: z.boolean(), pending: z.number() }),
  },
  tw_projects_list: {
    input: z.object({}),
    output: z.object({ projects: z.array(z.string()) }),
  },
```

- [ ] **Step 5: Wire handlers in `server.ts`**

Add imports:

```ts
import { createThreadStore } from "./lib/thread-store";
import { THREAD_STATE_CHANGED } from "./contract";
```
(extend the existing `./contract` import instead of adding a second one).

Inside `plugin()`, after `attachBlockedBy` and before `bb.rpc.register`, add:

```ts
  const threads = createThreadStore(bb.storage.kv, (threadId) =>
    bb.realtime.publish(THREAD_STATE_CHANGED, { threadId }),
  );
```

Add these handlers to the object passed to `bb.rpc.register(rpcContract, { ... })`:

```ts
    thread_get: async ({ threadId }) => ({ state: await threads.get(threadId) }),
    thread_pin: async ({ threadId, uuid }) => ({ state: await threads.pin(threadId, uuid) }),
    thread_unpin: async ({ threadId, uuid }) => ({ state: await threads.unpin(threadId, uuid) }),
    thread_reorder_pins: async ({ threadId, order }) => ({
      state: await threads.reorder(threadId, order),
    }),
    thread_record_view: async ({ threadId, uuid }) => {
      await threads.recordView(threadId, uuid);
      return { ok: true };
    },
    thread_record_search: async ({ threadId, query }) => {
      await threads.recordSearch(threadId, query);
      return { ok: true };
    },
    project_link_get: async ({ projectId }) => ({
      twProject: await threads.getProjectLink(projectId),
    }),
    project_link_set: async ({ projectId, twProject }) => {
      await threads.setProjectLink(projectId, twProject);
      return { ok: true };
    },
    project_status: async ({ name }) => {
      const tasks = await exportTasks([`project:${name}`]);
      return {
        exists: tasks.length > 0,
        pending: tasks.filter((task) => task.status === "pending").length,
      };
    },
    tw_projects_list: async () => {
      const result = await runTask(["_projects"]);
      const projects =
        result.exitCode === 0
          ? [...new Set(result.stdout.split("\n").map((line) => line.trim()).filter(Boolean))].sort()
          : [];
      return { projects };
    },
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run test/server-rpc.test.ts && npm run typecheck`
Expected: PASS, typecheck clean. If `setSettings` rejects unknown keys or the fake host reads settings differently, adjust the `boot` helper only, not the handlers.

- [ ] **Step 7: Commit**

```bash
git add contract.ts server.ts test/fixtures test/server-rpc.test.ts
git commit -m "rpc-wiring: thread state, project link, project status, project list RPCs"
```

---

### thread-panel-pins

**Files:**
- Create: `components/thread-panel/use-thread-state.ts`, `components/thread-panel/use-tasks-by-uuid.ts`, `components/thread-panel/compact-task-row.tsx`, `components/thread-panel/pinned-section.tsx`, `components/thread-panel/thread-panel.tsx`, `test/thread-panel.test.tsx`
- Modify: `app.tsx` (register `threadPanelAction`)

**Interfaces:**
- Consumes: RPC methods from `rpc-wiring`; `TaskDetail`, `priorityLabel`/`priorityVariant`, `isOverdue`, `matchesSearch`.
- Produces:
  - `useThreadState(threadId: string)` returning `{ state: ThreadState | null; pin(uuid): Promise<void>; unpin(uuid): Promise<void>; reorder(order: string[]): Promise<void>; recordView(uuid): Promise<void>; recordSearch(query): Promise<void> }`, refreshed on `THREAD_STATE_CHANGED` for its thread.
  - `useTasksByUuid(uuids: string[])` returning `Map<string, TaskRecord>`, refreshed on `TASKS_CHANGED`.
  - `CompactTaskRow({ uuid, task, pinned, badge, onOpen, onComplete, onTogglePin, onMoveUp, onMoveDown, onClear })`. `task` may be `undefined` (unknown/deleted uuid). Every callback is optional; a control renders only when its callback is given.
  - `ThreadPanel({ threadId, params })` where `params` may be `{ query?: string; mode?: "pin" }` or `null`.
  - `PinnedSection({ threadId, state, tasks, actions })`.

- [ ] **Step 1: Write the failing component tests**

`test/thread-panel.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/thread-panel.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hooks**

`components/thread-panel/use-thread-state.ts`:

```ts
import { useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract, THREAD_STATE_CHANGED, type ThreadState } from "../../contract";

export function useThreadState(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<ThreadState | null>(null);

  async function refresh() {
    const { state: next } = await rpc.call("thread_get", { threadId });
    setState(next);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useRealtime(THREAD_STATE_CHANGED, (payload) => {
    const changed = (payload as { threadId?: string } | null)?.threadId;
    if (changed === undefined || changed === threadId) void refresh();
  });

  return {
    state,
    async pin(uuid: string) {
      setState((await rpc.call("thread_pin", { threadId, uuid })).state);
    },
    async unpin(uuid: string) {
      setState((await rpc.call("thread_unpin", { threadId, uuid })).state);
    },
    async reorder(order: string[]) {
      setState((await rpc.call("thread_reorder_pins", { threadId, order })).state);
    },
    async recordView(uuid: string) {
      await rpc.call("thread_record_view", { threadId, uuid });
    },
    async recordSearch(query: string) {
      await rpc.call("thread_record_search", { threadId, query });
    },
  };
}
```

`components/thread-panel/use-tasks-by-uuid.ts`:

```ts
import { useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "../../contract";

/** Resolve stored uuids to live tasks (any status). Missing uuids are absent
 * from the map, which the UI renders as "no longer exists". */
export function useTasksByUuid(uuids: string[]): Map<string, TaskRecord> {
  const rpc = useRpc<typeof rpcContract>();
  const [byUuid, setByUuid] = useState<Map<string, TaskRecord>>(new Map());
  const key = uuids.join(",");

  async function refresh() {
    if (uuids.length === 0) {
      setByUuid(new Map());
      return;
    }
    const { tasks } = await rpc.call("tasks_list", { filter: uuids });
    setByUuid(new Map(tasks.map((task) => [task.uuid, task])));
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useRealtime(TASKS_CHANGED, () => {
    void refresh();
  });

  return byUuid;
}
```

- [ ] **Step 4: Implement `CompactTaskRow`**

`components/thread-panel/compact-task-row.tsx`:

```tsx
import type { ReactNode } from "react";
import type { TaskRecord } from "../../contract";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Pill } from "@/components/ui/pill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { isOverdue, priorityLabel, priorityVariant } from "../../lib/task-format";

interface CompactTaskRowProps {
  uuid: string;
  task: TaskRecord | undefined;
  pinned?: boolean;
  badge?: ReactNode;
  onOpen?: () => void;
  onComplete?: () => void;
  onTogglePin?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onClear?: () => void;
}

function IconAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          className={COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS}
          aria-label={label}
          onClick={onClick}
        >
          <Icon name={icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function CompactTaskRow(props: CompactTaskRowProps) {
  const { task, pinned, badge } = props;
  if (task === undefined) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex-1">Task no longer exists</span>
        {props.onClear && <IconAction label="Clear" icon="X" onClick={props.onClear} />}
      </div>
    );
  }
  const finished = task.status === "completed" || task.status === "deleted";
  return (
    <div className="@container flex items-center gap-1 px-3 py-2">
      <button
        type="button"
        onClick={props.onOpen}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
      >
        <span
          className={cn(
            "w-full truncate text-sm text-foreground",
            finished && "text-muted-foreground line-through",
          )}
        >
          {task.description}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {task.project && (
            <Pill variant="outline" size="sm">
              {task.project}
            </Pill>
          )}
          {task.priority && (
            <Pill variant={priorityVariant(task.priority)} size="sm">
              {priorityLabel(task.priority)}
            </Pill>
          )}
          {isOverdue(task) && (
            <Pill variant="destructive" size="sm">
              Overdue
            </Pill>
          )}
          {badge}
        </span>
      </button>
      {props.onMoveUp && <IconAction label="Move up" icon="ArrowUp" onClick={props.onMoveUp} />}
      {props.onMoveDown && (
        <IconAction label="Move down" icon="ArrowDown" onClick={props.onMoveDown} />
      )}
      {props.onTogglePin && (
        <IconAction
          label={pinned ? "Unpin" : "Pin"}
          icon={pinned ? "PinOff" : "Pin"}
          onClick={props.onTogglePin}
        />
      )}
      {props.onComplete && !finished && (
        <IconAction label="Complete" icon="Check" onClick={props.onComplete} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement `PinnedSection`**

`components/thread-panel/pinned-section.tsx`:

```tsx
import type { TaskRecord, ThreadState } from "../../contract";
import { CompactTaskRow } from "./compact-task-row";

export interface PinnedActions {
  open(task: TaskRecord): void;
  unpin(uuid: string): void;
  reorder(order: string[]): void;
  complete(task: TaskRecord): void;
}

export function PinnedSection({
  state,
  tasks,
  actions,
}: {
  state: ThreadState;
  tasks: Map<string, TaskRecord>;
  actions: PinnedActions;
}) {
  if (state.pins.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        Nothing pinned yet. Pin a task from Recent or search to keep it here.
      </p>
    );
  }
  const move = (index: number, delta: -1 | 1) => {
    const order = [...state.pins];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    actions.reorder(order);
  };
  return (
    <div className="divide-y divide-border">
      {state.pins.map((uuid, index) => {
        const task = tasks.get(uuid);
        return (
          <CompactTaskRow
            key={uuid}
            uuid={uuid}
            task={task}
            pinned
            onOpen={task ? () => actions.open(task) : undefined}
            onComplete={task ? () => actions.complete(task) : undefined}
            onTogglePin={() => actions.unpin(uuid)}
            onMoveUp={index > 0 ? () => move(index, -1) : undefined}
            onMoveDown={index < state.pins.length - 1 ? () => move(index, 1) : undefined}
            onClear={() => actions.unpin(uuid)}
          />
        );
      })}
    </div>
  );
}
```
Note: the "no longer exists" row's clear button and the pinned row's unpin button share `actions.unpin`. In the unresolved-row case `onTogglePin` is not rendered (the row returns early), only `onClear`.

- [ ] **Step 6: Implement `ThreadPanel` (pins + search shell + detail)**

`components/thread-panel/thread-panel.tsx`:

```tsx
import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, type TaskRecord } from "../../contract";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { PinnedSection } from "./pinned-section";
import { useTasksByUuid } from "./use-tasks-by-uuid";
import { useThreadState } from "./use-thread-state";

export interface ThreadPanelParams {
  query?: string;
  mode?: "pin";
}

export function ThreadPanel({
  threadId,
  params,
}: {
  threadId: string;
  params: ThreadPanelParams | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const thread = useThreadState(threadId);
  const [query, setQuery] = useState(params?.query ?? "");
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const pins = thread.state?.pins ?? [];
  const tasks = useTasksByUuid(pins);

  if (openTaskId !== null) {
    return (
      <TooltipProvider>
        <TaskDetail
          id={openTaskId}
          onOpenTask={setOpenTaskId}
          onClose={() => setOpenTaskId(null)}
        />
      </TooltipProvider>
    );
  }

  async function completeTask(task: TaskRecord) {
    const { ok } = await rpc.call("tasks_complete", { id: task.id });
    if (!ok) toast.error(`Could not complete "${task.description}"`);
  }

  function openTask(task: TaskRecord) {
    void thread.recordView(task.uuid);
    setOpenTaskId(task.id);
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-y-auto">
        <div className="p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
          />
        </div>
        <h3 className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Pinned
        </h3>
        {thread.state !== null && (
          <PinnedSection
            state={thread.state}
            tasks={tasks}
            actions={{
              open: openTask,
              unpin: (uuid) => void thread.unpin(uuid),
              reorder: (order) => void thread.reorder(order),
              complete: (task) => void completeTask(task),
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
```
The search input is a shell here; `thread-panel-recent` wires search results and recording.

- [ ] **Step 7: Register the panel in `app.tsx`**

Add the import and a registration inside `definePluginApp`:

```tsx
import { ThreadPanel } from "@/components/thread-panel/thread-panel";
```

```tsx
  app.slots.threadPanelAction({
    id: "tasks",
    title: "Tasks",
    icon: "ListTodo",
    layout: "flush",
    component: ThreadPanel,
  });
```
`ThreadPanel` receives `PluginThreadPanelProps` (`threadId`, `params: JsonValue | null`). If the `params` type does not fit `ThreadPanelParams`, wrap: `component: (props) => <ThreadPanel threadId={props.threadId} params={props.params as ThreadPanelParams | null} />`.

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run test/thread-panel.test.tsx && npm run typecheck`
Expected: PASS, typecheck clean. If an icon name is rejected by the `Icon` type, use one already used in `task-detail.tsx` (`Check`, `X`) or a registered extended name (`ArrowUp`, `ArrowDown`, `Pin`, `PinOff`).

- [ ] **Step 9: Commit**

```bash
git add components/thread-panel app.tsx test/thread-panel.test.tsx
git commit -m "thread-panel-pins: thread panel tab with pinned tasks"
```

---

### thread-panel-recent

**Files:**
- Create: `components/thread-panel/recent-section.tsx`, `components/thread-panel/search-results.tsx`
- Modify: `components/thread-panel/thread-panel.tsx`, `test/thread-panel.test.tsx`

**Interfaces:**
- Consumes: `useThreadState`, `useTasksByUuid`, `CompactTaskRow`, `matchesSearch`.
- Produces:
  - `RecentSection({ state, tasks, pinnedUuids, actions })` showing viewed/agent-touched tasks (each row badged "you" or "agent") plus past searches as clickable chips. `actions: { open(task), togglePin(uuid), rerun(query) }`.
  - `SearchResults({ query, pinnedUuids, actions })` fetching `tasks_list({ filter: ["status:pending"] })`, filtering with `matchesSearch`, rendering `CompactTaskRow`s with a pin toggle. `actions: { open(task), togglePin(uuid) }`.
  - Behavior: a non-empty `query` replaces Pinned/Recent with search results. Search is recorded via `thread.recordSearch(query)` when the user presses Enter.

- [ ] **Step 1: Add failing tests**

Append to `test/thread-panel.test.tsx`:

```tsx
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
      tasks_list: () => ({ tasks: [task(A, "Agent did this"), task(B, "You viewed this")] }),
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
});

describe("ThreadPanel search", () => {
  it("shows matching pending tasks and records the search on Enter", async () => {
    const view = panel({
      thread_get: () => ({ state: { pins: [], recent: [], searches: [] } }),
      tasks_list: () => ({ tasks: [task(A, "Buy milk"), task(B, "Write plan")] }),
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/thread-panel.test.tsx`
Expected: the new tests FAIL; the earlier pinned tests still PASS.

- [ ] **Step 3: Implement `SearchResults`**

`components/thread-panel/search-results.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "../../contract";
import { matchesSearch } from "../../lib/task-list-model";
import { CompactTaskRow } from "./compact-task-row";

export function SearchResults({
  query,
  pinnedUuids,
  actions,
}: {
  query: string;
  pinnedUuids: string[];
  actions: { open(task: TaskRecord): void; togglePin(uuid: string): void };
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);

  async function refresh() {
    const { tasks: next } = await rpc.call("tasks_list", { filter: ["status:pending"] });
    setTasks(next);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRealtime(TASKS_CHANGED, () => {
    void refresh();
  });

  if (tasks === null) return <p className="px-3 py-4 text-xs text-muted-foreground">Loading…</p>;
  const matches = tasks.filter((task) => matchesSearch(task, query));
  if (matches.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">No matching tasks.</p>;
  }
  return (
    <div className="divide-y divide-border">
      {matches.map((task) => (
        <CompactTaskRow
          key={task.uuid}
          uuid={task.uuid}
          task={task}
          pinned={pinnedUuids.includes(task.uuid)}
          onOpen={() => actions.open(task)}
          onTogglePin={() => actions.togglePin(task.uuid)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement `RecentSection`**

`components/thread-panel/recent-section.tsx`:

```tsx
import type { TaskRecord, ThreadState } from "../../contract";
import { Pill } from "@/components/ui/pill";
import { CompactTaskRow } from "./compact-task-row";

export function RecentSection({
  state,
  tasks,
  actions,
}: {
  state: ThreadState;
  tasks: Map<string, TaskRecord>;
  actions: { open(task: TaskRecord): void; togglePin(uuid: string): void; rerun(query: string): void };
}) {
  if (state.recent.length === 0 && state.searches.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">Nothing yet.</p>;
  }
  return (
    <div>
      {state.searches.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {state.searches.map((search) => (
            <button key={search.query} type="button" onClick={() => actions.rerun(search.query)}>
              <Pill variant="outline" size="sm">
                {search.query}
              </Pill>
            </button>
          ))}
        </div>
      )}
      <div className="divide-y divide-border">
        {state.recent.map((entry) => {
          const task = tasks.get(entry.uuid);
          return (
            <CompactTaskRow
              key={entry.uuid}
              uuid={entry.uuid}
              task={task}
              pinned={state.pins.includes(entry.uuid)}
              badge={
                <Pill variant={entry.by === "agent" ? "emphasis" : "secondary"} size="sm">
                  {entry.by === "agent" ? "agent" : "you"}
                </Pill>
              }
              onOpen={task ? () => actions.open(task) : undefined}
              onTogglePin={task ? () => actions.togglePin(entry.uuid) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire search and Recent into `ThreadPanel`**

In `thread-panel.tsx`:
- Compute `const recentUuids = thread.state?.recent.map((entry) => entry.uuid) ?? []` and resolve `useTasksByUuid([...new Set([...pins, ...recentUuids])])` once (replace the pins-only call) so both sections share one lookup.
- Add `function togglePin(uuid: string) { void (pins.includes(uuid) ? thread.unpin(uuid) : thread.pin(uuid)); }`.
- On the search `Input`, add `onKeyDown={(event) => { if (event.key === "Enter") void thread.recordSearch(query); }}`.
- When `query.trim() !== ""`, render `<SearchResults query={query} pinnedUuids={pins} actions={{ open: openTask, togglePin }} />` instead of the sections.
- Otherwise render Pinned, then a "Recent" heading (same style as "Pinned") followed by `<RecentSection state={thread.state} tasks={tasks} actions={{ open: openTask, togglePin, rerun: setQuery }} />`.

- [ ] **Step 6: Run to verify it passes**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add components/thread-panel test/thread-panel.test.tsx
git commit -m "thread-panel-recent: search, recent views, agent touches, pin from any row"
```

---

### project-mapping

**Files:**
- Create: `components/thread-panel/project-section.tsx`, `components/thread-panel/use-project-link.ts`
- Modify: `components/thread-panel/thread-panel.tsx`, `test/thread-panel.test.tsx`

**Interfaces:**
- Consumes: `effectiveProject`, `projectHealth`, `closestProject`; RPC `project_link_get`, `project_link_set`, `project_status`, `tw_projects_list`; `useBbContext`, `experimental_useSidebarThreads`.
- Produces: `useProjectLink(projectId: string | null)` returning `{ twProject: string | null; setLink(name: string | null): Promise<void> }`, and `ProjectSection({ projectId, bbProjectName, isPersonal, pinnedUuids, actions })`. `actions: { open(task), togglePin(uuid) }`.

Behavior (spec Section 2):
- Effective project = override, else bb project name (none for personal).
- `unlinked` (no effective project): show only the picker.
- `missing`: warning "No Taskwarrior project named `X`. Name mismatch, or nothing created yet?" + picker (pre-selected via `closestProject`) + "Add a task" button (`tasks_add` with description `""` is invalid, so it opens an inline input, then calls `tasks_add`, then `tasks` modify with `project`).
- `empty`: neutral "All clear".
- `ok`: `tasks_list({ filter: ["status:pending", "project:X"] })` rows with pin toggle.
- Section is collapsed by default (`Collapsible`).

- [ ] **Step 1: Add failing tests**

Append to `test/thread-panel.test.tsx` a `describe("ThreadPanel project section")` covering, with `renderSlot` option `sidebarThreads: { status: "ready", threads: [], projects: [{ id: "p1", name: "bb-plugin-taskwarrior", isPersonal: false }] }`:

```tsx
import { fireEvent, waitFor } from "@testing-library/react";

const project = (over: object = {}) => ({
  sidebarThreads: {
    status: "ready" as const,
    threads: [],
    projects: [{ id: "p1", name: "bb-plugin-taskwarrior", isPersonal: false, ...over }],
  },
});

function projectPanel(rpc: Record<string, (i: any) => unknown>, over: object = {}) {
  return renderSlot(
    { component: ThreadPanel },
    { threadId: "t1", params: null } as any,
    {
      rpc: {
        thread_get: () => ({ state: { pins: [], recent: [], searches: [] } }),
        project_link_get: () => ({ twProject: null }),
        tw_projects_list: () => ({ projects: ["home", "taskwarrior"] }),
        ...rpc,
      } as any,
      context: { projectId: "p1", threadId: "t1" },
      ...project(over),
    },
  );
}

describe("ThreadPanel project section", () => {
  it("warns when no taskwarrior project matches the bb project name", async () => {
    const view = projectPanel({ project_status: () => ({ exists: false, pending: 0 }) });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() =>
      view.getByText(/No Taskwarrior project named.*bb-plugin-taskwarrior/i),
    );
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
      tasks_list: () => ({ tasks: [task(A, "Project task")] }),
    });
    fireEvent.click(await view.findByText("Project"));
    await waitFor(() => view.getByText("Project task"));
  });

  it("uses a saved override instead of the bb project name", async () => {
    const view = projectPanel({
      project_link_get: () => ({ twProject: "taskwarrior" }),
      project_status: (input: { name: string }) => ({
        exists: input.name === "taskwarrior",
        pending: input.name === "taskwarrior" ? 1 : 0,
      }),
      tasks_list: () => ({ tasks: [task(A, "Linked task")] }),
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
    fireEvent.click(view.getByLabelText(/link a taskwarrior project/i));
    fireEvent.click(await view.findByText("home"));
    await waitFor(() =>
      expect(view.inspection.rpcCalls.find((c) => c.method === "project_link_set")?.input).toEqual({
        projectId: "p1",
        twProject: "home",
      }),
    );
  });

  it("has no default for the personal project", async () => {
    const view = projectPanel({ project_status: () => ({ exists: true, pending: 1 }) }, { isPersonal: true });
    fireEvent.click(await view.findByText("Project"));
    await view.findByLabelText(/link a taskwarrior project/i);
    expect(view.inspection.rpcCalls.some((c) => c.method === "project_status")).toBe(false);
  });
});
```
(Radix `Select` may not open under jsdom via `click`; if "saves a link" cannot open the listbox, drive it by replacing the picker's `Select` with a native `<select aria-label="Link a Taskwarrior project">` inside `ProjectSection`. A native select is acceptable and simpler for a narrow panel. In that case change the test to `fireEvent.change(view.getByLabelText(...), { target: { value: "home" } })`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/thread-panel.test.tsx`
Expected: project-section tests FAIL; earlier tests still PASS.

- [ ] **Step 3: Implement `useProjectLink`**

`components/thread-panel/use-project-link.ts`:

```ts
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../../contract";

export function useProjectLink(projectId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [twProject, setTwProject] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    if (projectId === null) {
      setTwProject(null);
      setLoaded(true);
      return;
    }
    void rpc.call("project_link_get", { projectId }).then((out) => {
      setTwProject(out.twProject);
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return {
    twProject,
    loaded,
    async setLink(name: string | null) {
      if (projectId === null) return;
      await rpc.call("project_link_set", { projectId, twProject: name });
      setTwProject(name);
    },
  };
}
```

- [ ] **Step 4: Implement `ProjectSection`**

`components/thread-panel/project-section.tsx`: a `Collapsible` (closed by default) titled **Project** whose trigger text is exactly `Project`. Inside:
1. Read `link = useProjectLink(projectId)`. Wait for `link.loaded`.
2. `const project = effectiveProject(link.twProject, bbProjectName, isPersonal)`.
3. If `project !== null`, call `project_status({ name: project })` (effect keyed on `project`, and re-run on `TASKS_CHANGED`) into `status`; else `status = null`. Load `tw_projects_list` once into `projects`.
4. `health = projectHealth(project, status)`.
5. Render by health:
   - `unlinked`: the picker only.
   - `missing`: a warning block (`role="alert"`) with the text ``No Taskwarrior project named `${project}`. Name mismatch, or nothing created yet?``, then the picker, then an "Add a task" affordance (an `Input` + `Button`; on submit call `tasks_add({ description })` then `tasks_modify({ id: task.id, project })` using the returned `task`).
   - `empty`: neutral text `All clear.` and a small "Change project" link that reveals the picker.
   - `ok`: fetch `tasks_list({ filter: ["status:pending", `project:${project}`] })`, render `CompactTaskRow`s with a pin toggle, plus the "Change project" link.
6. The picker is a native `<select aria-label="Link a Taskwarrior project">` listing `projects`, with the `closestProject(project ?? bbProjectName ?? "", projects)` option marked "(suggested)". Choosing an option calls `link.setLink(name)`.

Use only existing UI pieces (`Collapsible`, `Input`, `Button`, `Pill`, `Icon`) and the existing `CompactTaskRow`. Use `@container` classes, not viewport hooks.

- [ ] **Step 5: Mount it in `ThreadPanel`**

In `thread-panel.tsx`, read `const { projectId } = useBbContext()` and `const { projects } = experimental_useSidebarThreads()`; find `const bbProject = projects.find((p) => p.id === projectId)`. Render `<ProjectSection projectId={projectId} bbProjectName={bbProject?.name ?? null} isPersonal={bbProject?.isPersonal ?? false} pinnedUuids={pins} actions={{ open: openTask, togglePin }} />` between Pinned and Recent (only when not searching).

- [ ] **Step 6: Run to verify it passes**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add components/thread-panel test/thread-panel.test.tsx
git commit -m "project-mapping: project section with name default, override, and warning"
```

---

### agent-recent

**Files:**
- Modify: `server.ts`
- Create: `test/agent-recent.test.ts`

**Interfaces:**
- Consumes: `extractTaskRefs`, `parseCreatedTaskId`, `threads.recordView(threadId, uuid, "agent")`, `exportTasks`.
- Produces: `taskwarrior_run`'s `execute(params, ctx)` now records touched tasks into `ctx.threadId`'s `recent` with `by: "agent"`, and publishes `TASKS_CHANGED` when anything was touched or created.

Behavior (spec Section 3b): resolve refs to UUIDs **before** running (IDs die after `done`/`delete`); after `add`, resolve the new ID. Best-effort: errors are caught and logged, never surfaced.

- [ ] **Step 1: Write the failing tests**

`test/agent-recent.test.ts` (reuse the `boot` helper pattern from `test/server-rpc.test.ts`; copy it locally rather than importing across test files):

```ts
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

const hosts: any[] = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop().harness.lifecycle.dispose();
});

const ctx = { threadId: "t1", projectId: "p1" };

async function recent(host: any) {
  const out = (await host.harness.behavior.callRpc("thread_get", { threadId: "t1" })) as any;
  return out.state.recent as { uuid: string; by: string }[];
}

describe("taskwarrior_run feeds Recent", () => {
  it("records a task the agent completes, using its uuid resolved before the run", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    const result = await host.harness.behavior.callAgentTool("taskwarrior_run", { args: ["1", "done"] }, ctx);
    expect(result.isError).toBeFalsy();
    expect(await recent(host)).toEqual([expect.objectContaining({ uuid: A, by: "agent" })]);
  });

  it("records a task the agent adds", async () => {
    const host = await boot([]);
    hosts.push(host);
    await host.harness.behavior.callAgentTool("taskwarrior_run", { args: ["add", "New thing"] }, ctx);
    const list = await recent(host);
    expect(list).toHaveLength(1);
    expect(list[0].by).toBe("agent");
  });

  it("does not record report output", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    await host.harness.behavior.callAgentTool("taskwarrior_run", { args: ["list"] }, ctx);
    expect(await recent(host)).toEqual([]);
  });

  it("never fails the tool call when recording fails", async () => {
    const host = await boot([{ uuid: A, description: "a", status: "pending" }]);
    hosts.push(host);
    // No such ref: resolution finds nothing; the command result is still returned untouched.
    const result = await host.harness.behavior.callAgentTool("taskwarrior_run", { args: ["99", "done"] }, ctx);
    expect(result.content).toBeDefined();
    expect(await recent(host)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agent-recent.test.ts`
Expected: FAIL (recent stays empty).

- [ ] **Step 3: Implement recording in `server.ts`**

Add imports: `import { extractTaskRefs, parseCreatedTaskId } from "./lib/task-refs";`.

Add a helper inside `plugin()`, near `attachBlockedBy`:

```ts
  async function resolveUuids(refs: string[]): Promise<string[]> {
    if (refs.length === 0) return [];
    return (await exportTasks(refs)).map((task) => task.uuid);
  }
```

Replace the tool's `execute`:

```ts
    async execute({ args }, ctx) {
      // Resolve refs to UUIDs first: integer IDs are invalid once a task is
      // completed or deleted, and we only ever store UUIDs.
      let touched: string[] = [];
      try {
        touched = await resolveUuids(extractTaskRefs(args));
      } catch (error) {
        bb.log.warn(`recent: could not resolve refs: ${String(error)}`);
      }

      const result = await runTask(args);

      try {
        if (result.exitCode === 0 && args[0] === "add") {
          const created = parseCreatedTaskId(result.stdout);
          if (created !== null) touched = touched.concat(await resolveUuids([created]));
        }
        if (result.exitCode === 0 && touched.length > 0) {
          for (const uuid of touched) await threads.recordView(ctx.threadId, uuid, "agent");
          bb.realtime.publish(TASKS_CHANGED, { reason: "agent" });
        }
      } catch (error) {
        bb.log.warn(`recent: could not record agent touches: ${String(error)}`);
      }

      const text = [result.stdout, result.stderr].filter(Boolean).join("\n");
      return {
        content: [{ type: "text", text: text || "(no output)" }],
        isError: result.exitCode !== 0,
      };
    },
```
(Only mutating commands reach the record step meaningfully: read-only commands such as `["12", "info"]` also name a ref and will record it, which is acceptable: the agent looked at that task.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server.ts test/agent-recent.test.ts
git commit -m "agent-recent: feed Recent from taskwarrior_run, best-effort"
```

---

### palette-rows

**Files:**
- Create: `lib/palette-actions.ts`, `test/palette-actions.test.ts`
- Modify: `app.tsx`, `components/thread-panel/thread-panel.tsx`, `test/thread-panel.test.tsx`

**Interfaces:**
- Consumes: `PluginCommandPaletteActionContext` shape (`threadId: string | null`, `projectId: string | null`, `openPanel({ actionId, title?, params? }): boolean`); nav fallback `toPluginPanel`.
- Produces from `lib/palette-actions.ts`:
  - `PALETTE_PANEL_ACTION_ID = "tasks"` (matches the `threadPanelAction` id).
  - `interface PaletteContext { threadId: string | null; projectId: string | null; openPanel(o: { actionId: string; title?: string; params?: unknown }): boolean }`
  - `paletteActions(): { id: string; title: string; isAvailable?(c: PaletteContext): boolean; run(c: PaletteContext): void }[]` returning `find`, `add`, `pin`, `open` rows in that order.
  - Behavior: `find` opens the panel with `params: { query: "" }`; `add` opens with `params: { mode: "add" }`; `pin` opens with `params: { mode: "pin" }` and is available only when `threadId != null`; `open` opens with no params and is available only when `threadId != null`. If `openPanel` returns false, the row falls back to navigating to the nav page via an injected `navigate` (see below).
- `ThreadPanelParams` gains `mode?: "pin" | "add"`.

The registered `run(context)` cannot call `useBbNavigate` (no hooks in `run`). The fallback navigates by opening the plugin's nav panel URL, so `paletteActions(navigateToNavPanel)` takes a `navigateToNavPanel: () => void` argument supplied at registration.

- [ ] **Step 1: Write the failing tests**

`test/palette-actions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { paletteActions, type PaletteContext } from "../lib/palette-actions";

function ctx(over: Partial<PaletteContext> = {}): PaletteContext {
  return { threadId: "t1", projectId: "p1", openPanel: vi.fn(() => true), ...over };
}
const byId = (id: string, navigate = () => {}) =>
  paletteActions(navigate).find((row) => row.id === id)!;

describe("palette rows", () => {
  it("lists find, add, pin, open in order", () => {
    expect(paletteActions(() => {}).map((r) => r.id)).toEqual(["find", "add", "pin", "open"]);
  });

  it("find opens the panel with an empty query", () => {
    const c = ctx();
    byId("find").run(c);
    expect(c.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: "tasks", params: { query: "" } }),
    );
  });

  it("add opens the panel in add mode", () => {
    const c = ctx();
    byId("add").run(c);
    expect(c.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: "tasks", params: { mode: "add" } }),
    );
  });

  it("pin and open need a thread", () => {
    expect(byId("pin").isAvailable?.(ctx({ threadId: null }))).toBe(false);
    expect(byId("pin").isAvailable?.(ctx())).toBe(true);
    expect(byId("open").isAvailable?.(ctx({ threadId: null }))).toBe(false);
    expect(byId("open").isAvailable?.(ctx())).toBe(true);
  });

  it("find and add are always available", () => {
    expect(byId("find").isAvailable?.(ctx({ threadId: null })) ?? true).toBe(true);
    expect(byId("add").isAvailable?.(ctx({ threadId: null })) ?? true).toBe(true);
  });

  it("falls back to the nav page when there is no side panel", () => {
    const navigate = vi.fn();
    const c = ctx({ openPanel: vi.fn(() => false) });
    byId("find", navigate).run(c);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
```

Add to `test/thread-panel.test.tsx`:

```tsx
describe("ThreadPanel modes", () => {
  it("pin mode shows search results with a Pin action", async () => {
    const view = panel(
      {
        thread_get: () => ({ state: { pins: [], recent: [], searches: [] } }),
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
      {
        thread_get: () => ({ state: { pins: [], recent: [], searches: [] } }),
        tasks_add: () => ({ task: task(A, "New") }),
      },
      { mode: "add" },
    );
    const input = await view.findByLabelText("New task description");
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(view.inspection.rpcCalls.find((c) => c.method === "tasks_add")?.input).toEqual({
        description: "New",
      }),
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/palette-actions.test.ts test/thread-panel.test.tsx`
Expected: FAIL (module missing; modes unimplemented).

- [ ] **Step 3: Implement `lib/palette-actions.ts`**

```ts
// Palette rows as plain functions so they are testable without the host.
// Rows are static: the palette cannot list tasks, so "find" is a launcher
// that opens the panel with the search box focused.
export const PALETTE_PANEL_ACTION_ID = "tasks";

export interface PaletteContext {
  threadId: string | null;
  projectId: string | null;
  openPanel(options: { actionId: string; title?: string; params?: unknown }): boolean;
}

export interface PaletteRow {
  id: string;
  title: string;
  isAvailable?(context: PaletteContext): boolean;
  run(context: PaletteContext): void;
}

export function paletteActions(navigateToNavPanel: () => void): PaletteRow[] {
  const open = (context: PaletteContext, params?: unknown) => {
    const opened = context.openPanel({
      actionId: PALETTE_PANEL_ACTION_ID,
      title: "Tasks",
      params,
    });
    if (!opened) navigateToNavPanel();
  };
  const needsThread = (context: PaletteContext) => context.threadId !== null;
  return [
    { id: "find", title: "Tasks: find…", run: (c) => open(c, { query: "" }) },
    { id: "add", title: "Tasks: add…", run: (c) => open(c, { mode: "add" }) },
    { id: "pin", title: "Tasks: pin to this thread", isAvailable: needsThread, run: (c) => open(c, { mode: "pin" }) },
    { id: "open", title: "Tasks: open this thread's tasks", isAvailable: needsThread, run: (c) => open(c) },
  ];
}
```

- [ ] **Step 4: Register the rows in `app.tsx`**

The nav fallback needs a way to reach the nav page from a non-hook callback. Use a full navigation to the plugin route documented in the SDK (`/plugins/<pluginId>/<path>`), computed from the plugin id:

```tsx
import { paletteActions } from "./lib/palette-actions";
```

Inside `definePluginApp`:

```tsx
  for (const row of paletteActions(() => {
    window.location.hash = "";
    window.location.assign("/plugins/taskwarrior/tasks");
  })) {
    app.slots.commandPaletteAction(row);
  }
```
Verify the real plugin id and route in a running bb instance (the nav panel's URL when open). If `window.location.assign` full-reloads the SPA and that is jarring, prefer registering `useBbNavigate` access through a module-level ref set from a small always-mounted component; do that only if the reload is a problem in practice. Keep the simple version first.

- [ ] **Step 5: Add modes to `ThreadPanel`**

In `thread-panel.tsx`:
- Extend `ThreadPanelParams` with `mode?: "pin" | "add"`.
- `mode === "pin"`: initialize so that `SearchResults` renders even with an empty query (pass an `alwaysShowResults` boolean, or treat `mode === "pin"` as "searching"); pin actions already exist on `SearchResults` rows.
- `mode === "add"`: render at the top a `<form>` with `<Input aria-label="New task description" />` and a submit `Button`. On submit, call `tasks_add({ description })`, clear the input, and `toast.success("Task added")`. If the bb project maps to a Taskwarrior project (`ProjectSection` state is not available here), skip auto-assigning a project in v1.

- [ ] **Step 6: Run to verify it passes**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add lib/palette-actions.ts app.tsx components/thread-panel test
git commit -m "palette-rows: find, add, pin, and open commands"
```

---

### spec-sync

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-thread-panel-design.md`, `README.md`, `PLUGIN_OVERVIEW.md`, `skills/taskwarrior/SKILL.md`

- [ ] **Step 1: Update the spec**

Apply the "Deviations from the spec" list from this plan to the spec: Section 5 (TaskList/TaskRow page-only; shared formatters + TaskDetail + `CompactTaskRow` for the panel), Section 3 (pin lives in panel and palette pin-picker, not the full page; up/down reorder in v1), Section 6 (tooltip pulls in overlay-trigger; drag handle deferred), and Build order (add `thread-panel-recent`; rename to match this plan's slugs: `test-harness`, `core-extraction`, `thread-state-model`, `task-refs`, `project-link-model`, `thread-store`, `rpc-wiring`, `thread-panel-pins`, `thread-panel-recent`, `project-mapping`, `agent-recent`, `palette-rows`).

- [ ] **Step 2: Update user-facing docs**

- `README.md` and `PLUGIN_OVERVIEW.md`: describe the thread "Tasks" tab (pinned, project, recent), project name-matching with the mismatch warning, agent-touched tasks showing in Recent, and the four palette rows. `PLUGIN_OVERVIEW.md` still describes the old "Example todos" page; rewrite it to match the plugin as it is.
- `skills/taskwarrior/SKILL.md`: add one line telling agents that tasks they touch via `taskwarrior_run` show up in the thread's Tasks tab, so they should name tasks by ID or UUID in the command rather than relying on listings.

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests pass. Then in a running bb: open a thread, open the Tasks tab, pin a task, run an agent `taskwarrior_run` completing a task and confirm it appears in Recent with an "agent" badge, open the palette (Mod+Shift+P) and try each row.

- [ ] **Step 4: Commit**

```bash
git add docs README.md PLUGIN_OVERVIEW.md skills
git commit -m "spec-sync: document shipped behavior and reconcile spec with plan"
```

---

## Self-Review

**Spec coverage:**
- Section 1 (thread/project state, RPC): `thread-state-model`, `thread-store`, `rpc-wiring`.
- Section 2 (project mapping, warning states): `project-link-model`, `rpc-wiring` (`project_status`, `tw_projects_list`), `project-mapping`.
- Section 3 (panel: Pinned/Project/Recent, search, detail, `params.query`): `thread-panel-pins`, `thread-panel-recent`, `project-mapping`.
- Section 3b (agent-fed Recent, resolve-before-run, best-effort, realtime, badge): `task-refs`, `agent-recent`, badge in `thread-panel-recent`.
- Section 4 (palette rows): `palette-rows`.
- Section 5 (shared core): `core-extraction` (with the narrowed scope in Deviations).
- Section 6 (`components/ui`): `tooltip` and coarse-pointer sizing are both used in `CompactTaskRow`'s `IconAction` (`COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS`, pure CSS, no hook needed).
- Overlay: explicitly deferred, no task.

**Placeholder scan:** no TBD/TODO. Two steps say "verify in a running bb" or "adjust if the harness differs" (`setSettings` shape, palette nav fallback route, native select fallback): these are conditional adaptations to SDK behavior I could not fully verify offline, each with a concrete fallback stated.

**Type consistency:** `ThreadState`, `threadStateSchema`, `THREAD_STATE_CHANGED` defined in `thread-state-model`; `createThreadStore` methods (`get/pin/unpin/reorder/recordView/recordSearch/getProjectLink/setProjectLink`) match their use in `rpc-wiring` and `agent-recent`; RPC method names match between `contract.ts`, `server.ts`, hooks, and tests; `CompactTaskRow` props are identical across `pinned-section`, `recent-section`, `search-results`, and `project-section`; `PALETTE_PANEL_ACTION_ID` equals the `threadPanelAction` id `"tasks"`.
