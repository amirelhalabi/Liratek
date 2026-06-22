import { useState, useCallback } from "react";

const STORAGE_KEY = "sidebar_favorites";

function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
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
