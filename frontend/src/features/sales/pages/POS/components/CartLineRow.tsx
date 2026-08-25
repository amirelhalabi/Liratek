import { Trash2, Plus, Minus } from "lucide-react";
import type { CartItem } from "@liratek/ui";
import { useInStockUnitsQuery } from "@/features/sales/hooks/useProductUnits";
import {
  resolveCartLineMode,
  shouldAlwaysAddNewLine,
} from "@/features/sales/utils/cartGate";
import { getCartLineKey } from "@/features/sales/utils/cartLineKey";

interface CartLineRowProps {
  item: CartItem;
  /** The full cart, used only to filter units already claimed by OTHER
   *  lines of the same product out of this line's picker options. */
  allItems: CartItem[];
  onUpdateQuantity: (lineKey: string, delta: number) => void;
  onRemoveItem: (lineKey: string) => void;
  onUpdateIMEI: (lineKey: string, imei: string) => void;
  onSelectUnit: (
    lineKey: string,
    unit: { id: number; imei: string } | null,
  ) => void;
}

/**
 * One cart row. LIRA-143 phase 6a extracted this out of Cart.tsx because it
 * now needs a per-product IN_STOCK-units query (resolveCartLineMode) to
 * decide between the unit picker, the free-text IMEI input, and neither —
 * hooks can't be called conditionally inside Cart.tsx's `.map`, so each row
 * is its own component instead.
 */
export function CartLineRow({
  item,
  allItems,
  onUpdateQuantity,
  onRemoveItem,
  onUpdateIMEI,
  onSelectUnit,
}: CartLineRowProps) {
  const lineKey = getCartLineKey(item);
  const { data: units = [] } = useInStockUnitsQuery(
    item.tracks_imei_units ? item.id : null,
  );
  const mode = resolveCartLineMode(item.tracks_imei_units, units.length);
  const isLockedQty = shouldAlwaysAddNewLine(mode);

  // Units already picked on OTHER lines of the SAME product must not be
  // offered here — but this line's OWN current selection stays an option
  // (it needs to keep showing as selected).
  const usedElsewhere = new Set(
    allItems
      .filter(
        (other) => other.id === item.id && getCartLineKey(other) !== lineKey,
      )
      .map((other) => other.product_unit_id)
      .filter((id): id is number => id != null),
  );
  const unitOptions = units.filter(
    (u) => u.id === item.product_unit_id || !usedElsewhere.has(u.id),
  );

  return (
    <div className="bg-slate-700/30 rounded-xl p-3 border border-slate-700/50 flex gap-3 group hover:bg-slate-700/50 transition-all">
      <div className="flex-1">
        <h4 className="font-medium text-slate-200 text-sm line-clamp-1">
          {item.name}
        </h4>
        <div className="text-xs text-slate-500 mt-1">
          ${item.retail_price.toFixed(2)} / unit
        </div>

        {mode === "free-text" && (
          <div className="mt-2">
            <input
              type="text"
              placeholder="Enter IMEI / Serial"
              value={item.imei || ""}
              onChange={(e) => onUpdateIMEI(lineKey, e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-2 py-1 text-[10px] text-white focus:border-violet-500/50 outline-none placeholder:text-slate-600 font-mono"
            />
          </div>
        )}

        {mode === "unit-picker" && (
          <div className="mt-2">
            <select
              value={item.product_unit_id ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (!raw) {
                  onSelectUnit(lineKey, null);
                  return;
                }
                const unitId = Number(raw);
                const unit = unitOptions.find((u) => u.id === unitId);
                if (unit) {
                  onSelectUnit(lineKey, { id: unit.id, imei: unit.imei });
                }
              }}
              className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-2 py-1 text-[10px] text-white focus:border-violet-500/50 outline-none font-mono"
            >
              <option value="">Select IMEI / Serial…</option>
              {unitOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.imei}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="font-bold text-violet-400">
          ${(item.retail_price * item.quantity).toFixed(2)}
        </div>

        <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1 border border-slate-700">
          <button
            onClick={() => onUpdateQuantity(lineKey, -1)}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-30"
            disabled={item.quantity <= 1 || isLockedQty}
            aria-label="Decrease quantity"
            title={
              isLockedQty
                ? "Locked at 1 — each IMEI/unit is its own line"
                : undefined
            }
          >
            <Minus size={12} />
          </button>
          <span className="text-xs font-mono w-4 text-center text-white">
            {item.quantity}
          </span>
          <button
            onClick={() => onUpdateQuantity(lineKey, 1)}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-30"
            disabled={isLockedQty}
            aria-label="Increase quantity"
            title={
              isLockedQty
                ? "Locked at 1 — each IMEI/unit is its own line"
                : undefined
            }
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <button
        onClick={() => onRemoveItem(lineKey)}
        className="self-center p-2 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all -mr-2"
        aria-label="Remove item"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
