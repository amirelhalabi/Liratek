/**
 * LIRA-347 (owner decisions 2026-10-26) — the LIRA-343 settle-by-day
 * calendar for a CLIENT's debts, inside the Debts page's repayment modal.
 *
 * D1  The cashier picks days; the page then pays them through today's
 *     repayment (the picked days' items become the picker's ticks and the
 *     amount fills to what they owe). Every pick goes through ONE builder,
 *     `buildDebtDayTargets` (rule 22), and is reported with `onPlan`.
 * D2  "Use credit [x] of [total]" per currency, pre-filled with
 *     min(owed of the picked days, credit); the payment fills to the rest.
 * D3  Debt with no item (manual / imported / opening balance) and the
 *     credit sit on no day: they are account lines under the calendar.
 *
 * Generic calendar pieces come from `@/shared/components/settleCalendar`;
 * days are painted by core `buildSettleDays` from the server's month rows
 * (each row's shop day computed server-side, rule 27). Currency strict: one
 * state per day, $ / L badges like OMT.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import { formatNumber } from "@liratek/ui/i18n/format";
import {
  buildDebtDayTargets,
  buildSettleDays,
  daySelectionRowKey,
  debtItemsToSettleRows,
  isSettleRowOpen,
  monthLeft as sumMonthLeft,
  type DebtAccountLines,
  type DebtDayTargets,
  type DebtMonthRows,
  type OpenDebtItem,
} from "@liratek/core";
import { useFormat } from "@/i18n/useFormat";
import { localDay } from "@/shared/utils/localDay";
import logger from "@/utils/logger";
import {
  countOpenSettleTransactions,
  SettleCalendar,
  SettleSelectionBar,
  SettleTransactionsPanel,
  type SettleTransactionRow,
} from "@/shared/components/settleCalendar";

export interface DebtDayCalendarProps {
  clientId: number;
  /** The repayment screen's open items (with `shopDay`). */
  openItems: readonly OpenDebtItem[];
  /** Called on every pick / credit change with the ONE plan (rule 22). */
  onPlan: (plan: DebtDayTargets) => void;
}

/** `YYYY-MM` shifted by `delta` months. Pure arithmetic, no clock. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const mon = (index % 12) + 1;
  return `${year}-${mon < 10 ? `0${mon}` : mon}`;
}

/** A local-midnight Date for a `YYYY-MM-DD` key — display labels only. */
function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d || 1);
}

const fmtUsd = (n: number): string => `$${n.toFixed(2).replace(/\.00$/, "")}`;
const fmtLbp = (n: number): string => `${formatNumber(Math.round(n))} LBP`;

type Ccy = "USD" | "LBP";
const NO_LINES: DebtAccountLines = {
  earlier_usd: 0,
  earlier_lbp: 0,
  credit_usd: 0,
  credit_lbp: 0,
};

