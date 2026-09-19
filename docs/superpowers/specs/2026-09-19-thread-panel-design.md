# Thread panel, thread state, and palette rows

Status: implemented (see Unverified notes). Date: 2026-09-19.

## Goal

Taskwarrior is currently one full-page `navPanel`. Add persistent, thread-local
task surfaces so tasks sit beside the work:

- A **thread panel tab** with pinned tasks, project tasks, and recent
  views/searches.
- **Command palette rows** for finding, adding, pinning, and opening tasks.
- A shared task-view core so the page and panel don't duplicate UI.

Out of scope for this spec: a global always-on overlay (`experimental_appOverlay`).
Deferred until the panel shows what is actually wanted there.

## Constraints from the SDK

- `threadPanelAction` components receive `threadId` and persisted `params`;
  the tab restores across reloads. `useBbContext()` supplies `projectId`.
- Command palette rows are static (title + `run`, registered at startup). They
  cannot list tasks as rows. "Find" is a launcher that opens a panel with the
  search box focused.
- Plugin settings are global only; there is no project-scoped settings surface.
  Per-project state lives in plugin storage, edited inline.
- No slot docks a persistent panel into the main sidebar.

## Section 1: thread and project state (server)

Plugin storage, referencing tasks by **UUID only** (integer IDs are reused):

```
threads/<threadId>   = { pins: uuid[], recent: [{uuid, at, by: "user"|"agent"}], searches: [{query, at}] }
projects/<projectId> = { twProject: string | null }   // null/absent = use default
```

- `recent` capped at ~20, `searches` at ~10.
- RPC (as built, in `contract.ts`): `thread_get`, `thread_pin`, `thread_unpin`,
  `thread_reorder_pins`, `thread_record_view`, `thread_record_search`,
  `project_link_get`, `project_link_set`, `project_status`, `tw_projects_list`.
  Changes publish `THREAD_STATE_CHANGED` (`{ threadId }`).
- Taskwarrior stays the source of truth for task content. Plugin storage holds
  only UI state.
- A pinned UUID that is no longer pending (done/deleted) renders struck through
  with a "clear" action. It is never dropped silently. Finished tasks export
  `id: 0`, so `CompactTaskRow` only opens tasks with `id > 0`; finished pins
  are shown but not openable.

## Section 2: project mapping

- Effective Taskwarrior project = `projects/<projectId>.twProject` if set,
  else the bb project's name (from `experimental_useSidebarThreads().projects`).
- Matching is exact-or-dotted-prefix (`belongsToProject` in
  `lib/project-link.ts`): a task belongs to `home` if its project is `home` or
  `home.something`. Taskwarrior's own `project:X` filter is a plain PREFIX
  match (verified on task 3.4.2: `project:home` also matches `homework`), so
  `project_status` on the server and the panel's project list both re-filter
  with `belongsToProject`.
- The implicit personal project (`isPersonal`) has no default; the Project
  section shows the picker only.
- The mapping is edited inline in the panel's Project section, not in Settings.
- Warning states (checked against `task projects`):
  - **No Taskwarrior project with that name exists:** warning banner, "No
    Taskwarrior project named `X`. Name mismatch, or nothing created yet?" with
    a picker (existing Taskwarrior projects, the closest name marked
    "(suggested)") and an "Add a task" button that creates the task and then
    sets its project to `X`. The picker is a native `<select>` with no
    preselection, since a native select cannot act on a preselected option.
  - **Project exists, nothing pending:** neutral "All clear", not a warning.
  - **Project exists with pending tasks:** the list.
- No UI clears an override yet; `project_link_set` accepts `null`, but nothing
  in the panel sends it.

## Section 3: the thread panel

One `threadPanelAction` ("Tasks"), `layout: "flush"`, with a search box on top
and three stacked sections. Every section is gated on `thread.state !== null &&
tasks !== null`; `useTasksByUuid` returns `Map | null` (null until every
current uuid has been fetched), so a pin never flashes as "no longer exists":

1. **Pinned**: reorderable, inline complete, click for detail.
2. **Project**: open tasks for the effective Taskwarrior project, collapsed by
   default; hosts the Section 2 warning/picker.
3. **Recent**: viewed tasks and past searches; one click re-opens or re-runs.

- Search reuses the existing list filters. Detail view opens inside the panel.
- Views and searches are recorded automatically (no save step).
- Pin/unpin lives in the panel (rows, the detail flow, search results) and in
  the palette's pin-picker mode. The full page has no "current thread", so it
  has no pin button.
- Pinned rows reorder with up/down buttons in v1. Drag-and-drop is deferred.
- `params` may carry `{ query }` (search box autofocuses when present) or
  `{ mode: "add" | "pin" }` (add form on top, or search results as a pin
  picker).
- Add-task failure handling is shared by the Project section and the panel's
  add mode via the `useAddTask` hook.

## Section 3b: agent-fed Recent

`taskwarrior_run`'s `execute(params, ctx)` receives `ctx.threadId`, so the
server can attribute agent calls to a thread and append to that thread's
`recent` with `by: "agent"`.

- **What counts:** tasks the agent explicitly touched, meaning integer IDs or
  UUIDs named in `args` (`["12", "done"]`, `["modify", "<uuid>", ...]`), plus
  the task created by `add` (parsed from `Created task N.`). Report output
  (`list`, `export`) does not count; a listing would flood Recent with noise.
  Read-only commands that name a ref (e.g. `info 12`) also record it.
