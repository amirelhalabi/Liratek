/**
 * LIRA-309 — the status chip a phone line shows (Phone Lines page, Settings →
 * Carrier Lines). The status itself comes from core's `classifyLineStatus`
 * (one rule for both kinds of line); this only colours and words it.
 */
import { classifyLineStatus, type LineStatusResult } from "@liratek/core";
import { localDay } from "@/shared/utils/localDay";
import { lineStatusText } from "@/features/phoneLines/utils/lineStatusText";

const STYLES: Record<LineStatusResult["status"], string> = {
  OK: "bg-emerald-500/15 text-emerald-400",
  EXPIRING: "bg-amber-500/20 text-amber-400",
  IN_GRACE: "bg-red-500/20 text-red-400",
  LOST: "bg-slate-600/30 text-slate-400 line-through",
  NO_EXPIRY: "bg-slate-600/30 text-slate-400",
};

export function LineStatusChip({
  expiry,
  warningDays,
  today = localDay(),
}: {
  expiry: string | null | undefined;
  warningDays: number;
  today?: string;
}) {
  const s = classifyLineStatus(expiry, today, warningDays);
  return (
    <span
      data-testid="line-status"
      data-status={s.status}
      className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${STYLES[s.status]}`}
    >
      {lineStatusText(s)}
    </span>
  );
}
