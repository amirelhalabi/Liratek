/**
 * "See transactions" (owner mock 2026-10-26, omt-settle-by-day §7): a table
 * of the PICKED days' transactions beside the settle calendar, so a statement
 * can be checked line by line without leaving the sheet.
 *
 * Columns: tick | # | transaction | part | name / ref | amount | left. One
 * header row per picked day with what its TICKED open rows leave, per
 * currency. Paid rows are greyed (disabled tick, "paid"). A search box
 * filters by reference, name or #id. × closes (`onClose`).
 *
 * Generic (OMT / suppliers, partners, client debts): no module imports. The
 * caller owns every money decision:
 *
 * - `rows` — any rows; only those on `pickedDays` are shown. Amounts are
 *   SIGNED as the caller's account reads them; `formatters` may word the
 *   sign (e.g. "owes you $200").
 * - `checked` — whether the row is in the settlement. It MUST come from the
 *   caller's own payload builder (the selection keys), never from a second
 *   derivation here (rule 14), so the subtotals equal the pre-fill.
 * - `onToggleRow(key)` — the SAME untick state the day details use; the
 *   caller re-renders with the new `checked`.
 * - `scrollToDay` — bump `seq` to scroll that day's header into view (a day
 *   picked while the table is open).
 *
 * Pair it with `SettleSheetLayout` (widening sheet) and the calendar's
 * `seeTransactions` prop (the "See transactions (N)" pill, N =
 * `countOpenSettleTransactions`).
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, X } from "lucide-react";
import { DirIcon } from "@liratek/ui/components/ui/DirIcon";
import { DEFAULT_SETTLE_FORMATTERS, joinCurrencyAmounts } from "./format";
import type { SettleFormatters } from "./types";
import type { SettleTransactionRow } from "./settleTransactions";

export interface SettleTransactionsPanelProps {
  rows: readonly SettleTransactionRow[];
  pickedDays: ReadonlySet<string>;
  /** Day header label, e.g. "Wed 22 Oct". */
  dayLabel: (day: string) => string;
  onToggleRow?: ((key: string) => void) | undefined;
  onClose: () => void;
  scrollToDay?: { day: string; seq: number } | null | undefined;
  loading?: boolean | undefined;
  error?: boolean | undefined;
  /** Heading; default "Transactions · picked days". */
  title?: string | undefined;
  /** Money wording; the defaults show the sign ("−$40.00"). */
  formatters?: Partial<Pick<SettleFormatters, "formatUsd" | "formatLbp">> | undefined;
}

function rowMoney(
  usd: number,
  lbp: number,
  f: Pick<SettleFormatters, "formatUsd" | "formatLbp">,
): string {
  return joinCurrencyAmounts(usd, lbp, f) || f.formatUsd(0);
}

