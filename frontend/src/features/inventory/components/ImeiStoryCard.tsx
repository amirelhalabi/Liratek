import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { useFormat } from "@/i18n/useFormat";
import type { UnitStoryEntry } from "../hooks/useProductUnits";
import { warrantyDisplayBadge } from "../productUnitsLogic";

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
  const { t } = useTranslation("inventory");
  const { formatDate } = useFormat();
  // The SAME mapping as the Phone Units table (LIRA-296 follow-up, owner
  // decision 2026-10-10): a unit on the shelf reads "Not sold".
  const badge = warrantyDisplayBadge({
    warranty: story.warranty,
    status: story.status,
    productWarrantyMonths: story.product_warranty_months,
  }, t);
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
        <div className="text-sm font-semibold text-white flex items-center gap-2">
          <span>{story.product_name ?? t("story.unknownProduct")}</span>
          {/* LIRA-172 — mirrors the Phone Units register's chip
              (PhoneUnits/index.tsx), same muted/secondary styling (never an
              alarm color): a sold unit of a soft-deleted product stays
              findable here (it is history), but nothing else on this card
              said the product was gone. */}
          {story.product_deleted === 1 && (
            <span
              data-testid="imei-story-product-deleted"
              title={t("unit.productDeletedTitle")}
              className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-700/40 text-slate-400 border-slate-600/40"
            >
              {t("unit.productDeleted")}
            </span>
          )}
        </div>
        <div className="text-xs font-mono text-slate-400">
          <Ltr>{story.imei}</Ltr>
        </div>
      </div>

      <span className={`text-xs px-2 py-1 rounded border ${statusBadgeClass}`}>
        {t(`unit.status.${story.status}`)}
      </span>

      {!!story.is_defective && (
        <span className="text-xs px-2 py-1 rounded border bg-red-500/10 text-red-400 border-red-500/30">
          {t("unit.defective")}
        </span>
      )}

      <div className="text-xs text-slate-400">
        {t("story.sold")}{" "}
        <span className="text-slate-300">
          {story.sold_at
            ? formatDate(parseDbDate(story.sold_at), {
                year: "numeric",
                month: "numeric",
                day: "numeric",
              })
            : "—"}
        </span>
      </div>

      <div className="text-xs text-slate-400">
        {t("story.price")}{" "}
        <Ltr className="text-slate-300">
          {story.sold_price_usd != null
            ? `$${story.sold_price_usd.toFixed(2)}`
            : "—"}
        </Ltr>
      </div>

      <div className="text-xs text-slate-400">
        {t("story.client")}{" "}
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
