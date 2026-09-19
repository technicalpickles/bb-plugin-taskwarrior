import { useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "../../contract";

/** Resolve stored uuids to live tasks (any status). Missing uuids are absent
 * from the map, which the UI renders as "no longer exists". */
export function useTasksByUuid(uuids: string[]): Map<string, TaskRecord> {
  const rpc = useRpc<typeof rpcContract>();
  const [byUuid, setByUuid] = useState<Map<string, TaskRecord>>(new Map());
  const key = uuids.join(",");

  async function refresh() {
    if (uuids.length === 0) {
      setByUuid(new Map());
      return;
    }
    const { tasks } = await rpc.call("tasks_list", { filter: uuids });
    setByUuid(new Map(tasks.map((task) => [task.uuid, task])));
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useRealtime(TASKS_CHANGED, () => {
    void refresh();
  });

  return byUuid;
}
