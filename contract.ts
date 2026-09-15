// Shared RPC contract between server.ts (Node) and app.tsx (browser bundle).
// Keep this file free of Node built-ins — app.tsx imports its runtime
// exports (rpcContract, TASKS_CHANGED), and anything imported here gets
// bundled into the browser.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// A pared-down projection of `task export`'s JSON — only what the sidebar
// panel renders. Taskwarrior's export includes many more fields.
export const taskRecordSchema = z.object({
  id: z.number(),
  uuid: z.string(),
  description: z.string(),
  status: z.string(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  due: z.string().optional(),
  urgency: z.number().optional(),
});
export type TaskRecord = z.infer<typeof taskRecordSchema>;

/** Realtime channel app.tsx listens on to refresh the sidebar panel. */
export const TASKS_CHANGED = "tasks-changed";

export const rpcContract = defineRpcContract({
  tasks_list: {
    input: z.null(),
    output: z.object({ tasks: z.array(taskRecordSchema) }),
  },
  tasks_add: {
    input: z.object({ description: z.string().trim().min(1).max(500) }),
    output: z.object({ task: taskRecordSchema.nullable() }),
  },
  tasks_complete: {
    input: z.object({ id: z.number() }),
    output: z.object({ ok: z.boolean() }),
  },
  tasks_delete: {
    input: z.object({ id: z.number() }),
    output: z.object({ ok: z.boolean() }),
  },
});