export default function DebtDayCalendar({
  clientId,
  openItems,
  onPlan,
}: DebtDayCalendarProps) {
  const { t } = useTranslation("debts");
  const fmt = useFormat();
  const api = useApi();
  // Rule 25 — `api` and `onPlan` read through refs, never as effect deps.
  // Refreshed after every render (declared before the effects that read
  // them, so they run first).
  const apiRef = useRef(api);
  const onPlanRef = useRef(onPlan);
  const monthCacheRef = useRef<Readonly<Record<string, DebtMonthRows>>>({});
  useEffect(() => {
    apiRef.current = api;
    onPlanRef.current = onPlan;
    monthCacheRef.current = monthCache;
  });

  // The shop's today from THIS device (rule 27), fixed while open.
  const today = useMemo(() => localDay(), []);
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<DebtMonthRows | null>(null);
  const [failed, setFailed] = useState(false);
  // The account lines come with the first month read; kept across months.
  const [account, setAccount] = useState<DebtAccountLines | null>(null);
  // "See transactions": every month read so far, by `<clientId>:<YYYY-MM>`
  // (the table shows paid items of picked days in any month; keyed by
  // client so another client's rows never show).
  const [monthCache, setMonthCache] = useState<
    Readonly<Record<string, DebtMonthRows>>
  >({});

  useEffect(() => {
    let cancelled = false;
    apiRef.current
      .getDebtMonthRows(clientId, month)
      .then((res) => {
        if (cancelled) return;
        setFailed(false);
        setData(res);
        setAccount((prev) => prev ?? res.account);
        setMonthCache((prev) => ({ ...prev, [`${clientId}:${res.month}`]: res }));
      })
      .catch((error: unknown) => {
        logger.error("Failed to load the debt month", { error });
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, month]);

  const days = useMemo(
    () =>
      data && data.month === month
        ? buildSettleDays(data.rows, { today, month })
        : [],
    [data, month, today],
  );
  const openRows = useMemo(() => debtItemsToSettleRows(openItems), [openItems]);
  /** Every open day up to today, any month ("Pick all open"). */
  const openDays = useMemo(
    () =>
      [
        ...new Set(
          openRows.filter((r) => r.shop_day <= today).map((r) => r.shop_day),
        ),
      ].sort(),
    [openRows, today],
  );

  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // null = the builder's pre-fill (min of what the days owe and the credit).
  const [creditInput, setCreditInput] = useState<Record<Ccy, string | null>>({
    USD: null,
    LBP: null,
  });

  const lines = account ?? NO_LINES;
  const planFor = (
    nextPicked: ReadonlySet<string>,
    nextUnticked: ReadonlySet<string>,
    nextCredit: Record<Ccy, string | null>,
  ): DebtDayTargets => {
    const num = (v: string | null): number | undefined => {
      if (v === null) return undefined;
      const n = parseFloat(v.replace(/,/g, ""));
      return Number.isFinite(n) ? n : 0;
    };
    const usd = num(nextCredit.USD);
    const lbp = num(nextCredit.LBP);
    return buildDebtDayTargets(openItems, {
      pickedDays: nextPicked,
      untickedRows: nextUnticked,
      credit: { usd: lines.credit_usd, lbp: lines.credit_lbp },
      creditUsed: {
        ...(usd !== undefined ? { usd } : {}),
        ...(lbp !== undefined ? { lbp } : {}),
      },
    });
  };
  const plan = planFor(picked, unticked, creditInput);

  /** Apply a change and report the new plan (events only — never an
   *  effect, so opening the calendar changes nothing on its own). */
  const change = (
    nextPicked: ReadonlySet<string>,
    nextUnticked: ReadonlySet<string>,
    nextCredit: Record<Ccy, string | null>,
  ) => {
    setPicked(nextPicked);
    setUnticked(nextUnticked);
    setCreditInput(nextCredit);
    onPlanRef.current(planFor(nextPicked, nextUnticked, nextCredit));
  };

  const toggleDay = (day: string) => {
    const next = new Set(picked);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    // A change of days re-fills the credit from the new days.
    change(next, unticked, { USD: null, LBP: null });
  };
  const toggleRow = (key: string) => {
    const next = new Set(unticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    change(picked, next, { USD: null, LBP: null });
  };

  const pickedSorted = [...picked].sort();
  const newest = pickedSorted[pickedSorted.length - 1] ?? null;
  const leftOutDays = new Set(
    newest === null ? [] : openDays.filter((d) => d < newest && !picked.has(d)),
  );
  const partlyPicked = new Set(
    openRows
      .filter(
        (r) =>
          picked.has(r.shop_day) &&
          isSettleRowOpen(r) &&
          unticked.has(daySelectionRowKey(r)),
      )
      .map((r) => r.shop_day),
  );
  const earlier = openDays.filter((d) => d.slice(0, 7) < month && !picked.has(d));
  const olderMonth = earlier.length
    ? earlier[earlier.length - 1].slice(0, 7)
    : null;
  const olderUnselected = olderMonth
    ? {
        count: earlier.filter((d) => d.startsWith(`${olderMonth}-`)).length,
        monthLabel: fmt.formatDate(dayDate(`${olderMonth}-01`), {
          month: "long",
        }),
        onOpen: () => setMonth(olderMonth),
      }
    : undefined;

  const dayLabel = (day: string) =>
    fmt.formatDate(dayDate(day), { day: "numeric", month: "short" });

  // ── See transactions (owner mock 2026-10-26 §7) ─────────────────────────
  // The picked days' items, paid ones too, under the calendar (the calendar
  // sits inside the repayment modal, so the table opens below it instead of
  // widening a sheet). Paid items and full amounts from the month reads of
  // every month with a picked day; open items, what is left and the tick
  // from `openItems` and the ONE plan's targets (rules 14 / 22). Unticking
  // here is `toggleRow`, so `onPlan` follows.
  const [txOpen, setTxOpen] = useState(false);
  const [txScroll, setTxScroll] = useState<{ day: string; seq: number } | null>(
    null,
  );
  const [txFailed, setTxFailed] = useState(false);
  const txPanelId = useId();
  const txRequested = useRef(new Set<string>());
  const txMonthsKey = [...new Set(pickedSorted.map((d) => d.slice(0, 7)))].join(
    ",",
  );
  useEffect(() => {
    if (!txOpen || !txMonthsKey) return;
    for (const m of txMonthsKey.split(",")) {
      const key = `${clientId}:${m}`;
      if (monthCacheRef.current[key] || txRequested.current.has(key)) continue;
      txRequested.current.add(key);
      apiRef.current
        .getDebtMonthRows(clientId, m)
        .then((res) =>
          setMonthCache((prev) => ({ ...prev, [`${clientId}:${res.month}`]: res })),
        )
        .catch((error: unknown) => {
          logger.error("Failed to load the debt month", { error });
          txRequested.current.delete(key);
          setTxFailed(true);
        });
    }
  }, [txOpen, txMonthsKey, clientId]);

  const kindLabel = (kind: string): string =>
    kind === "sale"
      ? t("dayCalendar.kindSale")
      : kind === "member"
        ? t("dayCalendar.kindMember")
        : t("dayCalendar.kindCharge");
  const txRows: SettleTransactionRow[] = (() => {
    const openByKey = new Map(
      openItems
        .filter((it) => it.kind !== "balance" && it.shopDay)
        .map((it) => [daySelectionRowKey(it), it]),
    );
    const ticked = new Set(plan.targets.map((r) => daySelectionRowKey(r)));
    const out = new Map<string, SettleTransactionRow>();
    const build = (
      key: string,
      kind: string,
      id: number,
      day: string,
      type: string | null,
      label: string,
      amount: { usd: number; lbp: number },
    ): SettleTransactionRow => {
      const it = openByKey.get(key);
      const open = !!it && (it.openUsd > 0.004 || it.openLbp > 0.5);
      return {
        key,
        id,
        day,
        label: kindLabel(kind),
        memberTag: type ? type.replace(/_/g, " ") : null,
        nameRef: label || null,
        amount_usd: amount.usd,
        amount_lbp: amount.lbp,
        left_usd: open ? it.openUsd : 0,
        left_lbp: open ? it.openLbp : 0,
        status: open ? "open" : "paid",
        checked: ticked.has(key),
      };
    };
    for (const [cacheKey, m] of Object.entries(monthCache)) {
      if (!cacheKey.startsWith(`${clientId}:`)) continue;
      for (const r of m.rows) {
        if (r.row_scope !== "DAY" || !picked.has(r.shop_day)) continue;
        const key = daySelectionRowKey(r);
        out.set(
          key,
          build(key, r.kind, r.id, r.shop_day, r.type, r.label, {
            usd: r.amount_usd,
            lbp: r.amount_lbp,
          }),
        );
      }
    }
    // A month not read yet: its open items still show.
    for (const [key, it] of openByKey) {
      const day = it.shopDay as string;
      if (!picked.has(day) || out.has(key)) continue;
      out.set(
        key,
        build(key, it.kind, it.id, day, it.type, it.label, {
          usd: it.openUsd,
          lbp: it.openLbp,
        }),
      );
    }
    return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
  })();
  const txCount = countOpenSettleTransactions(txRows, picked);
  /** Scroll the open table to `day`; nothing while it is closed (owner
   *  2026-10-27: a day tap only picks / unpicks; no inline day details). */
  const scrollTableTo = (day: string) => {
    if (txOpen) setTxScroll((prev) => ({ day, seq: (prev?.seq ?? 0) + 1 }));
  };

  const creditCcys: Ccy[] = [
    ...(lines.credit_usd > 0.004 ? (["USD"] as const) : []),
    ...(lines.credit_lbp > 0.5 ? (["LBP"] as const) : []),
  ];
  const hasEarlier = lines.earlier_usd > 0.004 || lines.earlier_lbp > 0.5;

  return (
    <div
      data-testid="debt-day-calendar"
      className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3"
    >
      <p className="text-xs text-slate-400">{t("dayCalendar.intro")}</p>
      {failed ? (
        <div className="py-4 text-center text-xs text-red-400">
          {t("dayCalendar.failed")}
        </div>
      ) : !data || data.month !== month ? (
        <div className="py-4 text-center text-xs text-slate-400">
          {t("dayCalendar.loading")}
        </div>
      ) : (
        <SettleCalendar
          month={month}
          days={days}
          today={today}
          picked={picked}
          partlyPicked={partlyPicked}
          onToggleDay={toggleDay}
          onOpenDay={scrollTableTo}
          onPrevMonth={() => setMonth((m) => shiftMonth(m, -1))}
          onNextMonth={
            month < currentMonth
              ? () => setMonth((m) => shiftMonth(m, 1))
              : undefined
          }
          leftOutDays={leftOutDays}
          monthLeft={sumMonthLeft(days)}
          olderUnselected={olderUnselected}
          seeTransactions={{
            count: txCount,
            expanded: txOpen,
            controlsId: txPanelId,
            onToggle: () => setTxOpen(!txOpen),
          }}
        />
      )}
      <SettleSelectionBar
        count={picked.size}
        firstDay={pickedSorted[0] ? dayLabel(pickedSorted[0]) : ""}
        lastDay={newest ? dayLabel(newest) : ""}
        totals={plan.owed}
        leftOutCount={leftOutDays.size}
        onClear={() => change(new Set(), new Set(), { USD: null, LBP: null })}
        onPickAllOpen={() =>
          change(new Set(openDays), unticked, { USD: null, LBP: null })
        }
      />
      <div
        id={txPanelId}
        inert={!txOpen}
        className={
          txOpen
            ? "h-[420px] max-h-[60vh] overflow-hidden rounded-xl border border-slate-700"
            : "hidden"
        }
      >
        {txOpen && (
          <SettleTransactionsPanel
            rows={txRows}
            pickedDays={picked}
            dayLabel={(day) =>
              fmt.formatDate(dayDate(day), {
                weekday: "short",
                day: "numeric",
                month: "short",
              })
            }
            onToggleRow={toggleRow}
            onClose={() => setTxOpen(false)}
            scrollToDay={txScroll}
            error={txFailed}
          />
        )}
      </div>

      {(hasEarlier || creditCcys.length > 0) && (
        <div className="space-y-2 border-t border-slate-700 pt-2 text-xs">
          {hasEarlier && (
            <div
              data-testid="debt-account-earlier"
              className="flex flex-wrap items-center gap-x-2 text-slate-300"
            >
              <span>{t("dayCalendar.earlierBalance")}</span>
              <span className="font-mono font-semibold text-white tabular-nums">
                {[
                  lines.earlier_usd > 0.004 ? fmtUsd(lines.earlier_usd) : "",
                  lines.earlier_lbp > 0.5 ? fmtLbp(lines.earlier_lbp) : "",
                ]
                  .filter(Boolean)
                  .join(" + ")}
              </span>
              <span className="text-slate-500">
                {t("dayCalendar.earlierHint")}
              </span>
            </div>
          )}
          {creditCcys.map((c) => {
            const total = c === "USD" ? lines.credit_usd : lines.credit_lbp;
            const used = c === "USD" ? plan.credit_used.usd : plan.credit_used.lbp;
            const raw = creditInput[c];
            return (
              <label
                key={c}
                className="flex flex-wrap items-center gap-2 text-slate-300"
              >
                <span>{t("dayCalendar.useCredit")}</span>
                <input
                  data-testid={`debt-use-credit-${c}`}
                  inputMode="decimal"
                  aria-label={t("dayCalendar.useCreditLabel", { currency: c })}
                  className="w-28 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-end font-mono text-white"
                  value={raw ?? String(used)}
                  onChange={(e) =>
                    change(picked, unticked, {
                      ...creditInput,
                      [c]: e.target.value,
                    })
                  }
                />
                <span>
                  {t("dayCalendar.useCreditOf", {
                    amount: c === "USD" ? fmtUsd(total) : fmtLbp(total),
                  })}
                </span>
              </label>
            );
          })}
          {creditCcys.length > 0 && (
            <p className="text-slate-500">{t("dayCalendar.creditNote")}</p>
          )}
        </div>
      )}
    </div>
  );
}
