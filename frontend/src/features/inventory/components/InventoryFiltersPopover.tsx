/**
 * InventoryFiltersPopover — the numeric half of the product-list filters
 * (Cost / Retail / Profit % / Stock min-max pairs).
 *
 * Category, Supplier and the Added date range live INLINE in the toolbar;
 * only the four numeric ranges are tucked behind this button so the toolbar
 * stays one row on a normal screen.
 */

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { SlidersHorizontal } from "lucide-react";
import type {
  NumericFilterField,
  ProductFiltersUiState,
} from "../productListFilters";

interface NumericRange {
  label: string;
  minField: NumericFilterField;
  maxField: NumericFilterField;
  /** testid stem — inputs become `inventory-filter-<stem>-min` / `-max`. */
  testIdStem: string;
  step?: string;
}

const RANGES: NumericRange[] = [
  {
    label: "Cost ($)",
    minField: "costMin",
    maxField: "costMax",
    testIdStem: "cost",
    step: "0.01",
  },
  {
    label: "Retail ($)",
    minField: "retailMin",
    maxField: "retailMax",
    testIdStem: "retail",
    step: "0.01",
  },
  {
    label: "Profit (%)",
    minField: "profitPctMin",
    maxField: "profitPctMax",
    testIdStem: "profit",
    step: "0.1",
  },
  {
    label: "Stock (units)",
    minField: "stockMin",
    maxField: "stockMax",
    testIdStem: "stock",
    step: "1",
  },
];

export interface InventoryFiltersPopoverProps {
  filters: ProductFiltersUiState;
  onFieldChange: (field: NumericFilterField, value: string) => void;
  onReset: () => void;
  /** How many numeric bounds are set — rendered as the button's badge. */
  activeCount: number;
}

const inputClass =
  "w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 " +
  "text-white text-sm focus:outline-none focus:border-violet-500";

export function InventoryFiltersPopover({
  filters,
  onFieldChange,
  onReset,
  activeCount,
}: InventoryFiltersPopoverProps) {
  return (
    <Popover className="relative">
      <PopoverButton
        data-testid="inventory-filters-button"
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors outline-none ${
          activeCount > 0
            ? "border-violet-500/60 bg-violet-600/15 text-violet-300 hover:bg-violet-600/25"
            : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-700/50"
        }`}
      >
        <SlidersHorizontal size={16} />
        Filters
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center rounded bg-violet-600/30 px-1.5 py-0.5 text-xs font-medium text-violet-200">
            {activeCount}
          </span>
        )}
      </PopoverButton>

      {/* `anchor` portals the panel into the shared headlessui portal root —
          it needs its own z-index to rank above the app's modals, same
          reasoning (and same ceiling) as the shared Select's z-[500]. */}
      <PopoverPanel
        anchor="bottom start"
        className="z-[500] mt-2 w-80 rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-2xl"
      >
        <div className="space-y-3">
          {RANGES.map((range) => (
            <div key={range.testIdStem}>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                {range.label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={range.step}
                  placeholder="Min"
                  data-testid={`inventory-filter-${range.testIdStem}-min`}
                  value={filters[range.minField]}
                  onChange={(e) =>
                    onFieldChange(range.minField, e.target.value)
                  }
                  className={inputClass}
                />
                <span className="text-slate-500">–</span>
                <input
                  type="number"
                  step={range.step}
                  placeholder="Max"
                  data-testid={`inventory-filter-${range.testIdStem}-max`}
                  value={filters[range.maxField]}
                  onChange={(e) =>
                    onFieldChange(range.maxField, e.target.value)
                  }
                  className={inputClass}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end border-t border-slate-700 pt-3">
          <button
            type="button"
            onClick={onReset}
            data-testid="inventory-filters-reset"
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700"
          >
            Reset
          </button>
        </div>
      </PopoverPanel>
    </Popover>
  );
}

export default InventoryFiltersPopover;
