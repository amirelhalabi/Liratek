import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePresence } from "@/shared/hooks/usePresence";

/** Matches `.animate-expand-rows` in index.css (0.22s). */
export const EXPAND_MS = 220;

/**
 * Shows its children when `open`, animating their real height open and
 * closed (`animate-expand-rows` / `animate-collapse-rows` in index.css), so a
 * grid row or list below moves smoothly instead of jumping.
 *
 * - Content already open on first render does not animate (no page-load
 *   flourish).
 * - The `overflow-hidden` the height animation needs is applied only while it
 *   runs, so selection rings and shadows are not clipped once settled.
 */
export function Collapsible({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const { mounted, closing } = usePresence(open);
  const [expanding, setExpanding] = useState(false);
  const wasOpen = useRef(open);

  // Layout effect: mark the opening before the first paint, so the content
  // never flashes at full height for a frame before the animation starts.
  useLayoutEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (!open || was) return;
    setExpanding(true);
    const t = setTimeout(() => setExpanding(false), EXPAND_MS);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted) return null;

  const animation = closing
    ? "animate-collapse-rows"
    : expanding
      ? "animate-expand-rows"
      : "";
  return (
    <div className={`grid ${animation}`}>
      <div
        className={`min-h-0 ${closing || expanding ? "overflow-hidden" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
