// Pure transitions over a thread's UI state. No I/O, no mutation, so the
// store and the tests can both lean on them.
import type { ThreadState } from "../contract";

export const RECENT_CAP = 20;
export const SEARCH_CAP = 10;

export function emptyThreadState(): ThreadState {
  return { pins: [], recent: [], searches: [] };
}

export function pin(state: ThreadState, uuid: string): ThreadState {
  if (state.pins.includes(uuid)) return state;
  return { ...state, pins: [...state.pins, uuid] };
}

export function unpin(state: ThreadState, uuid: string): ThreadState {
  if (!state.pins.includes(uuid)) return state;
  return { ...state, pins: state.pins.filter((existing) => existing !== uuid) };
}

/** Apply `order` to the current pins: unknown uuids are dropped, pins the
 * caller omitted keep their relative order at the end. */
export function reorderPins(state: ThreadState, order: string[]): ThreadState {
  const current = new Set(state.pins);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const uuid of order) {
    if (current.has(uuid) && !seen.has(uuid)) {
      ordered.push(uuid);
      seen.add(uuid);
    }
  }
  for (const uuid of state.pins) if (!seen.has(uuid)) ordered.push(uuid);
  return { ...state, pins: ordered };
}

export function recordTouch(
  state: ThreadState,
  uuid: string,
  by: "user" | "agent",
  at: number,
): ThreadState {
  const rest = state.recent.filter((entry) => entry.uuid !== uuid);
  return { ...state, recent: [{ uuid, at, by }, ...rest].slice(0, RECENT_CAP) };
}

export function recordSearch(state: ThreadState, query: string, at: number): ThreadState {
  const trimmed = query.trim();
  if (trimmed === "") return state;
  const rest = state.searches.filter((entry) => entry.query !== trimmed);
  return { ...state, searches: [{ query: trimmed, at }, ...rest].slice(0, SEARCH_CAP) };
}
