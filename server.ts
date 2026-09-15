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
import { rpcContract, taskRecordSchema, TASKS_CHANGED, type TaskRecord } from "./contract";

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

  async function listPendingTasks(filter: string[]): Promise<TaskRecord[]> {
    const tasks = await exportTasks(["status:pending", ...filter]);
    return tasks.sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0));
  }

  bb.rpc.register(rpcContract, {
    tasks_list: async ({ filter }) => ({ tasks: await listPendingTasks(filter) }),
    tasks_get: async ({ id }) => ({ task: (await exportTasks([String(id)]))[0] ?? null }),
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
