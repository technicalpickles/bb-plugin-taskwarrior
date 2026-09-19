# bb-plugin-taskwarrior

A BB plugin for [Taskwarrior](https://taskwarrior.org). It runs your local `task` CLI and puts your tasks in a few places:

- **Taskwarrior page** (sidebar, `app.slots.navPanel`): browse, sort, filter, group, edit, complete, and delete tasks.
- **Tasks thread tab** (`app.slots.threadPanelAction`): thread-local views of your tasks.
  - **Pinned**: tasks you pinned to this thread, reorderable with up/down buttons. Finished pins show struck through and can be cleared.
  - **Project**: open tasks for the effective Taskwarrior project, collapsed by default.
  - **Recent**: tasks viewed in this thread and past searches, each marked "you" or "agent".
  - A search box on top. Enter records the search.
- **Command palette rows**: `Tasks: find…` (opens the tab with search focused), `Tasks: add…`, `Tasks: pin to this thread`, and `Tasks: open this thread's tasks`. The last two need a thread.
- **`bb tw <args...>`**: forwards to `task`, so any filter, report, or command works.
- **`taskwarrior_run` agent tool**: same argv as `task`. The bundled skill (`skills/taskwarrior/SKILL.md`) documents it.

## Project matching

The Project section uses the BB project's name as the Taskwarrior project, unless you linked a different one. A task matches if its project is that name or a dotted child (`home` matches `home.chores`, not `homework`). The implicit personal project has no default, so it shows the picker only.

If no Taskwarrior project has that name, the section shows a warning with a picker (closest name marked "(suggested)") and an "Add a task" button. If the project exists but nothing is pending, it says "All clear".

## Agent-touched tasks

When an agent runs `taskwarrior_run`, tasks it names by id or uuid, plus any task it creates with `add`, land in that thread's Recent with an "agent" badge and the tab updates live. Report output (`list`, `export`) does not count. Recording is best-effort and never fails the command.

## State

Thread state (pins, recent, searches) and project links live in plugin storage (`threads/<threadId>`, `projects/<projectId>`), keyed by task uuid. Taskwarrior stays the source of truth for task content. Recent is capped at 20 entries, searches at 10.

## Layout

- `server.ts`: `task` runner, RPC methods, `bb tw`, `taskwarrior_run`, realtime signals.
- `contract.ts`: shared RPC contract and schemas (browser-safe).
- `app.tsx`: slot registrations.
- `components/tasks/`: the page (`TaskList`, `TaskDetail`).
- `components/thread-panel/`: the thread tab.
- `lib/`: pure models (thread state, project link, task refs, palette rows, formatters).
- `PLUGIN_OVERVIEW.md`: the store listing text. See [Store listing](#store-listing).
- Design notes: `docs/superpowers/specs/2026-09-19-thread-panel-design.md`.

Develop with `npm test` and `npm run typecheck`.

## UI components

`components/ui/` is vendored source you own (the shadcn model): edit the
files freely — they never update out from under you. Add more from the BB
component registry (the full shadcn set, version-matched to your BB install
via the pinned ref in `components.json`):

```
npx shadcn add @bb/select @bb/table
```

Run `npm install` once before `bb plugin build` — the vendored components'
npm deps bundle into your dist. React, and BB-shimmed packages like the
radix portal primitives and `sonner` (`import { toast } from "sonner"`
reaches BB's own toaster), are provided by the BB app at runtime and never
bundled. Every shimmed package is declared in `devDependencies` at the
host's version so those imports typecheck; keep them there (never in
`dependencies`, which would bundle a second copy), and `bb plugin types`
repins them alongside the SDK. Ship `dist/` (npm tarball or committed for
git installs) so people installing your plugin never need npm.

## Manifest

`package.json` is the plugin manifest. Notable fields:

- `bb.server` — backend entry (required).
- `bb.app` — frontend entry. Delete it, `app.tsx`, `components/`,
  `hooks/`, and `lib/` for a headless plugin.
- `bb.skills` — skill roots; omitted here, so BB reads `skills/`. Each
  directory with a `SKILL.md` is one skill, named after the directory.
- `bb.name` and `bb.description` — required human-facing identity.
- `bb.branding` — required; declare `icon` as a BB icon name or a
  plugin-relative compact SVG, or declare `logo.light` (with optional
  `logo.dark`). Logo assets must be relative `.svg`, `.png`, or
  `.webp` files.
- `engines.bb` — supported bb app version range.
- `engines.bbPluginSdk` — the lowest plugin SDK you need (scaffold:
  `>=0.4.87`). BB reads this as a floor, not a ceiling: a later
  SDK in the same major still loads your plugin.
- `dependencies` — every package your source imports that BB does not provide.
  `bb plugin build` inlines them into `dist/`, and git installs resolve this
  list alone, so a build-required package here rather than in
  `devDependencies` is what keeps your plugin installable. `devDependencies`
  is for types and tooling only (BB shims React, the portal primitives, and
  `@get-bb/plugin-sdk` at runtime — never bundle them).

Run `bb plugin build` before publishing git/npm installs. It writes
`dist/server.js` + `server.meta.json` and `app.js` / `app.css` /
`app.meta.json`. Each `*.meta.json` stamps SDK major/version,
`artifactFormatVersion`, `pluginId`, `pluginVersion`, and
`builtWith` so managed installs can verify the artifacts.

## Store listing

Two texts describe the plugin in the store. `bb.description` in package.json
is the one-sentence hook on every browse card and the lead paragraph on the
detail page; keep it under about 140 characters. `PLUGIN_OVERVIEW.md` is the
same claim at length, shown in an Overview section under that paragraph.
Rewrite the scaffold's copy for your plugin, and update it whenever
`bb.description` changes, so the two never disagree.

The submission to the public BB Community marketplace requires the file. Keep
it under 4000 characters (aim for 700 to 1800) and use headings, paragraphs,
emphasis, code, blockquotes, lists, thematic breaks, and absolute https links
only — raw HTML, images, tables, footnotes, and task lists are rejected. Do
not open with a `#` title or repeat `bb.description` verbatim; the page
shows both directly above.

## Install

From this directory (`bb plugin new` already ran the install; a fresh clone
needs it):

```
npm install
bb plugin install .
```

After editing sources, reload:

```
bb plugin reload taskwarrior
```

Or let `bb plugin dev` rebuild and reload on every save.

## Configure

```
bb plugin config taskwarrior
bb plugin config taskwarrior set showDone false
bb plugin reload taskwarrior
```

## Types & API reference

The plugin API ships as the npm package `@get-bb/plugin-sdk`, pinned to an
exact version in `devDependencies` (`0.4.87` — the SDK of the BB
that scaffolded this plugin). After `npm install`, the full surface is on disk
at:

```
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts      # backend
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts  # frontend
```

Your editor and `tsc` resolve `@get-bb/plugin-sdk` there through ordinary node
resolution — no path mapping. These are readable declarations: open them for an
exact signature.

The SDK surface grows with every BB release, so the pin has to track the BB you
actually run:

```
bb plugin types          # sync this plugin's SDK surface to the running BB
bb plugin types --check  # CI: fail when it does not match
```

Ask BB to write plugins for you: the `bb-plugin-authoring` skill documents
the whole surface with examples.

Confused by the API, or need something the types don't explain? Clone the BB
repo and read the source: <https://github.com/get-bb/bb>.
