import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import {
  appEvents,
  DecimalInput,
  DiscountLine,
  discountFieldClass,
  MultiPaymentInput,
  type PaymentLine,
} from "@liratek/ui";
import { formatNumber } from "@liratek/ui/i18n/format";
import {
  buildSettleDays,
  daySelectionRowKey,
  isSettleRowOpen,
  isSettleStaleMessage,
  monthLeft as sumMonthLeft,
  openDaysBefore,
  type PartnerSettleRow,
  type SettleAccountMark,
} from "@liratek/core";
import { useFormat } from "@/i18n/useFormat";
import { useSellRate } from "@/hooks/useSellRate";
import { localDay } from "@/shared/utils/localDay";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import {
  countOpenSettleTransactions,
  SettleCalendar,
  SettleDayDetails,
  SettleSelectionBar,
  SettleSheetLayout,
  SettleTransactionsPanel,
  type SettleDayDetailsRow,
  type SettleTransactionRow,
} from "@/shared/components/settleCalendar";
import {
  usePartnerSettleDayDetailQuery,
  usePartnerSettleDaysMutation,
  usePartnerSettleMonthRowsQuery,
  usePartnerSettleMonthsRowsQueries,
  usePartnerSettleOpenRowsQuery,
} from "../hooks/usePartnerSettle";
import {
  buildPartnerOldHistoryPayload,
  buildPartnerSettleDaysPayload,
  oldHistoryDays,
  oldHistoryWouldSettle,
  PARTNER_SETTLE_CURRENCIES,
  PARTNER_SETTLE_EPS,
  partnerSettleRowKey,
  planPartnerSettle,
  roundPartnerMoney,
  type PartnerSettleCurrency,
  type PartnerSettlePlanCurrency,
  type PartnerSettleSectionMoney,
} from "../utils/partnerSettleDaysPayload";
import { partnerLegMethods } from "../utils/partnerLegMethods";
import {
  capSettlementDiscount,
  discountRoomAfterSettlement,
  isDiscountClippedBySettlement,
} from "../utils/settlementDiscount";

/**
 * LIRA-346 (specs/346-partner-settle-by-day) — settle a partner BY DAY.
 *
 * Mirrors the OMT calendar sheet (`AccountSettleSheet`), without its
 * OMT-only parts (commission, statement types, members):
 *
 * - A month calendar (today = this device's `localDay()`, rule 27). The
 *   days are worked out by core's `buildSettleDays` from the month's rows.
 * - The OPEN queue decides the money. Default pick = every open day before
 *   today, across months; today is never picked by default.
 * - Partner rows are signed like the balance: + Karim owes the shop. Per
 *   currency the sign of the pre-fill says who pays ("Karim pays you" /
 *   "You pay Karim"); a For and a Through on the picked days net together.
 * - "Use Karim's credit" per currency, pre-filled by the builder; a payment
 *   typed later never moves it.
 * - Forgive (no cash) only when the partner pays (as the old Settle modal).
 * - Every payload comes from ONE builder, `buildPartnerSettleDaysPayload`
 *   (rule 22); "Settle old history up to…" uses the same builder with no
 *   money.
 */

export interface PartnerSettleSheetProps {
  partner: { id: number; name: string };
  onClose: () => void;
  /** After a successful settle: the page reloads balances and ledgers. */
  onSettled: () => void;
  /** "Settle old history up to…" (admins). */
  canSettleOldHistory?: boolean | undefined;
  /** Opens the old balance-based Settle (kept until the owner decides). */
  onSettleByAmount?: (() => void) | undefined;
}

type PerCurrency<T> = Record<PartnerSettleCurrency, T>;
const EMPTY_LINES: PerCurrency<PaymentLine[]> = { USD: [], LBP: [] };

