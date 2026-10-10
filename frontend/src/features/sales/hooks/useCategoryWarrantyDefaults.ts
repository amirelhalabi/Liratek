import { useQuery } from "@tanstack/react-query";
import { useApi } from "@liratek/ui";
import { serialLabelFor, type SerialLabel } from "@liratek/core";

/**
 * LIRA-296 — each category's default warranty (Settings → Categories), keyed
 * by category NAME (lower-cased), for the POS cart's "Warranty: N months"
 * hint. One shared query for every cart line. The server resolves the real
 * stamp itself; this only shows the cashier what the default will be.
 */
interface CategoriesApi {
  getCategoriesFull: () => Promise<
    Array<{ name: string; warranty_months?: number | null }>
  >;
}

export const CATEGORY_WARRANTY_KEY = ["categories-full", "warranty"] as const;

export function useCategoryWarrantyDefaults(): Map<string, number | null> {
  const api = useApi() as unknown as CategoriesApi;
  const { data } = useQuery({
    queryKey: CATEGORY_WARRANTY_KEY,
    queryFn: () => api.getCategoriesFull(),
    staleTime: 60_000,
  });
  const map = new Map<string, number | null>();
  for (const c of data ?? []) {
    map.set(c.name.trim().toLowerCase(), c.warranty_months ?? null);
  }
  return map;
}

interface CategorySerialRow {
  name: string;
  tracks_imei_units?: number | boolean | null;
  serial_label?: string | null;
}

/**
 * LIRA-296 P3 (FR-015) — what each category calls its unit serial ("IMEI"
 * or "Serial"), from the SAME category query as the warranty defaults (one
 * cached fetch). Returns a lookup by category NAME; an unknown category
 * falls back on the line's own tracking flag (core's `serialLabelFor`).
 */
export function useCategorySerialLabels(): (
  category: string | null | undefined,
  tracksImeiUnits?: number | boolean | null,
) => SerialLabel {
  const api = useApi() as unknown as {
    getCategoriesFull: () => Promise<CategorySerialRow[]>;
  };
  const { data } = useQuery({
    queryKey: CATEGORY_WARRANTY_KEY,
    queryFn: () => api.getCategoriesFull(),
    staleTime: 60_000,
  });
  const byName = new Map<string, CategorySerialRow>();
  for (const c of (data ?? []) as CategorySerialRow[]) {
    byName.set(c.name.trim().toLowerCase(), c);
  }
  return (category, tracksImeiUnits) =>
    serialLabelFor(
      byName.get((category ?? "").trim().toLowerCase()) ?? {
        tracks_imei_units: tracksImeiUnits ?? null,
      },
    );
}
