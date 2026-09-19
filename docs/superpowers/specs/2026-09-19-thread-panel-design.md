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
- **Uuids are validated at the door.** A stored uuid is replayed into `task`
  argv by every client (`task <pins…> export`), so `thread_pin`,
  `thread_unpin`, `thread_record_view` and every entry of
  `thread_reorder_pins.order` require a uuid shape
  (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`), not
  just `z.string()`. Deliberately NOT `z.uuid()`: that enforces RFC 4122
  version/variant bits Taskwarrior does not, so it would reject real task
  uuids. `thread_reorder_pins.order` caps at 200 entries and
  `thread_record_search.query` at 200 characters.
- A corrupt or legacy `threads/<threadId>` record is parsed with
  `threadStateSchema` and falls back to an empty state, so it cannot wedge
  `thread_get`; the next mutation overwrites it.
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
    sets its project to `X`. The picker is a native `<select>`; an existing
    override is shown as selected, but the suggestion is never preselected,
    since a native select cannot act on a preselected option.
  - **Project exists, nothing pending:** neutral "All clear", not a warning.
  - **Project exists with pending tasks:** the list.
- No UI clears an override yet; `project_link_set` accepts `null`, but nothing
  in the panel sends it.

## Section 3: the thread panel

One `threadPanelAction` ("Tasks"), `layout: "flush"`, with a search box on top
and three stacked sections:

1. **Pinned**: reorderable, inline complete, click for detail.
2. **Project**: open tasks for the effective Taskwarrior project, collapsed by
   default; hosts the Section 2 warning/picker.
3. **Recent**: viewed tasks and past searches; one click re-opens or re-runs.

Gating differs per section, because only two of them read the task map:

- **Pinned** and **Recent** resolve uuids to tasks, so they wait for
  `thread.state !== null && tasks !== null`.
- **Project** never reads the map, so it is gated on `thread.state !== null`
  only. Gating it on the map as well meant that pinning a Project row
  unmounted the section it was pinned from: the map went back to "loading",
  the Collapsible's open state reset to collapsed, and `tw_projects_list`,
  `project_link_get` and `project_status` were all re-issued on remount.
- **Project** additionally needs `projectId !== null` and
  `experimental_useSidebarThreads().status === "ready"`. With no bb project,
  `useProjectLink.setLink` silently returns, so the picker could not save
  anything — the section is omitted entirely. Before the sidebar loads,
  `bbProject` is undefined, the effective project reads as "unlinked", and the
  picker would render and then flip; so nothing renders until ready.

`useTasksByUuid(uuids)` takes `string[] | null` and returns
`{ tasks: Map<string, TaskRecord>, resolved: Set<string> } | null`:

- `null` for `uuids` means "the uuid set is not known yet" — what ThreadPanel
  passes while `thread.state === null`. The hook issues nothing and returns
  `null`.
- The result is `null` only until the first fetch resolves, so a pin never
  flashes as "no longer exists" on first paint. After that it never returns
  `null` again: a refetch keeps the previous map in place, so no section
  blanks out mid-flight.
- A uuid in the current set but not in `resolved` is still in flight and
  renders a lightweight "Loading…" row. A uuid in `resolved` but absent from
  `tasks` is genuinely gone and renders "Task no longer exists" with Clear.
  That is the distinction `resolved` exists for.
- Every refresh — including the `TASKS_CHANGED` one — carries a request
  counter, so a response a newer request superseded is dropped instead of
  overwriting newer data.
- The fetch key sorts a copy of the uuids, so reordering pins does not refetch
  `tasks_list`.

- Search reuses the existing list filters. Detail view opens inside the panel.
- Views and searches are recorded automatically (no save step).
- Pin/unpin lives on the panel's compact rows (Pinned, Project, Recent, and
  search results) and in the palette's pin-picker mode. `TaskDetail` has no
  pin control. The full page has no "current thread", so it has no pin button.
- Pinned rows reorder with up/down buttons in v1. Drag-and-drop is deferred.
- `params` may carry `{ query }` (search box autofocuses when present) or
  `{ mode: "add" | "pin" }` (add form on top, or search results as a pin
  picker). `params.mode` **seeds local component state and is not read again**:
  the panel owns `mode: "normal" | "pin" | "add"`, and in `pin`/`add` mode
  renders a "Done" control at the top that resets it to `normal` — bringing
  Pinned/Project/Recent back and hiding the add form. `params` persist with
  the tab (Section 4), so without Done a `{mode:"pin"}` tab would show search
  results forever and come back as a pin picker after every reload. Add mode
  keeps the form open after a successful add; Done is the way out. Autofocus
  follows `params.query !== undefined || mode === "pin"`.
- Add-task failure handling is shared by the Project section and the panel's
  add mode via the `useAddTask` hook.
- Everything the panel opens or creates lands in Recent: a row click and a
  task created in add mode record by uuid directly; a blocker opened from
  `TaskDetail`'s "Blocked by" links only carries an integer id, so the panel
  resolves its uuid with a `tasks_get` lookup first. All three are
  best-effort and never block navigation.
- Fire-and-forget pin/unpin/reorder are wrapped: a rejection surfaces as a
  "Could not update pins" toast rather than an unhandled promise rejection.

## Section 3b: agent-fed Recent

`taskwarrior_run`'s `execute(params, ctx)` receives `ctx.threadId`, so the
server can attribute agent calls to a thread and append to that thread's
`recent` with `by: "agent"`.

- **What counts:** tasks the agent explicitly touched, meaning integer IDs or
  UUIDs that LEAD the argv (`extractTaskRefs` in `lib/task-refs.ts`), plus
  the task created by `add` (parsed from `Created task N.`). Report output
  (`list`, `export`) does not count; a listing would flood Recent with noise.
  - Recorded: `["12","done"]`, `["12","info"]`, `["<uuid>","modify","priority:H"]`,
    `["1,2","done"]`. Filter tokens (`project:home`, `+tag`) before the refs are
    skipped.
  - Not recorded: `["info","12"]`, `["modify","12",...]` (refs after a bare
    command word), and anything starting with `log`. `add` records only the
    task it creates.
  - There is no read-only exclusion: `["12","info"]` records too.
  - Refs are capped at 50, and nothing is recorded unless `task` exits 0.
- **Resolve before running:** integer IDs become invalid after `done`/`delete`,
  so resolve refs to UUIDs (a `task export` lookup) *before* executing, and
  resolve `add`'s new ID *after*. Store UUIDs only.
- **Never fail the tool call:** the recording is best-effort, wrapped in
  try/catch and logged. A storage error must not turn a successful `task`
  command into an error for the agent.
- **Live:** publish `TASKS_CHANGED` (`reason: "agent"`) so an open panel
  updates as the agent works. The panel subscribes with `useRealtime`.
  Publishing is driven by **whether the command mutates**, not by whether a
  ref was detected — those are different questions, and conflating them left
  the panel stale for every mutation that does not lead with a ref:
  `["project:home","modify","priority:H"]`, `["+urgent","done"]`, `["undo"]`,
  `["sync"]`. The rule: `task` exited 0 **and** argv contains one of
  `add modify done delete start stop annotate denotate append prepend edit
  purge undo import duplicate sync log` as an exact token. A description token
  that happens to equal a command word costs one extra refresh, which is
  cheaper than a stale panel.
- **Publish before recording, and separately:** the publish sits in its own
  try/catch ahead of the recording block, so a KV failure can no longer
  swallow the realtime refresh, and a publish failure can never fail the tool
  call. The recording block does not publish, so one mutation signals once.
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

**Each row uses different `params`, and `params` are part of a tab's
identity.** Per the SDK (`bb-plugin-sdk-app.d.ts`): `params` persist with the
tab and are restored across reloads, opening with params identical to an
already-open tab focuses that tab, and different params open a NEW tab. So the
four rows can produce up to four separate "Tasks" tabs, and a tab opened by
`pin` comes back as a pin picker after a reload. The panel absorbs the second
half of that by seeding `params.mode` into local state with a Done control
(Section 3) rather than reading `params` on every render; the tab
multiplicity itself is left as is and listed under Unverified below —
re-working the palette's tab strategy is out of scope for this pass.

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
| `use-compact-viewport`, `use-media-query` | Viewport breakpoints | **Not adopted.** Panel width is not viewport width. A `@container` class is set on the Project `Collapsible` and on `CompactTaskRow`, but nothing reads it: no `@sm:`/`@md:` variant class exists anywhere in the plugin, so container queries are **declared and inert** today. The marker is there for whenever a row needs width-driven layout; treat it as a placeholder, not a working mechanism. |
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

## Unverified: needs a click-through in a running bb

Everything below is covered by jsdom tests and `tsc` only. There is no browser
and no running bb in the loop that built this, so these are claims about the
host, about real widths, or about pixels — none of which a jsdom test can
settle.

1. **Palette tab multiplicity and restore (Section 4).** The four rows open
   with `{query:""}`, `{mode:"add"}`, `{mode:"pin"}` and no params, so the SDK
   should treat them as four distinct tabs, and a reload should restore each
   with its params. Check: run all four rows and count the "Tasks" tabs; open
   the pin row, reload, confirm the tab comes back in pin mode and that Done
   gets you out.
2. **The nav fallback route.** `NAV_PANEL_ROUTE` (`/plugins/taskwarrior/tasks`)
   in `app.tsx` is inferred from the SDK's `PluginNavPanelProps` route shape
   plus the plugin id. The plugin directory `~/.bb/plugins/taskwarrior` exists
   on the dev machine, which corroborates the `taskwarrior` id but says
   nothing about the route prefix or the trailing segment. Check: trigger a
   palette row on a surface with no side panel and see where it lands. Fix the
   constant if it differs.
3. **The `core-extraction` page click-through.** The full page was refactored
   out of a 1100-line `app.tsx` with no behavior change intended, and nothing
   about that is asserted end-to-end. Walk: list renders, filters, sort,
   group, open detail, back to list, blocker links, edit, complete, delete.
4. **`TaskDetail` at real panel width.** It uses `PageScroll` (max-w 840px),
   built for the full page, inside a `layout: "flush"` panel around 300px
   wide. Also unchecked at that width: tooltip placement/overflow on the
   icon-only row actions, and whether `COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS`
   hit targets are usable rather than merely present.
5. **`useBbContext().projectId` inside a thread panel.** The whole Project
   section rests on this being the *thread's* project. It is what the SDK
   types imply and what the tests stub, but it has never been observed in a
   real thread panel. If it turns out to be the sidebar's selected project
   instead, the Project section is showing the wrong project's tasks.

## Open questions

None outstanding.
