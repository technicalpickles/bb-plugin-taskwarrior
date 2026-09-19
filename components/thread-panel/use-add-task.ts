import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, type TaskRecord } from "../../contract";

export type AddTaskResult =
  | { status: "added"; task: TaskRecord }
  | { status: "failed" }
  | { status: "ignored" };

// Shared add path: trims, ignores blank/in-flight submits, calls tasks_add and
// toasts the failure cases. Callers decide what happens after "added" and keep
// their input on "failed"/"ignored".
export function useAddTask() {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);

  async function add(description: string): Promise<AddTaskResult> {
    const trimmed = description.trim();
    if (trimmed === "" || busy) return { status: "ignored" };
    setBusy(true);
    try {
      let added: TaskRecord | null;
      try {
        ({ task: added } = await rpc.call("tasks_add", { description: trimmed }));
      } catch {
        toast.error("Could not add the task");
        return { status: "failed" };
      }
      if (added === null) {
        toast.error("Task was added but could not be read back");
        return { status: "failed" };
      }
      return { status: "added", task: added };
    } finally {
      setBusy(false);
    }
  }

  return { busy, add };
}
