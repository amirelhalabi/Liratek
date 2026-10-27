import { useId, useMemo, useState, type ReactNode } from "react";
import { appEvents, MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { useFormat } from "@/i18n/useFormat";
import {
  buildDaySelections,
  buildSettleDays,
  daySelectionRowKey,
  isSettleStaleMessage,
  isSettleRowOpen,
  isSettleRowWaiting,
  monthLeft as sumMonthLeft,
  openDaysBefore,
  type AccountSettleAllocResult,
  type DaySelectionsResult,
  type OmtCoveredType,
} from "@liratek/core";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { localDay } from "@/shared/utils/localDay";
import {
  countOpenSettleTransactions,
  SettleCalendar,
  SettleSelectionBar,
  SettleSheetLayout,
  SettleTransactionsPanel,
  type SettleTransactionRow,
} from "@/shared/components/settleCalendar";
import {
  useSupplierAccountMonthRowsQuery,
  useSupplierAccountMonthsRowsQueries,
  useSupplierAccountUnsettledQuery,
  useSettleSupplierAccountMutation,
  type AccountBalance,
  type AccountUnsettledRow,
  type SettleAccountRequest,
} from "../hooks/useSuppliers";
import {
  accountRowKey,
  allocateSection,
  assignChangeLegs,
  directionFromOwed,
  roundMoney,
  rowRemaining,
  rowsInCurrency,
  sortOldestFirst,
  SETTLE_CURRENCIES,
  SETTLE_EPS,
  type SettleCurrency,
  type SettleDirection,
} from "../utils/accountSettleMath";
import OmtCoveredTypesPicker from "./OmtCoveredTypesPicker";
import { AccountCreditRemoval } from "./AccountCreditRemoval";
import {
  loadCoveredTypes,
  saveCoveredTypes,
} from "../utils/omtCoveredTypesStorage";

/**
 * Settle Account — ONE action pays or collects the OMT open-credit account
 * (the counter, OMT App and iPick) in a single call (rule 16).
 *
 * LIRA-343 (specs/343-omt-settle-by-day) — settle BY DAY:
 *
 * - The sheet opens on a calendar of the current month (today = this
 *   device's `localDay()`, rule 27). Month switching reads the month's rows
 *   (`useSupplierAccountMonthRowsQuery`); the days are worked out by core's
 *   `buildSettleDays`, never stored.
 * - The OPEN queue (`useSupplierAccountUnsettledQuery`) decides the money:
 *   the default pick is every open day before today, across months
 *   (`openDaysBefore`); today is never picked by default (FR-008).
 * - `buildDaySelections` is the ONE payload builder (rule 22): the picked
 *   days' open rows (`selections`), what they owe, the account credit (rows
 *   that sit on no day), `credit_used`, `expected_owed` and the pre-fill.
 * - "Use OMT credit [x] of [total]" per currency (FR-012): pre-filled with
 *   the builder's default, editable 0…limit. The payment box is pre-filled
 *   with `prefill` (= owed − credit) and is re-filled when the picked days or
 *   the credit change; a payment typed afterwards never moves the credit.
 * - The preview is the core allocator with the SAME inputs the server uses
 *   (`allocateSection` with the account credits and `credit_used`, FR-015).
 *
 * LIRA-322 rules kept: each currency on its own (`$` settles `$`, LBP
 * settles LBP), PAY / COLLECT per currency, the shared box for currencies
 * owed in the same direction, commission per currency, and the stale
 * refusal (FR-021) that refetches while keeping what the operator typed.
 *
 * Cash routing (D3): a CASH leg resolves to the OMT drawer server-side
 * (`resolveServiceCashDrawer` with the parent's provider). This component
 * never picks a drawer itself.
 */

/** "$497.00" / "900,000 LBP" — magnitudes only. */
function formatMoney(amount: number, currency: SettleCurrency): string {
  const abs = Math.abs(amount);
  return currency === "LBP"
    ? `${formatNumber(Math.round(abs))} LBP`
    : `$${abs.toFixed(2)}`;
}

/** Compact form for the preview chips: "$47", "$20.30", "100,000 LBP". */
function formatCompact(amount: number, currency: SettleCurrency): string {
  const abs = Math.abs(amount);
  if (currency === "LBP") return `${formatNumber(Math.round(abs))} LBP`;
  const cents = Math.round(abs * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** The credit box's text for an amount: "8.70" / "450000". */
function formatCreditInput(amount: number, currency: SettleCurrency): string {
  return currency === "USD" ? amount.toFixed(2) : String(Math.round(amount));
}

function rowTypeLabel(row: AccountUnsettledRow): string {
  return row.source_name || row.source_provider || "—";
}

/** A "See transactions" row's own label: the transfer type, else the ledger entry
 *  type (data values, shown as stored like the Transactions window). */
function detailLabel(row: AccountUnsettledRow): string {
  return row.service_type || row.entry_type || "—";
}

/** "See transactions" — the name / reference column: "Nour A. · ref
 *  OMT-77610", else the phone, else the note. Display only. */
function txNameRef(
  row: AccountUnsettledRow,
  refLabel: (ref: string) => string,
): string | null {
  const parts: string[] = [];
  if (row.party_name) parts.push(row.party_name);
  if (row.reference) parts.push(refLabel(row.reference));
  else if (row.phone) parts.push(row.phone);
  if (parts.length === 0 && row.note) parts.push(row.note);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, "")) || 0;
}

function sumAmounts(lines: PaymentLine[], currency?: SettleCurrency): number {
  return lines
    .filter((l) => l.amount > 0 && (!currency || l.currencyCode === currency))
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

type PerCurrency<T> = Record<SettleCurrency, T>;
const CURRENCY_KEY: PerCurrency<"usd" | "lbp"> = { USD: "usd", LBP: "lbp" };

/** What one currency section knows before any money is entered. */
interface SectionBase {
  currency: SettleCurrency;
  /** Picked rows that still owe something in this currency, oldest first. */
  rows: AccountUnsettledRow[];
  /** Signed: what the picked days owe in this currency (before credit). */
  daysOwed: number;
  /** Signed: what to pay (+) or collect (−) — the pre-fill (owed − credit). */
  owed: number;
  /** Account credit the user set, this currency (magnitude). */
  creditUsed: number;
  direction: SettleDirection;
  /** Nothing owed: the operator chooses the direction. */
  canChooseDirection: boolean;
  /** The picked days owe something, but the credit / netting covers it all:
   *  nothing to pay, the section is sent with `payments: []`. */
  coveredWithoutMoney: boolean;
  /** Rendered (rows owed, credit used, or the operator opened it). */
  shown: boolean;
}

/** Everything one currency section needs, derived once per render. */
interface SectionState extends SectionBase {
  /** Money or commission entered in this section. */
  hasMoney: boolean;
  commission: number;
  /** Sent in `per_currency` (see `included` below). */
  included: boolean;
  /** The preview: the allocation of what is sent, or null (untouched). */
  alloc: AccountSettleAllocResult | null;
  commissionProblem: string | null;
}

const EMPTY_LINES: PerCurrency<PaymentLine[]> = { USD: [], LBP: [] };

/**
 * LIRA-345 — who is being settled: the OMT account parent, or any other
 * supplier on the day calendar (`settlesByDay`) as an "account of one".
 * Only the id and the name are read.
 */
export type SettleSheetAccount = Pick<
  AccountBalance,
  "account_supplier_id" | "account_name"
>;

export interface AccountSettleSheetProps {
  account: SettleSheetAccount;
  /** LIRA-345 — the OMT "Which OMT shares" statement-type picker. Only the
   *  OMT account settles by statement type; default true (the OMT sheet). */
  showStatementTypes?: boolean | undefined;
  /** LIRA-345 — the settlement-day commission field. Off for a supplier
   *  with no commission to settle here (Katsh, product suppliers); default
   *  true. */
  showCommission?: boolean | undefined;
  onClose: () => void;
  /** Fired after a successful settle — the page closes the sheet and lets
   *  its own queries (already invalidated by the mutation) refresh. */
  onSettled: () => void;
  /** LIRA-343 T041 (FR-021) — offer "Settle old history up to…" (admin). */
  canSettleOldHistory?: boolean | undefined;
  /** LIRA-344 — offer "Remove credit" on each open account credit (admin). */
  canRemoveCredit?: boolean | undefined;
}

/** Old-history (T041) preview of one picked day. */
interface OldHistoryDay {
  day: string;
  status: "closes" | "open";
  left: PerCurrency<number>;
}

export function AccountSettleSheet({
  account,
  onClose,
  onSettled,
  canSettleOldHistory = false,
  canRemoveCredit = false,
  showStatementTypes = true,
  showCommission = true,
}: AccountSettleSheetProps) {
  const { t } = useTranslation("suppliers");
  const { t: tc } = useTranslation("common");
  const fmt = useFormat();
  const { methods } = usePaymentMethods();
  const { buyRate: exchangeRate } = useSellRate();
  // Owner decision 2026-10-07: the rate the cashier actually used on a
  // payment box (hand-edited or not; reported on mount too). Stamp-only —
  // the server settles each currency natively.
  const [paymentRate, setPaymentRate] = useState<number | undefined>();

  // LIRA-343 — the shop's today from THIS device (rule 27), fixed while the
  // sheet is open.
  const today = useMemo(() => localDay(), []);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const currentMonth = today.slice(0, 7);

  // `refetchOnMount: "always"` — this sheet decides how much money changes
  // hands, so it never works off a cached queue that predates a change made
  // elsewhere (see the hook's own doc comment).
  const unsettledQuery = useSupplierAccountUnsettledQuery(
    account.account_supplier_id,
    { refetchOnMount: "always" },
  );
  const rows = useMemo(
    () => sortOldestFirst((unsettledQuery.data ?? []) as AccountUnsettledRow[]),
    [unsettledQuery.data],
  );
  const monthQuery = useSupplierAccountMonthRowsQuery(
    account.account_supplier_id,
    month,
  );

  // LIRA-256 — the OMT commission types this statement covers (this
  // device's last choice; undefined = all types).
  // LIRA-345: none for a supplier that does not settle by statement type.
  const [coveredTypes, setCoveredTypes] = useState<
    OmtCoveredType[] | undefined
  >(() =>
    showStatementTypes ? loadCoveredTypes(account.account_supplier_id) : undefined,
  );

  // ── Days ────────────────────────────────────────────────────────────────
  const days = useMemo(
    () =>
      buildSettleDays(monthQuery.data ?? [], {
        today,
        month,
        ...(coveredTypes ? { coveredTypes } : {}),
      }),
    [monthQuery.data, today, month, coveredTypes],
  );
  const monthLeftTotals = useMemo(() => sumMonthLeft(days), [days]);
  /** Every open day before today, any month (the default pick). */
  const openDays = useMemo(() => openDaysBefore(rows, today), [rows, today]);

  // null = the default pick (follows the queue until the operator taps).
  const [pickedState, setPickedState] = useState<ReadonlySet<string> | null>(
    null,
  );
  const defaultPicked = useMemo(() => new Set(openDays), [openDays]);
  const picked: ReadonlySet<string> = pickedState ?? defaultPicked;
  // LIRA-343 FR-016a — open transfers of picked days the operator unticked
  // in the "See transactions" table (`"KIND:id"`); left out like an
  // unpicked day. (Owner 2026-10-27: a day tap only picks / unpicks; the
  // inline day details are gone.)
  const [untickedRows, setUntickedRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const handleToggleRow = (key: string) => {
    setUntickedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const handleToggleDay = (day: string) => {
    const next = new Set(picked);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    setPickedState(next);
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
  // Picked days with an open transfer unticked in the table: the
  // calendar marks them "partly picked". Same rows, same key and same open
  // rule as `buildDaySelections` (rule 14); an unpicked day is never in it,
  // even while its unticked keys are remembered.
  const partlyPickedDays = useMemo(
    () =>
      new Set(
        rows
          .filter(
            (r) =>
              r.row_scope === "DAY" &&
              picked.has(r.shop_day) &&
              isSettleRowOpen(r) &&
              untickedRows.has(daySelectionRowKey(r)),
          )
          .map((r) => r.shop_day),
      ),
    [rows, picked, untickedRows],
  );
  // FR-006 — the nearest earlier month that still has open days unpicked.
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

  // ── Selection + credit (ONE builder, rule 22) ──────────────────────────
  // null = the builder's default credit for the picked days.
  const [creditInput, setCreditInput] = useState<PerCurrency<string | null>>({
    USD: null,
    LBP: null,
  });
  const baseSelection = useMemo(
    () =>
      buildDaySelections(rows, {
        pickedDays: picked,
        untickedRows,
        ...(coveredTypes ? { coveredTypes } : {}),
      }),
    [rows, picked, untickedRows, coveredTypes],
  );
  const selectedKeys = useMemo(
    () => new Set(baseSelection.selections.map(accountRowKey)),
    [baseSelection],
  );
  const selectedRows = useMemo(
    () => rows.filter((r) => selectedKeys.has(accountRowKey(r))),
    [rows, selectedKeys],
  );
  const accountRows = useMemo(
    () => rows.filter((r) => r.row_scope === "ACCOUNT"),
    [rows],
  );

  /** Per currency: the credit available, the most that may be used, and
   *  what is used (the typed amount clamped, or the default). */
  const credit = useMemo(() => {
    const out = {} as PerCurrency<{
      total: number;
      limit: number;
      used: number;
    }>;
    for (const c of SETTLE_CURRENCIES) {
      const k = CURRENCY_KEY[c];
      const total = roundMoney(
        Math.max(0, -baseSelection.account_credit[k]),
        c,
      );
      const owed = baseSelection.owed[k];
      const limit = roundMoney(owed > 0 ? Math.min(owed, total) : total, c);
      const typed = creditInput[c];
      // The builder's default: 0 where the picked days owe nothing,
      // min(owed, credit) when the shop pays, the whole credit when OMT pays.
      const wanted =
        typed === null ? baseSelection.credit_used[k] : parseAmount(typed);
      out[c] = {
        total,
        limit,
        used: roundMoney(Math.min(Math.max(wanted, 0), limit), c),
      };
    }
    return out;
  }, [baseSelection, creditInput]);

  const selection = useMemo(
    () =>
      buildDaySelections(rows, {
        pickedDays: picked,
        untickedRows,
        ...(coveredTypes ? { coveredTypes } : {}),
        creditUsed: { usd: credit.USD.used, lbp: credit.LBP.used },
      }),
    [rows, picked, untickedRows, coveredTypes, credit],
  );

  const [directionChoice, setDirectionChoice] = useState<
    PerCurrency<SettleDirection | null>
  >({ USD: null, LBP: null });
  // The ONE payment box (every currency owed in the main direction): its
  // lines (any currency) and its change legs.
  const [mainLines, setMainLines] = useState<PaymentLine[]>([]);
  const [mainReturnLegs, setMainReturnLegs] = useState<PaymentLine[]>([]);
  // A currency outside the main box (the rare opposite direction, or one
  // the operator opened with nothing owed) keeps its own small box.
  const [sideLines, setSideLines] =
    useState<PerCurrency<PaymentLine[]>>(EMPTY_LINES);
  const [sideReturnLegs, setSideReturnLegs] =
    useState<PerCurrency<PaymentLine[]>>(EMPTY_LINES);
  const [commissionInput, setCommissionInput] = useState<PerCurrency<string>>({
    USD: "",
    LBP: "",
  });
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settleMutation = useSettleSupplierAccountMutation(
    account.account_supplier_id,
  );

  const handleCoveredChange = (next: OmtCoveredType[] | undefined) => {
    setCoveredTypes(next);
    saveCoveredTypes(account.account_supplier_id, next);
  };

  const handleCreditChange = (c: SettleCurrency, raw: string) => {
    const clean = raw.replace(/,/g, "");
    const ok = c === "USD" ? /^\d*\.?\d*$/.test(clean) : /^\d*$/.test(clean);
    if (!ok) return;
    const limit = credit[c].limit;
    setCreditInput((prev) => ({
      ...prev,
      [c]: parseAmount(clean) > limit ? formatCreditInput(limit, c) : clean,
    }));
  };

  const bases: PerCurrency<SectionBase> = (() => {
    const out = {} as PerCurrency<SectionBase>;
    for (const currency of SETTLE_CURRENCIES) {
      const k = CURRENCY_KEY[currency];
      const cRows = rowsInCurrency(selectedRows, currency);
      const daysOwed = selection.owed[k];
      const prefill = roundMoney(selection.prefill[k], currency);
      const fromPrefill = directionFromOwed(prefill, currency);
      const fromDays =
        cRows.length > 0 ? directionFromOwed(daysOwed, currency) : null;
      const creditUsed = credit[currency].used;
      out[currency] = {
        currency,
        rows: cRows,
        daysOwed,
        owed: prefill,
        creditUsed,
        direction:
          fromPrefill ?? fromDays ?? directionChoice[currency] ?? "PAY",
        canChooseDirection: fromPrefill === null && fromDays === null,
        coveredWithoutMoney: fromPrefill === null && fromDays !== null,
        shown:
          cRows.length > 0 ||
          fromPrefill !== null ||
          directionChoice[currency] !== null,
      };
    }
    return out;
  })();

  // LIRA-322 (owner 2026-10-15) — ONE payment box for every currency that
  // is owed in the same direction (the normal case). Only when OMT owes the
  // shop in one currency while the shop owes OMT in the other does that
  // other currency get its own small box.
  const owedSections = SETTLE_CURRENCIES.map((c) => bases[c]).filter(
    (b) => directionFromOwed(b.owed, b.currency) !== null,
  );
  const mainDirection: SettleDirection | null =
    owedSections[0]?.direction ?? null;
  const mainCurrencies = owedSections
    .filter((b) => b.direction === mainDirection)
    .map((b) => b.currency);
  const mainKeyCurrencies = mainCurrencies.join("-");
  /** What the main box is paying, per currency (the box's `totals`). */
  const mainTotals = mainCurrencies.map((c) => ({
    amount: roundMoney(Math.abs(bases[c].owed), c),
    currency: c,
  }));

  // Lines and change legs per currency section, from whichever box owns it.
  const linesByCurrency: PerCurrency<PaymentLine[]> = { USD: [], LBP: [] };
  const returnLegsByCurrency: PerCurrency<PaymentLine[]> = { USD: [], LBP: [] };
  if (mainCurrencies.length > 0) {
    const extras: Partial<Record<SettleCurrency, number>> = {};
    for (const tot of mainTotals) {
      extras[tot.currency] = sumAmounts(mainLines, tot.currency) - tot.amount;
    }
    const change = assignChangeLegs(mainReturnLegs, extras, mainCurrencies[0]);
    for (const c of mainCurrencies) {
      linesByCurrency[c] = mainLines.filter((l) => l.currencyCode === c);
      returnLegsByCurrency[c] = change[c];
    }
  }
  for (const c of SETTLE_CURRENCIES) {
    if (mainCurrencies.includes(c) || !bases[c].shown) continue;
    if (bases[c].coveredWithoutMoney) continue;
    linesByCurrency[c] = sideLines[c];
    returnLegsByCurrency[c] = sideReturnLegs[c];
  }

  const sections: PerCurrency<SectionState> = (() => {
    const lines = linesByCurrency;
    const returnLegs = returnLegsByCurrency;
    const withMoney = {} as PerCurrency<
      SectionBase & { hasMoney: boolean; commission: number }
    >;
    for (const c of SETTLE_CURRENCIES) {
      const commission = parseAmount(commissionInput[c]);
      withMoney[c] = {
        ...bases[c],
        hasMoney:
          sumAmounts(lines[c]) > 0 ||
          sumAmounts(returnLegs[c]) > 0 ||
          commission > 0,
        commission,
      };
    }
    const moneyOf = (c: SettleCurrency) => ({
      inSame: sumAmounts(lines[c], c),
      outSame: sumAmounts(returnLegs[c], c),
      commission: withMoney[c].commission,
    });
    // A currency goes in the payload when money or commission was entered
    // in it (FR-002: an untouched currency stays unchanged), or when the
    // credit / day netting covers the picked days on its own (nothing to
    // pay: sent with `payments: []`). With nothing entered anywhere, a
    // currency whose credits close debts on their own is sent the same way.
    const anyMoney = SETTLE_CURRENCIES.some((c) => withMoney[c].hasMoney);
    const out = {} as PerCurrency<SectionState>;
    for (const c of SETTLE_CURRENCIES) {
      const s = withMoney[c];
      let alloc: AccountSettleAllocResult | null = null;
      if (s.rows.length > 0 || s.hasMoney || s.creditUsed > 0) {
        const candidate = allocateSection(
          selectedRows,
          c,
          s.direction,
          moneyOf(c),
          { rows: accountRows, creditUsed: s.creditUsed },
        );
        if (
          s.hasMoney ||
          (s.coveredWithoutMoney && candidate.takes.length > 0) ||
          (!anyMoney && candidate.closed.length > 0)
        ) {
          alloc = candidate;
        }
      }
      // Owner 2026-10-15: the commission never changes what the money
      // covers (nor the box totals, nor the extra) — it is credited to the
      // account after the payment. It still needs a commission-carrying
      // transfer this payment closes, to be recognised as profit (FR-012).
      let commissionProblem: string | null = null;
      if (alloc && s.commission > 0 && alloc.commission_without_closed_model1) {
        commissionProblem = t("accountSettle.commissionProblem");
      }
      out[c] = { ...s, included: alloc !== null, alloc, commissionProblem };
    }
    return out;
  })();

  const includedSections = SETTLE_CURRENCIES.map((c) => sections[c]).filter(
    (s) => s.included,
  );
  const hasCommissionProblem = includedSections.some(
    (s) => s.commissionProblem !== null,
  );
  const creditTooHigh = includedSections.some(
    (s) => s.alloc?.credit_used_too_high === true,
  );
  const confirmDisabled =
    submitting ||
    !unsettledQuery.isSuccess ||
    selection.selections.length === 0 ||
    includedSections.length === 0 ||
    hasCommissionProblem ||
    creditTooHigh;

  /**
   * THE settle payload (rule 22): the normal settle and "Settle old history
   * up to…" (T041) both build it here; only the selection, the sections and
   * the credit used differ. Every selection key comes from
   * `buildDaySelections`; `selections` is always sent (an absent list means
   * "the whole account" to the server).
   */
  const buildSettlePayload = (
    sel: DaySelectionsResult,
    perCurrency: NonNullable<SettleAccountRequest["per_currency"]>,
    creditUsed: { usd: number; lbp: number },
  ): SettleAccountRequest => {
    const trimmedNote = note.trim();
    return {
      per_currency: perCurrency,
      selections: sel.selections,
      include_account_credits: true,
      credit_used: creditUsed,
      expected_owed: sel.expected_owed,
      exchange_rate: paymentRate ?? exchangeRate,
      ...(trimmedNote ? { note: trimmedNote } : {}),
      // LIRA-256 — only when the statement covers some types.
      ...(coveredTypes ? { covered_omt_service_types: coveredTypes } : {}),
    };
  };

  const handleSubmit = async () => {
    if (confirmDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const perCurrency: NonNullable<SettleAccountRequest["per_currency"]> = {};
      for (const s of includedSections) {
        const c = s.currency;
        perCurrency[c] = {
          direction: s.direction,
          // ONE payload (rule 22): money handed over + change handed back
          // (OUT legs, any currency, cash only — LIRA-315).
          payments: [
            ...linesByCurrency[c]
              .filter((l) => l.amount > 0)
              .map((l) => ({
                method: l.method,
                currency_code: l.currencyCode,
                amount: roundMoney(l.amount, c),
              })),
            ...returnLegsByCurrency[c]
              .filter((l) => l.amount > 0)
              .map((l) => ({
                method: l.method,
                currency_code: l.currencyCode,
                amount: roundMoney(
                  l.amount,
                  l.currencyCode === "LBP" ? "LBP" : "USD",
                ),
                direction: "OUT" as const,
              })),
          ],
          ...(s.commission > 0
            ? { commission: roundMoney(s.commission, c) }
            : {}),
        };
      }
      const usedIn = (c: SettleCurrency) =>
        sections[c].included ? selection.credit_used[CURRENCY_KEY[c]] : 0;
      const payload = buildSettlePayload(selection, perCurrency, {
        usd: usedIn("USD"),
        lbp: usedIn("LBP"),
      });

      const result = await settleMutation.mutateAsync(payload);
      if (!result.success) {
        const message = result.error || t("settle.failed");
        setError(message);
        // FR-021 — someone else changed the account: show the new amounts,
        // keep what the operator picked and typed (the picked days and the
        // credit are frozen so the payment box is not re-filled).
        if (isSettleStaleMessage(message)) {
          setPickedState(new Set(picked));
          setCreditInput({
            USD: formatCreditInput(credit.USD.used, "USD"),
            LBP: formatCreditInput(credit.LBP.used, "LBP"),
          });
          void unsettledQuery.refetch();
          void monthQuery.refetch();
        }
        return;
      }

      const summary = includedSections
        .map((s) => {
          const paid = sumAmounts(linesByCurrency[s.currency], s.currency);
          if (paid <= 0) return null;
          return s.direction === "PAY"
            ? t("accountSettle.summaryPaid", {
                money: formatMoney(paid, s.currency),
              })
            : t("accountSettle.summaryReceived", {
                money: formatMoney(paid, s.currency),
              });
        })
        .filter(Boolean)
        .join(", ");
      appEvents.emit(
        "notification:show",
        summary
          ? t("accountSettle.doneWithSummary", {
              name: account.account_name,
              summary,
            })
          : t("accountSettle.done", { name: account.account_name }),
        "success",
      );
      onSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settle.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Settle old history up to… (T041, FR-021) ───────────────────────────
  // One-time step: the account credits pay every open transfer on or before
  // a date, oldest first, per currency, with no money. Same builder, same
  // allocator and same settle call as the normal settle (rules 14 / 22).
  const [oldOpen, setOldOpen] = useState(false);
  const [oldUpTo, setOldUpTo] = useState("");
  const oldHistory = useMemo(() => {
    if (!oldOpen || !oldUpTo) return null;
    const pickedDays = new Set(
      rows
        .filter(
          (r) =>
            r.row_scope === "DAY" &&
            r.shop_day <= oldUpTo &&
            isSettleRowOpen(r),
        )
        .map((r) => r.shop_day),
    );
    const scope = coveredTypes ? { coveredTypes } : {};
    const base = buildDaySelections(rows, { pickedDays, ...scope });
    // Credit = min(owed, credit) where the old days owe; none elsewhere.
    const creditWanted = { usd: 0, lbp: 0 };
    for (const c of SETTLE_CURRENCIES) {
      const k = CURRENCY_KEY[c];
      const owed = base.owed[k];
      const available = Math.max(0, -base.account_credit[k]);
      creditWanted[k] = owed > 0 ? roundMoney(Math.min(owed, available), c) : 0;
    }
    const sel = buildDaySelections(rows, {
      pickedDays,
      ...scope,
      creditUsed: creditWanted,
    });
    const selKeys = new Set(sel.selections.map(accountRowKey));
    const selRows = rows.filter((r) => selKeys.has(accountRowKey(r)));
    const perCurrency: NonNullable<SettleAccountRequest["per_currency"]> = {};
    const creditUsed = { usd: 0, lbp: 0 };
    const allocs: Partial<PerCurrency<AccountSettleAllocResult>> = {};
    for (const c of SETTLE_CURRENCIES) {
      const k = CURRENCY_KEY[c];
      if (rowsInCurrency(selRows, c).length === 0) continue;
      const direction: SettleDirection =
        directionFromOwed(sel.owed[k], c) === "COLLECT" ? "COLLECT" : "PAY";
      const alloc = allocateSection(
        selRows,
        c,
        direction,
        { inSame: 0, outSame: 0, commission: 0 },
        { rows: accountRows, creditUsed: creditWanted[k] },
      );
      // Only a currency the credit actually pays something in is sent.
      if (alloc.takes.length === 0 || alloc.credit_used_too_high) continue;
      perCurrency[c] = { direction, payments: [] };
      creditUsed[k] = creditWanted[k];
      allocs[c] = alloc;
    }
    // "Confirm is off when nothing would close": at least one old transfer
    // must end fully paid (a part-payment alone does not count).
    let closesAny = false;
    const days: OldHistoryDay[] = [...pickedDays].sort().map((day) => {
      const left: PerCurrency<number> = { USD: 0, LBP: 0 };
      for (const r of selRows.filter((x) => x.shop_day === day)) {
        const key = accountRowKey(r);
        for (const c of SETTLE_CURRENCIES) {
          const before = rowRemaining(r, c);
          if (Math.abs(before) <= SETTLE_EPS[c]) continue;
          const alloc = allocs[c];
          const after = !alloc
            ? before
            : alloc.partial && accountRowKey(alloc.partial) === key
              ? alloc.partial.remaining
              : alloc.closed.some((x) => accountRowKey(x) === key)
                ? 0
                : before;
          if (alloc && Math.abs(after) <= SETTLE_EPS[c]) closesAny = true;
          left[c] = roundMoney(left[c] + after, c);
        }
      }
      const open = SETTLE_CURRENCIES.some(
        (c) => Math.abs(left[c]) > SETTLE_EPS[c],
      );
      return { day, status: open ? "open" : "closes", left };
    });
    return {
      days,
      sel,
      perCurrency,
      creditUsed,
      anything: Object.keys(perCurrency).length > 0 && closesAny,
    };
  }, [oldOpen, oldUpTo, rows, coveredTypes, accountRows]);

  const handleOldHistorySubmit = async () => {
    if (!oldHistory?.anything || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await settleMutation.mutateAsync(
        buildSettlePayload(
          oldHistory.sel,
          oldHistory.perCurrency,
          oldHistory.creditUsed,
        ),
      );
      if (!result.success) {
        const message = result.error || t("settle.failed");
        setError(message);
        // FR-021 (LIRA-322) — the account changed meanwhile: reload.
        if (isSettleStaleMessage(message)) {
          void unsettledQuery.refetch();
          void monthQuery.refetch();
        }
        return;
      }
      appEvents.emit(
        "notification:show",
        t("accountSettle.oldHistory.done", {
          name: account.account_name,
          day: dayLabel(oldUpTo),
        }),
        "success",
      );
      onSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settle.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  // ── See transactions (owner mock 2026-10-26 §7) ─────────────────────────
  // The picked days' rows, paid ones too, beside the calendar. Paid rows and
  // full amounts come from the month reads (every month with a picked day,
  // shared cache with the calendar); open status, what is left and the tick
  // come from the open queue and `buildDaySelections` (`selectedKeys`), so
  // the table can never disagree with the payload (rule 14). Unticking here
  // writes the sheet's `untickedRows`.
  const [txOpen, setTxOpen] = useState(false);
  const [txScroll, setTxScroll] = useState<{ day: string; seq: number } | null>(
    null,
  );
  const txPanelId = useId();
  const pickedMonths = useMemo(
    () => [...new Set(pickedSorted.map((d) => d.slice(0, 7)))],
    [pickedSorted],
  );
  const txMonthQueries = useSupplierAccountMonthsRowsQueries(
    account.account_supplier_id,
    pickedMonths,
    txOpen,
  );
  // Worked out on every render (a few dozen rows): the month reads are a
  // variable-length list, which a hook dependency array cannot hold.
  const txRows: SettleTransactionRow[] = (() => {
    const queueByKey = new Map(rows.map((r) => [accountRowKey(r), r]));
    const byKey = new Map<string, AccountUnsettledRow>();
    for (const { data } of txMonthQueries) {
      for (const r of (data ?? []) as AccountUnsettledRow[]) {
        if (r.row_scope === "DAY" && picked.has(r.shop_day)) {
          byKey.set(accountRowKey(r), r);
        }
      }
    }
    // A month not read yet (or the table closed): its open rows still show.
    for (const r of rows) {
      const key = accountRowKey(r);
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
        const key = accountRowKey(r);
        const q = queueByKey.get(key);
        const open = q !== undefined && isSettleRowOpen(q);
        const waiting = open && isSettleRowWaiting(q, coveredTypes);
        return {
          key,
          id: r.id,
          day: r.shop_day,
          label: detailLabel(r),
          memberTag: r.source_name || null,
          nameRef: txNameRef(q ?? r, (ref) =>
            t("accountSettle.transactions.ref", { ref }),
          ),
          amount_usd: r.amount_usd,
          amount_lbp: r.amount_lbp,
          left_usd: open ? q.remaining_usd : 0,
          left_lbp: open ? q.remaining_lbp : 0,
          status: !open ? "paid" : waiting ? "waiting" : "open",
          checked: selectedKeys.has(key),
        };
      });
  })();
  const txCount = countOpenSettleTransactions(txRows, picked);
  /** Scroll the open table to `day`; nothing while it is closed (owner
   *  2026-10-27: a day tap only picks / unpicks). */
  const scrollTableTo = (day: string) => {
    if (txOpen) setTxScroll((prev) => ({ day, seq: (prev?.seq ?? 0) + 1 }));
  };

  // ── Account lines an undo / void wrote (T037, FR-016b) ──────────────────
  const reliefRows = accountRows.filter(
    (r) => r.relief_origin && isSettleRowOpen(r),
  );
  /** The ↺ line's day link: show that day's month (and its rows, when the
   *  table is open). */
  const goToDay = (day: string) => {
    setMonth(day.slice(0, 7));
    scrollTableTo(day);
  };

  const sideSections = SETTLE_CURRENCIES.map((c) => sections[c]).filter(
    (s) => s.shown && !mainCurrencies.includes(s.currency),
  );
  const hiddenSections = SETTLE_CURRENCIES.map((c) => sections[c]).filter(
    (s) => !s.shown,
  );
  const creditCurrencies = SETTLE_CURRENCIES.filter(
    (c) => credit[c].total > SETTLE_EPS[c],
  );
  // The boxes are re-created (re-filled with the new pre-fill) when the
  // operator changes WHAT is settled — the picked days, the credit, the
  // statement types — never when the queue refetches after a stale refusal
  // (FR-021: the lines the operator typed are kept).
  const scopeKey = `${pickedSorted.join(",")}|${[...untickedRows].sort().join(",")}|${credit.USD.used}|${credit.LBP.used}|${coveredTypes?.join(",") ?? "all"}`;

  const handleCommissionChange = (c: SettleCurrency, raw: string) =>
    setCommissionInput((prev) => ({ ...prev, [c]: raw }));

  const dayLabel = (day: string) =>
    fmt.formatDate(dayDate(day), { day: "numeric", month: "short" });

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="supplier-account-settle-sheet"
    >
      <SettleSheetLayout
        open={txOpen}
        panelId={txPanelId}
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
              {t("accountSettle.title", { name: account.account_name })}
            </h3>
            <div className="text-xs text-slate-400 mt-1">
              {t("accountSettle.calendar.intro")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label={tc("actions.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div
            className="space-y-3"
            data-testid="supplier-account-settle-calendar"
          >
            {monthQuery.isError ? (
              <div className="text-red-400 text-xs py-4 text-center">
                {t("accountSettle.calendar.monthFailed")}
              </div>
            ) : monthQuery.isLoading ? (
              <div className="text-slate-400 text-xs py-4 text-center">
                {t("accountSettle.calendar.monthLoading")}
              </div>
            ) : (
              <SettleCalendar
                month={month}
                days={days}
                today={today}
                picked={picked}
                partlyPicked={partlyPickedDays}
                onToggleDay={handleToggleDay}
                onOpenDay={scrollTableTo}
                onPrevMonth={() => setMonth((m) => shiftMonth(m, -1))}
                onNextMonth={
                  month < currentMonth
                    ? () => setMonth((m) => shiftMonth(m, 1))
                    : undefined
                }
                leftOutDays={leftOutDays}
                monthLeft={monthLeftTotals}
                olderUnselected={olderUnselected}
                seeTransactions={{
                  count: txCount,
                  expanded: txOpen,
                  controlsId: txPanelId,
                  onToggle: () => setTxOpen(!txOpen),
                }}
                // LIRA-345 — the ↺ hover text names the supplier settled.
                formatMark={(m) => {
                  const params = {
                    amount: formatMoney(Math.abs(m.amount), m.currency),
                    ref: m.ref.startsWith("#") ? m.ref : `#${m.ref}`,
                    name: account.account_name,
                  };
                  return m.origin === "UNDO"
                    ? t("accountSettle.calendar.markOwedName", params)
                    : t("accountSettle.calendar.markCreditName", params);
                }}
              />
            )}
            {unsettledQuery.isSuccess && (
              <SettleSelectionBar
                count={picked.size}
                firstDay={pickedSorted[0] ? dayLabel(pickedSorted[0]) : ""}
                lastDay={newestPicked ? dayLabel(newestPicked) : ""}
                totals={selection.owed}
                leftOutCount={leftOutDays.size}
                onClear={() => setPickedState(new Set())}
                onPickAllOpen={() => setPickedState(new Set(openDays))}
              />
            )}
          </div>

          {showStatementTypes && (
            <OmtCoveredTypesPicker
              value={coveredTypes}
              onChange={handleCoveredChange}
              testIdPrefix="supplier-account-settle-covered"
              heading={t("settleTab.coveredHeading")}
            />
          )}

          {unsettledQuery.isLoading ? (
            <div className="text-slate-400 text-xs py-4 text-center">
              {t("accountSettle.loading")}
            </div>
          ) : unsettledQuery.isError ? (
            <div className="text-red-400 text-xs py-4 text-center">
              {t("accountSettle.loadFailed", { name: account.account_name })}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-slate-500 text-xs py-4 text-center">
              {t("accountSettle.empty", { name: account.account_name })}
            </div>
          ) : null}

          {unsettledQuery.isSuccess &&
            creditCurrencies.map((c) => {
              const lc = c.toLowerCase();
              const typed = creditInput[c];
              const shownValue =
                typed !== null && parseAmount(typed) <= credit[c].limit
                  ? typed
                  : formatCreditInput(credit[c].used, c);
              return (
                <div
                  key={c}
                  data-testid={`supplier-account-settle-credit-line-${lc}`}
                  className="flex flex-wrap items-center gap-2 bg-emerald-950/40 border border-emerald-800/60 rounded-xl px-3 py-2 text-xs text-emerald-300"
                >
                  <label htmlFor={`supplier-account-settle-credit-${lc}`}>
                    {t("accountSettle.calendar.useCredit", {
                      name: account.account_name,
                    })}
                  </label>
                  <input
                    id={`supplier-account-settle-credit-${lc}`}
                    type="text"
                    inputMode={c === "USD" ? "decimal" : "numeric"}
                    data-testid={`supplier-account-settle-credit-${lc}`}
                    value={shownValue}
                    onChange={(e) => handleCreditChange(c, e.target.value)}
                    className="w-28 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-white text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <span
                    data-testid={`supplier-account-settle-credit-total-${lc}`}
                  >
                    {t("accountSettle.calendar.creditOf", {
                      total: formatMoney(credit[c].total, c),
                    })}
                  </span>
                </div>
              );
            })}

          {/* LIRA-344 — "Remove credit" on each open account credit
              (admin). After a removal the credit box re-defaults. */}
          {unsettledQuery.isSuccess && canRemoveCredit && (
            <AccountCreditRemoval
              accountSupplierId={account.account_supplier_id}
              accountName={account.account_name}
              rows={accountRows}
              dayLabel={dayLabel}
              onRemoved={() => setCreditInput({ USD: null, LBP: null })}
              onStale={() => void unsettledQuery.refetch()}
            />
          )}

          {/* LIRA-343 T037 (FR-016b) — what an undo / void moved to the
              account, naming its origin, with a link to the day it
              happened (that day carries the ↺ mark). */}
          {unsettledQuery.isSuccess &&
            reliefRows.map((r) => {
              const lines: string[] = [];
              for (const c of SETTLE_CURRENCIES) {
                const amount = rowRemaining(r, c);
                if (Math.abs(amount) <= SETTLE_EPS[c]) continue;
                const params = {
                  amount: formatMoney(amount, c),
                  ref: r.relief_ref ?? "",
                  name: account.account_name,
                };
                lines.push(
                  r.relief_origin === "UNDO"
                    ? t("accountSettle.calendar.markOwedName", params)
                    : t("accountSettle.calendar.markCreditName", params),
                );
              }
              return (
                <div
                  key={accountRowKey(r)}
                  data-testid="supplier-account-settle-relief-line"
                  className="flex flex-wrap items-center gap-2 bg-indigo-950/40 border border-indigo-800/60 rounded-xl px-3 py-2 text-xs text-indigo-200"
                >
                  <span aria-hidden="true" className="font-bold">
                    ↺
                  </span>
                  <span className="flex-1">{lines.join(" · ")}</span>
                  <button
                    type="button"
                    onClick={() => goToDay(r.shop_day)}
                    className="font-semibold underline underline-offset-[3px] hover:text-white"
                  >
                    {t("accountSettle.calendar.reliefGoToDay", {
                      day: dayLabel(r.shop_day),
                    })}
                  </button>
                </div>
              );
            })}

          {unsettledQuery.isSuccess && mainCurrencies.length > 0 && (
            <CurrencySection
              sections={mainCurrencies.map((c) => sections[c])}
              accountName={account.account_name}
              showCommission={showCommission}
              commissionInput={commissionInput}
              onCommissionChange={handleCommissionChange}
              onChooseDirection={() => {}}
              returnLegs={returnLegsByCurrency}
              paymentInput={
                <MultiPaymentInput
                  // Re-created when the currencies, the direction or the
                  // scope change (re-filled with the new pre-fill); NOT on
                  // a refetch after a stale refusal (FR-021).
                  key={`main-${mainDirection}-${mainKeyCurrencies}-${scopeKey}`}
                  label={
                    mainDirection === "PAY"
                      ? t("accountSettle.youPay", {
                          currencies: mainCurrencies.join(" · "),
                        })
                      : t("accountSettle.youReceive", {
                          currencies: mainCurrencies.join(" · "),
                        })
                  }
                  // LIRA-322 — each currency on its own: a line counts only
                  // toward its own currency, never converted or netted.
                  perCurrencyTotals
                  totals={mainTotals}
                  // LIRA-343 — pre-filled with what the picked days owe
                  // minus the credit set, one Cash line per currency.
                  initialLines={mainTotals.map((tot) => ({
                    method: "CASH",
                    currencyCode: tot.currency,
                    amount: tot.amount,
                  }))}
                  totalAmountCurrency={mainCurrencies[0]}
                  currency={mainCurrencies[0]}
                  onChange={setMainLines}
                  // LIRA-315 — change handed back (OUT legs) or, when not
                  // handed back, left on the account (server books it).
                  onReturnChange={setMainReturnLegs}
                  unreturnedChangeTo="ACCOUNT_BALANCE"
                  accountLabel={t("accountSettle.accountLabel", {
                    name: account.account_name,
                  })}
                  cashOnlyReturn
                  showPmFee={false}
                  showDiscount={false}
                  paymentMethods={methods}
                  // FR-001 — only the currencies this box settles.
                  currencies={mainCurrencies.map((c) =>
                    c === "USD"
                      ? { code: "USD", symbol: "$" }
                      : { code: "LBP", symbol: "LBP" },
                  )}
                  returnCurrencies={["USD", "LBP"]}
                  exchangeRate={exchangeRate}
                  onExchangeRateChange={setPaymentRate}
                  payer={mainDirection === "PAY" ? "shop" : "customer"}
                  {...(mainDirection === "COLLECT"
                    ? {
                        owedLabel: t("accountSettle.stillOwes", {
                          name: account.account_name,
                        }),
                      }
                    : {})}
                  // Owner decision 2026-10-12 — no Waive on the Suppliers
                  // page (the server supports it per currency, FR-011).
                  waiveDisabled
                />
              }
            />
          )}

          {unsettledQuery.isSuccess &&
            sideSections.map((s) => (
              <CurrencySection
                key={s.currency}
                sections={[s]}
                accountName={account.account_name}
                showCommission={showCommission}
                commissionInput={commissionInput}
                onCommissionChange={handleCommissionChange}
                onChooseDirection={(dir) =>
                  setDirectionChoice((prev) => ({ ...prev, [s.currency]: dir }))
                }
                returnLegs={returnLegsByCurrency}
                paymentInput={
                  s.coveredWithoutMoney ? null : (
                    <MultiPaymentInput
                      // Keyed by currency + direction + scope: a refetch
                      // after a stale refusal keeps the lines the operator
                      // typed.
                      key={`${s.currency}-${s.direction}-${scopeKey}`}
                      label={
                        s.direction === "PAY"
                          ? t("accountSettle.youPay", {
                              currencies: s.currency,
                            })
                          : t("accountSettle.youReceive", {
                              currencies: s.currency,
                            })
                      }
                      totals={[
                        {
                          amount: roundMoney(Math.abs(s.owed), s.currency),
                          currency: s.currency,
                        },
                      ]}
                      // LIRA-343 (FR-010) — pre-filled with the pre-fill like
                      // the main box; a currency with nothing owed (the
                      // operator chose a direction) starts empty.
                      fillTotals={[
                        {
                          amount: s.canChooseDirection
                            ? 0
                            : roundMoney(Math.abs(s.owed), s.currency),
                          currency: s.currency,
                        },
                      ]}
                      totalAmountCurrency={s.currency}
                      currency={s.currency}
                      onChange={(next) =>
                        setSideLines((prev) => ({
                          ...prev,
                          [s.currency]: next,
                        }))
                      }
                      onReturnChange={(next) =>
                        setSideReturnLegs((prev) => ({
                          ...prev,
                          [s.currency]: next,
                        }))
                      }
                      unreturnedChangeTo="ACCOUNT_BALANCE"
                      accountLabel={t("accountSettle.accountLabel", {
                        name: account.account_name,
                      })}
                      cashOnlyReturn
                      showPmFee={false}
                      showDiscount={false}
                      paymentMethods={methods}
                      // FR-001 — money in this section is in its own currency.
                      currencies={[
                        s.currency === "USD"
                          ? { code: "USD", symbol: "$" }
                          : { code: "LBP", symbol: "LBP" },
                      ]}
                      returnCurrencies={["USD", "LBP"]}
                      exchangeRate={exchangeRate}
                      onExchangeRateChange={setPaymentRate}
                      payer={s.direction === "PAY" ? "shop" : "customer"}
                      {...(s.direction === "COLLECT"
                        ? {
                            owedLabel: t("accountSettle.stillOwes", {
                              name: account.account_name,
                            }),
                          }
                        : {})}
                      waiveDisabled
                    />
                  )
                }
              />
            ))}

          {unsettledQuery.isSuccess && hiddenSections.length > 0 && (
            <div className="space-y-1">
              {hiddenSections.map((s) => (
                <div
                  key={s.currency}
                  data-testid={`supplier-account-settle-nothing-owed-${s.currency.toLowerCase()}`}
                  className="flex items-center justify-between gap-2 text-xs text-slate-500 px-1"
                >
                  <span>
                    {t("accountSettle.nothingOwedIn", { currency: s.currency })}
                  </span>
                  <DirectionChoice
                    currency={s.currency}
                    accountName={account.account_name}
                    value={null}
                    onChoose={(dir) =>
                      setDirectionChoice((prev) => ({
                        ...prev,
                        [s.currency]: dir,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          {canSettleOldHistory && unsettledQuery.isSuccess && (
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
              accountName={account.account_name}
              preview={oldHistory}
              dayLabel={dayLabel}
              submitting={submitting}
              onConfirm={handleOldHistorySubmit}
            />
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {t("form.noteOptional")}
            </label>
            <input
              data-testid="supplier-account-settle-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              placeholder={t("accountSettle.notePlaceholder", {
                name: account.account_name,
              })}
            />
          </div>

          {error && (
            <p
              className="text-red-400 text-xs"
              data-testid="supplier-account-settle-error"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
            >
              {tc("actions.cancel")}
            </button>
            <button
              type="button"
              data-testid="supplier-account-settle-submit"
              onClick={handleSubmit}
              disabled={confirmDisabled}
              className="flex-1 py-3 rounded-xl font-bold text-white shadow-lg active:scale-95 transition-all disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none bg-blue-600 hover:bg-blue-500 shadow-blue-900/20"
            >
              {submitting ? t("form.processing") : t("account.settle")}
            </button>
          </div>
        </div>
      </SettleSheetLayout>
    </div>
  );
}

/**
 * LIRA-343 T041 (FR-021) — "Settle old history up to…": a date, the
 * preview of each open day on or before it (closes / stays open with what
 * is left), the credit it uses, and its own confirm. Confirm is off when
 * nothing would be paid.
 */
function OldHistoryPanel({
  open,
  onOpen,
  onCancel,
  upTo,
  maxDay,
  onUpToChange,
  accountName,
  preview,
  dayLabel,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  upTo: string;
  maxDay: string;
  onUpToChange: (day: string) => void;
  accountName: string;
  preview: {
    days: OldHistoryDay[];
    creditUsed: { usd: number; lbp: number };
    anything: boolean;
  } | null;
  dayLabel: (day: string) => string;
  submitting: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation("suppliers");
  const { t: tc } = useTranslation("common");
  const dateId = useId();
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="text-xs font-semibold text-slate-400 underline underline-offset-[3px] hover:text-white"
      >
        {t("accountSettle.oldHistory.open")}
      </button>
    );
  }
  const usedParts: string[] = [];
  if (preview && preview.creditUsed.usd > 0)
    usedParts.push(formatMoney(preview.creditUsed.usd, "USD"));
  if (preview && preview.creditUsed.lbp > 0)
    usedParts.push(formatMoney(preview.creditUsed.lbp, "LBP"));
  return (
    <div
      data-testid="supplier-account-settle-old-history"
      className="bg-slate-800 rounded-xl p-4 space-y-3"
    >
      <div>
        <div className="text-white font-bold text-sm">
          {t("accountSettle.oldHistory.heading")}
        </div>
        <p className="text-xs text-slate-400 mt-1">
          {t("accountSettle.oldHistory.intro", { name: accountName })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={dateId} className="text-xs text-slate-400">
          {t("accountSettle.oldHistory.upTo")}
        </label>
        <input
          id={dateId}
          type="date"
          value={upTo}
          max={maxDay}
          onChange={(e) => onUpToChange(e.target.value)}
          className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-emerald-500 [color-scheme:dark]"
        />
      </div>
      {preview && (
        <div className="space-y-1 text-xs">
          {preview.days.map((d) => {
            const left: string[] = [];
            for (const c of SETTLE_CURRENCIES) {
              if (Math.abs(d.left[c]) > SETTLE_EPS[c])
                left.push(formatMoney(d.left[c], c));
            }
            return (
              <div
                key={d.day}
                data-testid="supplier-account-settle-old-day"
                data-day={d.day}
                data-status={d.status}
                className={
                  d.status === "closes" ? "text-emerald-300" : "text-amber-300"
                }
              >
                {d.status === "closes"
                  ? t("accountSettle.oldHistory.dayCloses", {
                      day: dayLabel(d.day),
                    })
                  : t("accountSettle.oldHistory.dayStaysOpen", {
                      day: dayLabel(d.day),
                      amounts: left.join(" + "),
                    })}
              </div>
            );
          })}
          {usedParts.length > 0 && (
            <div
              data-testid="supplier-account-settle-old-credit-used"
              className="text-slate-300 pt-1"
            >
              {t("accountSettle.oldHistory.creditUsed", {
                name: accountName,
                amounts: usedParts.join(" + "),
              })}
            </div>
          )}
          {!preview.anything && (
            <p
              data-testid="supplier-account-settle-old-nothing"
              className="text-slate-500"
            >
              {t("accountSettle.oldHistory.nothing")}
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:bg-slate-700 hover:text-white"
        >
          {tc("actions.cancel")}
        </button>
        <button
          type="button"
          data-testid="supplier-account-settle-old-confirm"
          onClick={onConfirm}
          disabled={submitting || !preview?.anything}
          className="flex-1 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500"
        >
          {t("accountSettle.oldHistory.confirm")}
        </button>
      </div>
    </div>
  );
}

/** Pay OMT / Collect from OMT — only for a currency that owes nothing. */
function DirectionChoice({
  currency,
  value,
  onChoose,
  accountName,
}: {
  currency: SettleCurrency;
  value: SettleDirection | null;
  onChoose: (dir: SettleDirection) => void;
  /** LIRA-345 — "Pay Katsh" / "Collect from Katsh". */
  accountName: string;
}) {
  const { t } = useTranslation("suppliers");
  return (
    <div className="flex gap-1">
      {(["PAY", "COLLECT"] as const).map((dir) => (
        <button
          key={dir}
          type="button"
          data-testid={`supplier-account-settle-direction-${dir.toLowerCase()}-${currency.toLowerCase()}`}
          onClick={() => onChoose(dir)}
          className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
            value === dir
              ? dir === "PAY"
                ? "bg-red-600 text-white"
                : "bg-green-600 text-white"
              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
        >
          {dir === "PAY"
            ? t("accountSettle.payName", { name: accountName })
            : t("accountSettle.collectFromName", { name: accountName })}
        </button>
      ))}
    </div>
  );
}

/**
 * One payment card: the header (what is owed, each currency in its own
 * currency, joined " · "), the commission per currency, the payment box and
 * the preview per currency (closes / part-paid / untouched, still owed
 * after). `sections` all share one direction. The card's test id lists its
 * currencies (`…-section-usd`, `…-section-usd-lbp`).
 */
function CurrencySection({
  sections,
  accountName,
  showCommission,
  commissionInput,
  onCommissionChange,
  onChooseDirection,
  returnLegs,
  paymentInput,
}: {
  sections: SectionState[];
  accountName: string;
  showCommission: boolean;
  commissionInput: PerCurrency<string>;
  onCommissionChange: (currency: SettleCurrency, raw: string) => void;
  onChooseDirection: (dir: SettleDirection) => void;
  returnLegs: PerCurrency<PaymentLine[]>;
  paymentInput: ReactNode;
}) {
  const { t } = useTranslation("suppliers");
  const first = sections[0];
  const { direction } = first;
  const nothingOwed = sections.length === 1 && first.canChooseDirection;
  const stillOwedOf = (s: SectionState) =>
    s.alloc ? s.alloc.remaining_after : s.daysOwed;
  const owesYouAfter = sections.some(
    (s) => stillOwedOf(s) < -SETTLE_EPS[s.currency],
  );

  return (
    <div
      data-testid={`supplier-account-settle-section-${sections
        .map((s) => s.currency.toLowerCase())
        .join("-")}`}
      className="bg-slate-800 rounded-xl p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-white font-bold text-sm">
          {nothingOwed
            ? t("accountSettle.nothingOwedIn", { currency: first.currency })
            : direction === "PAY"
              ? t("accountSettle.youPayName", { name: accountName })
              : t("accountSettle.namePaysYou", { name: accountName })}
        </span>
        {nothingOwed ? (
          <DirectionChoice
            currency={first.currency}
            accountName={accountName}
            value={direction}
            onChoose={onChooseDirection}
          />
        ) : (
          <span
            className={`font-mono font-bold text-base ${
              direction === "PAY" ? "text-red-400" : "text-green-400"
            }`}
          >
            {sections.map((s, i) => (
              <span key={s.currency}>
                {i > 0 && " · "}
                <span
                  data-testid={`supplier-account-settle-owed-${s.currency.toLowerCase()}`}
                >
                  {formatMoney(s.owed, s.currency)}
                </span>
              </span>
            ))}
          </span>
        )}
      </div>

      {/* Settlement-day commission per currency. Owner 2026-10-15: it never
          changes what the money covers or the box totals — after the
          payment it is credited to the OMT account (netted at the next
          settlement), and recognised only on transfers this payment
          closes. */}
      {showCommission && (
      <div
        className={sections.length > 1 ? "grid grid-cols-2 gap-2" : undefined}
      >
        {sections.map((s) => {
          const lc = s.currency.toLowerCase();
          return (
            <div key={s.currency}>
              <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
                {t("accountSettle.commission", { currency: s.currency })}
              </label>
              <input
                type="text"
                inputMode={s.currency === "USD" ? "decimal" : "numeric"}
                data-testid={`supplier-account-settle-commission-${lc}`}
                value={commissionInput[s.currency]}
                onChange={(e) => {
                  const raw = e.target.value.replace(/,/g, "");
                  const ok =
                    s.currency === "USD"
                      ? /^\d*\.?\d*$/.test(raw)
                      : /^\d*$/.test(raw);
                  if (raw === "" || ok) onCommissionChange(s.currency, raw);
                }}
                placeholder={s.currency === "USD" ? "0.00" : "0"}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
              {s.commissionProblem && (
                <p
                  className="text-amber-400 text-xs mt-1"
                  data-testid={`supplier-account-settle-commission-warning-${lc}`}
                >
                  {s.commissionProblem}
                </p>
              )}
            </div>
          );
        })}
      </div>
      )}

      {paymentInput}

      {sections.some((s) => s.rows.length > 0) && (
        <div className="border border-slate-700 rounded-xl overflow-hidden">
          <div className="max-h-[24vh] overflow-y-auto divide-y divide-slate-700">
            {sections
              .filter((s) => s.rows.length > 0)
              .map((s) => (
                <PreviewRows key={s.currency} section={s} />
              ))}
          </div>
        </div>
      )}

      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-slate-300">
          <span>
            {owesYouAfter
              ? t("accountSettle.stillOwesYouAfter", { name: accountName })
              : t("accountSettle.stillOwedAfter")}
          </span>
          <span className="font-mono font-semibold text-white">
            {sections.map((s, i) => (
              <span key={s.currency}>
                {i > 0 && " · "}
                <span
                  data-testid={`supplier-account-settle-still-owed-${s.currency.toLowerCase()}`}
                >
                  {formatMoney(
                    roundMoney(stillOwedOf(s), s.currency),
                    s.currency,
                  )}
                </span>
              </span>
            ))}
          </span>
        </div>
        {sections.map((s) => {
          const lc = s.currency.toLowerCase();
          const extra = s.alloc ? s.alloc.extra : 0;
          const changeInOtherCurrency = returnLegs[s.currency].some(
            (l) => l.amount > 0 && l.currencyCode !== s.currency,
          );
          return (
            <div key={s.currency} className="space-y-1">
              {/* LIRA-343 (FR-015) — the account credit this settlement uses. */}
              {s.alloc &&
                s.alloc.account_credit_applied > SETTLE_EPS[s.currency] && (
                  <div className="flex justify-between text-slate-300">
                    <span>
                      {t("accountSettle.calendar.creditUsed", {
                        name: accountName,
                      })}
                    </span>
                    <span
                      data-testid={`supplier-account-settle-credit-applied-${lc}`}
                      className="font-mono text-emerald-400"
                    >
                      {formatMoney(s.alloc.account_credit_applied, s.currency)}
                    </span>
                  </div>
                )}
              {s.alloc && s.alloc.cashout_commission_recognised > 0 && (
                <div className="flex justify-between text-slate-300">
                  <span>{t("accountSettle.deferredCommission")}</span>
                  <span
                    data-testid={`supplier-account-settle-deferred-commission-${lc}`}
                    className="font-mono text-emerald-400"
                  >
                    {formatMoney(
                      s.alloc.cashout_commission_recognised,
                      s.currency,
                    )}
                  </span>
                </div>
              )}
              {Math.abs(extra) > SETTLE_EPS[s.currency] && (
                <p
                  className="text-emerald-300 text-xs"
                  data-testid={`supplier-account-settle-extra-${lc}`}
                >
                  {changeInOtherCurrency
                    ? t("accountSettle.extraChangeOther", {
                        money: formatMoney(extra, s.currency),
                      })
                    : t("accountSettle.extraOnAccount", {
                        money: formatMoney(extra, s.currency),
                      })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One currency's preview rows: closes / part-paid / untouched. */
function PreviewRows({ section }: { section: SectionState }) {
  const { t } = useTranslation("suppliers");
  const { currency, alloc } = section;
  const closedKeys = new Set(alloc?.closed.map(accountRowKey) ?? []);
  return (
    <div
      data-testid={`supplier-account-settle-preview-${currency.toLowerCase()}`}
      className="divide-y divide-slate-700"
    >
      {section.rows.map((row) => {
        const key = accountRowKey(row);
        const before = rowRemaining(row, currency);
        const isPartial =
          alloc?.partial != null && accountRowKey(alloc.partial) === key;
        const status = isPartial
          ? "part-paid"
          : closedKeys.has(key)
            ? "closes"
            : "untouched";
        return (
          <div
            key={key}
            data-testid="supplier-account-settle-preview-row"
            data-kind={row.kind}
            data-row-id={row.id}
            data-status={status}
            className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center"
          >
            <div className="col-span-4 text-slate-300 truncate flex items-center gap-1">
              {rowTypeLabel(row)}
              {before < 0 && (
                <span className="px-1 py-0.5 rounded bg-emerald-900/50 text-emerald-400 text-[9px] font-semibold uppercase tracking-wide">
                  {t("accountSettle.credit")}
                </span>
              )}
            </div>
            <div className="col-span-3 text-end font-mono text-white">
              {formatMoney(before, currency)}
            </div>
            <div className="col-span-5 text-end">
              {status === "closes" ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/50 text-green-300">
                  {t("accountSettle.closes")}
                </span>
              ) : status === "part-paid" && alloc?.partial ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/50 text-amber-300">
                  {t("accountSettle.partialOf", {
                    applied: formatCompact(alloc.partial.applied, currency),
                    before: formatCompact(before, currency),
                    remaining: formatCompact(alloc.partial.remaining, currency),
                  })}
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-400">
                  {t("accountSettle.untouched")}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default AccountSettleSheet;
