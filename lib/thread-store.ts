// KV-backed persistence for thread and project UI state. Mutations are
// read-modify-write, so they are serialized per key to avoid lost updates
// when the panel fires several RPCs at once.
import { threadStateSchema, type ThreadState } from "../contract";
import {
  emptyThreadState,
  pin,
  recordSearch,
  recordTouch,
  reorderPins,
  unpin,
} from "./thread-state";

export interface KvLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const threadKey = (threadId: string) => `threads/${threadId}`;
const projectKey = (projectId: string) => `projects/${projectId}`;

export function createThreadStore(
  kv: KvLike,
  publish: (threadId: string) => void,
  now: () => number = Date.now,
) {
  const chains = new Map<string, Promise<unknown>>();

  function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    chains.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  // A corrupt or legacy record must not wedge thread_get: parse it, and fall
  // back to an empty state the next mutation will overwrite cleanly.
  async function load(threadId: string): Promise<ThreadState> {
    const record = await kv.get<unknown>(threadKey(threadId));
    if (record === undefined) return emptyThreadState();
    const parsed = threadStateSchema.safeParse(record);
    return parsed.success ? parsed.data : emptyThreadState();
  }

  function mutate(threadId: string, change: (state: ThreadState) => ThreadState) {
    return serialized(threadKey(threadId), async () => {
      const next = change(await load(threadId));
      await kv.set(threadKey(threadId), next);
      publish(threadId);
      return next;
    });
  }

  return {
    get: load,
    pin: (threadId: string, uuid: string) => mutate(threadId, (s) => pin(s, uuid)),
    unpin: (threadId: string, uuid: string) => mutate(threadId, (s) => unpin(s, uuid)),
    reorder: (threadId: string, order: string[]) =>
      mutate(threadId, (s) => reorderPins(s, order)),
    recordView: async (threadId: string, uuid: string, by: "user" | "agent" = "user") => {
      await mutate(threadId, (s) => recordTouch(s, uuid, by, now()));
    },
    recordSearch: async (threadId: string, query: string) => {
      await mutate(threadId, (s) => recordSearch(s, query, now()));
    },
    async getProjectLink(projectId: string): Promise<string | null> {
      const record = await kv.get<{ twProject: string | null }>(projectKey(projectId));
      return record?.twProject ?? null;
    },
    setProjectLink(projectId: string, twProject: string | null): Promise<void> {
      return serialized(projectKey(projectId), () => kv.set(projectKey(projectId), { twProject }));
    },
  };
}
