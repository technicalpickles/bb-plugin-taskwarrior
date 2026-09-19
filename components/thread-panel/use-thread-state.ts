import { useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract, THREAD_STATE_CHANGED, type ThreadState } from "../../contract";

export function useThreadState(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<ThreadState | null>(null);

  async function refresh() {
    const { state: next } = await rpc.call("thread_get", { threadId });
    setState(next);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useRealtime(THREAD_STATE_CHANGED, (payload) => {
    const changed = (payload as { threadId?: string } | null)?.threadId;
    if (changed === undefined || changed === threadId) void refresh();
  });

  return {
    state,
    async pin(uuid: string) {
      setState((await rpc.call("thread_pin", { threadId, uuid })).state);
    },
    async unpin(uuid: string) {
      setState((await rpc.call("thread_unpin", { threadId, uuid })).state);
    },
    async reorder(order: string[]) {
      setState((await rpc.call("thread_reorder_pins", { threadId, order })).state);
    },
    async recordView(uuid: string) {
      await rpc.call("thread_record_view", { threadId, uuid });
    },
    async recordSearch(query: string) {
      await rpc.call("thread_record_search", { threadId, query });
    },
  };
}
