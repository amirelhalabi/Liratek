/**
 * LIRA-343: the legend under the settle calendar
 * (Settled · Partly paid · Unpaid · $ L badges).
 */
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

const MASK = "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px))";

const SETTLED: CSSProperties = { background: "rgba(16,185,129,.3)" };
const PARTIAL: CSSProperties = {
  background: "conic-gradient(#10b981 0 60%, #fb7185 60% 100%)",
  WebkitMask: MASK,
  mask: MASK,
};
const UNPAID: CSSProperties = { background: "#fb7185", WebkitMask: MASK, mask: MASK };

export function SettleLegend() {
  const { t } = useTranslation("suppliers");
  return (
    <div
      data-testid="settle-legend"
      className="flex flex-wrap justify-center gap-x-3.5 gap-y-1.5 text-[11px] text-slate-400"
    >
      <span className="inline-flex items-center gap-1.5">
        <i aria-hidden="true" className="inline-block size-[11px] rounded-full" style={SETTLED} />
        {t("accountSettle.calendar.legendSettled")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i aria-hidden="true" className="inline-block size-[11px] rounded-full" style={PARTIAL} />
        {t("accountSettle.calendar.legendPartial")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i aria-hidden="true" className="inline-block size-[11px] rounded-full" style={UNPAID} />
        {t("accountSettle.calendar.legendUnpaid")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-flex gap-0.5">
          <i className="rounded-[7px] bg-rose-400 px-1 text-[8px] leading-[14px] font-extrabold text-slate-950 not-italic">
            {t("accountSettle.calendar.badgeUsd")}
          </i>
          <i className="rounded-[7px] bg-emerald-500 px-1 text-[8px] leading-[14px] font-extrabold text-slate-950 not-italic">
            {t("accountSettle.calendar.badgeLbp")}
          </i>
        </span>
        {t("accountSettle.calendar.legendBadges")}
      </span>
    </div>
  );
}