- **Resolve before running:** integer IDs become invalid after `done`/`delete`,
  so resolve refs to UUIDs (`task <refs> _uuids`) *before* executing, and
  resolve `add`'s new ID *after*. Store UUIDs only.
- **Never fail the tool call:** the recording is best-effort, wrapped in
  try/catch and logged. A storage error must not turn a successful `task`
  command into an error for the agent.
- **Live:** publish `TASKS_CHANGED` (`reason: "agent"`) so an open panel
  updates as the agent works. The panel subscribes with `useRealtime`.
- **UI:** rows in Recent carry a small "agent" / "you" marker so you can see
  what the agent has been touching.

## Section 4: palette rows

Registered with `commandPaletteAction`:

| Row | Behavior | `isAvailable` |
|---|---|---|
| Tasks: find… | opens panel with `{query: ""}` focused; on surfaces with no panel, navigates to the nav page | always |
| Tasks: add… | opens add flow (panel, or nav page fallback) | always |
| Tasks: pin to this thread | opens panel in pin-picker mode | `threadId != null` |
| Tasks: open this thread's tasks | opens/focuses the panel tab | `threadId != null` |

`openPanel` returns false on surfaces without a side panel; the fallback
navigates to the nav page.

As built: rows are pure functions in `lib/palette-actions.ts`
(`paletteActions(navigateToNavPanel)`). `find` opens the panel with
`{ query: "" }` (search autofocuses); `add` and `pin` open it with
`{ mode: "add" }` / `{ mode: "pin" }`; `open` opens it bare.

**Unverified:** the fallback route is a single constant, `NAV_PANEL_ROUTE`
(`/plugins/taskwarrior/tasks`) in `app.tsx`. It is inferred from the SDK's
`PluginNavPanelProps` route shape and the plugin id, NOT verified against a
running bb. Fix the constant if the route differs. The manual pass (open the
Tasks tab, pin, run an agent `taskwarrior_run` and check the "agent" badge,
try each palette row) is also outstanding.

## Section 5: shared core (refactor)

`app.tsx` was 1100 lines and is now registrations only. What is shared and
what is not:

- Shared: formatters (`lib/task-format.ts`), the sort/filter/group model
  (`lib/task-list-model.ts`), and `TaskDetail({ id, onOpenTask, onClose })`
  (`components/tasks/task-detail.tsx`).
- Page-only: `TaskList` / `TaskRow`. They are coupled to select-mode, bulk
  actions, and `toPluginPanel`, so they did not move into a `scope`-taking
  component.
- Panel-only: `CompactTaskRow` (`components/thread-panel/`), used by the
  Pinned, Project, Recent, and search sections.

## Section 6: `components/ui` audit

Already used by `app.tsx`: `Button`, `Card`, `Badge`, `Pill`, `Input`,
`Switch`, `Icon`, `EmptyState`, `Collapsible`, `DropdownMenu`, `Select`, plus
`sonner` toasts. Vendored but currently unused:

| Component | Use it for | Verdict |
|---|---|---|
| `tooltip` | Icon-only pin / unpin / complete buttons in dense panel rows | **Used** in `CompactTaskRow`. Pulls in `overlay-trigger` transitively. |
| `coarse-pointer-sizing` | Touch-sized hit targets; the bb UI is used remotely, possibly on touch | **Used** on row action buttons (pure CSS class, no hook needed). |
| `motion` | Pin reorder / row enter-exit | Use lightly, only if reorder feels janky. |
| `responsive-overlay` (823 lines) | Dialog on desktop, drawer on compact, for the pin-picker | **Not adopted.** The pin-picker is the panel's search results. |
| `use-compact-viewport`, `use-media-query` | Viewport breakpoints | **Not adopted.** Panel width is not viewport width. The panel uses Tailwind container queries (`@container`). |
| `menu-item-hover` | Internals for overlay/menu polish | Skip unless a component needs it. |
| `overlay-trigger` | Internal to `tooltip` | Present only because `tooltip` imports it. |

Gaps the panel needed that nothing vendored covers: a compact row (built as
`CompactTaskRow`, with up/down buttons for reordering; a drag handle is
deferred) and a project picker (a native `<select>`).

## Build order

Slugs match the implementation plan:

1. `test-harness`: vitest config and a fake `task` binary.
2. `core-extraction`: shared formatters, list model, `TaskDetail`; no behavior change.
3. `thread-state-model`: pure thread-state transitions and schemas.
4. `task-refs`: extract refs from `task` argv, parse `Created task N.`.
5. `project-link-model`: effective project, health, closest-name match.
6. `thread-store`: KV-backed, per-key-serialized store.
7. `rpc-wiring`: contract and server RPC methods.
8. `thread-panel-pins`: panel tab with search and Pinned.
9. `thread-panel-recent`: the Recent section UI.
10. `project-mapping`: Project section, default-by-name, warning/picker.
11. `agent-recent`: feed Recent from `taskwarrior_run` (Section 3b).
12. `palette-rows`: the four commands.
13. `spec-sync`: this document and the user-facing docs.
14. Deferred: `global-overlay`.

## Open questions

None outstanding.
