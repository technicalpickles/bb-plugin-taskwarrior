// Palette rows as plain functions so they are testable without the host.
// Rows are static: the palette cannot list tasks, so "find" is a launcher
// that opens the panel with the search box focused.
export const PALETTE_PANEL_ACTION_ID = "tasks";

export interface PaletteContext {
  threadId: string | null;
  projectId: string | null;
  openPanel(options: { actionId: string; title?: string; params?: unknown }): boolean;
}

export interface PaletteRow {
  id: string;
  title: string;
  isAvailable?(context: PaletteContext): boolean;
  run(context: PaletteContext): void;
}

export function paletteActions(navigateToNavPanel: () => void): PaletteRow[] {
  const open = (context: PaletteContext, params?: unknown) => {
    const opened = context.openPanel({
      actionId: PALETTE_PANEL_ACTION_ID,
      title: "Tasks",
      params,
    });
    if (!opened) navigateToNavPanel();
  };
  const needsThread = (context: PaletteContext) => context.threadId !== null;
  return [
    { id: "find", title: "Tasks: find…", run: (c) => open(c, { query: "" }) },
    { id: "add", title: "Tasks: add…", run: (c) => open(c, { mode: "add" }) },
    {
      id: "pin",
      title: "Tasks: pin to this thread",
      isAvailable: needsThread,
      run: (c) => open(c, { mode: "pin" }),
    },
    {
      id: "open",
      title: "Tasks: open this thread's tasks",
      isAvailable: needsThread,
      run: (c) => open(c),
    },
  ];
}
