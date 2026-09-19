---
name: taskwarrior
description: Query and manage the user's Taskwarrior tasks via `bb tw` or the taskwarrior_run tool
---

# Taskwarrior plugin

This plugin proxies the local `task` CLI. It does not add its own command
grammar — anything you'd type after `task` on the command line works
unchanged, including filters, reports, and bulk operations.

## Usage

- Shell / CLI: `bb tw <taskwarrior args...>`
- Agent tool: `taskwarrior_run({ args: [...] })` — same argv, one token per
  array element, no shell quoting.

Examples:

```
bb tw list
bb tw +work ls
bb tw add Buy milk project:home due:tomorrow
bb tw 12 done
bb tw 12 modify priority:H
bb tw export project:home
```

## Notes

- Runs on the bb server's machine, against whatever Taskwarrior data lives
  there (`~/.taskrc` / `~/.task` by default, or the plugin's `taskrc`/
  `taskdata` settings if configured). There is no remote-host support: if bb
  runs somewhere other than where the user's tasks live, this plugin can't
  reach them.
- Every call runs with `rc.confirmation=no rc.recurrence.confirmation=no
  rc.bulk=0 rc.color=off` so it never blocks on an interactive y/n prompt.
  Double-check filters before bulk `modify`/`delete` calls since there's no
  confirmation step to catch a too-broad filter.
- Commands time out after 20s.
- Tasks you touch through `taskwarrior_run` show up in the thread's Tasks tab (Recent, with an "agent" badge). Put the id or uuid first in the command (`["12", "done"]`, not `["done", "12"]`) rather than relying on listings; report output like `list` is not recorded.
