import { describe, expect, it, vi } from "vitest";
import { paletteActions, type PaletteContext } from "../lib/palette-actions";

function ctx(over: Partial<PaletteContext> = {}): PaletteContext {
  return { threadId: "t1", projectId: "p1", openPanel: vi.fn(() => true), ...over };
}
const byId = (id: string, navigate = () => {}) =>
  paletteActions(navigate).find((row) => row.id === id)!;

describe("palette rows", () => {
  it("lists find, add, pin, open in order", () => {
    expect(paletteActions(() => {}).map((r) => r.id)).toEqual(["find", "add", "pin", "open"]);
  });

  it("find opens the panel with an empty query", () => {
    const c = ctx();
    byId("find").run(c);
    expect(c.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: "tasks", params: { query: "" } }),
    );
  });

  it("add opens the panel in add mode", () => {
    const c = ctx();
    byId("add").run(c);
    expect(c.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: "tasks", params: { mode: "add" } }),
    );
  });

  it("pin opens the panel in pin mode", () => {
    const c = ctx();
    byId("pin").run(c);
    expect(c.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: "tasks", params: { mode: "pin" } }),
    );
  });

  it("pin and open need a thread", () => {
    expect(byId("pin").isAvailable?.(ctx({ threadId: null }))).toBe(false);
    expect(byId("pin").isAvailable?.(ctx())).toBe(true);
    expect(byId("open").isAvailable?.(ctx({ threadId: null }))).toBe(false);
    expect(byId("open").isAvailable?.(ctx())).toBe(true);
  });

  it("find and add are always available", () => {
    expect(byId("find").isAvailable?.(ctx({ threadId: null })) ?? true).toBe(true);
    expect(byId("add").isAvailable?.(ctx({ threadId: null })) ?? true).toBe(true);
  });

  it("falls back to the nav page when there is no side panel", () => {
    const navigate = vi.fn();
    const c = ctx({ openPanel: vi.fn(() => false) });
    byId("find", navigate).run(c);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("does not navigate when the panel opens", () => {
    const navigate = vi.fn();
    byId("find", navigate).run(ctx());
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("palette wiring", () => {
  it("PALETTE_PANEL_ACTION_ID matches the thread panel action registered in app.tsx", async () => {
    const { loadPluginApp } = await import("@get-bb/plugin-sdk/testing/app");
    const { PALETTE_PANEL_ACTION_ID } = await import("../lib/palette-actions");
    const captured = await loadPluginApp(() => import("../app"));
    expect(captured.threadPanelActions[0].id).toBe(PALETTE_PANEL_ACTION_ID);
  });
});
