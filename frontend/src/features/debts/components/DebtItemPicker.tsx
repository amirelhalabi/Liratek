/**
 * LIRA-304 (spec US2, FR-006/FR-007) — the repayment screen's list of open
 * debt items. Separate visits are one line each; the items of a session
 * basket are grouped under "Session #N basket" and can be ticked one by
 * one. Ticking is optional: nothing ticked = today's order.
 */
import type { OpenDebtItem, DebtItemRef } from "@liratek/core";

interface DebtItemPickerProps {
  items: OpenDebtItem[];
  selected: DebtItemRef[];
  onChange: (next: DebtItemRef[]) => void;
}

const sameRef = (a: DebtItemRef, b: DebtItemRef): boolean =>
  a.kind === b.kind && a.id === b.id;

function openText(item: OpenDebtItem): string {
  return [
    item.openUsd > 0.004 ? `$${item.openUsd.toFixed(2)}` : "",
    item.openLbp > 0.5 ? `${Math.round(item.openLbp).toLocaleString()} LBP` : "",
  ]
    .filter(Boolean)
    .join(" + ");
}

export default function DebtItemPicker({
  items,
  selected,
  onChange,
}: DebtItemPickerProps) {
  if (items.length === 0) return null;

  const toggle = (item: OpenDebtItem) => {
    const ref = { kind: item.kind, id: item.id };
    onChange(
      selected.some((s) => sameRef(s, ref))
        ? selected.filter((s) => !sameRef(s, ref))
        : [...selected, ref],
    );
  };

  // Group basket items under their session; everything else stands alone,
  // in the order the server returned (oldest first).
  const groups: Array<{ sessionId: number | null; items: OpenDebtItem[] }> =
    [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (item.sessionId != null && last && last.sessionId === item.sessionId) {
      last.items.push(item);
    } else {
      groups.push({ sessionId: item.sessionId, items: [item] });
    }
  }

  const row = (item: OpenDebtItem, indent: boolean) => {
    const checked = selected.some(
      (s) => s.kind === item.kind && s.id === item.id,
    );
    return (
      <label
        key={`${item.kind}-${item.id}`}
        data-testid={`debt-item-${item.kind}-${item.id}`}
        className={`flex items-center gap-2 py-1.5 text-sm cursor-pointer ${
          indent ? "pl-4" : ""
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggle(item)}
          className="accent-emerald-500"
        />
        <span className="flex-1 min-w-0 truncate text-slate-200">
          {item.label}
        </span>
        {item.isPrimary && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300 shrink-0">
            Cash drawer
          </span>
        )}
        <span className="font-mono text-slate-300 shrink-0">
          {openText(item)}
        </span>
      </label>
    );
  };

  return (
    <div
      data-testid="debt-item-picker"
      className="bg-slate-800/50 border border-slate-700/40 rounded-xl p-3"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-300 uppercase tracking-wider">
          Open debt — what is this payment for?
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] text-slate-400 hover:text-slate-200"
          >
            Clear
          </button>
        )}
      </div>
      <div className="divide-y divide-slate-700/40 max-h-56 overflow-y-auto">
        {groups.map((g, gi) =>
          g.sessionId != null ? (
            <div key={`session-${g.sessionId}-${gi}`} className="py-1">
              <div className="text-xs text-slate-400 py-1">
                Session #{g.sessionId} basket
              </div>
              {g.items.map((i) => row(i, true))}
            </div>
          ) : (
            g.items.map((i) => row(i, false))
          ),
        )}
      </div>
      <p className="text-[11px] text-slate-500 mt-1">
        Nothing ticked = cash drawer first, then oldest first.
      </p>
    </div>
  );
}
