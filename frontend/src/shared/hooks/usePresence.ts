import { useEffect, useState } from "react";

/** Matches `.animate-swipe-down` in index.css (0.18s). */
export const PRESENCE_EXIT_MS = 180;

/**
 * Keeps a panel on screen long enough to play its exit animation.
 *
 * `open` is whether the panel should show. While it goes from open to closed,
 * `closing` is true for {@link PRESENCE_EXIT_MS} — render the exit animation
 * then — after which `mounted` turns false and the panel can be removed.
 * Reopening during the exit cancels it. A timer (not `animationend`) ends the
 * exit, so it also finishes under "reduce motion" and in tests.
 */
export function usePresence(open: boolean): {
  mounted: boolean;
  closing: boolean;
} {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const t = setTimeout(() => setMounted(false), PRESENCE_EXIT_MS);
    return () => clearTimeout(t);
  }, [open, mounted]);

  return { mounted: open || mounted, closing: !open && mounted };
}
