import { describe, expect, it } from "vitest";
import {
  RECENT_CAP,
  SEARCH_CAP,
  emptyThreadState,
  pin,
  recordSearch,
  recordTouch,
  reorderPins,
  unpin,
} from "../lib/thread-state";

describe("pins", () => {
  it("appends and dedupes", () => {
    let s = emptyThreadState();
    s = pin(s, "a");
    s = pin(s, "b");
    s = pin(s, "a");
    expect(s.pins).toEqual(["a", "b"]);
  });
  it("unpin removes and ignores unknown", () => {
    const s = pin(pin(emptyThreadState(), "a"), "b");
    expect(unpin(s, "a").pins).toEqual(["b"]);
    expect(unpin(s, "zzz").pins).toEqual(["a", "b"]);
  });
  it("reorderPins applies the order, drops strangers, keeps omitted pins at the end", () => {
    const s = { ...emptyThreadState(), pins: ["a", "b", "c"] };
    expect(reorderPins(s, ["c", "x", "a"]).pins).toEqual(["c", "a", "b"]);
  });
  it("does not mutate input", () => {
    const s = emptyThreadState();
    pin(s, "a");
    expect(s.pins).toEqual([]);
  });
});

describe("recordTouch", () => {
  it("puts the newest first and dedupes by uuid with latest 'by' winning", () => {
    let s = emptyThreadState();
    s = recordTouch(s, "a", "user", 1);
    s = recordTouch(s, "b", "user", 2);
    s = recordTouch(s, "a", "agent", 3);
    expect(s.recent).toEqual([
      { uuid: "a", at: 3, by: "agent" },
      { uuid: "b", at: 2, by: "user" },
    ]);
  });
  it("caps at RECENT_CAP, dropping the oldest", () => {
    let s = emptyThreadState();
    for (let i = 0; i < RECENT_CAP + 5; i++) s = recordTouch(s, `u${i}`, "user", i);
    expect(s.recent).toHaveLength(RECENT_CAP);
    expect(s.recent[0].uuid).toBe(`u${RECENT_CAP + 4}`);
    expect(s.recent.at(-1)?.uuid).toBe("u5");
  });
});

describe("recordSearch", () => {
  it("trims, ignores blanks, dedupes by query, newest first", () => {
    let s = emptyThreadState();
    s = recordSearch(s, "  milk ", 1);
    s = recordSearch(s, "   ", 2);
    s = recordSearch(s, "eggs", 3);
    s = recordSearch(s, "milk", 4);
    expect(s.searches).toEqual([
      { query: "milk", at: 4 },
      { query: "eggs", at: 3 },
    ]);
  });
  it("caps at SEARCH_CAP", () => {
    let s = emptyThreadState();
    for (let i = 0; i < SEARCH_CAP + 3; i++) s = recordSearch(s, `q${i}`, i);
    expect(s.searches).toHaveLength(SEARCH_CAP);
  });
});
