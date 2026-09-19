Browse and manage your Taskwarrior tasks from BB, and keep the ones that matter next to the thread you're working in.

## What you get

- A **Taskwarrior** page in the left sidebar: list, sort, filter, group, edit, complete, and delete tasks.
- A **Tasks** tab in every thread with three sections: **Pinned** (your ordered shortlist for this thread), **Project** (open tasks for the matching Taskwarrior project), and **Recent** (tasks you opened or the agent touched, plus past searches).
- Command palette rows: **Tasks: find…**, **Tasks: add…**, **Tasks: pin to this thread**, and **Tasks: open this thread's tasks**.
- A `bb tw` command that forwards straight to the `task` CLI.

## Projects

The Project section looks for a Taskwarrior project with the same name as the BB project. No match shows a warning with a picker (closest name suggested), so you can link the right one.

## For agents

The `taskwarrior_run` tool runs `task` with any arguments. Tasks an agent names by id or uuid, or creates with `add`, show up in the thread's Recent list with an **agent** badge.

Everything runs against your local Taskwarrior data. No account or external service.
