import { useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract, TASKS_CHANGED, type TaskRecord } from "../../contract";

export interface ResolvedTasks {
  /** Live tasks (any status) for the uuids the last fetch asked about. */
  tasks: Map<string, TaskRecord>;
  /** Uuids that fetch covered. A uuid in `resolved` but not in `tasks` is
   * genuinely gone; a uuid in neither is still in flight. */
  resolved: Set<string>;
}

/** Resolve stored uuids to live tasks (any status).
 *
 * Pass `null` for "the uuid set is not known yet" (e.g. thread state still
 * loading): the hook returns `null` and issues nothing. Once the first fetch
 * has resolved it never returns `null` again — a refetch keeps the previous
 * map in place, so sections do not blank out mid-flight. Callers distinguish
 * "still loading" from "no longer exists" with `resolved`.
 */
export function useTasksByUuid(uuids: string[] | null): ResolvedTasks | null {
  const rpc = useRpc<typeof rpcContract>();
  const [loaded, setLoaded] = useState<ResolvedTasks | null>(null);
  // Order-insensitive: reordering pins must not look like a new uuid set.
  const key = uuids === null ? null : [...uuids].sort().join(",");
  const latest = useRef(0);

  async function refresh(current: string[]) {
    const request = ++latest.current;
    if (current.length === 0) {
      setLoaded({ tasks: new Map(), resolved: new Set() });
      return;
    }
    const { tasks } = await rpc.call("tasks_list", { filter: current });
    // Ignore a response a newer request has already superseded.
    if (request !== latest.current) return;
    setLoaded({
      tasks: new Map(tasks.map((task) => [task.uuid, task])),
      resolved: new Set(current),
    });
  }

  useEffect(() => {
    if (uuids === null) return;
    void refresh(uuids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useRealtime(TASKS_CHANGED, () => {
    if (uuids === null) return;
    void refresh(uuids);
  });

  return loaded;
}
