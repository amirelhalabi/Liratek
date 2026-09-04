import { useState, useCallback } from "react";

const STORAGE_KEY = "sidebar_favorites";

// LIRA-116: `/services` (OMT/Whish) was renamed to `/omt-whish` because it
// collided with the `custom_services` module's UI label "Services". Sidebar
// favorites are persisted as raw route strings (Sidebar.tsx resolves them by
// exact `to === route` match), so a favorite stored under the old route
// would otherwise silently stop resolving after the rename. This map is the
// open/closed extension point for future route renames — add an entry here;
// the migration logic in readFavorites() below never needs to change.
const LEGACY_ROUTE_ALIASES: Readonly<Record<string, string>> = {
  "/services": "/omt-whish",
};

function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const stored = parsed as string[];
    const migrated = stored.map(
      (route) => LEGACY_ROUTE_ALIASES[route] ?? route,
    );

    // De-duplicate while preserving FIFO order (favorites are documented as
    // FIFO-ordered in Sidebar.tsx) — a user could plausibly have both the
    // legacy and current route already stored.
    const deduped = Array.from(new Set(migrated));

    const changed =
      deduped.length !== stored.length ||
      deduped.some((route, i) => route !== stored[i]);

    if (changed) {
      // One-time write-back so the migration doesn't re-run every load. A
      // storage failure here (quota, private mode, etc.) must not throw or
      // fall through to an empty list — the caller already got a usable
      // in-memory result this session.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped));
      } catch {
        // Ignored — migrated array is still returned below.
      }
    }

    return deduped;
  } catch {
    return [];
  }
}

export function useSidebarFavorites() {
  const [favorites, setFavorites] = useState<string[]>(readFavorites);

  const toggleFavorite = useCallback((route: string) => {
    setFavorites((prev) => {
      const next = prev.includes(route)
        ? prev.filter((r) => r !== route)
        : [...prev, route];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (route: string) => favorites.includes(route),
    [favorites],
  );

  return { favorites, toggleFavorite, isFavorite };
}
