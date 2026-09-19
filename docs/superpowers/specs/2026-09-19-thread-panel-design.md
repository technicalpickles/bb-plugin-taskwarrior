# Thread panel, thread state, and palette rows

Status: draft, awaiting review. Date: 2026-09-19.

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
- RPC: `getThreadState`, `pin`, `unpin`, `reorderPins`, `recordView`,
  `recordSearch`, `getProjectLink`, `setProjectLink`, `listTwProjects`.
- Taskwarrior stays the source of truth for task content. Plugin storage holds
  only UI state.
- A pinned UUID that is no longer pending (done/deleted) renders struck through
  with a "clear" action. It is never dropped silently.

## Section 2: project mapping

- Effective Taskwarrior project = `projects/<projectId>.twProject` if set,
  else the bb project's name (from `experimental_useSidebarThreads().projects`).
- The implicit personal project (`isPersonal`) has no default; the Project
  section shows the picker only.
- The mapping is edited inline in the panel's Project section, not in Settings.
- Warning states (checked against `task projects`):
  - **No Taskwarrior project with that name exists:** warning banner, "No
    Taskwarrior project named `X`. Name mismatch, or nothing created yet?" with
    a picker (existing Taskwarrior projects, pre-selected by closest name) and
    an "Add a task" button that pre-fills `project:X`.
  - **Project exists, nothing pending:** neutral "All clear", not a warning.
  - **Project exists with pending tasks:** the list.

## Section 3: the thread panel

One `threadPanelAction` ("Tasks"), `layout: "flush"`, with a search box on top
and three stacked sections:

1. **Pinned**: reorderable, inline complete, click for detail.
2. **Project**: open tasks for the effective Taskwarrior project, collapsed by
   default; hosts the Section 2 warning/picker.
3. **Recent**: viewed tasks and past searches; one click re-opens or re-runs.

- Search reuses the existing list filters. Detail view opens inside the panel.
- Views and searches are recorded automatically (no save step).
- Pin/unpin is a button on any task row, in the panel or on the full page.
- `params` may carry `{ query }` so a palette launch lands with search focused.

## Section 3b: agent-fed Recent

`taskwarrior_run`'s `execute(params, ctx)` receives `ctx.threadId`, so the
server can attribute agent calls to a thread and append to that thread's
`recent` with `by: "agent"`.

- **What counts:** tasks the agent explicitly touched, meaning integer IDs or
  UUIDs named in `args` (`["12", "done"]`, `["modify", "<uuid>", ...]`), plus
  the task created by `add` (parsed from `Created task N.`). Report output
  (`list`, `export`) does not count; a listing would flood Recent with noise.
- **Resolve before running:** integer IDs become invalid after `done`/`delete`,
  so resolve refs to UUIDs (`task <refs> _uuids`) *before* executing, and
  resolve `add`'s new ID *after*. Store UUIDs only.
- **Never fail the tool call:** the recording is best-effort, wrapped in
  try/catch and logged. A storage error must not turn a successful `task`
  command into an error for the agent.
- **Live:** publish on a realtime channel so an open panel updates as the agent
  works. The panel subscribes with `useRealtime`.
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

`openPanel` returns false on surfaces without a side panel; fall back to
`toPluginPanel("tasks")`.

## Section 5: shared core (refactor)

`app.tsx` is 1100 lines. Extract task list, row, and detail into components
taking a `scope` prop (`all` for the page; pins/project/recent for the panel).
This is a prerequisite for the panel, not a separate cleanup.

## Section 6: `components/ui` audit

Already used by `app.tsx`: `Button`, `Card`, `Badge`, `Pill`, `Input`,
`Switch`, `Icon`, `EmptyState`, `Collapsible`, `DropdownMenu`, `Select`, plus
`sonner` toasts. Vendored but currently unused:

| Component | Use it for | Verdict |
|---|---|---|
| `tooltip` | Icon-only pin / unpin / complete buttons in dense panel rows | **Use.** The panel is icon-heavy and narrow. |
| `use-pointer-coarse`, `coarse-pointer-sizing` | Touch-sized hit targets; the bb UI is used remotely, possibly on touch | **Use** on row action buttons. |
| `motion` | Pin reorder / row enter-exit | Use lightly, only if reorder feels janky. |
| `responsive-overlay` (823 lines) | Dialog on desktop, drawer on compact, for the pin-picker | **Defer.** Heavy. Start with a plain `DropdownMenu`/inline picker; adopt only if the picker needs a real modal. |
| `use-compact-viewport`, `use-media-query` | Viewport breakpoints | **Don't use for the panel.** Panel width is not viewport width (side panel is narrow on a wide screen). Use Tailwind container queries (`@container`) instead. |
| `menu-item-hover`, `overlay-trigger` | Internals for overlay/menu polish | Skip unless a component needs them. |

Gaps the panel needs that nothing vendored covers: a compact row with a drag
handle for reordering pins (build it; no vendored primitive), and a small
"search + select" for the project picker (`Select` is enough; upgrade only if
the Taskwarrior project list gets long).

## Build order

1. `core-extraction`: extract shared components, no behavior change.
2. `thread-state`: storage + RPC for pins/recent/searches.
3. `thread-panel-pins`: panel tab with search and Pinned.
4. `project-mapping`: Project section, default-by-name, warning/picker.
5. `agent-recent`: feed Recent from `taskwarrior_run` (Section 3b).
6. `palette-rows`: the four commands.
7. Deferred: `global-overlay`.

## Open questions

None outstanding.
