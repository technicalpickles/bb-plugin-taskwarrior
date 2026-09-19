/** The nav panel page owns its full body with zero host padding/scrolling —
 * per the plugin SDK's "classic page" recipe, supply both ourselves. */
export function PageScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[840px] space-y-4 p-4 md:p-5">{children}</div>
    </div>
  );
}
