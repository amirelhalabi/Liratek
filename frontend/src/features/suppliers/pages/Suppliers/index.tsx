import { useEffect, useMemo, useState } from "react";
import {
  appEvents,
  BALANCE_EPS,
  balanceBucket,
  balanceTextColor,
  CounterpartySettleModal,
  PageHeader,
  type PaymentLine,
} from "@liratek/ui";
import { Truck, Eraser, Plus, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { useShopBase } from "@/hooks/useShopBase";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import {
  useSuppliersQuery,
  useSupplierBalancesQuery,
  useProductSupplierBalancesQuery,
  useProductItemsQuery,
  useSupplierLedgerQuery,
  useAllTransactionsQuery,
  useSupplierCashflowMutation,
  useSupplierLedgerEntryMutation,
  useSupplierWriteOffMutation,
  useUnsettledTransactionsQuery,
  useSettleTransactionsMutation,
  type UnsettledSupplierTransaction,
} from "../../hooks/useSuppliers";

type Supplier = {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  note: string | null;
  is_active: number;
  module_key: string | null;
  provider: string | null;
  is_system: number;
  created_at: string;
  /** COMMISSION_AT_SETTLEMENT_PLAN.md D8 — per-supplier preference,
   *  pre-selects the Settle modal's LUMP/RATE toggle. Null on schemas
   *  older than v150. */
  commission_entry_mode?: "LUMP" | "RATE" | null;
  /** D8 — pre-fills the RATE-mode per-unit rate. */
  commission_rate?: number | null;
  /** LIRA-112 (D12, v151) — does this supplier earn commission at all
   *  (0 = never, e.g. iPick; 1 = yes, e.g. Katsh/every other supplier).
   *  Undefined on schemas older than v151. */
  commission_eligible?: number | null;
  /** LIRA-112 (v151) — the currency `commission_rate` is denominated in
   *  ('USD' by default; Katsh is 'LBP' — 20,000 LBP/bill, not USD).
   *  Undefined on schemas older than v151. */
  commission_rate_currency?: "USD" | "LBP" | null;
};

type SupplierBalance = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

type LedgerEntry = {
  id: number;
  supplier_id: number;
  entry_type:
    | "TOP_UP"
    | "SALE_COST"
    | "PAYMENT"
    | "ADJUSTMENT"
    | "SETTLEMENT"
    | "CASH_PRIZE"
    | "SUPPLIER_PAYS_US";
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_by: number | null;
  transaction_id: number | null;
  /** 1 = soft-voided (its transaction was voided/refunded); excluded from the balance. */
  is_refunded?: number;
  refunded_at?: string | null;
  created_at: string;
};

type SupplierTxn = {
  id: number;
  // COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 1 — iPick/Katsh BILL rows now
  // flow through this same history projection (getAllByProvider).
  service_type: "SEND" | "RECEIVE" | "BILL";
  amount: number;
  currency: string;
  commission: number;
  cost: number;
  omt_fee: number | null;
  omt_service_type: string | null;
  settlement_id: number | null;
  is_settled: number;
  /**
   * Computed by the repository (SUPPLIER_OWED_EXPR — the ONE owed-per-row
   * definition): 0 for wallet-provider transfers, cost for a LEGACY
   * cost-flow row (`supplier_debt_booked = 1`) and 0 for a post-C5 one
   * (LIRA-122 — the debt already lives in a TOP_UP ledger entry booked at
   * top-up time, so a prepaid sale owes nothing on its own row), and for
   * OMT/WHISH the FEE SPLIT ONLY (|fee| − |commission|), same for SEND
   * and RECEIVE — the principal moved through the system float at transaction
   * time and is not owed. All owed math on this page sums this — never
   * re-derive it.
   */
  supplier_owed: number;
  fifo_status: "paid" | "partial" | "unpaid";
  fifo_paid_usd: number;
  created_at: string;
};

const PROVIDER_DRAWER: Record<string, string> = {
  OMT: "OMT_System",
  WHISH: "Whish_System",
  iPick: "iPick",
  Katsh: "Katsh",
  OMT_APP: "OMT_App",
  WHISH_APP: "Whish_App",
  LOTO: "Loto",
};

/** Display label for the drawer badge next to a supplier's name. OMT_System /
 *  Whish_System are the physical cash drawer at the shop's money-transfer
 *  counter (Primary Cash Drawer plan §1), not a provider float balance — the
 *  badge should read that way, not as the raw internal drawer name. */
function drawerDisplayLabel(drawerName: string): string {
  if (drawerName === "OMT_System") return "OMT Cash Drawer";
  if (drawerName === "Whish_System") return "Whish Cash Drawer";
  return drawerName;
}

/**
 * Supplier balance is the signed sum of the ledger:
 *   > 0  → WE owe the supplier   ("You owe …", GREEN) — owner's rule, verbatim
 *          (2026-08-10): "Positive account should be green, means shop owes
 *          the second party." Suppliers' own positive sign already means
 *          "shop owes" natively, so no negation is needed before handing the
 *          raw amount to the shared `balanceTextColor`/`balanceBucket`
 *          helpers (`@liratek/ui`) — unlike Debts/Partners, whose positive
 *          sign means the OPPOSITE and must negate first.
 *   < 0  → the supplier owes US  ("They owe you …", RED) — e.g. after overpayment
 *   = 0  → settled (within BALANCE_EPS)
 *
 * Pre-2026-08-11 this page's own convention (documented right here) inverted
 * the owner's rule — red for "we owe", green for "they owe us" — inherited,
 * not introduced, by the LIRA-129 refactor (9082d6c), which moved this
 * comment and its branches verbatim without changing the polarity. Flipped
 * as part of the Balance Pages colour audit (`BALANCE_PAGES_UX_AUDIT.md`).
 */

/**
 * LIRA-129, rule 14 — the ONE place "which way does this signed money value
 * move the we-owe-the-supplier balance" is decided. Every signed-amount
 * decision on this page (the aggregate balance via `balanceColor`/
 * `describeBalance`, a single ledger row's badge, a single ledger row's own
 * amount cell) reuses this bucket instead of re-deriving its own threshold.
 */
type LedgerDirection = "UP" | "DOWN" | "FLAT";

/** UP/DOWN/FLAT is this page's own domain vocabulary for "what happens to
 *  the we-owe-the-supplier balance" — kept local since the badge tooltip
 *  text (`LEDGER_DIRECTION_HINT`) is written in those terms. The actual
 *  threshold/epsilon decision is NOT re-derived here — it delegates to the
 *  shared `balanceBucket` (`@liratek/ui`), since Suppliers' positive sign
 *  already means "shop owes" natively (no negation needed, unlike
 *  Debts/Partners — see the balance doc-comment above). */
function signBucket(amount: number): LedgerDirection {
  const bucket = balanceBucket(amount, BALANCE_EPS);
  if (bucket === "SHOP_OWES") return "UP";
  if (bucket === "COUNTERPARTY_OWES") return "DOWN";
  return "FLAT";
}

/**
 * LIRA-129 — a ledger row's overall direction, for the badge. Every write
 * path (`SupplierRepository.addLedgerEntry`/`recordSupplierCashflow`/
 * `settleTransactions`/`_bookCommissionAtSettlement`, and the LOTO/Recharge/
 * FinancialService callers that book TOP_UP) puts a nonzero amount in
 * EXACTLY ONE of amount_usd/amount_lbp — and on the rows where both ARE
 * populated (a mixed-currency settlement/cashflow), both share the caller's
 * one `sign`. So "whichever is nonzero" is safe and matches either currency.
 */
function ledgerRowDirection(
  amountUsd: number,
  amountLbp: number,
): LedgerDirection {
  return signBucket(amountUsd !== 0 ? amountUsd : amountLbp);
}

const LEDGER_DIRECTION_HINT: Record<LedgerDirection, string> = {
  UP: "Increases what we owe this supplier",
  DOWN: "Decreases what we owe this supplier (or increases what they owe us)",
  FLAT: "No effect on the balance",
};

/**
 * LIRA-129 — the badge USED to color itself purely from `entry_type`
 * (TOP_UP always red = "debt up"). That's wrong for a SIGNED TOP_UP: an
 * OMT/WHISH RECEIVE books a NEGATIVE TOP_UP (`grossOwedDelta`,
 * FinancialServiceRepository.ts) because it *reduces* what the shop owes
 * the provider — a red badge next to a green (down) amount told the
 * operator two different things about the same row. Not TOP_UP-specific:
 * the sweep for this ticket found ADJUSTMENT (CREDIT +/DEBIT −, by design)
 * and SUPPLIER_PAYS_US (positive via a RECEIVE cashflow, negative via the
 * at-settlement commission credit) are ALSO written with either sign
 * depending on the call site — same defect, same fix.
 *
 * Direction now comes from the row's own SIGN (`ledgerRowDirection` below —
 * rule 14, the ONE place this decision is made), the same signed-amount
 * convention `balanceColor`/`describeBalance` already use for the
 * aggregate balance above: the whole supplier balance is a straight SUM of
 * every ledger row, so the same "+ increases what we owe, − decreases it"
 * rule applies uniformly to every entry_type, not just TOP_UP. `type` now
 * drives ONLY the label text (which event this was) — never the color.
 *
 * Colour polarity flipped 2026-08-11 (Balance Pages colour audit) to match
 * the owner's rule: UP ("shop owes more") is now GREEN, DOWN ("supplier owes
 * us more") is now RED — the label/meaning (`LEDGER_DIRECTION_HINT` below)
 * did not change, only which colour each meaning gets.
 */
function EntryTypeBadge({
  type,
  direction,
}: {
  type: string;
  direction: LedgerDirection;
}) {
  const color =
    direction === "UP"
      ? "bg-green-900/50 text-green-300"
      : direction === "DOWN"
        ? "bg-red-900/50 text-red-300"
        : "bg-slate-700/50 text-slate-300";
  const label =
    type === "SALE_COST"
      ? "SALE COST"
      : type === "SUPPLIER_PAYS_US"
        ? "PAID US"
        : type;
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${color}`}
      title={LEDGER_DIRECTION_HINT[direction]}
    >
      {label}
    </span>
  );
}

/** `$1.23` or `1,234 LBP` — the one place the USD/LBP money-string ternary
 *  lives (rule 14). Reused by `describeBalance` below and by the batch-settle
 *  confirm modal's "Net payment" line + success notification (LIRA-119) —
 *  before that fix, the settle modal pasted its own `$${...toFixed(2)}`
 *  unconditionally, which is exactly what showed "$0.00" for an LBP-only
 *  commission settlement. */
function formatMoney(amount: number, currency: "USD" | "LBP"): string {
  return currency === "USD"
    ? `$${amount.toFixed(2)}`
    : `${Math.round(amount).toLocaleString()} LBP`;
}

/** Prose is unchanged; only the colour flips (owner's rule, 2026-08-11):
 *  shop-owes ("You owe …") is GREEN, counterparty-owes ("They owe you …")
 *  is RED. Delegates to the shared `balanceTextColor` (`@liratek/ui`) so
 *  the actual bucket/colour mapping isn't re-derived per page (rule 14) —
 *  also retires this page's `green-400` shade in favour of the
 *  `emerald-400` the other two balance pages already use. */
function describeBalance(
  amount: number,
  currency: "USD" | "LBP",
): { text: string; cls: string } {
  const abs = Math.abs(amount);
  const money = formatMoney(abs, currency);
  const bucket = signBucket(amount);
  const cls = balanceTextColor(amount, BALANCE_EPS);
  if (bucket === "UP") return { text: `You owe ${money}`, cls };
  if (bucket === "DOWN") return { text: `They owe you ${money}`, cls };
  return { text: "Settled", cls };
}

/** Compact directional color for a single signed amount (list rows AND,
 *  LIRA-129, a ledger row's own amount cell — same `signBucket` the badge
 *  now uses, rule 14: one threshold, never re-derived). Suppliers' raw sign
 *  already means "shop owes" when positive, so the amount is passed to the
 *  shared helper unnegated (contrast Debts/Partners, which must negate). */
function balanceColor(amount: number): string {
  return balanceTextColor(amount, BALANCE_EPS);
}

export default function SuppliersPage() {
  const { methods } = usePaymentMethods();
  const { partnerSystem } = useShopBase();
  const { user } = useAuth();
  // CQ-10 (D4): standalone write-off is admin-only; the bundled Pay/Receive
  // discount stays admin+staff, same as the Pay/Receive flow it's attached to.
  const isAdmin = user?.role === "admin";

  // ── UI / form state (kept local — not server state) ──────────────────────
  const [viewCategory, setViewCategory] = useState<"companies" | "products">(
    "companies",
  );
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<"settle" | "manual" | "items">(
    "settle",
  );
  // Pay / Receive (LIRA-059): cashflow against the supplier via payment legs
  const [cashflowDirection, setCashflowDirection] = useState<"PAY" | "RECEIVE">(
    "PAY",
  );
  const [cashflowLines, setCashflowLines] = useState<PaymentLine[]>([]);
  const [cashflowNote, setCashflowNote] = useState("");
  const [cashflowKey, setCashflowKey] = useState(0);
  // CQ-10: bundled discount on the Pay/Receive form. MultiPaymentInput's
  // totals here are ALWAYS single-currency (payAmount/payCurrency — the
  // mixed-balance case already collapses to one net USD figure), so the
  // built-in discount scalar maps cleanly: it's already denominated in
  // payCurrency, no per-currency split needed.
  const [cashflowDiscount, setCashflowDiscount] = useState(0);
  const [cashflowDiscountReason, setCashflowDiscountReason] = useState("");

  // CQ-10 (D4): standalone "Write off" modal (admin-only, pure forgiveness —
  // the supplier forgives what we owe them, no cash movement).
  const [showWriteOffModal, setShowWriteOffModal] = useState(false);
  useModalFocusFix(showWriteOffModal);
  const [writeOffAmountUsd, setWriteOffAmountUsd] = useState("");
  const [writeOffAmountLbp, setWriteOffAmountLbp] = useState("");
  const [writeOffReason, setWriteOffReason] = useState("");
  const [writeOffSubmitting, setWriteOffSubmitting] = useState(false);

  // LIRA-080: "Add Credit / Debt" modal (admin+staff). CREDIT = shop owes the
  // supplier more (ledger +); DEBIT = reduces what we owe / they owe us
  // (ledger −). "Cash moved" default ON: cash-ON routes through the existing
  // Pay/Receive plumbing (recordSupplierCashflow — CREDIT→RECEIVE cash in,
  // DEBIT→PAY cash out); OFF posts a paper ADJUSTMENT (no drawer/payments).
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  useModalFocusFix(showAdjustModal);
  const [adjustDirection, setAdjustDirection] = useState<"CREDIT" | "DEBIT">(
    "CREDIT",
  );
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustCurrency, setAdjustCurrency] = useState<"USD" | "LBP">("USD");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustMoveCash, setAdjustMoveCash] = useState(true);
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  // D5 — batch settlement (resurrected from the orphaned
  // Settings/SupplierLedger.tsx, admin-only, built on the shared
  // CounterpartySettleModal). Selection is keyed off the SAME
  // getUnsettledByProvider row set the deleted UI used — not `allTxns` (the
  // Transactions-tab history query includes row types, e.g. a plain SEND
  // with no cost/commission, that were never "settleable" here).
  const [selectedSettleIds, setSelectedSettleIds] = useState<Set<number>>(
    new Set(),
  );
  const [showSettleConfirm, setShowSettleConfirm] = useState(false);
  useModalFocusFix(showSettleConfirm);
  const [settlePaymentLines, setSettlePaymentLines] = useState<PaymentLine[]>(
    [],
  );
  const [settleNote, setSettleNote] = useState("");
  const [settleSubmitting, setSettleSubmitting] = useState(false);
  const [settleKey, setSettleKey] = useState(0);
  // COMMISSION_AT_SETTLEMENT_PLAN.md D8 — entry-mode UI for a NEW-MODEL
  // (commission_model = 1) batch. Ignored/hidden for a legacy batch, whose
  // commission stays derived-and-informational exactly as before.
  const [settleEntryMode, setSettleEntryMode] = useState<"LUMP" | "RATE">(
    "LUMP",
  );
  const [settleCommissionUsdInput, setSettleCommissionUsdInput] = useState("");
  const [settleCommissionLbpInput, setSettleCommissionLbpInput] = useState("");
  const [settleRateInput, setSettleRateInput] = useState("");
  const [settleRateCurrency, setSettleRateCurrency] = useState<"USD" | "LBP">(
    "USD",
  );
  const [settleUnitCountInput, setSettleUnitCountInput] = useState("");
  // Owner follow-up (2026-08-13) — bills-only batch only: how the entered
  // commission is COLLECTED. 'TOP_UP' (default, unchanged) credits the
  // Katsh/iPick provider drawer directly; 'OTHER_PAYMENT' renders
  // MultiPaymentInput (autofilled with the entered commission) and the
  // commission arrives through real payment legs instead. Mirrors the
  // settleEntryMode (LUMP|RATE) toggle immediately above — same pattern, a
  // sibling control, reset alongside it in handleOpenSettleConfirm.
  const [settleCommissionCollectionMode, setSettleCommissionCollectionMode] =
    useState<"TOP_UP" | "OTHER_PAYMENT">("TOP_UP");

  // ── Exchange rate ─────────────────────────────────────────────────────────
  // Payments use the BUY rate (owner decision 2026-07-06): every
  // MultiPaymentInput converts LBP↔USD at buyRate.
  const { buyRate: exchangeRate } = useSellRate();

  // ── Server queries ────────────────────────────────────────────────────────
  const suppliersQuery = useSuppliersQuery();
  const balancesQuery = useSupplierBalancesQuery();
  const productBalancesQuery = useProductSupplierBalancesQuery();

  const selectedSupplier = useMemo(
    () =>
      (suppliersQuery.data as Supplier[] | undefined)?.find(
        (s) => s.id === selectedSupplierId,
      ) ?? null,
    [suppliersQuery.data, selectedSupplierId],
  );

  const isProductSupplier = selectedSupplier?.is_system === 0;

  const ledgerQuery = useSupplierLedgerQuery(selectedSupplierId);
  const allTxnsQuery = useAllTransactionsQuery(
    isProductSupplier ? null : (selectedSupplier?.provider ?? null),
  );
  const unsettledQuery = useUnsettledTransactionsQuery(
    isProductSupplier ? null : (selectedSupplier?.provider ?? null),
  );
  const productItemsQuery = useProductItemsQuery(
    isProductSupplier ? selectedSupplierId : null,
  );

  // ── Derived data (pure computations, no state) ────────────────────────────
  const suppliers = (suppliersQuery.data ?? []) as Supplier[];
  const balances = (balancesQuery.data ?? []) as SupplierBalance[];
  const productBalances = (productBalancesQuery.data ??
    []) as SupplierBalance[];
  const ledger = (ledgerQuery.data ?? []) as LedgerEntry[];
  const allTxns = (allTxnsQuery.data ?? []) as SupplierTxn[];
  const unsettledTxns = (unsettledQuery.data ??
    []) as UnsettledSupplierTransaction[];
  const productItems = (productItemsQuery.data ?? []) as Array<{
    product_id: number;
    name: string;
    quantity: number;
    cost: number;
    total: number;
    created_at: string;
  }>;

  const sortedSuppliers = useMemo(
    () =>
      [...suppliers]
        .filter((s) => s.provider !== partnerSystem)
        .filter((s) =>
          viewCategory === "companies" ? s.is_system === 1 : s.is_system === 0,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [suppliers, partnerSystem, viewCategory],
  );

  const balanceBySupplier = useMemo(() => {
    const map = new Map<number, SupplierBalance>();
    for (const b of balances) map.set(b.supplier_id, b);
    return map;
  }, [balances]);

  const productBalanceBySupplier = useMemo(() => {
    const map = new Map<number, SupplierBalance>();
    for (const b of productBalances) map.set(b.supplier_id, b);
    return map;
  }, [productBalances]);

  // Use the right balance source depending on which tab we're viewing
  const activeBalanceMap =
    viewCategory === "products" ? productBalanceBySupplier : balanceBySupplier;

  // CQ-10: selected supplier's current balance, per currency — positive
  // means we owe THEM (see describeBalance), which is exactly the condition
  // under which they have something left to forgive (write-off).
  const selectedBalanceUsd = Number(
    activeBalanceMap.get(selectedSupplierId ?? -1)?.total_usd ?? 0,
  );
  const selectedBalanceLbp = Number(
    activeBalanceMap.get(selectedSupplierId ?? -1)?.total_lbp ?? 0,
  );
  const canWriteOffSupplier =
    selectedBalanceUsd > BALANCE_EPS || selectedBalanceLbp > BALANCE_EPS;

  const totalOwed = useMemo(() => {
    let usd = 0;
    let lbp = 0;
    for (const s of sortedSuppliers) {
      if (s.is_active === 0) continue;
      const b = activeBalanceMap.get(s.id);
      if (b) {
        usd += Number(b.total_usd || 0);
        lbp += Number(b.total_lbp || 0);
      }
    }
    return { usd, lbp };
  }, [sortedSuppliers, activeBalanceMap]);

  const hasOmtFee = useMemo(
    () => allTxns.some((t) => t.omt_fee != null && t.omt_fee > 0),
    [allTxns],
  );

  /**
   * Suggested amount, currency, and default PAY/RECEIVE direction for the Pay/Receive tab.
   *
   * Products → inventory total (Σ qty × cost), always USD. Direction = PAY (we always owe).
   *
   * Companies — three cases:
   *   Pure USD balance → USD amount, direction from sign.
   *   Pure LBP balance → LBP amount, direction from sign.
   *   Mixed (e.g. we owe LBP + supplier owes us USD) →
   *     netUsd = total_lbp / exchangeRate + total_usd  (user's formula)
   *     currency = USD, direction from sign of netUsd.
   *
   * Positive amount = we owe the supplier → PAY.
   * Negative amount = supplier owes us   → RECEIVE (form receives |amount|).
   */
  const { payAmount, payCurrency, defaultDirection } = useMemo<{
    payAmount: number;
    payCurrency: "USD" | "LBP";
    defaultDirection: "PAY" | "RECEIVE";
  }>(() => {
    if (isProductSupplier) {
      const bal = activeBalanceMap.get(selectedSupplierId ?? 0);
      const owed = Math.max(0, Number(bal?.total_usd ?? 0));
      return { payAmount: owed, payCurrency: "USD", defaultDirection: "PAY" };
    }
    const bal = activeBalanceMap.get(selectedSupplierId ?? 0);
    const usd = Number(bal?.total_usd ?? 0);
    const lbp = Number(bal?.total_lbp ?? 0);
    const hasUsd = Math.abs(usd) > BALANCE_EPS;
    const hasLbp = Math.abs(lbp) > 0.5;

    if (hasLbp && hasUsd) {
      // Mixed currencies: collapse to USD net using exchange rate
      const netUsd = lbp / exchangeRate + usd;
      return {
        payAmount: netUsd,
        payCurrency: "USD",
        defaultDirection: netUsd >= 0 ? "PAY" : "RECEIVE",
      };
    }
    if (hasLbp) {
      return {
        payAmount: lbp,
        payCurrency: "LBP",
        defaultDirection: lbp >= 0 ? "PAY" : "RECEIVE",
      };
    }
    return {
      payAmount: usd,
      payCurrency: "USD",
      defaultDirection: usd >= 0 ? "PAY" : "RECEIVE",
    };
  }, [
    isProductSupplier,
    productItems,
    activeBalanceMap,
    selectedSupplierId,
    exchangeRate,
  ]);

  // FIFO payment coverage per product item.
  // totalPaid = totalProductCosts − currentBalance (balance = costs − payments).
  const itemsWithCoverage = useMemo(() => {
    if (!isProductSupplier || productItems.length === 0) return [];
    const bal = activeBalanceMap.get(selectedSupplierId ?? 0);
    const currentBalanceUsd = Math.max(0, Number(bal?.total_usd ?? 0));
    const totalProductCosts = productItems.reduce((s, i) => s + i.total, 0);
    const totalPaid = Math.max(0, totalProductCosts - currentBalanceUsd);

    let remaining = totalPaid;
    return productItems.map((item) => {
      if (remaining >= item.total - 0.005) {
        remaining = Math.max(0, remaining - item.total);
        return { ...item, paid: item.total, status: "PAID" as const };
      } else if (remaining > 0.005) {
        const paid = remaining;
        remaining = 0;
        return { ...item, paid, status: "PARTIAL" as const };
      } else {
        return { ...item, paid: 0, status: "UNPAID" as const };
      }
    });
  }, [isProductSupplier, productItems, activeBalanceMap, selectedSupplierId]);

  // Auto-set PAY/RECEIVE direction whenever the Pay/Receive tab becomes active
  // or the selected supplier changes. The user can still override it manually.
  useEffect(() => {
    if (activeTab === "manual") {
      setCashflowDirection(defaultDirection);
    }
  }, [activeTab, selectedSupplierId, defaultDirection]);

  // CQ-10: discount is PAY-only (backend rejects it on RECEIVE) — clear it
  // whenever the direction flips or the form remounts post-submit, so a
  // stale discount never survives into a different supplier/direction.
  useEffect(() => {
    setCashflowDiscount(0);
    setCashflowDiscountReason("");
  }, [cashflowDirection, cashflowKey]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCashflow = async () => {
    if (!selectedSupplierId) return;
    const activeLines = cashflowLines.filter((l) => l.amount > 0);
    if (activeLines.length === 0) {
      alert("Enter at least one payment amount");
      return;
    }
    const trimmedNote = cashflowNote.trim();
    // CQ-10: bundled discount — PAY only. MultiPaymentInput's onDiscountChange
    // already emits the clamped value (capped at maxDiscount === payAmount)
    // in payCurrency, so it maps 1:1 onto whichever currency field is owed.
    const hasDiscount = cashflowDirection === "PAY" && cashflowDiscount > 0;
    const trimmedDiscountReason = cashflowDiscountReason.trim();
    const discountFields = hasDiscount
      ? {
          discount: {
            amount_usd: payCurrency === "USD" ? cashflowDiscount : 0,
            amount_lbp: payCurrency === "LBP" ? cashflowDiscount : 0,
            ...(trimmedDiscountReason ? { reason: trimmedDiscountReason } : {}),
          },
        }
      : {};
    const res = await supplierCashflow.mutateAsync({
      supplier_id: selectedSupplierId,
      direction: cashflowDirection,
      payments: activeLines.map((p) => ({
        method: p.method,
        currency_code: p.currencyCode,
        amount: p.amount,
      })),
      exchange_rate: exchangeRate,
      // Omit `note` entirely when empty (exactOptionalPropertyTypes: the field is
      // `note?: string`, so it must be absent rather than explicitly undefined).
      ...(trimmedNote ? { note: trimmedNote } : {}),
      ...discountFields,
    });
    if (!(res as { success: boolean }).success) {
      alert((res as { error?: string }).error || "Failed");
      return;
    }
    appEvents.emit(
      "notification:show",
      hasDiscount
        ? `Supplier transaction recorded (discount ${payCurrency === "USD" ? "$" : ""}${cashflowDiscount.toFixed(payCurrency === "USD" ? 2 : 0)}${payCurrency === "LBP" ? " LBP" : ""})`
        : "Supplier transaction recorded successfully",
      "success",
    );
    setCashflowLines([]);
    setCashflowNote("");
    setCashflowKey((k) => k + 1);
  };

  const supplierCashflow = useSupplierCashflowMutation(
    selectedSupplierId,
    selectedSupplier?.provider ?? null,
  );
  const supplierWriteOff = useSupplierWriteOffMutation(selectedSupplierId);

  // LIRA-080 — the paper (no-cash) side of "Add Credit / Debt".
  const supplierLedgerEntry = useSupplierLedgerEntryMutation(
    selectedSupplierId,
    selectedSupplier?.provider ?? null,
  );

  const resetAdjustForm = () => {
    setAdjustDirection("CREDIT");
    setAdjustAmount("");
    setAdjustCurrency("USD");
    setAdjustNote("");
    setAdjustMoveCash(true);
  };

  const handleSupplierAdjust = async () => {
    if (!selectedSupplierId) return;
    const amount = parseFloat(adjustAmount.replace(/,/g, "")) || 0;
    if (amount <= 0) {
      alert("Enter an amount greater than 0");
      return;
    }
    const isCredit = adjustDirection === "CREDIT";
    const trimmedNote = adjustNote.trim();
    setAdjustSubmitting(true);
    try {
      let result: { success: boolean; error?: string };
      if (adjustMoveCash) {
        // Cash-moved: reuse the existing Pay/Receive plumbing.
        //   CREDIT (we owe supplier more) → RECEIVE: cash IN, ledger +
        //   DEBIT  (reduces what we owe)  → PAY:     cash OUT, ledger −
        result = (await supplierCashflow.mutateAsync({
          supplier_id: selectedSupplierId,
          direction: isCredit ? "RECEIVE" : "PAY",
          payments: [{ method: "CASH", currency_code: adjustCurrency, amount }],
          exchange_rate: exchangeRate,
          ...(trimmedNote ? { note: trimmedNote } : {}),
        })) as { success: boolean; error?: string };
      } else {
        // Paper: signed ADJUSTMENT (CREDIT +, DEBIT −), no drawer/payments.
        // Moves the ledger the SAME way as the cash-moved path per direction.
        const signed = isCredit ? amount : -amount;
        result = (await supplierLedgerEntry.mutateAsync({
          supplier_id: selectedSupplierId,
          entry_type: "ADJUSTMENT",
          amount_usd: adjustCurrency === "USD" ? signed : 0,
          amount_lbp: adjustCurrency === "LBP" ? signed : 0,
          ...(trimmedNote ? { note: trimmedNote } : {}),
        })) as { success: boolean; error?: string };
      }
      if (result.success) {
        appEvents.emit(
          "notification:show",
          `${isCredit ? "Credit" : "Debit"} recorded${
            adjustMoveCash ? "" : " (paper, no cash moved)"
          }.`,
          "success",
        );
        setShowAdjustModal(false);
        resetAdjustForm();
      } else {
        alert(result.error || "Failed");
      }
    } catch {
      alert("Failed to record entry");
    } finally {
      setAdjustSubmitting(false);
    }
  };

  const handleSupplierWriteOff = async () => {
    if (!selectedSupplierId) return;
    const amountUsd = Math.min(
      Math.max(0, parseFloat(writeOffAmountUsd.replace(/,/g, "")) || 0),
      Math.max(0, selectedBalanceUsd),
    );
    const amountLbp = Math.min(
      Math.max(0, parseFloat(writeOffAmountLbp.replace(/,/g, "")) || 0),
      Math.max(0, selectedBalanceLbp),
    );
    if (amountUsd <= 0 && amountLbp <= 0) return;
    setWriteOffSubmitting(true);
    try {
      const result = await supplierWriteOff.mutateAsync({
        supplier_id: selectedSupplierId,
        amount_usd: amountUsd,
        amount_lbp: amountLbp,
        ...(writeOffReason.trim() ? { reason: writeOffReason.trim() } : {}),
      });
      if ((result as { success: boolean }).success) {
        appEvents.emit("notification:show", "Balance written off.", "success");
        setShowWriteOffModal(false);
        setWriteOffAmountUsd("");
        setWriteOffAmountLbp("");
        setWriteOffReason("");
      } else {
        alert((result as { error?: string }).error || "Failed");
      }
    } catch {
      alert("Failed to write off balance");
    } finally {
      setWriteOffSubmitting(false);
    }
  };

  // ── D5: batch settlement (admin-only) ─────────────────────────────────────
  const settleTransactions = useSettleTransactionsMutation(
    selectedSupplierId,
    selectedSupplier?.provider ?? null,
  );

  // Owed per row = supplier_owed, computed by the repository's single
  // SUPPLIER_OWED_EXPR. OMT/WHISH float model (owner-confirmed 2026-07-29):
  // supplier_owed is now FEE-ONLY (|fee| − |commission|, both SEND and
  // RECEIVE) — the shop's commission is ALREADY excluded from this figure.
  // Net you pay = supplier_owed itself, NOT owed − commission again (that
  // was the old gross-principal model's math and would double-subtract the
  // shop's cut under the new one). LBP rows are excluded from the
  // batch-settle CASH math (no LBP settle amount handled here — out of
  // scope) EXCEPT bills (COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 1): a
  // bill's principal never reaches the ledger (SUPPLIER_OWED_EXPR's BILL
  // branch is always 0), only its settlement commission does, so a BILL row
  // must stay selectable even though it's LBP-denominated.
  const selectedUnsettled = useMemo(
    () => unsettledTxns.filter((t) => selectedSettleIds.has(t.id)),
    [unsettledTxns, selectedSettleIds],
  );
  // D2/D4 — group the selection by commission_model. A selection spanning
  // both 0 (LEGACY) and 1 (NEW-MODEL) is a hard-reject on the backend
  // (`_resolveSettlementBatchModel`) — surfaced here BEFORE submit so the
  // operator gets an explanation instead of a generic alert(). Every BILL
  // row is always commission_model = 1 (a legacy commission_model = 0 bill
  // is born is_settled = 1 and can never reach this unsettled queue), so a
  // BILL-only selection is unambiguously a new-model batch.
  const selectedModels = useMemo(
    () => new Set(selectedUnsettled.map((t) => t.commission_model ?? 0)),
    [selectedUnsettled],
  );
  const isMixedModelBatch = selectedModels.size > 1;
  const isNewModelBatch = !isMixedModelBatch && selectedModels.has(1);
  // BILL_COMMISSION_SETTLEMENT_PLAN.md (LIRA-137) — narrow scope: the
  // commission-arrives-as-a-drawer-top-up treatment applies ONLY when every
  // selected row is a BILL (mirrors the SAME gate SupplierRepository.
  // settleTransactions applies server-side — rule 14, one definition of
  // "is this a bills-only batch"). Today every commission_model=1 row IS a
  // BILL (only BILL rows are born that way), so this is currently identical
  // to isNewModelBatch — but keeping the service_type check means a future
  // non-bills new-model row (Phase 2, not built) doesn't silently inherit
  // UI that was never designed for it.
  const isBillsOnlyBatch =
    isNewModelBatch &&
    selectedUnsettled.length > 0 &&
    selectedUnsettled.every((t) => t.service_type === "BILL");
  const settleTotalOwedUsd = useMemo(
    () =>
      selectedUnsettled
        .filter((t) => t.currency !== "LBP")
        .reduce((s, t) => s + t.supplier_owed, 0),
    [selectedUnsettled],
  );
  // LIRA-119 — the LBP mirror of settleTotalOwedUsd above. Always sums to 0
  // TODAY: the only LBP-denominated rows `selectableUnsettled` (below) lets
  // into this batch are BILLs, and SUPPLIER_OWED_EXPR's BILL branch is
  // hardcoded 0 — a bill's principal already left via a provider-drawer cost
  // leg when the bill was created, never through this ledger (the plan's
  // "bills settlement note"). Computed symmetrically with the USD side
  // anyway so `settleNetPayLbp` below is real per-currency math, not a
  // hardcoded 0 — and so a future LBP-eligible non-bill row type nets
  // correctly for free instead of silently reintroducing this exact bug.
  const settleTotalOwedLbp = useMemo(
    () =>
      selectedUnsettled
        .filter((t) => t.currency === "LBP")
        .reduce((s, t) => s + t.supplier_owed, 0),
    [selectedUnsettled],
  );
  // Legacy display only — the shop's cut is already embedded in
  // settleTotalOwedUsd above for a legacy batch, so this never feeds the
  // net-pay math; it just shows the operator what was baked in.
  const settleCommissionUsd = useMemo(
    () =>
      selectedUnsettled
        .filter((t) => t.currency !== "LBP")
        .reduce((s, t) => s + t.commission, 0),
    [selectedUnsettled],
  );
  // NEW-MODEL entered commission (D8): LUMP = the two currency inputs
  // directly; RATE = rate × count, placed into whichever currency the
  // operator picked for the rate (bills are naturally LBP-rated — the
  // legacy 20,000 LBP/bill this replaces — OMT/WHISH transfers USD-rated).
  const settleEnteredCommissionUsd = useMemo(() => {
    if (settleEntryMode === "RATE") {
      if (settleRateCurrency !== "USD") return 0;
      return (
        (parseFloat(settleRateInput.replace(/,/g, "")) || 0) *
        (parseInt(settleUnitCountInput.replace(/,/g, ""), 10) || 0)
      );
    }
    return parseFloat(settleCommissionUsdInput.replace(/,/g, "")) || 0;
  }, [
    settleEntryMode,
    settleRateCurrency,
    settleRateInput,
    settleUnitCountInput,
    settleCommissionUsdInput,
  ]);
  const settleEnteredCommissionLbp = useMemo(() => {
    if (settleEntryMode === "RATE") {
      if (settleRateCurrency !== "LBP") return 0;
      return (
        (parseFloat(settleRateInput.replace(/,/g, "")) || 0) *
        (parseInt(settleUnitCountInput.replace(/,/g, ""), 10) || 0)
      );
    }
    return parseFloat(settleCommissionLbpInput.replace(/,/g, "")) || 0;
  }, [
    settleEntryMode,
    settleRateCurrency,
    settleRateInput,
    settleUnitCountInput,
    settleCommissionLbpInput,
  ]);
  // Fee-only supplier_owed already nets out the shop's commission for a
  // LEGACY batch — pay exactly that. For a NEW-MODEL batch the commission is
  // entered here, so net pay = gross owed − entered commission (clamped at
  // 0 — a bills-only batch has 0 gross owed and settles for $0 cash, only
  // the commission credit moves, per the plan's "bills settlement note").
  const settleNetPayUsd = isNewModelBatch
    ? Math.max(0, settleTotalOwedUsd - settleEnteredCommissionUsd)
    : Math.max(0, settleTotalOwedUsd);
  // LIRA-119 — LBP mirror of settleNetPayUsd. Legacy batches never carry an
  // LBP gross-owed figure (settleTotalOwedLbp is structurally 0 — see its
  // own comment), so this is 0 for a legacy batch by the same math, not a
  // separate special case.
  const settleNetPayLbp = isNewModelBatch
    ? Math.max(0, settleTotalOwedLbp - settleEnteredCommissionLbp)
    : 0;
  // LIRA-119 — which currency the settlement's cash figures ("Net payment"
  // line, MultiPaymentInput's "Total Amount", the payment sheet's default
  // leg currency) are shown/denominated in. USD whenever there is real USD
  // cash owed (settleNetPayUsd > 0) — genuine cash, never relabeled just
  // because the operator happened to enter the commission in LBP. Otherwise
  // — the batch's only money-bearing figure is an LBP-entered commission
  // (Katsh's RATE mode default, LIRA-112) — follow that currency, so a
  // bills-only batch shows "0 LBP" instead of a misleading "$0.00".
  //
  // IMPORTANT: this does NOT inflate the displayed net payment to the
  // entered commission amount (e.g. 20,000 LBP). For a bills-only batch the
  // commission never pays out through THIS figure at all — it books as a
  // real top-up into the provider's own drawer (BILL_COMMISSION_SETTLEMENT_
  // PLAN.md, LIRA-137), which the modal shows via `settleEnteredCommission*`
  // below, framed as money arriving IN, never as a payment leg to enter
  // here. Showing the commission amount on THIS "net payment" figure would
  // invite the operator to add a matching CASH leg, which would double-count
  // that same commission as a real cash outflow. "0 LBP"/"$0.00" is the
  // correct, currency-honest figure for what this settlement actually PAYS
  // OUT in cash — see settleEnteredCommissionAmount for what it takes IN.
  const settleNetPayCurrency: "USD" | "LBP" =
    isNewModelBatch && settleNetPayUsd === 0 && settleEnteredCommissionLbp > 0
      ? "LBP"
      : "USD";
  const settleNetPayAmount =
    settleNetPayCurrency === "LBP" ? settleNetPayLbp : settleNetPayUsd;
  // BILL_COMMISSION_SETTLEMENT_PLAN.md — the RAW entered commission (never
  // netted against owed, unlike settleNetPay* above), for the bills-only
  // "{supplier} owes you" display. Same single-currency tie-break convention
  // as settleNetPayCurrency (LBP only when USD is exactly 0 and LBP > 0).
  const settleEnteredCommissionCurrency: "USD" | "LBP" =
    settleEnteredCommissionUsd === 0 && settleEnteredCommissionLbp > 0
      ? "LBP"
      : "USD";
  const settleEnteredCommissionAmount =
    settleEnteredCommissionCurrency === "LBP"
      ? settleEnteredCommissionLbp
      : settleEnteredCommissionUsd;
  // LIRA-137 Q2 — the SAME two-sided guard settleTransactions enforces
  // server-side (rule 14: one definition of "does this batch's cash math
  // make sense"), mirrored here so Confirm never even reaches the backend
  // with an impossible payload. A bills-only batch in the default "Top-up"
  // mode renders NO MultiPaymentInput at all (below), so settleHasActiveLegs
  // is structurally always false for it — this also covers a legacy/OMT
  // batch where the operator forces a stray leg with nothing owed, or leaves
  // real cash owed with no leg at all (both previously reached "Settlement
  // failed" only AFTER a submit attempt).
  const settleHasActiveLegs = settlePaymentLines.some((p) => p.amount > 0);
  const settleOwesCash =
    Math.abs(settleNetPayUsd) > 0.005 || Math.abs(settleNetPayLbp) > 0.005;
  // Owner follow-up (2026-08-13) — "Other payment" mode's legs are NOT a
  // net-pay tender (settleOwesCash is always false for a bills-only batch);
  // they collect the entered COMMISSION instead. Same two-sided shape as
  // settleOwesCash above, keyed off the commission rather than the (always
  // 0, for bills) net pay owed.
  const settleCommissionOwed =
    Math.abs(settleEnteredCommissionUsd) > 0.005 ||
    Math.abs(settleEnteredCommissionLbp) > 0.005;
  const settleConfirmDisabled = isBillsOnlyBatch
    ? settleCommissionCollectionMode === "OTHER_PAYMENT"
      ? settleCommissionOwed
        ? !settleHasActiveLegs
        : settleHasActiveLegs
      : settleHasActiveLegs // Top-up: no MultiPaymentInput renders, structurally always false
    : settleOwesCash
      ? !settleHasActiveLegs
      : settleHasActiveLegs;
  // LIRA-119 — same USD-hardcoding bug, second location: the "Owed … − Net
  // you pay" strip UNDER the row list (shown before the operator has even
  // opened the confirm modal, so no entered-commission signal exists yet —
  // this uses the SELECTION's own currency instead). All-LBP selection (a
  // Katsh bill batch) + nothing owed in USD ⇒ show the (also-0)
  // settleTotalOwedLbp/settleNetPayLbp figures as LBP rather than "$0.00".
  const preSettleCurrency: "USD" | "LBP" =
    isNewModelBatch &&
    settleTotalOwedUsd === 0 &&
    selectedUnsettled.some((t) => t.currency === "LBP")
      ? "LBP"
      : "USD";
  const preSettleOwed =
    preSettleCurrency === "LBP" ? settleTotalOwedLbp : settleTotalOwedUsd;
  const preSettleNetPay =
    preSettleCurrency === "LBP" ? settleNetPayLbp : settleNetPayUsd;
  const selectableUnsettled = useMemo(
    () =>
      unsettledTxns.filter(
        (t) => t.currency !== "LBP" || t.service_type === "BILL",
      ),
    [unsettledTxns],
  );

  const handleOpenSettleConfirm = () => {
    setSettlePaymentLines([]);
    setSettleNote("");
    setSettleKey((k) => k + 1);
    // D8 — pre-select the entry mode/rate from the supplier's preference;
    // prefill RATE's unit count from the selection itself (the real count
    // being settled, more precise than the per-provider summary total).
    setSettleEntryMode(selectedSupplier?.commission_entry_mode ?? "LUMP");
    setSettleRateInput(
      selectedSupplier?.commission_rate != null
        ? String(selectedSupplier.commission_rate)
        : "",
    );
    // LIRA-112 — the rate's currency is the supplier's OWN stored config
    // (`commission_rate_currency`, v151: Katsh -> LBP, everyone else ->
    // USD), never silently assumed. Falls back to the pre-v151 heuristic
    // (LBP for a bill-containing batch, USD otherwise) only when a
    // supplier's row predates that column (undefined, not a real "USD").
    setSettleRateCurrency(
      selectedSupplier?.commission_rate_currency ??
        (selectedUnsettled.some((t) => t.service_type === "BILL")
          ? "LBP"
          : "USD"),
    );
    setSettleUnitCountInput(String(selectedSettleIds.size));
    setSettleCommissionUsdInput("");
    setSettleCommissionLbpInput("");
    // Owner follow-up (2026-08-13) — always reopen in the default "Top-up"
    // mode, same reset-on-open convention as settleEntryMode above.
    setSettleCommissionCollectionMode("TOP_UP");
    setShowSettleConfirm(true);
  };

  const handleBatchSettle = async () => {
    if (!selectedSupplierId || selectedSettleIds.size === 0) return;
    if (isMixedModelBatch) return;
    const activeLines = settlePaymentLines.filter((p) => p.amount > 0);
    setSettleSubmitting(true);
    try {
      const trimmedNote = settleNote.trim();
      // No drawer_name: OMT_System/Whish_System is the provider FLOAT, never
      // a real cash drawer — settlement pays the net amount EXCLUSIVELY
      // through the payment-method legs the admin picks below (activeLines),
      // matching recordSupplierCashflow's own contract. A $0/0 LBP net (both
      // settleNetPayUsd and settleNetPayLbp === 0) needs no legs at all.
      //
      // NEW-MODEL batch (D8): commission_usd/commission_lbp become the
      // MONEY-BEARING entered figures (settleEnteredCommission*), plus the
      // entry_mode/rate/count audit snapshot the operator actually used.
      // LEGACY batch: byte-for-byte the pre-existing payload — informational
      // commission_usd only, no D8 fields at all.
      //
      // LIRA-119 — amount_lbp was hardcoded 0 here regardless of
      // settleNetPayLbp (itself always 0 today, see its own comment) —
      // sending the real computed value instead so a future LBP-eligible
      // non-bill row nets correctly without silently reintroducing this bug.
      const result = await settleTransactions.mutateAsync({
        supplier_id: selectedSupplierId,
        financial_service_ids: [...selectedSettleIds],
        amount_usd: settleNetPayUsd,
        amount_lbp: settleNetPayLbp,
        ...(isNewModelBatch
          ? {
              commission_usd: settleEnteredCommissionUsd,
              commission_lbp: settleEnteredCommissionLbp,
              entry_mode: settleEntryMode,
              ...(settleEntryMode === "RATE"
                ? {
                    commission_rate:
                      parseFloat(settleRateInput.replace(/,/g, "")) || 0,
                    commission_unit_count:
                      parseInt(settleUnitCountInput.replace(/,/g, ""), 10) || 0,
                  }
                : {}),
              // Owner follow-up (2026-08-13) — only meaningful for a
              // bills-only batch (the ONLY shape with a collection-mode
              // toggle at all); the backend ignores it otherwise.
              ...(isBillsOnlyBatch
                ? { commission_collection_mode: settleCommissionCollectionMode }
                : {}),
            }
          : {
              commission_usd: settleCommissionUsd,
              commission_lbp: 0,
            }),
        ...(trimmedNote
          ? { note: trimmedNote }
          : { note: `Settlement: ${selectedSettleIds.size} txns` }),
        ...(activeLines.length > 0
          ? {
              payments: activeLines.map((p) => ({
                method: p.method,
                currency_code: p.currencyCode,
                amount: p.amount,
              })),
            }
          : {}),
      });
      if (!(result as { success: boolean }).success) {
        alert((result as { error?: string }).error || "Settlement failed");
        return;
      }
      appEvents.emit(
        "notification:show",
        `Settled ${selectedSettleIds.size} transaction${selectedSettleIds.size !== 1 ? "s" : ""} — ${
          isBillsOnlyBatch
            ? `${selectedSupplier?.name ?? "supplier"} credited ${formatMoney(settleEnteredCommissionAmount, settleEnteredCommissionCurrency)}`
            : `net ${formatMoney(settleNetPayAmount, settleNetPayCurrency)}`
        }`,
        "success",
      );
      setShowSettleConfirm(false);
      setSelectedSettleIds(new Set());
      setSettlePaymentLines([]);
      setSettleNote("");
    } catch {
      alert("Settlement failed");
    } finally {
      setSettleSubmitting(false);
    }
  };

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-auto animate-in fade-in duration-500">
      <PageHeader
        icon={Truck}
        title="Suppliers"
        subtitle="Track amounts owed to suppliers. System debts are auto-recorded from transactions."
      />

      {/* Balance overview — was a bare `< 0 ? green : red` bypassing this
          page's own signBucket/BALANCE_EPS (latent bug #1, audit): exactly
          $0.00/0 LBP rendered alarm-red even when every supplier is settled.
          Now routed through the shared helper: epsilon'd (neutral at ~0)
          and owner's-rule polarity (positive = we owe = green). */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
          <div className="text-xs text-slate-400 mb-1">Total Owed (USD)</div>
          <div
            className={`text-2xl font-bold font-mono ${balanceTextColor(totalOwed.usd, BALANCE_EPS)}`}
          >
            ${totalOwed.usd.toFixed(2)}
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
          <div className="text-xs text-slate-400 mb-1">Total Owed (LBP)</div>
          <div
            className={`text-2xl font-bold font-mono ${balanceTextColor(totalOwed.lbp, BALANCE_EPS)}`}
          >
            {totalOwed.lbp.toLocaleString()} LBP
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left: Supplier list */}
        <div className="col-span-4 bg-slate-800 rounded-xl border border-slate-700/50 p-4 overflow-auto">
          <div className="flex gap-1 border-b border-slate-700/50 pb-2 mb-3">
            {(
              [
                { id: "companies" as const, label: "Companies" },
                { id: "products" as const, label: "Products" },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setViewCategory(cat.id);
                  setSelectedSupplierId(null);
                  setActiveTab(cat.id === "products" ? "items" : "settle");
                }}
                className={`px-4 py-1.5 text-xs font-semibold rounded-t transition-colors ${
                  viewCategory === cat.id
                    ? "text-white border-b-2 border-orange-500"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            {sortedSuppliers.map((s) => {
              const b = activeBalanceMap.get(s.id);
              const active = s.id === selectedSupplierId;
              const drawer = s.provider
                ? PROVIDER_DRAWER[s.provider]
                : undefined;
              return (
                <button
                  key={s.id}
                  data-testid={`supplier-tile-${s.provider ?? s.id}`}
                  onClick={() => {
                    setSelectedSupplierId(s.id);
                    setActiveTab(
                      viewCategory === "products" ? "items" : "settle",
                    );
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    active ? "bg-slate-700" : "hover:bg-slate-700/50"
                  } ${s.is_active === 0 ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{s.name}</span>
                      {s.is_active === 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/50 text-amber-300">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {drawer && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {drawerDisplayLabel(drawer)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs font-mono">
                    <span className={balanceColor(Number(b?.total_usd || 0))}>
                      ${Number(b?.total_usd || 0).toFixed(2)}
                    </span>
                    <span className="text-slate-600"> | </span>
                    <span className={balanceColor(Number(b?.total_lbp || 0))}>
                      {Number(b?.total_lbp || 0).toLocaleString()} LBP
                    </span>
                  </div>
                </button>
              );
            })}
            {sortedSuppliers.length === 0 && (
              <div className="text-slate-500 text-sm p-3">
                No suppliers found.
              </div>
            )}
          </div>
        </div>

        {/* Right: Tabbed panel */}
        <div className="col-span-8 bg-slate-800 rounded-xl border border-slate-700/50 p-4 overflow-auto">
          {!selectedSupplier ? (
            <div className="text-slate-400 text-sm">
              Select a supplier to view ledger.
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-white font-bold text-lg">
                    {selectedSupplier.name}
                  </div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">
                    {(() => {
                      const bal = activeBalanceMap.get(selectedSupplierId!);
                      const usd = Number(bal?.total_usd ?? 0);
                      const lbp = Number(bal?.total_lbp ?? 0);
                      const usdInfo = describeBalance(usd, "USD");
                      const lbpInfo = describeBalance(lbp, "LBP");
                      const settled =
                        Math.abs(usd) <= BALANCE_EPS &&
                        Math.abs(lbp) <= BALANCE_EPS;
                      return (
                        <>
                          Balance:{" "}
                          {settled ? (
                            <span className="font-semibold text-slate-400">
                              Settled
                            </span>
                          ) : (
                            <>
                              {Math.abs(usd) > BALANCE_EPS && (
                                <span
                                  className={`font-semibold ${usdInfo.cls}`}
                                >
                                  {usdInfo.text}
                                </span>
                              )}
                              {Math.abs(usd) > BALANCE_EPS &&
                                Math.abs(lbp) > BALANCE_EPS && (
                                  <span className="text-slate-600"> · </span>
                                )}
                              {Math.abs(lbp) > BALANCE_EPS && (
                                <span
                                  className={`font-semibold ${lbpInfo.cls}`}
                                >
                                  {lbpInfo.text}
                                </span>
                              )}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* LIRA-080: Add Credit / Debt — a manual supplier_ledger
                      correction with a "Cash moved" toggle (default ON).
                      Admin-only: it reuses the addLedgerEntry / cashflow
                      plumbing, both of which are requireRole(["admin"]) on IPC
                      AND REST — a staff user would only hit an auth rejection.
                      Active company suppliers only. */}
                  {isAdmin &&
                    selectedSupplier.is_active !== 0 &&
                    !isProductSupplier && (
                      <button
                        onClick={() => {
                          resetAdjustForm();
                          setShowAdjustModal(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
                        title="Manually record a credit or debt against this supplier"
                      >
                        <Plus className="w-4 h-4" />
                        Add Credit / Debt
                      </button>
                    )}
                  {/* CQ-10 (D4): standalone write-off — admin-only, only when
                      we owe the supplier something left to forgive. */}
                  {isAdmin && canWriteOffSupplier && (
                    <button
                      onClick={() => {
                        setWriteOffAmountUsd("");
                        setWriteOffAmountLbp("");
                        setWriteOffReason("");
                        setShowWriteOffModal(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm"
                      title="Supplier forgives part of what we owe them"
                    >
                      <Eraser className="w-4 h-4" />
                      Write off
                    </button>
                  )}
                  <button
                    onClick={() => {
                      suppliersQuery.refetch();
                      balancesQuery.refetch();
                      productBalancesQuery.refetch();
                      ledgerQuery.refetch();
                      if (!isProductSupplier) allTxnsQuery.refetch();
                      if (isProductSupplier) productItemsQuery.refetch();
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {/* Tabs */}
              {selectedSupplier.is_active !== 0 && (
                <div className="flex gap-1 mb-4 border-b border-slate-700">
                  {(isProductSupplier
                    ? [
                        { id: "items" as const, label: "Purchases" },
                        { id: "manual" as const, label: "Pay / Receive" },
                      ]
                    : [
                        {
                          id: "settle" as const,
                          label: `Transactions${allTxns.length > 0 ? ` (${allTxns.length})` : ""}`,
                        },
                        { id: "manual" as const, label: "Pay / Receive" },
                      ]
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                        activeTab === tab.id
                          ? "bg-slate-700 text-white border-b-2 border-blue-500"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Tab: Purchases — product items with FIFO payment coverage */}
              {selectedSupplier.is_active !== 0 && activeTab === "items" && (
                <div>
                  {productItemsQuery.isLoading ? (
                    <div className="text-slate-400 text-sm py-6 text-center">
                      Loading items…
                    </div>
                  ) : itemsWithCoverage.length === 0 ? (
                    <div className="text-slate-500 text-sm py-6 text-center">
                      No inventory items found for {selectedSupplier.name}.
                    </div>
                  ) : (
                    <div className="border border-slate-700 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-12 bg-slate-900/60 text-slate-300 text-xs font-semibold px-4 py-2">
                        <div className="col-span-3">Product</div>
                        <div className="col-span-1 text-right">Qty</div>
                        <div className="col-span-2 text-right">Cost</div>
                        <div className="col-span-1 text-right">Total</div>
                        <div className="col-span-1 text-right">Paid</div>
                        <div className="col-span-2 text-right">Status</div>
                        <div className="col-span-2 text-right">Date</div>
                      </div>
                      <div className="max-h-[45vh] overflow-y-auto divide-y divide-slate-700">
                        {itemsWithCoverage.map((item) => (
                          <div
                            key={item.product_id}
                            className="grid grid-cols-12 px-4 py-2.5 text-sm items-center hover:bg-slate-700/30"
                          >
                            <div className="col-span-3 text-white font-medium truncate">
                              {item.name}
                            </div>
                            <div className="col-span-1 text-right font-mono text-slate-300">
                              {item.quantity}
                            </div>
                            <div className="col-span-2 text-right font-mono text-slate-300">
                              ${item.cost.toFixed(2)}
                            </div>
                            <div className="col-span-1 text-right font-mono text-orange-300 font-semibold">
                              ${item.total.toFixed(2)}
                            </div>
                            <div className="col-span-1 text-right font-mono text-slate-300 text-xs">
                              ${item.paid.toFixed(2)}
                            </div>
                            <div className="col-span-2 text-right">
                              {item.status === "PAID" && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                                  Paid
                                </span>
                              )}
                              {item.status === "PARTIAL" && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                                  Partial
                                </span>
                              )}
                              {item.status === "UNPAID" && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-400 border border-slate-600">
                                  Unpaid
                                </span>
                              )}
                            </div>
                            <div className="col-span-2 text-right text-xs text-slate-400">
                              {item.created_at
                                ? parseDbDate(item.created_at).toLocaleString()
                                : "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between px-4 py-2.5 bg-slate-900/40 border-t border-slate-700 text-xs text-slate-400">
                        <span>
                          {
                            itemsWithCoverage.filter((i) => i.status === "PAID")
                              .length
                          }{" "}
                          paid ·{" "}
                          {
                            itemsWithCoverage.filter(
                              (i) => i.status === "PARTIAL",
                            ).length
                          }{" "}
                          partial ·{" "}
                          {
                            itemsWithCoverage.filter(
                              (i) => i.status === "UNPAID",
                            ).length
                          }{" "}
                          unpaid
                        </span>
                        <span className="font-mono font-bold text-white">
                          Outstanding: $
                          {itemsWithCoverage
                            .reduce((s, i) => s + (i.total - i.paid), 0)
                            .toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Transactions — batch settlement (D5, admin-only) above
                  the read-only full history below. */}
              {selectedSupplier.is_active !== 0 &&
                activeTab === "settle" &&
                isAdmin && (
                  <div className="mb-4">
                    {/* Owner request (2026-08-13): this table settles
                        commission for whichever supplier is selected — not
                        just Katsh — so the section heading is generic, and
                        renders identically for every supplier that reaches
                        this tab. */}
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
                      Commission Settlement
                    </h3>
                    <div className="border border-slate-700 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/60">
                        <label className="flex items-center gap-2 text-slate-300 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={
                              selectableUnsettled.length > 0 &&
                              selectedSettleIds.size ===
                                selectableUnsettled.length
                            }
                            onChange={(e) =>
                              setSelectedSettleIds(
                                e.target.checked
                                  ? new Set(
                                      selectableUnsettled.map((t) => t.id),
                                    )
                                  : new Set(),
                              )
                            }
                            className="w-4 h-4 rounded border-slate-600 bg-slate-900"
                          />
                          Select all ({selectableUnsettled.length})
                        </label>
                        <button
                          onClick={handleOpenSettleConfirm}
                          disabled={
                            selectedSettleIds.size === 0 || isMixedModelBatch
                          }
                          title={
                            isMixedModelBatch
                              ? "Selection mixes legacy and new-model commission transactions — settle them in separate batches"
                              : undefined
                          }
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium"
                        >
                          Settle
                          {selectedSettleIds.size > 0
                            ? ` (${selectedSettleIds.size})`
                            : ""}
                        </button>
                      </div>
                      {/* D4 — mixed-model selection explanation. The backend
                        hard-rejects this batch (_resolveSettlementBatchModel)
                        because entering one commission figure across rows
                        whose payable was computed two different ways
                        (embedded vs at-settlement) would double-net the
                        legacy rows' already-embedded cut. */}
                      {isMixedModelBatch && (
                        <div className="px-3 py-2 bg-amber-900/30 border-t border-amber-700/40 text-xs text-amber-300">
                          This selection mixes legacy and new-model commission
                          transactions — they can&apos;t be settled in one
                          batch. Deselect one group and settle it separately.
                        </div>
                      )}
                      {unsettledQuery.isLoading ? (
                        <div className="text-slate-400 text-xs py-4 text-center">
                          Loading pending transactions…
                        </div>
                      ) : selectableUnsettled.length === 0 ? (
                        <div className="text-slate-500 text-xs py-4 text-center">
                          No pending transactions to settle for{" "}
                          {selectedSupplier.name}
                        </div>
                      ) : (
                        <>
                          {/* Owner request (2026-08-13): column headers,
                            matching each row's own cell order/widths so they
                            line up — checkbox spacer, Type (flex-1), Amount
                            (font-mono, no fixed width — mirrors the row
                            cell), Commission (w-20 text-right), Date (w-36
                            text-right). Renders for every supplier that
                            reaches this tab, not just Katsh. */}
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/40 border-t border-slate-700 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            <span className="w-4 shrink-0" aria-hidden="true" />
                            <span className="flex-1">Type</span>
                            <span className="font-mono text-right">Amount</span>
                            <span className="w-20 text-right">Commission</span>
                            <span className="w-36 text-right">Date</span>
                          </div>
                          <div className="max-h-[30vh] overflow-y-auto divide-y divide-slate-700">
                            {selectableUnsettled.map((t) => (
                              <label
                                key={t.id}
                                className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-700/30 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedSettleIds.has(t.id)}
                                  onChange={(e) => {
                                    const next = new Set(selectedSettleIds);
                                    if (e.target.checked) next.add(t.id);
                                    else next.delete(t.id);
                                    setSelectedSettleIds(next);
                                  }}
                                  className="w-4 h-4 rounded border-slate-600 bg-slate-900 shrink-0"
                                />
                                <span className="flex-1 text-slate-300">
                                  {t.service_type === "BILL"
                                    ? "Bill"
                                    : t.omt_service_type || t.service_type}
                                </span>
                                <span className="font-mono text-white">
                                  {t.currency === "LBP"
                                    ? `${Math.round(Math.abs(t.amount)).toLocaleString()} LBP`
                                    : `$${Math.abs(t.amount).toFixed(2)}`}
                                </span>
                                <span className="font-mono text-emerald-400 w-20 text-right">
                                  {t.service_type === "BILL" ? (
                                    // Commission is entered AT settlement (D8) —
                                    // no per-row commission to show for a bill.
                                    <span className="text-slate-600">—</span>
                                  ) : t.commission > 0 ? (
                                    `+$${t.commission.toFixed(4)}`
                                  ) : (
                                    "—"
                                  )}
                                </span>
                                <span className="text-slate-500 w-36 text-right">
                                  {parseDbDate(t.created_at).toLocaleString()}
                                </span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                      {selectedSettleIds.size > 0 && !isMixedModelBatch && (
                        <div className="flex items-center justify-between px-3 py-2 bg-slate-900/40 border-t border-slate-700 text-xs text-slate-400">
                          {isBillsOnlyBatch ? (
                            // BILL_COMMISSION_SETTLEMENT_PLAN.md (LIRA-137) —
                            // a bills-only batch has NOTHING for the shop to
                            // pay; the commission (set in Settle) arrives IN
                            // as a top-up to the provider's own balance. The
                            // old "Owed X − commission / Net you pay: 0" strip
                            // implied a payment that never happens — say what
                            // is true instead.
                            <span className="text-emerald-400">
                              {selectedSupplier.name} owes you a settlement
                              commission — set the rate/count in Settle
                            </span>
                          ) : (
                            <>
                              <span>
                                {isNewModelBatch ? (
                                  <>
                                    Owed{" "}
                                    {formatMoney(
                                      preSettleOwed,
                                      preSettleCurrency,
                                    )}{" "}
                                    − commission (entered below)
                                  </>
                                ) : (
                                  <>
                                    Owed ${settleTotalOwedUsd.toFixed(2)} −
                                    commission ${settleCommissionUsd.toFixed(4)}
                                  </>
                                )}
                              </span>
                              <span className="font-mono font-bold text-white">
                                Net you pay:{" "}
                                {formatMoney(
                                  preSettleNetPay,
                                  preSettleCurrency,
                                )}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {/* Tab: Transactions (full history, read-only) */}
              {selectedSupplier.is_active !== 0 && activeTab === "settle" && (
                <div className="space-y-3">
                  {allTxnsQuery.isLoading ? (
                    <div className="text-slate-400 text-sm py-6 text-center">
                      Loading transactions…
                    </div>
                  ) : allTxns.length === 0 ? (
                    <div className="text-slate-500 text-sm py-6 text-center">
                      No transactions found for {selectedSupplier.name}
                    </div>
                  ) : (
                    <div className="border border-slate-700 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-12 gap-2 bg-slate-900/60 text-slate-300 text-xs font-semibold px-3 py-2">
                        <div
                          className={hasOmtFee ? "col-span-2" : "col-span-3"}
                        >
                          Type
                        </div>
                        <div
                          className={`${hasOmtFee ? "col-span-2" : "col-span-3"} text-right`}
                        >
                          Amount
                        </div>
                        {hasOmtFee && (
                          <div className="col-span-2 text-right">OMT Fee</div>
                        )}
                        <div className="col-span-2 text-right">Commission</div>
                        <div className="col-span-2 text-right">Status</div>
                        <div className="col-span-2">Date</div>
                      </div>
                      <div className="max-h-[40vh] overflow-y-auto">
                        {allTxns.map((t) => (
                          <div
                            key={t.id}
                            className="grid grid-cols-12 gap-2 px-3 py-2.5 text-sm border-t border-slate-700 items-center hover:bg-slate-700/30"
                          >
                            <div
                              className={`${hasOmtFee ? "col-span-2" : "col-span-3"} text-xs text-slate-300`}
                            >
                              {t.omt_service_type || t.service_type}
                            </div>
                            <div
                              className={`${hasOmtFee ? "col-span-2" : "col-span-3"} text-right font-mono text-white`}
                            >
                              {t.currency === "LBP"
                                ? `${Math.round(Math.abs(t.amount)).toLocaleString()} LBP`
                                : `$${Math.abs(t.amount).toFixed(2)}`}
                            </div>
                            {hasOmtFee && (
                              <div className="col-span-2 text-right font-mono text-amber-400">
                                {t.omt_fee ? `$${t.omt_fee.toFixed(2)}` : "—"}
                              </div>
                            )}
                            <div className="col-span-2 text-right font-mono text-emerald-400">
                              {t.commission > 0 ? (
                                t.currency === "LBP" ? (
                                  `${Math.round(t.commission).toLocaleString()} LBP`
                                ) : (
                                  `$${t.commission.toFixed(4)}`
                                )
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </div>
                            <div className="col-span-2 text-right">
                              {t.supplier_owed === 0 &&
                              t.settlement_id == null ? (
                                // Wallet-provider transfer (prepaid balance):
                                // nothing is owed to the supplier, so a
                                // paid/unpaid status is meaningless here.
                                <span className="text-slate-600">—</span>
                              ) : t.settlement_id != null ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-900/50 text-blue-300">
                                  Settled
                                </span>
                              ) : t.fifo_status === "paid" ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/50 text-green-300">
                                  Paid
                                </span>
                              ) : t.fifo_status === "partial" ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/50 text-amber-300">
                                  Partial
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-900/50 text-red-400">
                                  Unpaid
                                </span>
                              )}
                            </div>
                            <div className="col-span-2 text-xs text-slate-400">
                              {parseDbDate(t.created_at).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between px-4 py-2.5 bg-slate-900/40 border-t border-slate-700 text-xs text-slate-400">
                        <span>
                          {/* Rows that owe nothing (wallet-provider transfers)
                              carry no payment status — exclude them from the
                              counts, matching the "—" status cell above. */}
                          {
                            allTxns.filter(
                              (t) =>
                                t.supplier_owed > 0 && t.fifo_status === "paid",
                            ).length
                          }{" "}
                          paid ·{" "}
                          {
                            allTxns.filter(
                              (t) =>
                                t.supplier_owed > 0 &&
                                t.fifo_status === "partial",
                            ).length
                          }{" "}
                          partial ·{" "}
                          {
                            allTxns.filter(
                              (t) =>
                                t.supplier_owed > 0 &&
                                t.fifo_status === "unpaid",
                            ).length
                          }{" "}
                          unpaid
                        </span>
                        <span className="font-mono font-bold text-white">
                          {(() => {
                            // supplier_owed is the repository's single
                            // owed-per-row definition — wallet-provider
                            // transfers contribute 0 (nothing is owed for
                            // consuming the shop's own prepaid balance).
                            const outstandingUsd = allTxns
                              .filter((t) => t.currency !== "LBP")
                              .reduce(
                                (s, t) =>
                                  s +
                                  Math.max(
                                    0,
                                    t.supplier_owed - t.fifo_paid_usd,
                                  ),
                                0,
                              );
                            return outstandingUsd > 0
                              ? `Outstanding: $${outstandingUsd.toFixed(2)}`
                              : "Fully covered";
                          })()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Pay / Receive — CQ-11: shared CounterpartySettleModal,
                  inline variant (no backdrop/title — embedded in the tab). */}
              {selectedSupplier.is_active !== 0 && activeTab === "manual" && (
                <CounterpartySettleModal
                  variant="inline"
                  beforeContent={
                    <div className="flex gap-2">
                      {(["PAY", "RECEIVE"] as const).map((dir) => (
                        <button
                          key={dir}
                          onClick={() => setCashflowDirection(dir)}
                          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                            cashflowDirection === dir
                              ? dir === "PAY"
                                ? "bg-red-600 text-white"
                                : "bg-green-600 text-white"
                              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                          }`}
                        >
                          {dir === "PAY" ? "Pay Supplier" : "Supplier Paid Us"}
                        </button>
                      ))}
                    </div>
                  }
                  multiPaymentInputKey={`${cashflowKey}-${cashflowDirection}`}
                  multiPaymentInput={{
                    totals: [
                      { amount: Math.abs(payAmount), currency: payCurrency },
                    ],
                    totalAmountCurrency: payCurrency,
                    currency: payCurrency,
                    onChange: setCashflowLines,
                    showPmFee: false,
                    // CQ-10: discount is PAY-only (the supplier forgiving part
                    // of what we owe them) — the backend rejects it on
                    // RECEIVE. The single-currency totals here (payCurrency)
                    // mean the built-in scalar discount maps 1:1, no custom
                    // row needed (unlike Debts' mixed USD+LBP due).
                    showDiscount: cashflowDirection === "PAY",
                    maxDiscount: Math.abs(payAmount),
                    onDiscountChange: setCashflowDiscount,
                    paymentMethods: methods,
                    currencies: [
                      { code: "USD", symbol: "$" },
                      { code: "LBP", symbol: "LBP" },
                    ],
                    exchangeRate: exchangeRate,
                  }}
                  onConfirm={handleCashflow}
                  confirmLabel={
                    cashflowDirection === "PAY"
                      ? "Record Payment"
                      : "Record Receipt"
                  }
                  confirmColor={cashflowDirection === "PAY" ? "red" : "green"}
                  isSubmitting={supplierCashflow.isPending}
                >
                  {cashflowDirection === "PAY" && cashflowDiscount > 0 && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Discount reason (optional)
                      </label>
                      <input
                        value={cashflowDiscountReason}
                        onChange={(e) =>
                          setCashflowDiscountReason(e.target.value)
                        }
                        className="w-full bg-slate-950 border border-emerald-700/40 rounded-lg px-3 py-2 text-white text-sm"
                        placeholder="Why the supplier is forgiving this amount…"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Note (optional)
                    </label>
                    <input
                      value={cashflowNote}
                      onChange={(e) => setCashflowNote(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                      placeholder={
                        cashflowDirection === "PAY"
                          ? "Payment to supplier…"
                          : "Amount received from supplier…"
                      }
                    />
                  </div>
                </CounterpartySettleModal>
              )}

              {/* Ledger history */}
              <div className="mt-6">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
                  Payments
                </h3>
                <div className="border border-slate-700 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12 gap-2 bg-slate-900/60 text-slate-400 text-xs font-semibold px-3 py-2">
                    <div className="col-span-2">Type</div>
                    <div className="col-span-2 text-right">USD</div>
                    <div className="col-span-2 text-right">LBP</div>
                    <div className="col-span-4">Note</div>
                    <div className="col-span-2">Date</div>
                  </div>
                  <div className="max-h-[30vh] overflow-y-auto">
                    {ledger.map((row) => (
                      <div
                        key={row.id}
                        className={`grid grid-cols-12 gap-2 px-3 py-2 text-sm border-t border-slate-700 items-center ${row.is_refunded ? "opacity-60" : ""}`}
                      >
                        <div className="col-span-2 flex items-center gap-1">
                          <EntryTypeBadge
                            type={row.entry_type}
                            direction={ledgerRowDirection(
                              row.amount_usd,
                              row.amount_lbp,
                            )}
                          />
                          {!!row.is_refunded && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-slate-600/50 text-slate-300 font-semibold">
                              VOIDED
                            </span>
                          )}
                        </div>
                        <div
                          className={`col-span-2 text-right font-mono ${row.is_refunded ? "line-through text-slate-500" : balanceColor(row.amount_usd)}`}
                        >
                          {row.amount_usd !== 0
                            ? `${row.amount_usd > 0 ? "+" : ""}${row.amount_usd.toFixed(2)}`
                            : "—"}
                        </div>
                        <div
                          className={`col-span-2 text-right font-mono ${row.is_refunded ? "line-through text-slate-500" : balanceColor(row.amount_lbp)}`}
                        >
                          {row.amount_lbp !== 0
                            ? `${row.amount_lbp > 0 ? "+" : ""}${row.amount_lbp.toLocaleString()}`
                            : "—"}
                        </div>
                        <div className="col-span-4 text-slate-300 truncate text-xs">
                          {row.note || ""}
                        </div>
                        <div className="col-span-2 text-slate-400 text-xs">
                          {parseDbDate(row.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                    {ledger.length === 0 && (
                      <div className="text-slate-500 text-sm p-3">
                        No payment entries yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* LIRA-080: "Add Credit / Debt" modal — a manual supplier_ledger
          correction. CREDIT = shop owes the supplier more (ledger +); DEBIT =
          reduces what we owe / they owe us (ledger −). "Cash moved" default ON
          routes through the Pay/Receive plumbing; OFF posts a paper
          SUPPLIER_ADJUSTMENT (no drawer/payments). */}
      {showAdjustModal && selectedSupplier && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowAdjustModal(false);
          }}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            role="presentation"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-white mb-1">
              Add Credit / Debt
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Manual ledger correction for {selectedSupplier.name}.
            </p>
            <div className="space-y-4">
              {/* Direction */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                  Direction
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAdjustDirection("CREDIT")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors border ${
                      adjustDirection === "CREDIT"
                        ? "bg-red-900/40 border-red-600 text-red-300"
                        : "bg-slate-800 border-slate-600 text-slate-400 hover:text-white"
                    }`}
                  >
                    <ArrowDownLeft className="w-3.5 h-3.5" />
                    CREDIT (we owe them)
                  </button>
                  <button
                    onClick={() => setAdjustDirection("DEBIT")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors border ${
                      adjustDirection === "DEBIT"
                        ? "bg-emerald-900/40 border-emerald-600 text-emerald-300"
                        : "bg-slate-800 border-slate-600 text-slate-400 hover:text-white"
                    }`}
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    DEBIT (they owe us)
                  </button>
                </div>
              </div>

              {/* Amount + currency */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                    Amount
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={adjustAmount}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/,/g, "");
                      if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                        setAdjustAmount(raw);
                      }
                    }}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                    Currency
                  </label>
                  <div className="flex gap-1">
                    {(["USD", "LBP"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setAdjustCurrency(c)}
                        className={`px-3 py-2.5 rounded-lg text-sm font-medium border ${
                          adjustCurrency === c
                            ? "bg-indigo-900/40 border-indigo-600 text-indigo-200"
                            : "bg-slate-800 border-slate-600 text-slate-400 hover:text-white"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                  Note
                </label>
                <input
                  type="text"
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="Optional note..."
                />
              </div>

              {/* Cash moved toggle — default ON */}
              <label
                className="flex items-start gap-2 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 cursor-pointer"
                data-testid="supplier-cash-moved-toggle"
              >
                <input
                  type="checkbox"
                  checked={adjustMoveCash}
                  onChange={(e) => setAdjustMoveCash(e.target.checked)}
                  className="mt-0.5 accent-indigo-500"
                />
                <span className="text-xs text-slate-300">
                  <span className="font-medium text-white">Cash moved</span> —
                  this entry moves the drawer:{" "}
                  {adjustDirection === "CREDIT"
                    ? "cash IN from the supplier"
                    : "cash OUT to the supplier"}
                  . Untick for a paper-only ledger correction (no drawer
                  change).
                </span>
              </label>

              <div className="pt-2 flex gap-3">
                <button
                  onClick={() => setShowAdjustModal(false)}
                  className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={
                    adjustSubmitting ||
                    !(parseFloat(adjustAmount.replace(/,/g, "")) > 0)
                  }
                  onClick={handleSupplierAdjust}
                  className="flex-1 py-3 rounded-xl font-bold disabled:bg-slate-700 disabled:text-slate-500 text-white shadow-lg active:scale-95 transition-all bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/20"
                >
                  {adjustSubmitting ? "Processing..." : "Save entry"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CQ-10 (D4): standalone "Write off" modal — admin-only, pure
          forgiveness (the supplier forgives what we owe them), no cash
          movement. Capped client-side at the outstanding balance per
          currency; the backend re-validates. */}
      {showWriteOffModal && selectedSupplier && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowWriteOffModal(false);
          }}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            role="presentation"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-white mb-1">Write off</h3>
            <p className="text-xs text-slate-400 mb-4">
              {selectedSupplier.name} forgives part of what we owe them — no
              cash movement.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                  Amount (USD) — owed $
                  {Math.max(0, selectedBalanceUsd).toFixed(2)}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={writeOffAmountUsd}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, "");
                    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                      setWriteOffAmountUsd(raw);
                    }
                  }}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                  Amount (LBP) — owed{" "}
                  {Math.max(0, selectedBalanceLbp).toLocaleString()}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={writeOffAmountLbp}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, "");
                    if (raw === "" || /^\d+$/.test(raw)) {
                      setWriteOffAmountLbp(raw);
                    }
                  }}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                  Reason
                </label>
                <input
                  type="text"
                  value={writeOffReason}
                  onChange={(e) => setWriteOffReason(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500"
                  placeholder="Optional reason..."
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  onClick={() => setShowWriteOffModal(false)}
                  className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={
                    writeOffSubmitting ||
                    (!writeOffAmountUsd.trim() && !writeOffAmountLbp.trim())
                  }
                  onClick={handleSupplierWriteOff}
                  className="flex-1 py-3 rounded-xl font-bold disabled:bg-slate-700 disabled:text-slate-500 text-white shadow-lg active:scale-95 transition-all bg-orange-600 hover:bg-orange-500 shadow-orange-900/20"
                >
                  {writeOffSubmitting ? "Processing..." : "Write off"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* D5 — batch settlement confirm step (admin-only), built on the
          shared CounterpartySettleModal. No discount/reason field:
          supplierSettleSchema carries no discount — a batch settle is
          cash/commission only. */}
      {showSettleConfirm && selectedSupplier && isAdmin && (
        <CounterpartySettleModal
          title={`Settle ${selectedSettleIds.size} transaction${selectedSettleIds.size !== 1 ? "s" : ""} with ${selectedSupplier.name}`}
          panelClassName="max-w-md"
          onCancel={() => setShowSettleConfirm(false)}
          onConfirm={handleBatchSettle}
          confirmLabel="Confirm Settlement"
          confirmColor="blue"
          isSubmitting={settleSubmitting}
          confirmDisabled={settleConfirmDisabled}
          beforeContent={
            <div className="bg-slate-800 rounded-xl p-4 space-y-3 text-sm">
              {!isBillsOnlyBatch && (
                // BILL_COMMISSION_SETTLEMENT_PLAN.md — this figure is
                // structurally always $0.00 for a bills-only batch (a
                // bill's principal never reaches the ledger —
                // SUPPLIER_OWED_EXPR's BILL branch is hardcoded 0) AND was
                // hardcoded to a "$"-prefixed USD string regardless of the
                // batch's real currency — dropped entirely for that shape
                // rather than showing a number that can never be anything
                // but a misleading zero.
                <div className="flex justify-between text-slate-300">
                  <span>Total owed to {selectedSupplier.name} (fee-net):</span>
                  <span className="font-mono font-bold text-white">
                    ${settleTotalOwedUsd.toFixed(2)}
                  </span>
                </div>
              )}

              {isNewModelBatch ? (
                <>
                  {/* D8 — NEW-MODEL batch: commission is ENTERED here, not
                      derived. LUMP = one total per currency; RATE = rate ×
                      count (the operator's own supplier tariff), pre-selected
                      from the supplier's saved preference. */}
                  <div className="flex gap-2">
                    {(["LUMP", "RATE"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSettleEntryMode(mode)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          settleEntryMode === mode
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        }`}
                      >
                        {mode === "LUMP" ? "Lump sum" : "Rate × count"}
                      </button>
                    ))}
                  </div>

                  {settleEntryMode === "LUMP" ? (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
                          Commission (USD)
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={settleCommissionUsdInput}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/,/g, "");
                            if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                              setSettleCommissionUsdInput(raw);
                            }
                          }}
                          placeholder="0.00"
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
                          Commission (LBP)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={settleCommissionLbpInput}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/,/g, "");
                            if (raw === "" || /^\d+$/.test(raw)) {
                              setSettleCommissionLbpInput(raw);
                            }
                          }}
                          placeholder="0"
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
                            Rate per unit
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={settleRateInput}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/,/g, "");
                              if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                                setSettleRateInput(raw);
                              }
                            }}
                            placeholder="0"
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
                            Currency
                          </label>
                          <div className="flex gap-1">
                            {(["USD", "LBP"] as const).map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setSettleRateCurrency(c)}
                                className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                                  settleRateCurrency === c
                                    ? "bg-emerald-900/40 border-emerald-600 text-emerald-200"
                                    : "bg-slate-900 border-slate-600 text-slate-400 hover:text-white"
                                }`}
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="w-20">
                          <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
                            Count
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={settleUnitCountInput}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/,/g, "");
                              if (raw === "" || /^\d+$/.test(raw)) {
                                setSettleUnitCountInput(raw);
                              }
                            }}
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-500 text-right">
                        {settleRateInput || "0"} {settleRateCurrency} ×{" "}
                        {settleUnitCountInput || "0"} ={" "}
                        <span className="text-emerald-400 font-mono">
                          {settleRateCurrency === "USD"
                            ? `$${settleEnteredCommissionUsd.toFixed(2)}`
                            : `${Math.round(settleEnteredCommissionLbp).toLocaleString()} LBP`}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex justify-between text-slate-300">
                  <span>Your commission (already netted out):</span>
                  <span className="font-mono text-emerald-400">
                    ${settleCommissionUsd.toFixed(4)}
                  </span>
                </div>
              )}

              <div className="h-px bg-slate-600" />
              {isBillsOnlyBatch ? (
                // BILL_COMMISSION_SETTLEMENT_PLAN.md (LIRA-137) — the owner's
                // own model: "Katsh owes you X, they pay it to us via top-up
                // to our Katsh account" — a bills-only batch pays NOTHING
                // out; the entered commission arrives IN, either as a credit
                // to the Katsh/iPick provider drawer (default "Top-up") or,
                // per the owner's 2026-08-13 follow-up, through real
                // payment-method legs instead ("Other payment" — the sheet
                // below, autofilled with this same figure).
                <div className="space-y-2">
                  <div className="flex justify-between font-bold">
                    <span className="text-white">
                      {selectedSupplier.name} owes you:
                    </span>
                    <span className="font-mono text-emerald-400 text-base">
                      {formatMoney(
                        settleEnteredCommissionAmount,
                        settleEnteredCommissionCurrency,
                      )}
                    </span>
                  </div>

                  {/* Owner follow-up (2026-08-13) — mirrors the LUMP/RATE
                      toggle above: same look and behaviour, a sibling
                      control. Switching back to "Top-up" clears any
                      in-progress Other-payment legs so a stale leg can never
                      leak into a Top-up submission. */}
                  <div className="flex gap-2">
                    {(["TOP_UP", "OTHER_PAYMENT"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setSettleCommissionCollectionMode(mode);
                          if (mode === "TOP_UP") setSettlePaymentLines([]);
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          settleCommissionCollectionMode === mode
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        }`}
                      >
                        {mode === "TOP_UP" ? "Top-up" : "Other payment"}
                      </button>
                    ))}
                  </div>

                  {settleCommissionCollectionMode === "TOP_UP" ? (
                    <p className="text-[11px] text-slate-500">
                      Arrives as a top-up to the {selectedSupplier.name} balance
                      when you confirm — no payment for you to make.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      Pick how {selectedSupplier.name} pays you below — the
                      amount is prefilled from the commission above.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex justify-between font-bold">
                  <span className="text-white">
                    Net payment to {selectedSupplier.name}:
                  </span>
                  {/* LIRA-119 — respects settleNetPayCurrency instead of a
                      hardcoded "$" prefix. */}
                  <span className="font-mono text-blue-400 text-base">
                    {formatMoney(settleNetPayAmount, settleNetPayCurrency)}
                  </span>
                </div>
              )}
            </div>
          }
          multiPaymentInputKey={settleKey}
          multiPaymentInput={
            isBillsOnlyBatch
              ? settleCommissionCollectionMode === "OTHER_PAYMENT"
                ? {
                    // Owner follow-up (2026-08-13) — "Other payment" mode:
                    // the sheet's target is the RAW entered commission
                    // (never the always-0 net pay), autofilled by
                    // MultiPaymentInput's own single-mode auto-sync (same
                    // mechanism the legacy branch below already relies on).
                    totals: [
                      {
                        amount: settleEnteredCommissionAmount,
                        currency: settleEnteredCommissionCurrency,
                      },
                    ],
                    totalAmountCurrency: settleEnteredCommissionCurrency,
                    currency: settleEnteredCommissionCurrency,
                    onChange: setSettlePaymentLines,
                    showPmFee: false,
                    showDiscount: false,
                    paymentMethods: methods,
                    currencies: [
                      { code: "USD", symbol: "$" },
                      { code: "LBP", symbol: "LBP" },
                    ],
                    exchangeRate: exchangeRate,
                  }
                : null
              : {
                  // LIRA-119 — both the total and the payment sheet's default
                  // leg currency now follow settleNetPayCurrency instead of
                  // being hardcoded to USD, so a Katsh-style LBP commission
                  // settlement defaults to LBP the way the owner expects.
                  totals: [
                    {
                      amount: settleNetPayAmount,
                      currency: settleNetPayCurrency,
                    },
                  ],
                  totalAmountCurrency: settleNetPayCurrency,
                  currency: settleNetPayCurrency,
                  onChange: setSettlePaymentLines,
                  showPmFee: false,
                  showDiscount: false,
                  paymentMethods: methods,
                  currencies: [
                    { code: "USD", symbol: "$" },
                    { code: "LBP", symbol: "LBP" },
                  ],
                  exchangeRate: exchangeRate,
                }
          }
        >
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Note (optional)
            </label>
            <input
              value={settleNote}
              onChange={(e) => setSettleNote(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              placeholder={`Settlement with ${selectedSupplier.name}`}
            />
          </div>
        </CounterpartySettleModal>
      )}
    </div>
  );
}