/** "$497.00" / "900,000 LBP" — magnitudes only. */
function formatMoney(amount: number, currency: PartnerSettleCurrency): string {
  const abs = Math.abs(amount);
  return currency === "LBP"
    ? `${formatNumber(Math.round(abs))} LBP` // i18n-exempt: currency code
    : `$${formatNumber(abs, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCreditInput(amount: number, c: PartnerSettleCurrency): string {
  return c === "USD" ? amount.toFixed(2) : String(Math.round(amount));
}

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, "")) || 0;
}

function sumLines(lines: readonly PaymentLine[], c: PartnerSettleCurrency) {
  return lines
    .filter((l) => l.amount > 0 && l.currencyCode === c)
    .reduce((s, l) => s + l.amount, 0);
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

/** "FOR POS" / "THROUGH OMT SEND" — the stored type, readable. */
function typeLabel(raw: string | null): string {
  return raw ? raw.replace(/_/g, " ") : "—";
}

const signedRemaining = (r: PartnerSettleRow, c: PartnerSettleCurrency) =>
  c === "USD" ? r.remaining_usd : r.remaining_lbp;

export function PartnerSettleSheet({
  partner,
  onClose,
  onSettled,
  canSettleOldHistory = false,
  onSettleByAmount,
}: PartnerSettleSheetProps) {
  const { t } = useTranslation(["partners", "common"]);
  const fmt = useFormat();
  const name = partner.name;
  const { buyRate: exchangeRate } = useSellRate();
  // The rate the cashier used on a payment box (stamp only).
  const [paymentRate, setPaymentRate] = useState<number | undefined>();

  const today = useMemo(() => localDay(), []);
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(() => currentMonth);

  const openQuery = usePartnerSettleOpenRowsQuery(partner.id);
  const rows = useMemo(() => openQuery.data ?? [], [openQuery.data]);
  const monthQuery = usePartnerSettleMonthRowsQuery(partner.id, month);
  const monthRows = useMemo(() => monthQuery.data ?? [], [monthQuery.data]);

  // ── Days ────────────────────────────────────────────────────────────────
  const days = useMemo(
    () => buildSettleDays(monthRows, { today, month }),
    [monthRows, today, month],
  );
  const monthLeftTotals = useMemo(() => sumMonthLeft(days), [days]);
  const openDays = useMemo(() => openDaysBefore(rows, today), [rows, today]);

  const [pickedState, setPickedState] = useState<ReadonlySet<string> | null>(
    null,
  );
  const defaultPicked = useMemo(() => new Set(openDays), [openDays]);
  const picked: ReadonlySet<string> = pickedState ?? defaultPicked;
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  const [untickedRows, setUntickedRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const dayDetailQuery = usePartnerSettleDayDetailQuery(partner.id, focusedDay);

  const handleToggleDay = (day: string) => {
    const next = new Set(picked);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    setPickedState(next);
  };
  const handleToggleRow = (key: string) => {
    setUntickedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const pickedSorted = useMemo(() => [...picked].sort(), [picked]);
  const newestPicked = pickedSorted[pickedSorted.length - 1] ?? null;
  const leftOutDays = useMemo(
    () =>
      new Set(
        newestPicked === null
          ? []
          : openDays.filter((d) => d < newestPicked && !picked.has(d)),
      ),
    [openDays, newestPicked, picked],
  );
  const partlyPickedDays = useMemo(
    () =>
      new Set(
        rows
          .filter(
            (r) =>
              r.row_scope === "DAY" &&
              picked.has(r.shop_day) &&
              isSettleRowOpen(r) &&
              untickedRows.has(partnerSettleRowKey(r)),
          )
          .map((r) => r.shop_day),
      ),
    [rows, picked, untickedRows],
  );
  const olderUnselected = useMemo(() => {
    const earlier = openDays.filter(
      (d) => d.slice(0, 7) < month && !picked.has(d),
    );
    if (earlier.length === 0) return undefined;
    const target = earlier[earlier.length - 1].slice(0, 7);
    return {
      count: earlier.filter((d) => d.startsWith(`${target}-`)).length,
      monthLabel: fmt.formatDate(dayDate(`${target}-01`), { month: "long" }),
      onOpen: () => setMonth(target),
    };
  }, [openDays, month, picked, fmt]);

  // ── Plan (ONE builder, rule 22) ─────────────────────────────────────────
  // null = the builder's default credit for the picked days.
  const [creditInput, setCreditInput] = useState<PerCurrency<string | null>>({
    USD: null,
    LBP: null,
  });
  const typedCredit = useMemo(() => {
    const out: { usd?: number; lbp?: number } = {};
    if (creditInput.USD !== null) out.usd = parseAmount(creditInput.USD);
    if (creditInput.LBP !== null) out.lbp = parseAmount(creditInput.LBP);
    return out;
  }, [creditInput]);
  const plan = useMemo(
    () =>
      planPartnerSettle(rows, {
        pickedDays: picked,
        untickedRows,
        creditUsed: typedCredit,
      }),
    [rows, picked, untickedRows, typedCredit],
  );

  const [lines, setLines] = useState<PerCurrency<PaymentLine[]>>(EMPTY_LINES);
  const [returnLegs, setReturnLegs] =
    useState<PerCurrency<PaymentLine[]>>(EMPTY_LINES);
  const [forgiveInput, setForgiveInput] = useState<PerCurrency<string>>({
    USD: "",
    LBP: "",
  });
  const [forgiveReason, setForgiveReason] = useState<PerCurrency<string>>({
    USD: "",
    LBP: "",
  });
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settleMutation = usePartnerSettleDaysMutation();

  /** Per currency: money entered, the capped forgive, what is left after. */
  const money = useMemo(() => {
    const out = {} as PerCurrency<{
      plan: PartnerSettlePlanCurrency;
      /** The legs of the box on screen; none when no box is shown (a box
       *  that went away must not leave its old lines in the payload). */
      lines: PaymentLine[];
      returnLegs: PaymentLine[];
      due: number;
      net: number;
      forgive: number;
      forgiveRaw: number;
      forgiveClipped: boolean;
      forgiveRoom: number;
      /** Signed like the rows (+ Karim owes the shop), after this settle. */
      after: number;
    }>;
    for (const c of PARTNER_SETTLE_CURRENCIES) {
      const p = plan.currencies[c];
      const due = Math.abs(p.prefill);
      const boxShown = p.touched && due >= PARTNER_SETTLE_EPS[c];
      const shownLines = boxShown ? lines[c] : [];
      const shownReturn = boxShown ? returnLegs[c] : [];
      const net = sumLines(shownLines, c) - sumLines(shownReturn, c);
      const partnerPays = p.payer === "PARTNER";
      const forgiveRaw = partnerPays
        ? Math.max(0, parseAmount(forgiveInput[c]))
        : 0;
      const forgive = partnerPays
        ? roundPartnerMoney(capSettlementDiscount(due, net, forgiveRaw), c)
        : 0;
      const after = partnerPays
        ? roundPartnerMoney(p.prefill - net - forgive, c)
        : roundPartnerMoney(p.prefill + net, c);
      out[c] = {
        plan: p,
        lines: shownLines,
        returnLegs: shownReturn,
        due,
        net,
        forgive,
        forgiveRaw,
        forgiveClipped:
          partnerPays && isDiscountClippedBySettlement(due, net, forgiveRaw),
        forgiveRoom: discountRoomAfterSettlement(due, net),
        after,
      };
    }
    return out;
  }, [plan, lines, returnLegs, forgiveInput]);

  const sectionMoney = (): Partial<
    PerCurrency<PartnerSettleSectionMoney>
  > => {
    const out: Partial<PerCurrency<PartnerSettleSectionMoney>> = {};
    for (const c of PARTNER_SETTLE_CURRENCIES) {
      const reason = forgiveReason[c].trim();
      out[c] = {
        lines: money[c].lines,
        returnLegs: money[c].returnLegs,
        ...(money[c].forgive > 0
          ? {
              forgive: {
                amount: money[c].forgive,
                ...(reason ? { reason } : {}),
              },
            }
          : {}),
      };
    }
    return out;
  };

  const touched = PARTNER_SETTLE_CURRENCIES.filter(
    (c) => plan.currencies[c].touched,
  );
  const confirmDisabled =
    submitting ||
    !openQuery.isSuccess ||
    plan.selection.selections.length === 0 ||
    touched.length === 0;

  const refetchAfterStale = (message: string) => {
    if (isSettleStaleMessage(message)) {
      void openQuery.refetch();
      void monthQuery.refetch();
    }
  };

  const handleSubmit = async () => {
    if (confirmDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = buildPartnerSettleDaysPayload({
        partnerId: partner.id,
        openRows: rows,
        pickedDays: picked,
        untickedRows,
        creditUsed: typedCredit,
        money: sectionMoney(),
        notes,
        exchangeRate: paymentRate ?? exchangeRate,
      });
      const result = await settleMutation.mutateAsync(payload);
      if (!result.success) {
        const message = result.error || t("settle.failed");
        setError(message);
        if (isSettleStaleMessage(message)) {
          // Keep what the operator picked and typed (FR-021).
          setPickedState(new Set(picked));
          setCreditInput({
            USD: formatCreditInput(plan.currencies.USD.creditUsed, "USD"),
            LBP: formatCreditInput(plan.currencies.LBP.creditUsed, "LBP"),
          });
        }
        refetchAfterStale(message);
        return;
      }
      appEvents.emit(
        "notification:show",
        t("settleDays.done", { name }),
        "success",
      );
      onSettled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settle.error"));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Settle old history up to… (no money) ───────────────────────────────
  const [oldOpen, setOldOpen] = useState(false);
  const [oldUpTo, setOldUpTo] = useState("");
  const oldDays = useMemo(
    () => (oldOpen && oldUpTo ? oldHistoryDays(rows, oldUpTo) : []),
    [oldOpen, oldUpTo, rows],
  );
  // Confirm only when the server's allocator would close something with no
  // money (else it refuses with "nothing to settle").
  const oldCloses = useMemo(
    () => oldDays.length > 0 && oldHistoryWouldSettle(rows, oldUpTo),
    [oldDays, rows, oldUpTo],
  );
  const handleOldHistorySubmit = async () => {
    if (submitting || !oldCloses) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await settleMutation.mutateAsync(
        buildPartnerOldHistoryPayload({
          partnerId: partner.id,
          openRows: rows,
          upTo: oldUpTo,
          notes,
        }),
      );
      if (!result.success) {
        const message = result.error || t("settle.failed");
        setError(message);
        refetchAfterStale(message);
        return;
      }
      appEvents.emit(
        "notification:show",
        t("settleDays.oldHistory.done", { name, day: dayLabel(oldUpTo) }),
        "success",
      );
      onSettled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settle.error"));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Day details ─────────────────────────────────────────────────────────
  const detailRows: SettleDayDetailsRow[] = useMemo(
    () =>
      (dayDetailQuery.data ?? [])
        .filter((r) => r.row_scope === "DAY")
        .map((r) => {
          const signed = r.currency === "USD" ? r.amount_usd : r.amount_lbp;
          return {
            key: partnerSettleRowKey(r),
            id: r.id,
            label: `${typeLabel(r.transaction_type)} · ${
              signed >= 0
                ? t("settleDays.rowPartnerOwes", { name })
                : t("settleDays.rowYouOwe", { name })
            }`,
            memberTag: null,
            // The panel reads magnitudes; the side is in the label.
            amount_usd: Math.abs(r.amount_usd),
            amount_lbp: Math.abs(r.amount_lbp),
            covered_usd: Math.abs(r.covered_usd),
            covered_lbp: Math.abs(r.covered_lbp),
            remaining_usd: Math.abs(r.remaining_usd),
            remaining_lbp: Math.abs(r.remaining_lbp),
            settlements: r.settlements.map((x) => ({
              transaction_id: x.transaction_id,
              // Stored UTC → the shop's day on this device (rule 27).
              settled_at: localDay(parseDbDate(x.settled_at)),
              currency: x.currency,
              amount: x.amount,
            })),
            addedAfterSettlement: r.added_after_settlement,
            waitingForStatement: false,
          };
        }),
    [dayDetailQuery.data, name, t],
  );

  // ── See transactions (owner mock 2026-10-26 §7) ─────────────────────────
  // The picked days' entries, paid ones too, beside the calendar. Full
  // amounts and paid entries come from the month reads; open status, what
  // is left and the tick come from the open queue and the plan's own
  // selection (rule 14), so the table never disagrees with the payload.
  // Unticking here is the day details' own `untickedRows`.
  const [txOpen, setTxOpen] = useState(false);
  const [txScroll, setTxScroll] = useState<{ day: string; seq: number } | null>(
    null,
  );
  const txPanelId = useId();
  const pickedMonths = useMemo(
    () => [...new Set(pickedSorted.map((d) => d.slice(0, 7)))],
    [pickedSorted],
  );
  const txMonthQueries = usePartnerSettleMonthsRowsQueries(
    partner.id,
    pickedMonths,
    txOpen,
  );
  const selectedKeys = useMemo(
    () => new Set(plan.selection.selections.map((s) => daySelectionRowKey(s))),
    [plan.selection.selections],
  );
  // Worked out on every render (a few dozen rows): the month reads are a
  // variable-length list, which a hook dependency array cannot hold.
  const txRows: SettleTransactionRow[] = (() => {
    const queueByKey = new Map(rows.map((r) => [partnerSettleRowKey(r), r]));
    const byKey = new Map<string, PartnerSettleRow>();
    for (const { data } of txMonthQueries) {
      for (const r of data ?? []) {
        if (r.row_scope === "DAY" && picked.has(r.shop_day)) {
          byKey.set(partnerSettleRowKey(r), r);
        }
      }
    }
    // A month not read yet: its open entries still show.
    for (const r of rows) {
      const key = partnerSettleRowKey(r);
      if (r.row_scope === "DAY" && picked.has(r.shop_day) && !byKey.has(key)) {
        byKey.set(key, r);
      }
    }
    return [...byKey.values()]
      .sort(
        (a, b) =>
          a.shop_day.localeCompare(b.shop_day) ||
          a.created_at.localeCompare(b.created_at) ||
          a.id - b.id,
      )
      .map((r): SettleTransactionRow => {
        const key = partnerSettleRowKey(r);
        const q = queueByKey.get(key);
        const open = q !== undefined && isSettleRowOpen(q);
        const type = r.transaction_type ?? "";
        const isFor = type.startsWith("FOR_");
        const isThrough = type.startsWith("THROUGH_");
        return {
          key,
          id: r.id,
          day: r.shop_day,
          label: typeLabel(
            isFor || isThrough ? type.replace(/^(FOR|THROUGH)_/, "") : type,
          ),
          memberTag: isFor
            ? t("settleDays.txFor")
            : isThrough
              ? t("settleDays.txThrough")
              : null,
          nameRef: r.notes,
          amount_usd: r.amount_usd,
          amount_lbp: r.amount_lbp,
          left_usd: open ? q.remaining_usd : 0,
          left_lbp: open ? q.remaining_lbp : 0,
          status: open ? "open" : "paid",
          checked: selectedKeys.has(key),
        };
      });
  })();
  const txCount = countOpenSettleTransactions(txRows, picked);
  const handleOpenDay = (day: string) => {
    // While the table is open a tap picks the day and scrolls the table to
    // it; the day details stay closed.
    if (txOpen) setTxScroll((prev) => ({ day, seq: (prev?.seq ?? 0) + 1 }));
    else setFocusedDay(day);
  };

  // ── ↺ account lines an undo / void left (either side) ──────────────────
  const reliefRows = rows.filter(
    (r) => r.row_scope === "ACCOUNT" && r.relief_origin && isSettleRowOpen(r),
  );
  const reliefWhat = (origin: "UNDO" | "VOID", ref: string) => {
    const shown = ref.startsWith("#") ? ref : `#${ref}`;
    return origin === "UNDO"
      ? t("settleDays.undoOf", { ref: shown })
      : t("settleDays.voidOf", { ref: shown });
  };
  // Neutral hover text: a partner undo / void can go either way; the
  // account lines below say which side owes.
  const formatMark = (m: SettleAccountMark) =>
    t("settleDays.markMoved", {
      amount: formatMoney(m.amount, m.currency),
      what: reliefWhat(m.origin, m.ref),
    });

  const dayLabel = (day: string) =>
    fmt.formatDate(dayDate(day), { day: "numeric", month: "short" });

  const creditCurrencies = PARTNER_SETTLE_CURRENCIES.filter(
    (c) => plan.currencies[c].creditTotal >= PARTNER_SETTLE_EPS[c],
  );
  // Payment boxes are re-created (re-filled) when WHAT is settled changes,
  // never on a refetch after a stale refusal.
  const scopeKey = `${pickedSorted.join(",")}|${[...untickedRows].sort().join(",")}|${plan.currencies.USD.creditUsed}|${plan.currencies.LBP.creditUsed}`;

  const handleCreditChange = (c: PartnerSettleCurrency, raw: string) => {
    const clean = raw.replace(/,/g, "");
    const ok = c === "USD" ? /^\d*\.?\d*$/.test(clean) : /^\d*$/.test(clean);
    if (!ok) return;
    const limit = plan.currencies[c].creditLimit;
    setCreditInput((prev) => ({
      ...prev,
      [c]: parseAmount(clean) > limit ? formatCreditInput(limit, c) : clean,
    }));
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="partner-settle-sheet"
    >
      <SettleSheetLayout
        open={txOpen}
        panelId={txPanelId}
        role="dialog"
        aria-modal={true}
        aria-label={t("settle.title", { name })}
        onMouseDown={(e) => e.stopPropagation()}
        panel={
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
            onToggleRow={handleToggleRow}
            onClose={() => setTxOpen(false)}
            scrollToDay={txScroll}
            loading={txMonthQueries.some((q) => q.isLoading)}
            error={txMonthQueries.some((q) => q.isError)}
          />
        }
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-white">
              {t("settle.title", { name })}
            </h3>
            <div className="text-xs text-slate-400 mt-1">
              {t("settleDays.intro", { name })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label={t("common:actions.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-3" data-testid="partner-settle-calendar">
            {monthQuery.isError ? (
              <div className="text-red-400 text-xs py-4 text-center">
                {t("settleDays.monthFailed")}
              </div>
            ) : monthQuery.isLoading ? (
              <div className="text-slate-400 text-xs py-4 text-center">
                {t("settleDays.monthLoading")}
              </div>
            ) : (
              <SettleCalendar
                month={month}
                days={days}
                today={today}
                picked={picked}
                partlyPicked={partlyPickedDays}
                onToggleDay={handleToggleDay}
                onOpenDay={handleOpenDay}
                onPrevMonth={() => setMonth((m) => shiftMonth(m, -1))}
                onNextMonth={
                  month < currentMonth
                    ? () => setMonth((m) => shiftMonth(m, 1))
                    : undefined
                }
                leftOutDays={leftOutDays}
                focusedDay={focusedDay}
                monthLeft={monthLeftTotals}
                olderUnselected={olderUnselected}
                formatMark={formatMark}
                seeTransactions={{
                  count: txCount,
                  expanded: txOpen,
                  controlsId: txPanelId,
                  onToggle: () => {
                    // The table takes over from the day details.
                    if (!txOpen) setFocusedDay(null);
                    setTxOpen(!txOpen);
                  },
                }}
              />
            )}
            {openQuery.isSuccess && (
              <SettleSelectionBar
                count={picked.size}
                firstDay={pickedSorted[0] ? dayLabel(pickedSorted[0]) : ""}
                lastDay={newestPicked ? dayLabel(newestPicked) : ""}
                totals={plan.selection.owed}
                leftOutCount={leftOutDays.size}
                onClear={() => setPickedState(new Set())}
                onPickAllOpen={() => setPickedState(new Set(openDays))}
              />
            )}
            {focusedDay !== null && (
              <SettleDayDetails
                day={focusedDay}
                dayLabel={fmt.formatDate(dayDate(focusedDay), {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
                rows={detailRows}
                picked={picked.has(focusedDay)}
                unticked={untickedRows}
                onToggleRow={handleToggleRow}
                onClose={() => setFocusedDay(null)}
              />
            )}
          </div>

          {openQuery.isLoading ? (
            <div className="text-slate-400 text-xs py-4 text-center">
              {t("settleDays.loading")}
            </div>
          ) : openQuery.isError ? (
            <div className="text-red-400 text-xs py-4 text-center">
              {t("settleDays.loadFailed", { name })}
            </div>
          ) : rows.length === 0 ? (
            <div
              className="text-slate-500 text-xs py-4 text-center"
              data-testid="partner-settle-empty"
            >
              {t("settleDays.empty", { name })}
            </div>
          ) : null}

          {openQuery.isSuccess &&
            reliefRows.map((r) => (
              <div
                key={partnerSettleRowKey(r)}
                data-testid="partner-settle-relief-line"
                className="flex flex-wrap items-center gap-2 bg-indigo-950/40 border border-indigo-800/60 rounded-xl px-3 py-2 text-xs text-indigo-200"
              >
                <span aria-hidden="true" className="font-bold">
                  ↺
                </span>
                <span className="flex-1">
                  {PARTNER_SETTLE_CURRENCIES.filter(
                    (c) =>
                      Math.abs(signedRemaining(r, c)) >= PARTNER_SETTLE_EPS[c],
                  )
                    .map((c) => {
                      const amt = signedRemaining(r, c);
                      const params = {
                        name,
                        amount: formatMoney(amt, c),
                        what: reliefWhat(
                          r.relief_origin ?? "UNDO",
                          r.relief_ref ?? "",
                        ),
                      };
                      return amt > 0
                        ? t("settleDays.reliefPartnerOwes", params)
                        : t("settleDays.reliefYouOwe", params);
                    })
                    .join(" · ")}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMonth(r.shop_day.slice(0, 7));
                    setFocusedDay(r.shop_day);
                  }}
                  className="font-semibold underline underline-offset-[3px] hover:text-white"
                >
                  {t("settleDays.goToDay", { day: dayLabel(r.shop_day) })}
                </button>
              </div>
            ))}

          {openQuery.isSuccess &&
            creditCurrencies.map((c) => {
              const lc = c.toLowerCase();
              const p = plan.currencies[c];
              const typed = creditInput[c];
              const shownValue =
                typed !== null && parseAmount(typed) <= p.creditLimit
                  ? typed
                  : formatCreditInput(p.creditUsed, c);
              return (
                <div
                  key={c}
                  data-testid={`partner-settle-credit-line-${lc}`}
                  className="flex flex-wrap items-center gap-2 bg-emerald-950/40 border border-emerald-800/60 rounded-xl px-3 py-2 text-xs text-emerald-300"
                >
                  <label htmlFor={`partner-settle-credit-${lc}`}>
                    {p.payer === "SHOP" && p.touched
                      ? t("settleDays.payOutCredit", { name })
                      : t("settleDays.useCredit", { name })}
                  </label>
                  <input
                    id={`partner-settle-credit-${lc}`}
                    type="text"
                    inputMode={c === "USD" ? "decimal" : "numeric"}
                    data-testid={`partner-settle-credit-${lc}`}
                    value={shownValue}
                    onChange={(e) => handleCreditChange(c, e.target.value)}
                    className="w-28 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-white text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <span data-testid={`partner-settle-credit-total-${lc}`}>
                    {t("settleDays.creditOf", {
                      total: formatMoney(p.creditTotal, c),
                    })}
                  </span>
                </div>
              );
            })}

          {openQuery.isSuccess &&
            touched.map((c) => {
              const lc = c.toLowerCase();
              const m = money[c];
              const p = m.plan;
              const partnerPays = p.payer === "PARTNER";
              const noMoney = m.due < PARTNER_SETTLE_EPS[c];
              const forgiveLine =
                partnerPays && !noMoney ? (
                  <DiscountLine
                    label={t("settle.forgive")}
                    testId="partner-settle-forgive"
                    capNote={
                      m.forgiveClipped && m.forgiveRoom > 0
                        ? t("settle.capped", {
                            amount: formatMoney(m.forgiveRoom, c),
                          })
                        : undefined
                    }
                    hint={
                      m.forgiveClipped && m.forgiveRoom <= 0 ? (
                        <span data-testid="partner-settle-discount-room-hint">
                          {t("settle.lowerPayment")}
                        </span>
                      ) : undefined
                    }
                    reason={
                      m.forgive > 0
                        ? {
                            value: forgiveReason[c],
                            onChange: (v: string) =>
                              setForgiveReason((prev) => ({ ...prev, [c]: v })),
                            placeholder: t("settle.reasonPlaceholder"),
                            testId: "partner-settle-forgive-reason",
                          }
                        : undefined
                    }
                  >
                    <DecimalInput
                      value={m.forgiveRaw}
                      onChange={(n) =>
                        setForgiveInput((prev) => ({
                          ...prev,
                          [c]: n ? String(n) : "",
                        }))
                      }
                      className={discountFieldClass(m.forgiveClipped)}
                      placeholder="0"
                      aria-label={t("settle.forgiveAmount")}
                      data-testid="partner-settle-forgive-input"
                    />
                  </DiscountLine>
                ) : null;
              const eps = PARTNER_SETTLE_EPS[c];
              const after = m.after;
              const preview =
                Math.abs(after) < eps
                  ? t("settleDays.previewClosed")
                  : (after > 0) === (p.prefill > 0) || noMoney
                    ? after > 0
                      ? t("settleDays.previewPartnerStillOwes", {
                          name,
                          amount: formatMoney(after, c),
                        })
                      : t("settleDays.previewYouStillOwe", {
                          name,
                          amount: formatMoney(after, c),
                        })
                    : after < 0
                      ? t("settleDays.previewPartnerCredit", {
                          name,
                          amount: formatMoney(after, c),
                        })
                      : t("settleDays.previewShopOverpaid", {
                          name,
                          amount: formatMoney(after, c),
                        });
              return (
                <div
                  key={c}
                  data-testid={`partner-settle-section-${lc}`}
                  className="bg-slate-800 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-white font-bold text-sm"
                      data-testid={`partner-settle-payer-${lc}`}
                    >
                      {noMoney
                        ? t("settleDays.noMoney", { currency: c })
                        : partnerPays
                          ? t("settleDays.partnerPaysYou", { name })
                          : t("settleDays.youPayPartner", { name })}
                    </span>
                    {!noMoney && (
                      <span
                        data-testid={`partner-settle-owed-${lc}`}
                        className={`font-mono font-bold text-base ${
                          partnerPays ? "text-red-400" : "text-green-400"
                        }`}
                      >
                        {formatMoney(m.due, c)}
                      </span>
                    )}
                  </div>
                  {!noMoney && (
                    <MultiPaymentInput
                      key={`${c}-${p.payer}-${scopeKey}`}
                      totals={[
                        {
                          amount: roundPartnerMoney(
                            Math.max(0, m.due - m.forgive),
                            c,
                          ),
                          currency: c,
                        },
                      ]}
                      {...(forgiveLine
                        ? {
                            discountRow: forgiveLine,
                            totalBeforeDiscount: [{ amount: m.due, currency: c }],
                            afterDiscountLabel: t("settle.afterForgive"),
                          }
                        : {})}
                      discountMovesPayment={false}
                      owedLabel={
                        partnerPays
                          ? t("settle.partnerWillOwe")
                          : t("settleDays.youWillOwe")
                      }
                      totalAmountCurrency={c}
                      currency={c}
                      onChange={(next) =>
                        setLines((prev) => ({ ...prev, [c]: next }))
                      }
                      // Change handed back (OUT legs) or, when not handed
                      // back, left on the partner's account.
                      onReturnChange={(next) =>
                        setReturnLegs((prev) => ({ ...prev, [c]: next }))
                      }
                      unreturnedChangeTo="ACCOUNT_BALANCE"
                      accountLabel={t("settle.partnerAccount")}
                      cashOnlyReturn
                      // Every leg, change included, in this currency.
                      returnCurrencies={[c]}
                      payer={partnerPays ? "customer" : "shop"}
                      // Waive only when money comes IN (owner 2026-10-12).
                      waiveDisabled={!partnerPays}
                      showPmFee={false}
                      showDiscount={false}
                      paymentMethods={partnerLegMethods(
                        t("common:payment.CASH"),
                      )}
                      currencies={[
                        c === "USD"
                          ? { code: "USD", symbol: "$" }
                          : { code: "LBP", symbol: "LBP" },
                      ]}
                      exchangeRate={exchangeRate}
                      onExchangeRateChange={setPaymentRate}
                      // LIRA-310 — Waive puts the gap into the Forgive line.
                      onWaiveRemaining={(amount: number) => {
                        const next = m.forgive + amount;
                        setForgiveInput((prev) => ({
                          ...prev,
                          [c]: String(roundPartnerMoney(next, c)),
                        }));
                      }}
                    />
                  )}
                  <p
                    className="text-xs text-slate-300"
                    data-testid={`partner-settle-preview-${lc}`}
                  >
                    {preview}
                  </p>
                </div>
              );
            })}

          {canSettleOldHistory && openQuery.isSuccess && (
            <OldHistoryPanel
              open={oldOpen}
              onOpen={() => setOldOpen(true)}
              onCancel={() => {
                setOldOpen(false);
                setOldUpTo("");
              }}
              upTo={oldUpTo}
              maxDay={today}
              onUpToChange={setOldUpTo}
              name={name}
              dayCount={oldDays.length}
              closes={oldCloses}
              submitting={submitting}
              onConfirm={handleOldHistorySubmit}
            />
          )}

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {t("common.notes")}
            </label>
            <input
              type="text"
              data-testid="partner-settle-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
              placeholder={t("common.notesPlaceholder")}
            />
          </div>

          {error && (
            <p
              className="text-red-400 text-xs"
              data-testid="partner-settle-error"
              role="alert"
            >
              {error}
            </p>
          )}

          {onSettleByAmount && (
            <button
              type="button"
              data-testid="partner-settle-by-amount"
              onClick={onSettleByAmount}
              className="text-xs font-semibold text-slate-400 underline underline-offset-[3px] hover:text-white"
            >
              {t("settleDays.byAmount")}
            </button>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
            >
              {t("common:actions.cancel")}
            </button>
            <button
              type="button"
              data-testid="partner-settle-submit"
              onClick={handleSubmit}
              disabled={confirmDisabled}
              className="flex-1 py-3 rounded-xl font-bold text-white shadow-lg active:scale-95 transition-all disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20"
            >
              {submitting ? t("common.processing") : t("settle.confirm")}
            </button>
          </div>
        </div>
      </SettleSheetLayout>
    </div>
  );
}

/** "Settle old history up to…": a date, how many days it closes, confirm.
 *  No money moves: the days net against each other and the partner credit. */
function OldHistoryPanel({
  open,
  onOpen,
  onCancel,
  upTo,
  maxDay,
  onUpToChange,
  name,
  dayCount,
  closes,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  upTo: string;
  maxDay: string;
  onUpToChange: (day: string) => void;
  name: string;
  dayCount: number;
  /** The server's allocator would close something with no money. */
  closes: boolean;
  submitting: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation(["partners", "common"]);
  const dateId = useId();
  if (!open) {
    return (
      <button
        type="button"
        data-testid="partner-settle-old-history-open"
        onClick={onOpen}
        className="text-xs font-semibold text-slate-400 underline underline-offset-[3px] hover:text-white"
      >
        {t("settleDays.oldHistory.open")}
      </button>
    );
  }
  return (
    <div
      data-testid="partner-settle-old-history"
      className="bg-slate-800 rounded-xl p-4 space-y-3"
    >
      <div>
        <div className="text-white font-bold text-sm">
          {t("settleDays.oldHistory.heading")}
        </div>
        <p className="text-xs text-slate-400 mt-1">
          {t("settleDays.oldHistory.intro", { name })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={dateId} className="text-xs text-slate-400">
          {t("settleDays.oldHistory.upTo")}
        </label>
        <input
          id={dateId}
          type="date"
          data-testid="partner-settle-old-history-date"
          value={upTo}
          max={maxDay}
          onChange={(e) => onUpToChange(e.target.value)}
          className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-emerald-500 [color-scheme:dark]"
        />
      </div>
      {upTo && (
        <p
          className="text-xs text-slate-300"
          data-testid="partner-settle-old-history-count"
        >
          {dayCount === 0
            ? t("settleDays.oldHistory.nothing")
            : closes
              ? t("settleDays.oldHistory.days", { count: dayCount })
              : t("settleDays.oldHistory.nothingCloses")}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:bg-slate-700 hover:text-white"
        >
          {t("common:actions.cancel")}
        </button>
        <button
          type="button"
          data-testid="partner-settle-old-history-confirm"
          onClick={onConfirm}
          disabled={submitting || !closes}
          className="flex-1 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500"
        >
          {t("settleDays.oldHistory.confirm")}
        </button>
      </div>
    </div>
  );
}

export default PartnerSettleSheet;
