/**
 * LIRA-343 (spec US4, FR-016, FR-016a, FR-016c): what is behind one day of
 * the settle calendar.
 *
 * Per row: "#id label [member tag]", its amount, a paid bar per currency, one
 * "$50.00 paid by #10057" line per settlement (the last one ending
 * "· $47.00 left" while some is still open), and the tags "Added after
 * settlement" (R7) and "Waiting for its statement type" (R9).
 *
 * When the day is picked, every OPEN row gets a checkbox: unticking leaves
 * that row out of the settlement (the caller owns `unticked` and feeds it to
 * `buildDaySelections`), and the day then reads "Partly picked".
 *
 * Generic: no supplier / OMT imports; the caller passes ready labels.
 */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { DEFAULT_SETTLE_FORMATTERS } from "./format";
import type { SettleFormatters } from "./types";

export interface SettleDayDetailsSettlement {
  transaction_id: number;
  settled_at: string;
  currency: "USD" | "LBP";
  amount: number;
}

export interface SettleDayDetailsRow {
  /** Stable row key, the same one `unticked` holds. */
  key: string;
  id: number;
  label: string;
  /** Which part of the account the row belongs to, e.g. "OMT App". */
  memberTag: string | null;
  amount_usd: number;
  amount_lbp: number;
  covered_usd: number;
  covered_lbp: number;
  remaining_usd: number;
  remaining_lbp: number;
  /** Active coverage only. */
  settlements: SettleDayDetailsSettlement[];
  addedAfterSettlement: boolean;
  waitingForStatement: boolean;
}

export interface SettleDayDetailsProps {
  /** `YYYY-MM-DD`, the shop's day. */
  day: string;
  /** Display label, e.g. "21 Oct"; also the panel's accessible name. */
  dayLabel: string;
  rows: SettleDayDetailsRow[];
  picked: boolean;
  unticked: ReadonlySet<string>;
  /** Called with a row key; only offered on open rows of a picked day. */
  onToggleRow?: ((key: string) => void) | undefined;
  onSeeInTransactions?: (() => void) | undefined;
  onClose: () => void;
  formatters?: Partial<Pick<SettleFormatters, "formatUsd" | "formatLbp">> | undefined;
}

const USD_EPS = 0.005;
const LBP_EPS = 0.5;

function isOpenRow(r: SettleDayDetailsRow): boolean {
  return r.remaining_usd >= USD_EPS || r.remaining_lbp >= LBP_EPS;
}

function paidPct(covered: number, amount: number): number {
  if (amount <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, covered / amount)) * 100);
}

const LINK =
  "border-0 bg-transparent p-0 text-xs font-semibold text-slate-400 underline underline-offset-[3px] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 rounded";

const TAG = "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold";

export function SettleDayDetails({
  dayLabel,
  rows,
  picked,
  unticked,
  onToggleRow,
  onSeeInTransactions,
  onClose,
  formatters: overrides,
}: SettleDayDetailsProps) {
  const { t } = useTranslation("suppliers");
  const f = { ...DEFAULT_SETTLE_FORMATTERS, ...overrides };
  const headingId = useId();

  const partlyPicked = picked && rows.some((r) => isOpenRow(r) && unticked.has(r.key));

  /** One line per settlement in this currency; the last carries "· x left". */
  function currencyLines(r: SettleDayDetailsRow, currency: "USD" | "LBP"): string[] {
    const fmt = currency === "USD" ? f.formatUsd : f.formatLbp;
    const remaining = currency === "USD" ? r.remaining_usd : r.remaining_lbp;
    const eps = currency === "USD" ? USD_EPS : LBP_EPS;
    const paid = r.settlements
      .filter((s) => s.currency === currency)
      .map((s) =>
        t("accountSettle.dayDetails.paidBy", { amount: fmt(s.amount), id: s.transaction_id }),
      );
    if (remaining < eps) return paid;
    const left = t("accountSettle.dayDetails.left", { amount: fmt(remaining) });
    if (paid.length === 0) return [left];
    paid[paid.length - 1] = `${paid[paid.length - 1]} · ${left}`;
    return paid;
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="settle-day-details"
      className="rounded-xl border border-slate-700 bg-slate-800 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <h3 id={headingId} className="text-sm font-bold text-white">
          {dayLabel}
        </h3>
        {partlyPicked && (
          <span className={`${TAG} bg-amber-500/15 text-amber-300`}>
            {t("accountSettle.dayDetails.partlyPicked")}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("accountSettle.dayDetails.close")}
          className="ms-auto rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-500"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500">
          {t("accountSettle.dayDetails.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-700/70">
          {rows.map((r) => {
            const open = isOpenRow(r);
            const included = !unticked.has(r.key);
            const showBox = picked && open && !!onToggleRow;
            const bars: Array<{ currency: "USD" | "LBP"; pct: number }> = [];
            if (r.amount_usd >= USD_EPS)
              bars.push({ currency: "USD", pct: paidPct(r.covered_usd, r.amount_usd) });
            if (r.amount_lbp >= LBP_EPS)
              bars.push({ currency: "LBP", pct: paidPct(r.covered_lbp, r.amount_lbp) });
            const lines = [...currencyLines(r, "USD"), ...currencyLines(r, "LBP")];
            const amountParts: string[] = [];
            if (r.amount_usd >= USD_EPS) amountParts.push(f.formatUsd(r.amount_usd));
            if (r.amount_lbp >= LBP_EPS) amountParts.push(f.formatLbp(r.amount_lbp));
            return (
              <li
                key={r.key}
                data-testid={`settle-day-row-${r.key}`}
                className={`flex gap-2.5 py-2 ${picked && open && !included ? "opacity-55" : ""}`}
              >
                {showBox && (
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={() => onToggleRow?.(r.key)}
                    aria-label={t("accountSettle.dayDetails.includeRow", { id: r.id })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-xs text-slate-500">#{r.id}</span>
                    <span className="truncate text-sm text-white">{r.label}</span>
                    {r.memberTag && (
                      <span className={`${TAG} bg-slate-700 text-slate-200`}>{r.memberTag}</span>
                    )}
                    <span className="ms-auto font-mono text-sm text-white tabular-nums">
                      {amountParts.join(" + ")}
                    </span>
                  </div>
                  {bars.map((b) => (
                    <div
                      key={b.currency}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={b.pct}
                      aria-label={t("accountSettle.dayDetails.paidBar", {
                        currency: b.currency === "USD" ? "$" : t("accountSettle.calendar.lbp"),
                      })}
                      className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rose-400/30"
                    >
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${b.pct}%` }} />
                    </div>
                  ))}
                  {lines.map((line, i) => (
                    <div key={i} className="mt-1 text-xs text-slate-400 tabular-nums">
                      {line}
                    </div>
                  ))}
                  {(r.addedAfterSettlement || r.waitingForStatement) && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {r.addedAfterSettlement && (
                        <span className={`${TAG} bg-sky-500/15 text-sky-300`}>
                          {t("accountSettle.dayDetails.addedAfterSettlement")}
                        </span>
                      )}
                      {r.waitingForStatement && (
                        <span className={`${TAG} bg-amber-500/15 text-amber-300`}>
                          {t("accountSettle.dayDetails.waitingForStatement")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {onSeeInTransactions && (
        <div className="mt-2 flex justify-end">
          <button type="button" className={LINK} onClick={onSeeInTransactions}>
            {t("accountSettle.dayDetails.seeInTransactions")}
          </button>
        </div>
      )}
    </section>
  );
}
