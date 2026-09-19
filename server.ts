// bb-plugin-taskwarrior — a thin, non-interactive bridge to the local
// Taskwarrior (`task`) CLI. It does not reimplement Taskwarrior's query
// language: `bb tw <args...>` and the `taskwarrior_run` agent tool both
// forward argv straight to `task`, so any Taskwarrior filter/report/command
// syntax works exactly as it does on the command line.
//
// `run` executes on the bb SERVER process, so this only works when the
// server and the Taskwarrior data directory are on the same machine (the
// normal single-user desktop setup). There is no remote-host support here.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  PLUGIN_CLI_OUTPUT_MAX_BYTES,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  rpcContract,
  taskRecordSchema,
  TASKS_CHANGED,
  THREAD_STATE_CHANGED,
  type TaskRecord,
} from "./contract";
import { belongsToProject } from "./lib/project-link";
import { createThreadStore } from "./lib/thread-store";

const execFileAsync = promisify(execFile);

// Taskwarrior asks for interactive y/n confirmation on bulk changes,
// deletions, and recurring-task edits. A non-interactive caller can't answer,
// so it would hang until the timeout below kills it. These overrides make
// every invocation behave as if the user always answered "yes".
const NON_INTERACTIVE_OVERRIDES = [
  "rc.confirmation=no",
  "rc.recurrence.confirmation=no",
  "rc.bulk=0",
  "rc.color=off",
];

