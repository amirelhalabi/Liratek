import { useEffect, useRef, useState } from "react";
import { Search, Plus, Minus, Trash2 } from "lucide-react";
import { DecimalInput, useApi } from "@liratek/ui";
import type { Product } from "@liratek/ui";

/**
 * A part line as edited by this component. `product_name` is display-only
 * (never sent to the backend — see `toPartsPayload` in `./partsMath`); `id`
 * is present only for a line that was loaded from an existing job, so the
 * backend reconciles it instead of re-adding it
 * (MaintenanceRepository.syncParts).
 *
 * All prices here are USD, always, on both USD and LBP jobs — parts are
 * never converted (products only carry cost_price_usd/selling_price_usd).
 */
export interface PartLine {
  id?: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price_usd: number;
}

const PARTS_CATEGORY = "Parts";

interface PartPickerProps {
  parts: PartLine[];
  onChange: (parts: PartLine[]) => void;
  disabled?: boolean;
}

/**
 * Searchable parts editor for a maintenance job. Defaults the product search
 * to the "Parts" category with a toggle to search all categories. Out-of-
 * stock products are shown and selectable — the backend stock guard
 * (`allowOutOfStock`) is the authority; this component only flags them
 * visually and lets the save-time error surface as-is.
 */
export default function PartPicker({
  parts,
  onChange,
  disabled = false,
}: PartPickerProps) {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [searchAllCategories, setSearchAllCategories] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  // Read `api` through a ref instead of putting it in the effect's deps —
  // see CLAUDE.md rule 25 and `FeatureFlagContext.tsx` (the canonical
  // pattern). `useApi()` is only stable in production because `ApiProvider`
  // happens to hand out a module-level singleton; that isn't guaranteed, and
  // `PartPicker.test.tsx` deliberately mocks it as a fresh object literal per
  // render (on purpose — see that file). With `api` in the deps, that churn
  // re-fired this effect every render, and `setResults([])` on the empty-
  // search path allocated a NEW array each time, so React's `Object.is`
  // bail-out never fired: a synchronous infinite render loop. It doesn't
  // look like what it is — jest reports "Jest worker ran out of memory",
  // not a timeout, because a sync loop never yields back to the event loop.
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const term = search.trim();
    if (!term) {
      // Defence in depth: keep the same array reference when already empty
      // so React can bail out even if something else re-triggers this path.
      setResults((prev) => (prev.length === 0 ? prev : []));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const data = await apiRef.current.getProducts(
            term,
            searchAllCategories ? undefined : { categories: [PARTS_CATEGORY] },
          );
          if (!cancelled) setResults(data as unknown as Product[]);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, searchAllCategories]);

  const addPart = (product: Product) => {
    onChange([
      ...parts,
      {
        product_id: product.id,
        product_name: product.name,
        quantity: 1,
        unit_price_usd: product.retail_price ?? 0,
      },
    ]);
    setSearch("");
    setResults([]);
  };

  const updateLine = (index: number, patch: Partial<PartLine>) => {
    onChange(parts.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const removeLine = (index: number) => {
    onChange(parts.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">Parts</span>
        {!disabled && (
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={searchAllCategories}
              onChange={(e) => setSearchAllCategories(e.target.checked)}
              className="accent-violet-600"
            />
            Search all categories
          </label>
        )}
      </div>

      {!disabled && (
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            size={14}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              searchAllCategories ? "Search all products..." : "Search parts..."
            }
            className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-8 pr-3 py-1.5 text-white text-xs focus:outline-none focus:border-orange-500"
          />
          {search.trim() && (
            <div className="absolute z-20 mt-1 w-full max-h-48 overflow-auto bg-slate-800 border border-slate-600 rounded-lg shadow-xl custom-scrollbar">
              {loading ? (
                <div className="px-3 py-2 text-xs text-slate-500">
                  Searching...
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-500">
                  No products found
                </div>
              ) : (
                results.map((product) => {
                  const outOfStock = (product.stock_quantity ?? 0) <= 0;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addPart(product)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-700/70 border-b border-slate-700/40 last:border-0"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate flex items-center gap-1.5">
                          {product.name}
                          {outOfStock && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/20 text-red-400 shrink-0">
                              Out of stock
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Stock: {product.stock_quantity ?? 0}
                        </div>
                      </div>
                      <span className="text-xs font-mono text-emerald-400 shrink-0">
                        ${(product.retail_price ?? 0).toFixed(2)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {parts.length > 0 && (
        <div className="space-y-1.5">
          {parts.map((part, index) => (
            <div
              key={part.id ?? `new-${index}`}
              className="flex items-center gap-2 bg-slate-900/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5"
            >
              <span className="flex-1 min-w-0 text-xs text-slate-200 truncate">
                {part.product_name}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    updateLine(index, {
                      quantity: Math.max(1, part.quantity - 1),
                    })
                  }
                  className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Minus size={10} />
                </button>
                <span className="w-6 text-center text-xs text-white font-mono">
                  {part.quantity}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    updateLine(index, { quantity: part.quantity + 1 })
                  }
                  className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={10} />
                </button>
              </div>
              <div className="relative w-20 shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]">
                  $
                </span>
                <DecimalInput
                  value={part.unit_price_usd}
                  onChange={(v) => updateLine(index, { unit_price_usd: v })}
                  disabled={disabled}
                  decimals={2}
                  data-testid={`part-unit-price-${part.product_id}`}
                  className="w-full bg-slate-800 border border-slate-600 rounded pl-4 pr-1.5 py-1 text-white text-xs font-mono focus:outline-none focus:border-orange-500 disabled:opacity-50"
                />
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeLine(index)}
                  className="p-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 shrink-0"
                  title="Remove part"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
