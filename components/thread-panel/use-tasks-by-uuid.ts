import { useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "../../contract";

/** Resolve stored uuids to live tasks (any status). Missing uuids are absent
 * from the map, which the UI renders as "no longer exists". `null` means not loaded yet. */
export function useTasksByUuid(uuids: string[]): Map<string, TaskRecord> | null {
  const rpc = useRpc<typeof rpcContract>();
  const [loaded, setLoaded] = useState<{
    byUuid: Map<string, TaskRecord>;
    requested: Set<string>;
  } | null>(null);
  const key = uuids.join(",");

  async function refresh() {
    if (uuids.length === 0) {
      setLoaded({ byUuid: new Map(), requested: new Set() });
      return;
    }
    const { tasks } = await rpc.call("tasks_list", { filter: uuids });
    setLoaded({
      byUuid: new Map(tasks.map((task) => [task.uuid, task])),
      requested: new Set(uuids),
    });
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useRealtime(TASKS_CHANGED, () => {
    void refresh();
  });

  // Null until every current uuid has been resolved at least once, so a pin
  // never renders as "no longer exists" just because its fetch is in flight.
  if (loaded === null || !uuids.every((uuid) => loaded.requested.has(uuid))) return null;
  return loaded.byUuid;
}
