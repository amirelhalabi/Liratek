import { parseDbDate } from "@/shared/utils/parseDbDate";
import type { UnitStoryEntry } from "../hooks/useProductUnits";
import { warrantyStoryBadge } from "../productUnitsLogic";

export interface ImeiStoryCardProps {
  story: UnitStoryEntry;
}

/**
 * LIRA-143 Phase 6b — the walk-in lookup card (decision #7): one unit's full
 * story (product, sale, client, warranty verdict). Exported as a named
 * export so it can be reused as-is from POS (a later task) alongside the
 * Inventory page wiring below.
 */
export function ImeiStoryCard({ story }: ImeiStoryCardProps) {
  // The BACKWARD-looking mapping (`warrantyStoryBadge`), NOT the Phone Units
  // table's forward-looking one. The two agree on every case except a VOID
  // verdict on an in-stock unit: the table shows what the unit's next sale
  // will carry, this card shows what happened to the sale that was refunded
  // ("Void (refunded)") — which is the fact the card exists to report. Both
  // still read "N mo — starts at sale" for a never-sold unit of a model that
  // grants a term (nothing happened to its warranty, so there is no past
  // fact to preserve).
  const badge = warrantyStoryBadge({
    warranty: story.warranty,
    status: story.status,
    productWarrantyMonths: story.product_warranty_months,
  });
  const statusBadgeClass =
    story.status === "IN_STOCK"
      ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
      : "bg-slate-700/40 text-slate-300 border-slate-600/40";

  return (
    <div
      data-testid="imei-story-card"
      className="bg-slate-800 rounded-xl border border-slate-700/50 p-4 flex flex-wrap items-center gap-4"
    >
      <div className="min-w-[160px]">
        <div className="text-sm font-semibold text-white">
          {story.product_name ?? "Unknown product"}
        </div>
        <div className="text-xs font-mono text-slate-400">{story.imei}</div>
      </div>

      <span className={`text-xs px-2 py-1 rounded border ${statusBadgeClass}`}>
        {story.status}
      </span>

      {!!story.is_defective && (
        <span className="text-xs px-2 py-1 rounded border bg-red-500/10 text-red-400 border-red-500/30">
          Defective
        </span>
      )}

      <div className="text-xs text-slate-400">
        Sold:{" "}
        <span className="text-slate-300">
          {story.sold_at ? parseDbDate(story.sold_at).toLocaleDateString() : "—"}
        </span>
      </div>

      <div className="text-xs text-slate-400">
        Price:{" "}
        <span className="text-slate-300">
          {story.sold_price_usd != null
            ? `$${story.sold_price_usd.toFixed(2)}`
            : "—"}
        </span>
      </div>

      <div className="text-xs text-slate-400">
        Client:{" "}
        <span className="text-slate-300">{story.client_name ?? "—"}</span>
      </div>

      <span
        data-testid="imei-story-warranty-badge"
        className={`text-xs px-2 py-1 rounded border ${badge.className}`}
      >
        {badge.label}
      </span>
    </div>
  );
}

export default ImeiStoryCard;