export function SettleTransactionsPanel({
  rows,
  pickedDays,
  dayLabel,
  onToggleRow,
  onClose,
  scrollToDay,
  loading = false,
  error = false,
  title,
  formatters: overrides,
}: SettleTransactionsPanelProps) {
  const { t } = useTranslation("suppliers");
  const f = { ...DEFAULT_SETTLE_FORMATTERS, ...overrides };
  const headingId = useId();
  const [query, setQuery] = useState("");
  const dayRefs = useRef(new Map<string, HTMLTableRowElement>());

  const groups = useMemo(() => {
    const byDay = new Map<string, SettleTransactionRow[]>();
    for (const r of rows) {
      if (!pickedDays.has(r.day)) continue;
      const list = byDay.get(r.day);
      if (list) list.push(r);
      else byDay.set(r.day, [r]);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, list]) => {
        let usd = 0;
        let lbp = 0;
        for (const r of list) {
          if (r.status !== "open" || !r.checked) continue;
          usd += r.left_usd;
          lbp += r.left_lbp;
        }
        return { day, rows: list, usd, lbp };
      });
  }, [rows, pickedDays]);

  const q = query.trim().toLowerCase();
  const matches = (r: SettleTransactionRow): boolean =>
    !q ||
    `#${r.id} ${r.label} ${r.memberTag ?? ""} ${r.nameRef ?? ""}`
      .toLowerCase()
      .includes(q);

  const scrollDay = scrollToDay?.day;
  const scrollSeq = scrollToDay?.seq;
  const scrollBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollDay) return;
    const box = scrollBox.current;
    const row = dayRefs.current.get(scrollDay);
    if (!box || !row) return;
    // Only the table's own scroll box moves (never `scrollIntoView`, which
    // would also scroll the sheet / modal and move the calendar): the day
    // row lands just under the sticky header.
    const header = box.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    box.scrollTop +=
      row.getBoundingClientRect().top - box.getBoundingClientRect().top - header;
  }, [scrollDay, scrollSeq]);

  const visible = groups
    .map((g) => ({ ...g, shown: g.rows.filter(matches) }))
    .filter((g) => g.shown.length > 0);

  const th =
    "sticky top-0 z-[1] border-b border-slate-700 bg-slate-900 px-2.5 py-2 text-start text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase";
  const thEnd = `${th} text-end`;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="settle-transactions-panel"
      className="flex h-full min-h-0 flex-col bg-slate-950"
    >
      <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 pt-4 pb-3">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("accountSettle.transactions.back")}
          className="hidden rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-500 max-[899px]:inline-flex"
        >
          <DirIcon icon={ArrowLeft} className="size-4" aria-hidden="true" />
        </button>
        <h3 id={headingId} className="me-auto truncate text-[15px] font-bold text-white">
          {title ?? t("accountSettle.transactions.title")}
        </h3>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("accountSettle.transactions.searchPlaceholder")}
          aria-label={t("accountSettle.transactions.searchLabel")}
          className="w-[190px] min-w-0 rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1.5 text-[12.5px] text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={t("accountSettle.transactions.close")}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-500 max-[899px]:hidden"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      {(loading || error) && (
        <p
          className={`px-4 pt-2 text-xs ${error ? "text-red-400" : "text-slate-400"}`}
          role={error ? "alert" : undefined}
        >
          {error ? t("accountSettle.transactions.failed") : t("accountSettle.transactions.loading")}
        </p>
      )}

      <div
        ref={scrollBox}
        data-testid="settle-tx-scroll"
        className="min-h-0 flex-1 overflow-auto scroll-smooth motion-reduce:scroll-auto"
      >
        <table className="w-full min-w-[560px] border-collapse text-[12.5px] text-slate-300">
          <thead>
            <tr>
              <th className={th} />
              <th className={th}>{t("accountSettle.transactions.colId")}</th>
              <th className={th}>{t("accountSettle.transactions.colTransaction")}</th>
              <th className={th}>{t("accountSettle.transactions.colPart")}</th>
              <th className={th}>{t("accountSettle.transactions.colNameRef")}</th>
              <th className={thEnd}>{t("accountSettle.transactions.colAmount")}</th>
              <th className={thEnd}>{t("accountSettle.transactions.colLeft")}</th>
            </tr>
          </thead>
          <tbody>
            {pickedDays.size === 0 ? (
              <tr>
                <td colSpan={7} className="px-2.5 py-4 text-center text-xs text-slate-400">
                  {t("accountSettle.transactions.noDays")}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2.5 py-4 text-center text-xs text-slate-400">
                  {loading ? "" : t("accountSettle.transactions.noMatch")}
                </td>
              </tr>
            ) : (
              visible.map((g) => {
                const sub = joinCurrencyAmounts(g.usd, g.lbp, f);
                return [
                  <tr
                    key={`day-${g.day}`}
                    ref={(el) => {
                      if (el) dayRefs.current.set(g.day, el);
                      else dayRefs.current.delete(g.day);
                    }}
                    data-testid={`settle-tx-day-${g.day}`}
                    className="bg-slate-400/10"
                  >
                    <td colSpan={5} className="border-t border-slate-800 px-2.5 py-2 text-xs font-bold text-slate-300">
                      {dayLabel(g.day)}
                    </td>
                    <td
                      colSpan={2}
                      className="border-t border-slate-800 px-2.5 py-2 text-end font-mono text-xs font-bold whitespace-nowrap text-white tabular-nums"
                    >
                      {sub || "—"}
                    </td>
                  </tr>,
                  ...g.shown.map((r) => {
                    const open = r.status === "open";
                    const on = open && r.checked;
                    const dim = r.status === "paid" ? "opacity-45" : !on ? "opacity-50" : "";
                    const td = `border-t border-slate-800 px-2.5 py-2 align-middle ${dim}`;
                    const left =
                      r.status === "paid"
                        ? t("accountSettle.transactions.paid")
                        : r.status === "waiting"
                          ? (r.waitingNote ?? t("accountSettle.dayDetails.waitingForStatement"))
                          : on
                            ? rowMoney(r.left_usd, r.left_lbp, f)
                            : t("accountSettle.transactions.unticked");
                    return (
                      <tr key={r.key} data-testid={`settle-tx-row-${r.key}`}>
                        <td className={td}>
                          {r.status !== "waiting" && (
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!open || !onToggleRow}
                              onChange={() => onToggleRow?.(r.key)}
                              aria-label={t("accountSettle.dayDetails.includeRow", { id: r.id })}
                              className="size-[15px] accent-emerald-500"
                            />
                          )}
                        </td>
                        <td className={`${td} font-mono text-[11.5px] text-slate-400`}>#{r.id}</td>
                        <td className={`${td} font-semibold text-white`}>{r.label}</td>
                        <td className={td}>
                          {r.memberTag && (
                            <span className="rounded-[5px] bg-emerald-500/15 px-1.5 py-px text-[10px] font-bold text-emerald-300">
                              {r.memberTag}
                            </span>
                          )}
                        </td>
                        <td className={`${td} text-[11.5px] text-slate-400`}>{r.nameRef ?? ""}</td>
                        <td className={`${td} text-end font-mono whitespace-nowrap tabular-nums`}>
                          {rowMoney(r.amount_usd, r.amount_lbp, f)}
                        </td>
                        <td
                          className={`${td} text-end whitespace-nowrap ${on ? "font-mono tabular-nums" : "text-[11.5px]"}`}
                        >
                          {left}
                        </td>
                      </tr>
                    );
                  }),
                ];
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