const TIMEOUT_MS = 20_000;

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    binPath: {
      type: "string",
      label: "task binary",
      default: "task",
    },
    taskrc: {
      type: "string",
      label: "TASKRC override (path to .taskrc)",
      default: "",
    },
    taskdata: {
      type: "string",
      label: "TASKDATA override (path to task data dir)",
      default: "",
    },
  });

  interface RunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
  }

  async function runTask(args: string[]): Promise<RunResult> {
    const { binPath, taskrc, taskdata } = await settings.get();
    const env = { ...process.env };
    if (taskrc !== "") env.TASKRC = taskrc;
    if (taskdata !== "") env.TASKDATA = taskdata;
    try {
      const { stdout, stderr } = await execFileAsync(
        binPath,
        [...NON_INTERACTIVE_OVERRIDES, ...args],
        {
          env,
          timeout: TIMEOUT_MS,
          maxBuffer: PLUGIN_CLI_OUTPUT_MAX_BYTES,
        },
      );
      return { exitCode: 0, stdout, stderr };
    } catch (error) {
      const execError = error as {
        code?: number;
        killed?: boolean;
        signal?: string;
        stdout?: string;
        stderr?: string;
        message: string;
      };
      if (execError.killed) {
        return {
          exitCode: 1,
          stdout: execError.stdout ?? "",
          stderr: `task timed out after ${TIMEOUT_MS}ms (signal ${execError.signal ?? "unknown"})`,
        };
      }
      if (typeof execError.code === "number") {
        return {
          exitCode: execError.code,
          stdout: execError.stdout ?? "",
          stderr: execError.stderr ?? execError.message,
        };
      }
      // Not a "task exited non-zero" case — binary missing, ENOENT, etc.
      return { exitCode: 1, stdout: "", stderr: execError.message };
    }
  }

  async function exportTasks(filterArgs: string[]): Promise<TaskRecord[]> {
    const result = await runTask([...filterArgs, "export"]);
    if (result.exitCode !== 0 || result.stdout.trim() === "") return [];
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      return z.array(taskRecordSchema).parse(parsed);
    } catch (error) {
      bb.log.warn(`failed to parse \`task export\` output: ${String(error)}`);
      return [];
    }
  }

  // A blocker may not be in the caller's current filter/list, so it's
  // resolved with its own `task export` lookup rather than cross-referencing
  // the batch already in hand.
  async function attachBlockedBy(tasks: TaskRecord[]): Promise<TaskRecord[]> {
    const blockerUuids = new Set<string>();
    for (const task of tasks) {
      for (const uuid of task.depends ?? []) blockerUuids.add(uuid);
    }
    if (blockerUuids.size === 0) return tasks;

    const blockers = await exportTasks([...blockerUuids]);
    const blockerByUuid = new Map(blockers.map((blocker) => [blocker.uuid, blocker]));

    return tasks.map((task) => {
      if (task.depends === undefined || task.depends.length === 0) return task;
      const blockedBy = task.depends
        .map((uuid) => blockerByUuid.get(uuid))
        .filter((blocker): blocker is TaskRecord => blocker !== undefined)
        .filter((blocker) => blocker.status !== "completed" && blocker.status !== "deleted")
        .map((blocker) => ({ id: blocker.id, description: blocker.description }));
      return blockedBy.length > 0 ? { ...task, blockedBy } : task;
    });
  }

  const threads = createThreadStore(bb.storage.kv, (threadId) =>
    bb.realtime.publish(THREAD_STATE_CHANGED, { threadId }),
  );

  bb.rpc.register(rpcContract, {
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
      if (name.trim() === "") return { exists: false, pending: 0 };
      // `project:X` is a prefix match in Taskwarrior; post-filter to X or X.*.
      const tasks = (await exportTasks([`project:${name}`])).filter((task) =>
        belongsToProject(task.project, name),
      );
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
    tasks_list: async ({ filter }) => ({ tasks: await attachBlockedBy(await exportTasks(filter)) }),
    tasks_get: async ({ id }) => {
      const [task] = await attachBlockedBy(await exportTasks([String(id)]));
      return { task: task ?? null };
    },
    tasks_add: async ({ description }) => {
      const result = await runTask(["add", description]);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "task add failed");
      }
      const match = /Created task (\d+)\./.exec(result.stdout);
      const task =
        match !== null ? (await exportTasks([match[1]]))[0] ?? null : null;
      bb.realtime.publish(TASKS_CHANGED, { reason: "add" });
      return { task };
    },
    tasks_modify: async ({ id, priority, project, tags, due }) => {
      const args = [String(id), "modify"];
      if (priority !== undefined) args.push(priority === null ? "priority:" : `priority:${priority}`);
      if (project !== undefined) args.push(project === null ? "project:" : `project:${project}`);
      if (due !== undefined) args.push(due === null ? "due:" : `due:${due}`);
      if (tags !== undefined) {
        const current = (await exportTasks([String(id)]))[0];
        const currentTags = new Set(current?.tags ?? []);
        const nextTags = new Set(tags);
        for (const tag of currentTags) {
          if (!nextTags.has(tag)) args.push(`-${tag}`);
        }
        for (const tag of nextTags) {
          if (!currentTags.has(tag)) args.push(`+${tag}`);
        }
      }

      let ok = true;
      if (args.length > 2) {
        const result = await runTask(args);
        ok = result.exitCode === 0;
        bb.realtime.publish(TASKS_CHANGED, { reason: "modify" });
      }
      const task = (await exportTasks([String(id)]))[0] ?? null;
      return { ok, task };
    },
    tasks_complete: async ({ id }) => {
      const result = await runTask([String(id), "done"]);
      bb.realtime.publish(TASKS_CHANGED, { reason: "complete" });
      return { ok: result.exitCode === 0 };
    },
    tasks_delete: async ({ id }) => {
      const result = await runTask([String(id), "delete"]);
      bb.realtime.publish(TASKS_CHANGED, { reason: "delete" });
      return { ok: result.exitCode === 0 };
    },
  });

  const usage = [
    "Usage: bb tw <taskwarrior args...>",
    "",
    "Forwards straight to the `task` CLI, so any Taskwarrior filter, report,",
    "or command works, e.g.:",
    "  bb tw list",
    "  bb tw +work ls",
    "  bb tw add Buy milk project:home",
    "  bb tw 12 done",
    "  bb tw 12 modify priority:H",
    "  bb tw export project:home",
  ].join("\n");

  bb.cli.register({
    name: "tw",
    summary: "Query and manage Taskwarrior tasks (proxies the `task` CLI)",
    commands: [
      {
        name: "args",
        summary: "Any Taskwarrior args, forwarded verbatim to `task`",
        usage: "bb tw <taskwarrior args...>",
      },
    ],
    async run(argv) {
      if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
        return { exitCode: 0, stdout: usage };
      }
      const result = await runTask(argv);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout || undefined,
        stderr: result.stderr || undefined,
      };
    },
  });

  bb.agents.registerTool({
    name: "taskwarrior_run",
    description:
      "Run a Taskwarrior (`task`) command and return its output. Accepts the " +
      "same argv you'd type after `task` on the command line: filters, " +
      "reports, add/modify/done/delete, export, etc.",
    instructions:
      "Use taskwarrior_run for anything about the user's Taskwarrior tasks " +
      "(listing, adding, completing, modifying, querying). Pass args as you " +
      "would type them after `task`, e.g. [\"list\"], " +
      "[\"add\", \"Buy milk\", \"project:home\"], [\"12\", \"done\"].",
    presentation: {
      label: {
        pending: "Running Taskwarrior command",
        completed: "Ran Taskwarrior command",
      },
    },
    parameters: z.object({
      args: z
        .array(z.string())
        .min(1)
        .describe(
          "Argv to pass to `task`, one token per array element (no shell quoting).",
        ),
    }),
    async execute({ args }) {
      const result = await runTask(args);
      const text = [result.stdout, result.stderr].filter(Boolean).join("\n");
      return {
        content: [{ type: "text", text: text || "(no output)" }],
        isError: result.exitCode !== 0,
      };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
