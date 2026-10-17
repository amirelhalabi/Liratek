import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { SearchBar, useApi } from "@liratek/ui";
import { formatNumber } from "@liratek/ui/i18n/format";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import {
  STOCK_EXPENSE_CATALOG_PROVIDERS,
  type CatalogStockExpenseSource,
  type StockExpenseSource,
} from "@liratek/core";

/**
 * LIRA-262 — one searchable item the shop can record using for itself: an
 * inventory product, or a Katsh / iPick / Whish App catalog item. `unitCost`
 * is shown for the operator's information only — the server derives the
 * real cost (FIFO batch cost / catalog cost) and never trusts this value.
 */
export interface StockPick {
  key: string;
  source: StockExpenseSource;
  item_id: number;
  name: string;
  sourceLabel: string;
  unitCost: number;
  currency: "USD" | "LBP";
  /** Inventory only — units on hand. */
  stock?: number;
  /** LIRA-312 — set on an MTC/Alfa card (Katsh / iPick / Whish App catalog
   *  item with a cost): such a card can be recorded as a wrong number. */
  carrier?: "mtc" | "alfa";
}

// Brand names stay as they are (FR-009); "Inventory" is shown through
// `picker.inventory` in the displayed language.
const SOURCE_LABELS: Record<StockExpenseSource, string> = {
  INVENTORY: "Inventory", // i18n-exempt: replaced by picker.inventory where shown
  KATSH: "Katsh",
  IPICK: "iPick",
  WHISH_APP: "Whish App",
};

/** catalog provider spelling → source (inverse of the core map, rule 14). */
const SOURCE_BY_PROVIDER = new Map<string, CatalogStockExpenseSource>(
  (
    Object.entries(STOCK_EXPENSE_CATALOG_PROVIDERS) as [
      CatalogStockExpenseSource,
      string,
    ][]
  ).map(([source, provider]) => [provider, source]),
);

const MAX_PER_GROUP = 15;

interface ProductRow {
  id: number;
  name: string;
  barcode?: string | null;
  cost_price?: number | null;
  cost_price_usd?: number | null;
  stock_quantity?: number | null;
}

/**
 * The Expenses page's "use an item from stock" search — the same `SearchBar`
 * the Services (custom services) page uses to pick an inventory item, widened
 * to also list the Katsh / iPick / Whish App catalog.
 */
export function StockUsePicker({
  onPick,
}: {
  onPick: (pick: StockPick) => void;
}) {
  const api = useApi();
  const { t } = useTranslation("expenses");
  // rule 25: no effect depends on `api`; the catalog is fetched lazily on
  // the first search and cached for the page's lifetime.
  const catalogRef = useRef<StockPick[] | null>(null);

  const loadCatalog = async (): Promise<StockPick[]> => {
    if (catalogRef.current) return catalogRef.current;
    const items = await api.getActiveMobileServiceItems();
    const picks: StockPick[] = [];
    for (const item of items ?? []) {
      const source = SOURCE_BY_PROVIDER.get(item.provider);
      if (!source) continue;
      const category = item.category.toLowerCase();
      const carrier =
        (category === "mtc" || category === "alfa") && Number(item.cost_lbp) > 0
          ? category
          : undefined;
      picks.push({
        key: `${source}-${item.id}`,
        source,
        item_id: item.id,
        name: [item.category, item.subcategory, item.label]
          .filter(Boolean)
          .join(" · "),
        sourceLabel: SOURCE_LABELS[source],
        unitCost: Number(item.cost_lbp) || 0,
        currency: "LBP",
        ...(carrier ? { carrier } : {}),
      });
    }
    catalogRef.current = picks;
    return picks;
  };

  const search = async (query: string): Promise<StockPick[]> => {
    const q = query.trim().toLowerCase();
    const [products, catalog] = await Promise.all([
      api.getProducts(query) as Promise<ProductRow[]>,
      loadCatalog(),
    ]);
    const productPicks: StockPick[] = (products ?? [])
      .slice(0, MAX_PER_GROUP)
      .map((p) => ({
        key: `INVENTORY-${p.id}`,
        source: "INVENTORY" as const,
        item_id: p.id,
        name: p.name,
        sourceLabel: t("picker.inventory"),
        unitCost: Number(p.cost_price ?? p.cost_price_usd ?? 0) || 0,
        currency: "USD" as const,
        stock: Number(p.stock_quantity ?? 0),
      }));
    const catalogPicks = catalog
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, MAX_PER_GROUP);
    return [...productPicks, ...catalogPicks];
  };

  return (
    <SearchBar<StockPick>
      data-testid="expense-stock-search"
      placeholder={t("picker.placeholder")}
      onSearch={search}
      onSelect={onPick}
      renderItem={(item) => (
        <div className="flex items-center justify-between w-full gap-3">
          <span className="font-medium truncate">{item.name}</span>
          <span className="text-slate-400 text-xs whitespace-nowrap">
            {item.sourceLabel} · {t("picker.cost")}{" "}
            <Ltr>
              {item.currency === "USD"
                ? `$${item.unitCost.toFixed(2)}`
                : `${formatNumber(item.unitCost)} LBP`}
            </Ltr>
            {item.stock !== undefined
              ? t("picker.inStock", { count: item.stock })
              : ""}
          </span>
        </div>
      )}
      getKey={(item) => item.key}
      ringColor="ring-orange-500/50"
      noResultsMessage={t("picker.noResults")}
    />
  );
}
