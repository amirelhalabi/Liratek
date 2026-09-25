import {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
  Fragment,
} from "react";
import {
  PageHeader,
  useApi,
  DateRangeFilter,
  daysAgoISO,
  todayISO,
  type CommissionsReport,
} from "@liratek/ui";
import { useModules } from "@/contexts/ModuleContext";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import {
  TrendingUp,
  DollarSign,
  BarChart2,
  Calendar,
  CreditCard,
  Users,
  UserCheck,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Clock,
  PieChart as PieChartIcon,
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { DataTable } from "@liratek/ui";
import { messageFrom } from "@/api/apiError";
// PA-4.23 (a) — the ONE place that classifies a By Module row's module code
// into its rendering class (equation / commission / profit-only), reused
// here instead of a hand-rolled per-row if (rule 14). Exported from
// `browser.ts` (this is Vite/frontend-jest's resolved entry point, rule 29).
import { classifyProfitModuleRow, PROFIT_ROW_CLASS } from "@liratek/core";

const CommissionsChart = lazy(
  () => import("../../dashboard/components/CommissionsChart"),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// PROF-DD (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2) — the By
// Module drill-down's "Show transactions" payload. Local mirror of core's
// `ProfitModuleDetail`/`ProfitModuleDetailRow` (same convention as
// `ProfitSummary` below — this file hand-declares report payload shapes
// rather than importing them, so this stays consistent with its neighbours).
interface ModuleDetailRow {
  id: number;
  date: string;
  counterpart: string;
  detail: string | null;
  amount_usd: number;
  amount_lbp: number;
  cost_usd: number;
  cost_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  counted_pct: number;
  counted_profit_usd: number;
  counted_profit_lbp: number;
  reason: string | null;
  fee_note: string | null;
}

interface ModuleDetailResult {
  module: string;
  counted: ModuleDetailRow[];
  not_counted: ModuleDetailRow[];
  counted_total_profit_usd: number;
  counted_total_profit_lbp: number;
}

interface ProfitSummary {
  period: string;
  sales: {
    revenue_usd: number;
    cost_usd: number;
    profit_usd: number;
    /** PA-3.1 — kept change stamped in LBP on an otherwise-USD sale (the
     *  ONLY LBP profit a sale ever carries). Optional so an older cached
     *  payload doesn't crash the page. */
    profit_lbp?: number;
    count: number;
  };
  financial_services: {
    revenue_usd: number;
    revenue_lbp: number;
    /** PA-3.6 — unsettled FS revenue, kept OUT of revenue_usd/revenue_lbp
     *  above so an unrecognized transfer's principal no longer inflates
     *  Total Revenue. Optional so an older cached payload doesn't crash. */
    pending_revenue_usd?: number;
    pending_revenue_lbp?: number;
    commission_usd: number;
    commission_lbp: number;
    /** PA-2.4 — the cashless (OMT/WHISH post-cutover) settlement commission
     *  share, shown on THIS card as "Commission (at settlement)" instead of
     *  under Supplier Commission (bills-only). Already included in the
     *  totals below via `supplier_commission`'s bills-only figure plus this
     *  one — a display re-routing, not new money. Optional so an older
     *  cached payload doesn't crash. */
    commission_at_settlement_usd?: number;
    commission_at_settlement_lbp?: number;
    pending_commission_usd: number;
    pending_commission_lbp: number;
    /** LIRA-162: count of commission_model = 1 rows awaiting settlement —
     *  see ProfitService's own ProfitSummary.financial_services doc comment.
     *  Optional: an older cached payload (or a mocked test response) may not
     *  carry it yet. */
    awaiting_settlement_count?: number;
    pm_fee_usd: number;
    pm_fee_lbp: number;
    /** LO-R2 (round 3, data lane) — a SETTLED FS-commission row's own
     *  off-currency kept change (e.g. an OMT/WHISH model-1 row's D1-style
     *  fee stamp in the other currency). Already folded into
     *  `totals.gross_profit_usd/_lbp` and the top-level `kept_change`
     *  roll-up server-side — this field is display-only, not rendered on
     *  this card (mirrors `mobile_services.kept_change_usd`'s placement:
     *  it shows on the "Other / Kept Change" card instead). Optional so an
     *  older cached payload doesn't crash the page. */
    kept_change_usd?: number;
    kept_change_lbp?: number;
    /** Owner decision (h), 2026-09-24 afternoon — recognised FS commission
     *  whose underlying transfer is still charged to a customer's account
     *  and not yet repaid (excluded from `commission_usd`/`_lbp` above).
     *  Additive visibility only — never folded into `totals.gross_profit_*`/
     *  `totals.net_profit_*`. Optional so an older cached payload doesn't
     *  crash the page. */
    waiting_for_repayment_usd?: number;
    waiting_for_repayment_lbp?: number;
    count: number;
  };
  mobile_services: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    /** LO-V1 (round 2, OWNER_NOTES_2026-09-21.md §6) — kept change stamped
     *  in the OTHER currency on an iPick/Katsh/BOB transaction (e.g. an LBP
     *  service tendered with USD kept as change). Already folded into
     *  `totals.gross_profit_usd`/`_lbp` server-side (rule 14: this is a
     *  display convenience, not a second sum) — shown on the "Other / Kept
     *  Change" card, not here (mirrors `sales.profit_lbp`'s own placement).
     *  Optional so an older cached payload doesn't crash the page. */
    kept_change_usd?: number;
    kept_change_lbp?: number;
    count: number;
  };
  recharges: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    /** @see mobile_services.kept_change_usd — same convention. */
    kept_change_usd?: number;
    kept_change_lbp?: number;
    count: number;
  };
  custom_services: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  maintenance: {
    revenue_usd: number;
    revenue_lbp: number;
    cost_usd: number;
    cost_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  loto: {
    revenue_lbp: number;
    profit_lbp: number;
    /** @see mobile_services.kept_change_usd — same convention; loto is
     *  LBP-native, so only a USD-side kept change can occur. */
    kept_change_usd?: number;
    count: number;
  };
  exchange: {
    revenue_usd: number;
    profit_usd: number;
    count: number;
  };
  /** T3 keep-change on debt repayments ("Other / kept change"). Optional so
   *  an older backend summary shape doesn't crash the page. */
  debt_repayments?: {
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  expenses: { total_usd: number; total_lbp: number; count: number };
  /** Profit earned but not yet realized in cash — sitting in a partner
   *  settlement or a client's debt account. Optional so an older cached
   *  summary response (pre-deferred-profit backend) doesn't crash the page.
   *
   *  LIRA-158 D17 (owner decision, 2026-08-31): a settlement is CASHLESS
   *  when no money actually arrives at settlement (OMT/WHISH, and mixed
   *  bills+OMT batches) — the owner fronts that payout from his own drawer
   *  before the underlying client repays. Commission on a cashless
   *  settlement now defers until that client's debt is covered, instead of
   *  recognising on the settlement day. The deferred share is summed into
   *  `client_debt_profit_usd`/`client_debt_profit_lbp` alongside the
   *  pre-existing account-charged-transaction profit that bucket already
   *  carried — same "stranded behind an uncovered client debt" condition,
   *  now with a second contributing source. A bills-only Katsh/iPick
   *  settlement is unaffected (it recognises immediately; see
   *  `supplier_commission` below). */
  deferred?: {
    partner_profit_usd: number;
    partner_profit_lbp: number;
    client_debt_profit_usd: number;
    client_debt_profit_lbp: number;
    /** PA-3.10 — the D17 cashless-settlement share ALONE (already folded,
     *  undistinguished, into client_debt_profit_usd/_lbp above). Ordinary
     *  debt-pending recharge/service/loto/maintenance profit never lands
     *  here. The "Supplier Commission: Deferred" pointer card gates on THIS
     *  field, not the combined one — see that card's own comment. Optional
     *  so an older cached payload doesn't crash (in which case the pointer
     *  card degrades to never showing, never to over-showing). */
    cashless_deferred_profit_usd?: number;
    cashless_deferred_profit_lbp?: number;
    /** PA-3.11 — unpaid sales (date-independent, "as of now"), previously
     *  nowhere on the Overview. Additive visibility only — NOT netted into
     *  totals above. Optional so an older cached payload doesn't crash. */
    unpaid_sales_outstanding_usd?: number;
    unpaid_sales_potential_profit_usd?: number;
  };
  /** CQ-10 (D1): net signed profit from counterparty discounts — a discount
   *  WE give (client/partner write-off) is negative, a discount a supplier
   *  gives US is positive. Already folded into the totals above (the
   *  discount row carries a normal signed profit stamp); this bucket is a
   *  breakout for visibility. Optional so an older cached summary response
   *  (pre-CQ-10 backend) doesn't crash the page. */
  discounts?: { usd: number; lbp: number };
  /** LIRA-137 fix: bills-only settlement commission (Katsh/iPick BILL rows),
   *  stamped directly on the SUPPLIER_SETTLEMENT transaction at settlement —
   *  "our profit entirely" (owner). Already folded into the totals above;
   *  this is a visibility breakout. Optional so an older cached summary
   *  response (pre-fix backend) doesn't crash the page.
   *
   *  LIRA-158 D17: `count` is the number of DISTINCT settlements that
   *  contributed RECOGNISED commission in this window — not every
   *  settlement touched. A cashless (OMT/WHISH, or mixed) settlement whose
   *  commission is entirely deferred (§ `deferred.client_debt_profit_usd`
   *  above) contributes nothing here and does not increment `count`, even
   *  though it happened. A bills-only settlement always recognises
   *  immediately, so it always counts. `profit_usd`/`profit_lbp` can
   *  legitimately be 0 while `count` is 0 too — that means every
   *  settlement in the window was fully deferred, not that nothing
   *  happened; see the Deferred Profit card for where that money sits. */
  supplier_commission?: {
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  /** PA-2.3 — TELECOM_CREDIT_BUYBACK + RECHARGE_TOPUP profit, previously
   *  invisible on the Overview though already counted in By Cashier/By
   *  Client. Profit-only, no revenue/cost pair. Optional so an older cached
   *  payload doesn't crash the page. */
  topups_buybacks?: {
    profit_usd: number;
    profit_lbp: number;
    count: number;
  };
  /** LO-V1 (round 2, OWNER_NOTES_2026-09-21.md §6) — the shop's total
   *  OTHER-currency kept change across recharges, mobile services and loto
   *  (`recharges.kept_change_usd/_lbp` + `mobile_services.kept_change_usd/
   *  _lbp` + `loto.kept_change_usd`, summed server-side). ALREADY included
   *  in `totals.gross_profit_*`/`net_profit_*` — additive visibility only,
   *  for the "Other / Kept Change" card, alongside `debt_repayments` (a
   *  different source table) and `sales.profit_lbp` (a sale's own kept
   *  change — NOT repeated here). KNOWN GAP (server-documented): a
   *  financial-service commission row's own off-currency kept change is not
   *  included here yet. Optional so an older cached payload doesn't crash. */
  kept_change?: { usd: number; lbp: number };
  totals: {
    gross_revenue_usd: number;
    gross_revenue_lbp: number;
    total_cost_usd: number;
    total_cost_lbp: number;
    gross_profit_usd: number;
    gross_profit_lbp: number;
    net_profit_usd: number;
    net_profit_lbp: number;
    /** note #3 (2026-09-24, CLOSED "no change") — the combined
     *  "Total Net Profit ≈ X LBP (at buy rate N)" line is REMOVED (the
     *  former `combined_net_profit_lbp`/`combined_rate_used` pair; owner:
     *  credits are reduced in USD, so a `-0.32$` stays a USD figure and
     *  must never fold into one LBP total). `lbp_buy_rate` is kept ONLY to
     *  weight the By Module TOTAL row's mixed-currency margin_pct
     *  (LIRA-183, kept below) — `null` when no LBP rate is configured.
     *  Optional so an older cached payload doesn't crash. */
    lbp_buy_rate?: number | null;
  };
}

interface ModuleRow {
  module: string;
  label: string;
  revenue_usd: number;
  revenue_lbp: number;
  /** PA-2.9 — cost by currency (was hard-coded 0 for FS-provider rows).
   *  Optional so an older cached payload doesn't crash. */
  cost_usd?: number;
  cost_lbp?: number;
  profit_usd: number;
  profit_lbp: number;
  count: number;
  /** MAINTENANCE row only (LIRA-176): parts are always USD. */
  parts_revenue_usd?: number;
  parts_cost_usd?: number;
  parts_profit_usd?: number;
  labour_profit_usd?: number;
  labour_profit_lbp?: number;
  /** PA-4.21 — server-computed net margin %, `null` when revenue is 0 or
   *  the row mixes USD+LBP with no LBP rate configured to combine them.
   *  Optional so an older cached payload falls back to the old client-side
   *  USD-only formatPct computation. */
  margin_pct?: number | null;
  /** PA-4.21 — true when margin_pct required converting one currency into
   *  the other via the LBP buy rate. */
  margin_converted?: boolean;
  /** LO-V1 (round 2) — off-currency kept change on this row's own
   *  transaction(s). Only ever populated on FINANCIAL_SERVICE_* and
   *  RECHARGE_* rows. Additive: NOT already folded into profit_usd/
   *  profit_lbp above (those keep meaning "this row's own margin") — see
   *  ProfitByModule.kept_change_usd's own doc comment in ProfitService.ts.
   *  Optional so an older cached payload doesn't crash. */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  /** PFU-a-3 — SALE row ONLY, NOT additive (already inside profit_usd/
   *  profit_lbp) — see ProfitByModule.sale_kept_change_usd's own doc
   *  comment in ProfitService.ts. PFU-a-3-residual (verifier round 2): a
   *  NEGATIVE value is not guaranteed to be genuine kept change (same doc
   *  comment) — the renderer below labels it "unexplained difference"
   *  instead of "kept change". */
  sale_kept_change_usd?: number;
  sale_kept_change_lbp?: number;
}

interface DateRow {
  date: string;
  revenue_usd: number;
  /** PA-4.14/PA-2.2 — optional so an older cached payload doesn't crash. */
  revenue_lbp?: number;
  cost_usd?: number;
  cost_lbp?: number;
  profit_usd: number;
  profit_lbp: number;
  expenses_usd: number;
  /** PA-4.14 — already returned by getByDate, previously never rendered. */
  expenses_lbp?: number;
  net_profit_usd: number;
  net_profit_lbp: number;
}

interface PaymentMethodRow {
  method: string;
  /** New-sales intake, net of change/payout legs and partial item refunds
   *  (owner decision 1, 2026-09-24). Never includes debt-repayment intake —
   *  see {@link debt_repayment_usd}. */
  total_usd: number;
  total_lbp: number;
  /** Owner decision 3 (2026-09-24): debt-repayment intake, its OWN column —
   *  replaces the old all-or-nothing `is_debt_repayment_only` flag. */
  debt_repayment_usd?: number;
  debt_repayment_lbp?: number;
  count: number;
  /** Dollar pending amount — commission_model = 0 legacy rows only (D15). */
  pending_commission_usd?: number;
  /** LBP counterpart of pending_commission_usd (commission_model = 0 legacy
   *  rows only). */
  pending_commission_lbp?: number;
  /** LIRA-158 D15: count of commission_model = 1 rows awaiting settlement —
   *  their commission is unknowable until entered at settlement, so they
   *  are surfaced as a count, never a dollar figure. */
  awaiting_settlement_count?: number;
  is_settled?: number;
}

interface UserRow {
  user_id: number;
  username: string;
  revenue_usd: number;
  /** PA-1.7: was computed by the repository but never rendered. */
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
  /** PA-4.19: transaction_count minus REFUND/SUPPLIER_SETTLEMENT rows and an
   *  unrecognized FS row — the correct "Avg Profit/Txn" denominator. */
  recognized_transaction_count: number;
  pending_profit_usd: number;
  /** PA-1.3: LBP half of pending_profit_usd, split by currency. */
  pending_profit_lbp: number;
}

interface ClientRow {
  client_id: number | null;
  client_name: string;
  client_phone: string | null;
  revenue_usd: number;
  /** @see UserRow.revenue_lbp */
  revenue_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  transaction_count: number;
  /** @see UserRow.recognized_transaction_count */
  recognized_transaction_count: number;
  pending_profit_usd: number;
  /** @see UserRow.pending_profit_lbp */
  pending_profit_lbp: number;
}

type TabKey =
  | "overview"
  | "by-module"
  | "by-date"
  | "by-payment"
  | "by-user"
  | "by-client"
  | "pending"
  | "commissions";

// Commissions tab (OWNER_NOTES_2026-09-21.md §6, lane LC) reads
// `CommissionsReport`/`CommissionProviderRow` (packages/core/src/services/
// CommissionsReportService.ts, re-exported via @liratek/ui) instead of the
// old `getOMTAnalytics()`/`getUnsettledSummary()` pair — see loadCommissions
// below for why: that old pair mixed USD/LBP with no split (PA-1.1),
// dropped LBP pending (PA-1.6), excluded settled model-1 commission
// (PA-2.7), applied no recognition gates (PA-3.4), and ignored the date
// picker (PA-4.17).

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPct(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * PA-4.5 (OWNER_NOTES_2026-09-21.md §6.6) — every module profit figure used
 * to be hard-coded emerald (green), even a loss. Sign-based color: a loss
 * is red, exactly zero is neutral slate (matches the em-dash convention
 * already used for a zero LBP figure), anything positive is emerald.
 */
function profitClass(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-slate-400";
}

/**
 * PA-4.21 (LIRA-183) — render a server-computed margin (see
 * ProfitService's computeMargin). `null` means "not computable" (zero
 * revenue, or a mixed-currency row with no LBP rate configured) — rendered
 * as an em dash rather than a fabricated ratio (rule 8). `margin_converted`
 * marks a mixed-currency row's margin as approximate ("≈").
 */
function formatMargin(
  marginPct: number | null | undefined,
  marginConverted: boolean | undefined,
): string {
  if (marginPct === null || marginPct === undefined) return "—";
  return `${marginConverted ? "≈ " : ""}${marginPct.toFixed(1)}%`;
}

/**
 * PA-4.7 + PA-4.8 (OWNER_NOTES_2026-09-21.md §6.6) — a single helper for
 * "show both currencies at equal weight". PA-4.7: an LBP-only period used
 * to render a bare "$0.00" as the headline figure for a KPI whose USD side
 * happened to be zero; this shows the LBP figure instead, never a
 * fabricated $0.00. PA-4.8 (Turnover): when BOTH currencies are nonzero,
 * both render in the same text run — no primary/sub-value hierarchy that
 * would imply one currency mattered less than the other.
 */
function combinedAmountLabel(
  usd: number,
  lbp: number,
  formatAmount: (value: number, currency: "USD" | "LBP") => string,
): string {
  if (lbp === 0) return formatAmount(usd, "USD");
  if (usd === 0) return formatAmount(lbp, "LBP");
  return `${formatAmount(usd, "USD")} + ${formatAmount(lbp, "LBP")}`;
}

/**
 * LO-V9 (round 2 adversarial review, OWNER_NOTES_2026-09-21.md §6) — the
 * Mobile/Custom/Recharges/Maintenance profit lines used to wrap
 * `combinedAmountLabel`'s single string in ONE `profitClass` colored by
 * whichever currency happened to be nonzero (`profit_lbp !== 0 ?
 * profit_lbp : profit_usd`) — so a USD LOSS beside an LBP GAIN rendered
 * green, and vice versa. This renders each currency in its OWN span, colored
 * by its OWN sign, while keeping `combinedAmountLabel`'s zero-hiding
 * convention (an all-LBP or all-USD period never shows a fabricated
 * "$0.00" for the side with no activity at all).
 */
function ProfitAmountSpans({
  usd,
  lbp,
  formatAmount,
}: {
  usd: number;
  lbp: number;
  formatAmount: (value: number, currency: "USD" | "LBP") => string;
}) {
  if (lbp === 0) {
    return <span className={profitClass(usd)}>{formatAmount(usd, "USD")}</span>;
  }
  if (usd === 0) {
    return <span className={profitClass(lbp)}>{formatAmount(lbp, "LBP")}</span>;
  }
  return (
    <>
      <span className={profitClass(usd)}>{formatAmount(usd, "USD")}</span>
      {" + "}
      <span className={profitClass(lbp)}>{formatAmount(lbp, "LBP")}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  subValue,
  icon: Icon,
  color,
  trend,
}: {
  label: string;
  value: string;
  subValue?: string | undefined;
  icon: typeof DollarSign;
  color: string;
  trend?: "up" | "down" | "neutral" | undefined;
}) {
  const TrendIcon =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  const trendColor =
    trend === "up"
      ? "text-emerald-400"
      : trend === "down"
        ? "text-red-400"
        : "text-slate-400";

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400 uppercase tracking-wider">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className="flex items-end gap-2">
        <p className="text-xl font-bold text-white">{value}</p>
        {trend && <TrendIcon className={`h-4 w-4 ${trendColor}`} />}
      </div>
      {subValue && <p className="text-xs text-slate-500 mt-1">{subValue}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function Profits() {
  const api = useApi();
  const { formatAmount } = useCurrencyContext();
  const { isModuleEnabled } = useModules();
  const commissionsEnabled =
    isModuleEnabled("services") ||
    isModuleEnabled("recharge") ||
    isModuleEnabled("binance") ||
    isModuleEnabled("ipec_katch");

  const [tab, setTab] = useState<TabKey>("overview");
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  // LO-loading-race (OWNER_NOTES_2026-09-21.md §6.6, round 4): on By Module,
  // loadByModule and loadSummary are fired TOGETHER (see the tab-switch
  // effect below) but each independently called plain setLoading(true)/
  // setLoading(false) on the SAME boolean — a last-write-wins race. If
  // loadSummary resolved first, its OWN finally{setLoading(false)} flipped
  // `loading` false while loadByModule was still in flight for the NEW
  // range, so the By Module table briefly rendered with the PREVIOUS
  // range's rows sitting under a footer gated as current.
  //
  // Round 4's first fix made `loading` wait for BOTH fetches (a shared
  // counter) — but the By Module TABLE only ever reads `byModule`, and the
  // footer's net row already has its own staleness guard
  // (`summaryMatchesRange`, below) that degrades to a named "—"/error
  // fallback whenever `summary` isn't a match for the range on screen —
  // including "hasn't arrived yet". Coupling the table's visibility to
  // BOTH fetches meant a slow/hung getProfitSummary blanked the ENTIRE tab
  // (table included) instead of just the net row (round-1 fix-round
  // finding LO-loading-race-breaks-LO-V8-test).
  //
  // Fix: decouple. `summaryLoading` belongs to loadSummary alone (it is
  // the only thing the Overview tab's gates read). `loading` belongs to
  // loadByModule and every other tab's solo loader — none of THOSE ever
  // co-fire with anything, so a plain flag is correct for them, same as
  // before round 4. The By Module table therefore renders as soon as
  // `byModule` itself is ready; the net row still shows "—" until `summary`
  // catches up, via the SAME `summaryMatchesRange` check that already
  // covered a stale/mismatched period. TOTAL and NET still never mix
  // periods — `summaryMatchesRange` guarantees that regardless of which of
  // the two fetches happens to finish first.
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Data
  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  // PA-4.16 (own loader): a query failure used to render the SAME "No data
  // for this period" empty state as a genuine no-activity day.
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [byModule, setByModule] = useState<ModuleRow[]>([]);
  // PA-4.16 (own loader): getByModule now throws on a repository error
  // (previously returned []); surface that as a visible error instead of an
  // empty table.
  const [byModuleError, setByModuleError] = useState<string | null>(null);
  const [byDate, setByDate] = useState<DateRow[]>([]);
  // PA-4.16 (own loader): same fix as byModuleError — getByDate now throws.
  const [byDateError, setByDateError] = useState<string | null>(null);
  // PA-4.23 — which By Module rows have their Revenue − Cost = Profit /
  // maintenance parts-labour breakdown expanded. Purely a UI convenience
  // (not persisted), keyed by `module` (unique per row).
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    new Set(),
  );
  // PROF-DD (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2) — the
  // By Module drill-down's lazy-loaded "Show transactions" list, keyed by
  // module (one entry per row that has been expanded and asked for it).
  // `api` is read through a ref (rule 25) — this loader is NOT re-created
  // when `api`'s identity churns, only when the date range does.
  const [moduleDetail, setModuleDetail] = useState<
    Record<
      string,
      | { status: "loading" }
      | { status: "loaded"; data: ModuleDetailResult }
      | { status: "error"; error: string }
    >
  >({});
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  // PROF-DD-FIX (review round, M2) — the drill-down cache used to be keyed
  // ONLY by module and never cleared when the date range changed: after
  // loading a row's transactions and then changing `from`/`to`, the By
  // Module row above refreshed but the list still showed the OLD period's
  // rows with no way to reload, visibly disagreeing with the row it sits
  // under. Clearing on every range change forces a fresh "Show transactions"
  // click (the button reappears) instead of silently serving stale data.
  useEffect(() => {
    setModuleDetail({});
  }, [from, to]);
  // A request tagged with the range it was made for — dropped if a NEWER
  // request for the same module has already started by the time it
  // resolves, so a slow earlier response can never overwrite a fresher one
  // (both are now possible: the range-change effect above no longer removes
  // the in-flight request itself, only its eventual stale result).
  const moduleDetailRequestIdRef = useRef<Record<string, number>>({});
  const loadModuleDetail = useCallback(
    (moduleKey: string) => {
      const requestId = (moduleDetailRequestIdRef.current[moduleKey] ?? 0) + 1;
      moduleDetailRequestIdRef.current[moduleKey] = requestId;
      const requestFrom = from;
      const requestTo = to;
      setModuleDetail((prev) => ({
        ...prev,
        [moduleKey]: { status: "loading" },
      }));
      apiRef.current
        .getProfitModuleDetail(moduleKey, requestFrom, requestTo)
        .then((data: ModuleDetailResult) => {
          if (moduleDetailRequestIdRef.current[moduleKey] !== requestId) return;
          setModuleDetail((prev) => ({
            ...prev,
            [moduleKey]: { status: "loaded", data },
          }));
        })
        .catch((err: unknown) => {
          if (moduleDetailRequestIdRef.current[moduleKey] !== requestId) return;
          setModuleDetail((prev) => ({
            ...prev,
            [moduleKey]: {
              status: "error",
              error: messageFrom(
                err,
                "Failed to load transactions for this module.",
              ),
            },
          }));
        });
    },
    [from, to],
  );
  const [byPayment, setByPayment] = useState<PaymentMethodRow[]>([]);
  // PA-4.16 (OWNER_NOTES_2026-09-21.md §6.6): a query failure used to be
  // swallowed into `setByPayment([])`, rendering the SAME "No payment data
  // for this period" empty state as a genuine no-activity day — a broken
  // query read as silence. Own loader/tab only (every other lane fixes its
  // own the same way).
  const [byPaymentError, setByPaymentError] = useState<string | null>(null);
  const [byUser, setByUser] = useState<UserRow[]>([]);
  // PA-4.16: same "a broken query must not read as a quiet day" fix as
  // byPaymentError — own loader/tab only.
  const [byUserError, setByUserError] = useState<string | null>(null);
  const [byClient, setByClient] = useState<ClientRow[]>([]);
  const [byClientError, setByClientError] = useState<string | null>(null);
  const [commissionsReport, setCommissionsReport] =
    useState<CommissionsReport | null>(null);
  // PA-4.16: same "a broken query must not read as a quiet day" fix as
  // byPaymentError/pendingError — own loader/tab only.
  const [commissionsError, setCommissionsError] = useState<string | null>(
    null,
  );
  const [pendingData, setPendingData] = useState<{
    rows: {
      sale_id: number;
      created_at: string;
      client_name: string;
      client_phone: string;
      total_amount_usd: number;
      paid_usd: number;
      outstanding_usd: number;
      potential_profit_usd: number;
      items_summary: string;
    }[];
    totals: {
      total_outstanding_usd: number;
      total_pending_profit_usd: number;
      count: number;
    };
    unsettled_commissions: {
      id: number;
      provider: string;
      omt_service_type: string | null;
      amount: number;
      currency: string;
      commission: number;
      omt_fee: number | null;
      created_at: string;
    }[];
    unsettled_totals: {
      total_pending_commission_usd: number;
      total_pending_commission_lbp: number;
      count: number;
      /** PA-3.7: count of commission_model = 1 rows awaiting supplier
       *  settlement — a count only, never a $ figure (unknowable pre-
       *  settlement). Optional so an older cached payload doesn't crash. */
      awaiting_settlement_count?: number;
    };
    /** PA-3.7: profit already stamped but stranded behind an uncovered
     *  partner settlement or client-debt repayment (incl. cashless OMT/
     *  WHISH settlement commission) — additive visibility only, sourced
     *  unmodified from ProfitRepository.getDeferredProfit, NEVER netted
     *  into totals/unsettled_totals above. Optional so an older cached
     *  payload doesn't crash the page. */
    deferred?: {
      partner_profit_usd: number;
      partner_profit_lbp: number;
      client_debt_profit_usd: number;
      client_debt_profit_lbp: number;
    };
  } | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // ---------- Fetchers ----------

  // All fetchers below are dual-mode via useApi() — the adapter picks IPC
  // vs REST internally (ipcOrHttp), so no window.api gate belongs here
  // (rule 19a): a raw `window.api ? ... : ...` ternary takes the wrong
  // branch in the browser and under the web-test shim.
  const loadSummary = useCallback(async () => {
    // LO-loading-race: own flag, not the shared `loading` — see
    // `summaryLoading`'s doc comment above.
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const data = await api.getProfitSummary(from, to);
      setSummary(data);
    } catch (err) {
      // PA-4.16: do NOT collapse a real failure into the empty-data state —
      // clear stale data and surface a visible error instead of a silent
      // "No data for this period".
      setSummary(null);
      setSummaryError(
        messageFrom(err, "Failed to load the profit summary for this period."),
      );
    } finally {
      setSummaryLoading(false);
    }
  }, [api, from, to]);

  const loadByModule = useCallback(async () => {
    // LO-loading-race: plain shared `loading`, same as every other solo
    // loader — see `summaryLoading`'s doc comment above for why this no
    // longer waits on loadSummary too.
    setLoading(true);
    setByModuleError(null);
    try {
      const data = await api.getProfitByModule(from, to);
      setByModule(data || []);
    } catch (err) {
      // PA-4.16: getByModule now THROWS on a repository error (previously
      // returned [] and looked like a quiet day).
      setByModule([]);
      setByModuleError(
        messageFrom(err, "Failed to load profit by module for this period."),
      );
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadByDate = useCallback(async () => {
    setLoading(true);
    setByDateError(null);
    try {
      const data = await api.getProfitByDate(from, to);
      setByDate(data || []);
    } catch (err) {
      // PA-4.16: getByDate now THROWS on a repository error — same fix as
      // loadByModule above.
      setByDate([]);
      setByDateError(
        messageFrom(err, "Failed to load profit by date for this period."),
      );
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadByPayment = useCallback(async () => {
    setLoading(true);
    setByPaymentError(null);
    try {
      const data = await api.getProfitByPaymentMethod(from, to);
      setByPayment(data || []);
    } catch (error) {
      // PA-4.16: do NOT collapse a real failure into the empty-data state —
      // clear the stale rows and surface a visible error instead of a
      // silent "No payment data for this period".
      setByPayment([]);
      setByPaymentError(
        messageFrom(error, "Failed to load payment method data."),
      );
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadByUser = useCallback(async () => {
    setLoading(true);
    setByUserError(null);
    try {
      const data = await api.getProfitByUser(from, to);
      setByUser(data || []);
    } catch (err) {
      // PA-4.16: do NOT collapse a real failure into the empty-data state —
      // clear the stale rows and surface a visible error instead of a
      // silent "No data for this period".
      setByUser([]);
      setByUserError(
        messageFrom(err, "Failed to load profit by cashier for this period."),
      );
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadByClient = useCallback(async () => {
    setLoading(true);
    setByClientError(null);
    try {
      const data = await api.getProfitByClient(from, to, 30);
      setByClient(data || []);
    } catch (err) {
      // PA-4.16: see loadByUser's identical fix above.
      setByClient([]);
      setByClientError(
        messageFrom(err, "Failed to load profit by client for this period."),
      );
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setPendingError(null);
    try {
      const data = await api.getPendingProfit(from, to);
      setPendingData(data || null);
    } catch (err) {
      // PA-4.16: a failed fetch used to look identical to "no pending
      // profit this period" (both rendered the same "No data" placeholder).
      // Keep the distinction visible instead of swallowing it.
      setPendingData(null);
      setPendingError(
        messageFrom(err, "Failed to load pending profit for this period."),
      );
    } finally {
      setLoading(false);
    }
  }, [api, from, to]);

  const loadCommissions = useCallback(async () => {
    setLoading(true);
    setCommissionsError(null);
    try {
      const data = await api.getProfitsCommissions(from, to);
      setCommissionsReport(data);
    } catch (err) {
      // PA-4.16: this tab used to show "Loading..." forever on a failed
      // fetch (the guard below only ever checked `!commissionsData`, which
      // is equally true while loading AND after a swallowed error) — keep
      // the distinction visible instead.
      setCommissionsReport(null);
      setCommissionsError(
        messageFrom(err, "Failed to load commissions for this period."),
      );
    } finally {
      setLoading(false);
    }
    // PA-4.17: `from`/`to` now genuinely re-fetch on date-picker change —
    // the old version depended on `[api]` only and silently ignored the
    // picker.
  }, [api, from, to]);

  // LO-V8 (round 2 adversarial review) — the finding as reported assumed
  // getProfitSummary only ever fires when the Overview tab is visited, so
  // the By Module footer's Σ gross − expenses = net line (LO-V4) would read
  // "—" for every mixed total if By Module was opened first. Measured
  // (rule 28) instead of trusting that premise: `tab` defaults to
  // "overview" (see its useState below), so THIS effect already calls
  // loadSummary() unconditionally on first mount, before any tab click ever
  // reaches the user — `summary` is populated by the time this branch's
  // own render runs, with no extra fetch needed. Confirmed by instrumenting
  // the mock call count in Profits.auditBatchLO.round2.test.tsx: adding a
  // second loadSummary() call here made getProfitSummary fire TWICE for one
  // page visit, proving the data was already present after just one. The
  // footer below still degrades to a named "—"/error state rather than
  // crashing if that mount-time assumption is ever broken by a future
  // change to the default tab.
  useEffect(() => {
    if (tab === "overview") {
      loadSummary();
    } else if (tab === "by-module") {
      // LO-R1 / LO-V8 (round 3 adversarial review) — this branch used to
      // call ONLY loadByModule(), relying on "overview" being the default
      // tab so a mount-time loadSummary() would already be in flight before
      // the operator could ever switch away. That covers mount order but
      // NOT a date-range change made WHILE already on By Module: `tab`
      // stays "by-module" so this effect re-fires (loadByModule's identity
      // changed with from/to) without ever re-running loadSummary — so the
      // footer's Gross − Expenses = Net (+ combined) row kept showing the
      // PREVIOUS period's summary beside the CURRENT period's TOTAL row.
      // Proven by a mount → open By Module → change date probe:
      // getProfitByModule called twice, getProfitSummary once, TOTAL row
      // "999 USD" (new range) vs net row "111 USD" (old range). By Module's
      // footer reads `summary` too, so it needs the same fetch every time
      // this tab's data does. The footer itself additionally gates on
      // `summary.period` matching the current range (see its render below)
      // so an in-flight/failed refetch degrades to a named fallback instead
      // of ever showing a stale cross-period figure.
      loadByModule();
      loadSummary();
    } else if (tab === "by-date") loadByDate();
    else if (tab === "by-payment") loadByPayment();
    else if (tab === "by-user") loadByUser();
    else if (tab === "by-client") loadByClient();
    else if (tab === "pending") loadPending();
    else if (tab === "commissions") loadCommissions();
  }, [
    tab,
    loadSummary,
    loadByModule,
    loadByDate,
    loadByPayment,
    loadByUser,
    loadByClient,
    loadPending,
    loadCommissions,
  ]);

  // ---------- Tabs ----------

  const tabs: { key: TabKey; label: string; icon: typeof TrendingUp }[] = [
    { key: "overview", label: "Overview", icon: TrendingUp },
    { key: "by-module", label: "By Module", icon: BarChart2 },
    { key: "by-date", label: "By Date", icon: Calendar },
    {
      key: "by-payment",
      // PA-4.15: renamed from "By Payment Method" — this tab is a cash-intake
      // breakdown (what actually landed in a drawer by tender), not a profit
      // breakdown; the Commission rows it also carries are the exception, not
      // what the tab is FOR. Internal `key` unchanged (routing untouched).
      label: "Cash intake by method",
      icon: CreditCard,
    },
    { key: "by-user", label: "By Cashier", icon: UserCheck },
    { key: "by-client", label: "By Client", icon: Users },
    { key: "pending", label: "Pending Profit", icon: Clock },
    // Only show Commissions tab when a commission-generating module is enabled
    ...(commissionsEnabled
      ? [{ key: "commissions" as TabKey, label: "Commissions", icon: Activity }]
      : []),
  ];

  // LIRA-159 D2: total unsettled model-1 rows across all providers — the
  // pie chart's pending ring is dollar-only, so a provider whose pending
  // commission is entirely post-cutover would otherwise be invisible.
  // Surfaced as a caption near the chart instead of a fabricated pie amount.
  // `CommissionsReportService.getReport` already rolls this up across
  // providers (as-of-now, not scoped to [from,to] — see that file's header).
  const awaitingSettlementCount =
    commissionsReport?.awaiting_settlement_count ?? 0;

  // LO-loading-race: the Overview tab's only fetcher is loadSummary, so its
  // "still loading" state is `summaryLoading`, not the shared `loading` —
  // see that state's own doc comment above. Every other tab (including By
  // Module, whose table depends on `byModule` alone) keeps reading `loading`
  // unchanged.
  const currentTabLoading = tab === "overview" ? summaryLoading : loading;

  // ---------- Render ----------

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 pt-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader title="Profits" />

      {/* Tab bar + date range */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex bg-slate-800 rounded-lg p-1 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        <DateRangeFilter
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          className="ml-auto"
        />
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 min-h-0 overflow-y-auto -mr-6 pr-6 pb-6 space-y-6">
        {/* Loading */}
        {currentTabLoading && (
          <div className="text-center py-12 text-slate-400">Loading...</div>
        )}

        {/* ==================== Overview Tab ==================== */}
        {!currentTabLoading && tab === "overview" && summaryError && (
          // PA-4.16: a visible error state, distinct from the empty-data
          // message below for a real no-activity period.
          <div
            role="alert"
            className="m-0 flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300"
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-400" />
            <div>
              <p className="font-medium text-red-200">
                Failed to load the profit summary
              </p>
              <p className="mt-0.5 text-red-400/80">{summaryError}</p>
            </div>
          </div>
        )}
        {!currentTabLoading && tab === "overview" && !summaryError && !summary && (
          <div className="text-center py-12 text-slate-500">
            No data for this period
          </div>
        )}
        {!currentTabLoading && tab === "overview" && summary && (
          <div className="space-y-6">
            {/* PA-4.22 — headline "Total Net Profit" card: an explicit
                Gross − Expenses = Net equation per currency. note #3
                (2026-09-24, CLOSED "no change") dropped the combined
                report-time-only "≈ X LBP" line that PA-4.21 originally
                specified here — net_profit_usd/net_profit_lbp below stay
                separate per-currency figures, never folded into one
                number. */}
            <div
              data-testid="profits-headline-net-profit"
              className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">
                  Total Net Profit
                </span>
              </div>
              {/* LO-V9 — was unconditional `formatAmount(gross_profit_usd,
                  "USD")` first, so an LBP-only period printed a fabricated
                  "0 USD + X LBP" instead of just the LBP figure.
                  `combinedAmountLabel` applies the same zero-hiding
                  convention as every other card on this tab (PA-4.7). */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-300">
                <span>
                  {combinedAmountLabel(
                    summary.totals.gross_profit_usd,
                    summary.totals.gross_profit_lbp,
                    formatAmount,
                  )}
                </span>
                <span className="text-slate-500">(Gross)</span>
                <span className="text-slate-500">−</span>
                <span className="text-red-400">
                  {combinedAmountLabel(
                    summary.expenses.total_usd,
                    summary.expenses.total_lbp,
                    formatAmount,
                  )}
                </span>
                <span className="text-slate-500">(Expenses)</span>
                <span className="text-slate-500">=</span>
                {/* LO-R6 (round 3 adversarial review) — was ONE span
                    colored by net_profit_usd's sign only, so an LBP-only
                    period's net LOSS rendered neutral grey instead of red
                    (and a USD gain beside an LBP loss painted the whole
                    combined figure green). Per-currency spans, matching the
                    Mobile/Custom/Recharges/Maintenance lines' own LO-V9
                    fix. */}
                <span className="font-semibold">
                  <ProfitAmountSpans
                    usd={summary.totals.net_profit_usd}
                    lbp={summary.totals.net_profit_lbp}
                    formatAmount={formatAmount}
                  />
                </span>
              </div>
            </div>

            {/* Top-level KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                label="Net Profit (USD)"
                value={formatAmount(summary.totals.net_profit_usd, "USD")}
                subValue={`Gross: ${formatAmount(summary.totals.gross_profit_usd, "USD")}`}
                icon={DollarSign}
                color="text-emerald-400"
                trend={
                  summary.totals.net_profit_usd > 0
                    ? "up"
                    : summary.totals.net_profit_usd < 0
                      ? "down"
                      : "neutral"
                }
              />
              <SummaryCard
                label="Net Profit (LBP)"
                value={formatAmount(summary.totals.net_profit_lbp, "LBP")}
                // PA-4.4a — the LBP card had no "Gross" subline, unlike its
                // USD sibling above.
                subValue={`Gross: ${formatAmount(summary.totals.gross_profit_lbp, "LBP")}`}
                icon={DollarSign}
                color="text-blue-400"
                trend={
                  summary.totals.net_profit_lbp > 0
                    ? "up"
                    : summary.totals.net_profit_lbp < 0
                      ? "down"
                      : "neutral"
                }
              />
              <SummaryCard
                // PA-4.8 — renamed: this figure includes pass-through money
                // (FS principal, exchange USD leg, loto face value), so
                // "Total Revenue" overstated what the shop actually earned.
                label="Turnover (incl. transfers & exchange)"
                // PA-4.7 + PA-4.8 — both currencies at equal weight (never a
                // bare "$0.00" headline in an LBP-only period).
                value={combinedAmountLabel(
                  summary.totals.gross_revenue_usd,
                  summary.totals.gross_revenue_lbp,
                  formatAmount,
                )}
                icon={TrendingUp}
                color="text-blue-400"
              />
              <SummaryCard
                label="Total Expenses"
                // PA-4.7 — an LBP-only period no longer shows a bare "$0.00"
                // headline; the primary figure is whichever currency was
                // actually spent (both, if both were).
                value={combinedAmountLabel(
                  summary.expenses.total_usd,
                  summary.expenses.total_lbp,
                  formatAmount,
                )}
                icon={ArrowDownRight}
                color="text-red-400"
              />
            </div>

            {/* PA-4.4b — total_cost_usd/_lbp was computed but never shown
                anywhere on the Overview. */}
            <div className="grid grid-cols-1 gap-4">
              <SummaryCard
                label="Total Cost"
                value={combinedAmountLabel(
                  summary.totals.total_cost_usd,
                  summary.totals.total_cost_lbp,
                  formatAmount,
                )}
                icon={ArrowDownRight}
                color="text-amber-400"
              />
            </div>

            {/* Deferred profit — earned but not yet realized: sitting in a
                partner settlement or a client's debt account rather than
                cash. Informational only; excluded from the KPI totals above.
                PA-3.11 — the gate now also opens for unpaid-sales-only
                periods (previously that figure had nowhere to render at
                all, so a period with ONLY unpaid sales silently showed no
                Deferred card whatsoever). */}
            {summary.deferred &&
              ((summary.deferred.partner_profit_usd ?? 0) !== 0 ||
                (summary.deferred.partner_profit_lbp ?? 0) !== 0 ||
                (summary.deferred.client_debt_profit_usd ?? 0) !== 0 ||
                (summary.deferred.client_debt_profit_lbp ?? 0) !== 0 ||
                (summary.deferred.unpaid_sales_outstanding_usd ?? 0) !== 0) && (
                <div
                  data-testid="profits-deferred-card"
                  className="bg-amber-950/20 rounded-xl border border-amber-800/40 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-400" />
                      Deferred Profit
                    </span>
                    <span className="text-xs text-amber-400/70">
                      Not yet realized
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 space-y-2">
                    {((summary.deferred.partner_profit_usd ?? 0) !== 0 ||
                      (summary.deferred.partner_profit_lbp ?? 0) !== 0) && (
                      <div className="flex justify-between items-center gap-4">
                        <span>Pending partner settlements</span>
                        {/* PA-4.7 — an LBP-only partner settlement no longer
                            shows a bare "$0.00" headline. */}
                        <span className="text-amber-300 font-semibold text-right">
                          {combinedAmountLabel(
                            summary.deferred.partner_profit_usd ?? 0,
                            summary.deferred.partner_profit_lbp ?? 0,
                            formatAmount,
                          )}
                        </span>
                      </div>
                    )}
                    {((summary.deferred.client_debt_profit_usd ?? 0) !== 0 ||
                      (summary.deferred.client_debt_profit_lbp ?? 0) !== 0) && (
                      <div className="flex justify-between items-center gap-4 border-t border-amber-800/30 pt-2">
                        <span className="flex flex-col">
                          <span>Pending client accounts</span>
                          {/* LIRA-158 D17: this figure is a fusion of two
                              sources by design (see the `deferred` field doc
                              above) — account-charged transaction profit AND
                              cashless-settlement commission, both stranded
                              behind the same uncovered client debt. Named
                              here so it isn't read as a silent regression the
                              day this total grows for a reason unrelated to
                              transaction profit. */}
                          <span
                            data-testid="deferred-client-debt-caption"
                            className="text-[10px] text-amber-500/60 font-normal"
                          >
                            incl. cashless settlement commission awaiting
                            repayment
                          </span>
                        </span>
                        {/* PA-4.7 — same LBP-primary fix as partner
                            settlements above. */}
                        <span
                          data-testid="deferred-client-debt-usd"
                          className="text-amber-300 font-semibold text-right"
                        >
                          {combinedAmountLabel(
                            summary.deferred.client_debt_profit_usd ?? 0,
                            summary.deferred.client_debt_profit_lbp ?? 0,
                            formatAmount,
                          )}
                        </span>
                      </div>
                    )}
                    {/* PA-3.11 — unpaid sales appeared nowhere on the
                        Overview; this is visibility only, never netted into
                        any total above (an unpaid sale's profit is not yet
                        realized). USD-only: a sale's outstanding balance and
                        potential profit are always stamped in USD. */}
                    {(summary.deferred.unpaid_sales_outstanding_usd ?? 0) !==
                      0 && (
                      <div
                        data-testid="deferred-unpaid-sales"
                        className="flex justify-between items-center gap-4 border-t border-amber-800/30 pt-2"
                      >
                        <span className="flex flex-col">
                          <span>Unpaid sales (not counted)</span>
                          {/* LO-V14: this figure comes from the LP-owned,
                              date-independent getPendingSaleProfit() — the
                              all-time outstanding total, not scoped to the
                              date range picked above. Without this caption
                              the card silently opened for a period with no
                              deferred activity of its own whenever ANY
                              old sale anywhere was still unpaid, reading as
                              a period-specific figure. Same wording as the
                              Pending tab's identical caveat (PA-3.8). */}
                          <span
                            data-testid="deferred-unpaid-sales-caption"
                            className="text-[10px] text-amber-500/60 font-normal"
                          >
                            as of now, all dates — not scoped to the range
                            above
                          </span>
                        </span>
                        <span className="text-amber-300 font-semibold text-right">
                          {formatAmount(
                            summary.deferred.unpaid_sales_outstanding_usd ??
                              0,
                            "USD",
                          )}
                          <span className="block text-[11px] text-amber-400/70 font-normal">
                            potential profit{" "}
                            {formatAmount(
                              summary.deferred
                                .unpaid_sales_potential_profit_usd ?? 0,
                              "USD",
                            )}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

            {/* Module breakdown cards */}
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Breakdown by Source
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Sales */}
              <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">
                    Product Sales
                  </span>
                  <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                    {summary.sales.count} sales
                  </span>
                </div>
                <div className="text-xs text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Total Sales</span>
                    <span className="text-white">
                      {formatAmount(summary.sales.revenue_usd, "USD")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cost</span>
                    <span className="text-red-400">
                      -{formatAmount(summary.sales.cost_usd, "USD")}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-700 pt-1">
                    <span className="font-semibold">Profit</span>
                    {/* PA-4.5 — sign-colored, not hard-coded green. */}
                    <span
                      className={`font-semibold ${profitClass(summary.sales.profit_usd)}`}
                    >
                      {formatAmount(summary.sales.profit_usd, "USD")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Financial Services */}
              <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">
                    Financial Services
                  </span>
                  <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
                    {summary.financial_services.count} txns
                  </span>
                </div>
                <div className="text-xs text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Transaction Amount (USD)</span>
                    <span className="text-white">
                      {formatAmount(
                        summary.financial_services.revenue_usd,
                        "USD",
                      )}
                    </span>
                  </div>
                  {summary.financial_services.revenue_lbp > 0 && (
                    <div className="flex justify-between">
                      <span>Transaction Amount (LBP)</span>
                      <span className="text-white">
                        {formatAmount(
                          summary.financial_services.revenue_lbp,
                          "LBP",
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-700 pt-1">
                    <span className="font-semibold">Commission</span>
                    {/* LO-R6 (round 3) — was ONE span colored by
                        commission_usd's sign only. Per-currency spans. */}
                    <span className="font-semibold">
                      <ProfitAmountSpans
                        usd={summary.financial_services.commission_usd}
                        lbp={summary.financial_services.commission_lbp}
                        formatAmount={formatAmount}
                      />
                    </span>
                  </div>
                  {/* PA-2.4 — the cashless (OMT/WHISH post-cutover)
                      settlement commission share, previously only visible
                      under the Supplier Commission card (which is now
                      bills-only — see that card's own comment) while this
                      card's own Commission line read $0 for a model-1
                      period. Already counted in the totals above; a display
                      re-routing, not new money. */}
                  {((summary.financial_services.commission_at_settlement_usd ??
                    0) !== 0 ||
                    (summary.financial_services.commission_at_settlement_lbp ??
                      0) !== 0) && (
                    <div className="flex justify-between">
                      <span>Commission (at settlement)</span>
                      {/* LO-R6 (round 3) — was ONE span colored by the USD
                          component's sign only. Per-currency spans. */}
                      <span>
                        <ProfitAmountSpans
                          usd={
                            summary.financial_services
                              .commission_at_settlement_usd ?? 0
                          }
                          lbp={
                            summary.financial_services
                              .commission_at_settlement_lbp ?? 0
                          }
                          formatAmount={formatAmount}
                        />
                      </span>
                    </div>
                  )}
                  {/* PA-4.10 — a model-0 legacy commission is only
                      recognised once the supplier settlement is entered, so
                      a past period's total can legitimately increase after
                      the fact. */}
                  <p className="text-[10px] text-slate-500 italic">
                    Commission appears when settled; past periods may
                    increase.
                  </p>
                  {(summary.financial_services.pending_commission_usd > 0 ||
                    summary.financial_services.pending_commission_lbp > 0 ||
                    (summary.financial_services.awaiting_settlement_count ??
                      0) > 0 ||
                    (summary.financial_services.pending_revenue_usd ?? 0) !==
                      0 ||
                    (summary.financial_services.pending_revenue_lbp ?? 0) !==
                      0) && (
                    <div className="flex justify-between">
                      <span className="text-yellow-400">Pending</span>
                      <span className="text-yellow-400 text-right">
                        {(summary.financial_services.pending_commission_usd >
                          0 ||
                          summary.financial_services.pending_commission_lbp >
                            0) && (
                          <span className="block">
                            {formatAmount(
                              summary.financial_services.pending_commission_usd,
                              "USD",
                            )}
                            {summary.financial_services
                              .pending_commission_lbp !== 0 &&
                              ` + ${formatAmount(summary.financial_services.pending_commission_lbp, "LBP")}`}
                          </span>
                        )}
                        {/* PA-3.6 — the transaction amount itself, sitting
                            behind an unsettled FS row. Separate from the
                            commission line above: this money is NOT in
                            "Total Revenue" any more (PA-3.6 also stopped
                            folding it into gross revenue), so it needs its
                            own visible line or it simply vanishes from the
                            page instead of showing as pending. */}
                        {((summary.financial_services.pending_revenue_usd ??
                          0) !== 0 ||
                          (summary.financial_services.pending_revenue_lbp ??
                            0) !== 0) && (
                          <span
                            data-testid="overview-finsvc-pending-revenue"
                            className="block text-[11px] text-yellow-500/80 font-normal"
                          >
                            {formatAmount(
                              summary.financial_services.pending_revenue_usd ??
                                0,
                              "USD",
                            )}
                            {(summary.financial_services.pending_revenue_lbp ??
                              0) !== 0 &&
                              ` + ${formatAmount(summary.financial_services.pending_revenue_lbp ?? 0, "LBP")}`}{" "}
                            pending revenue
                          </span>
                        )}
                        {/* LIRA-162: D15's model-1 count — the ONLY honest
                            figure once the legacy dollar total above is 0
                            (an all-post-cutover period). Without this, the
                            "> 0" guard above never fired for such a period
                            and the whole Pending line silently didn't render
                            at all — worse than a $0.00, since nothing hinted
                            the commission existed. */}
                        {(summary.financial_services
                          .awaiting_settlement_count ?? 0) > 0 && (
                          <span
                            data-testid="overview-finsvc-awaiting-settlement"
                            className="block text-[11px] text-yellow-500/80 font-normal"
                          >
                            {
                              summary.financial_services
                                .awaiting_settlement_count
                            }{" "}
                            awaiting settlement
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  {/* Owner decision (h), 2026-09-24 afternoon
                      (OWNER_NOTES_2026-09-21.md §6.9, L0-4) — recognised FS
                      commission whose underlying transfer is still charged
                      to a customer's account and not yet repaid (excluded
                      from the Commission line above by the SAME
                      notDebtPending gate that excludes it from gross/net —
                      see ProfitRepository.getFinancialWaitingForRepaymentByCurrency's
                      own doc comment). Hidden when zero, same convention as
                      this card's other lines — never counted in gross/net. */}
                  {((summary.financial_services.waiting_for_repayment_usd ??
                    0) !== 0 ||
                    (summary.financial_services.waiting_for_repayment_lbp ??
                      0) !== 0) && (
                    <div
                      data-testid="overview-finsvc-waiting-for-repayment"
                      className="flex justify-between"
                    >
                      <span className="text-yellow-400">
                        Waiting for repayment
                      </span>
                      <span className="text-yellow-400">
                        <ProfitAmountSpans
                          usd={
                            summary.financial_services
                              .waiting_for_repayment_usd ?? 0
                          }
                          lbp={
                            summary.financial_services
                              .waiting_for_repayment_lbp ?? 0
                          }
                          formatAmount={formatAmount}
                        />
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* PA-4.9 — Payment Method Fees used to render inside the
                  Financial Services card, but the underlying total includes
                  iPick/Katsh/BOB wallet-surcharge fees too — money that has
                  nothing to do with OMT/Whish transfers. Own card. */}
              {((summary.financial_services.pm_fee_usd ?? 0) !== 0 ||
                (summary.financial_services.pm_fee_lbp ?? 0) !== 0) && (
                <div
                  data-testid="overview-pm-fee-card"
                  className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      Payment Method Fees
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    <div className="flex justify-between border-t border-slate-700 pt-1">
                      <span className="font-semibold">Kept by shop</span>
                      {/* LO-R6 (round 3) — was ONE span colored by the USD
                          component's sign only. Per-currency spans. */}
                      <span className="font-semibold">
                        <ProfitAmountSpans
                          usd={summary.financial_services.pm_fee_usd ?? 0}
                          lbp={summary.financial_services.pm_fee_lbp ?? 0}
                          formatAmount={formatAmount}
                        />
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Mobile Services (iPick, Katsh, BOB) */}
              {summary.mobile_services && (
                <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      Mobile Services
                    </span>
                    <span className="text-xs bg-pink-500/20 text-pink-400 px-2 py-0.5 rounded-full">
                      {summary.mobile_services.count} txns
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    {/* PA-4.3 — used to pick ONE currency (whichever had an
                        LBP balance) and hide the other entirely; now shows
                        both simultaneously, like Maintenance. */}
                    <div className="flex justify-between">
                      <span>Charged Amount</span>
                      <span className="text-white">
                        {combinedAmountLabel(
                          summary.mobile_services.revenue_usd,
                          summary.mobile_services.revenue_lbp,
                          formatAmount,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cost</span>
                      <span className="text-red-400">
                        -
                        {combinedAmountLabel(
                          summary.mobile_services.cost_usd,
                          summary.mobile_services.cost_lbp,
                          formatAmount,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-700 pt-1">
                      <span className="font-semibold">Profit</span>
                      {/* LO-V9 — each currency colored by ITS OWN sign, not
                          by whichever happened to be nonzero (that painted a
                          USD loss green whenever LBP was positive). */}
                      <span className="font-semibold">
                        <ProfitAmountSpans
                          usd={summary.mobile_services.profit_usd}
                          lbp={summary.mobile_services.profit_lbp}
                          formatAmount={formatAmount}
                        />
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Custom Services */}
              <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">
                    Custom Services
                  </span>
                  <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                    {summary.custom_services.count} jobs
                  </span>
                </div>
                <div className="text-xs text-slate-400 space-y-1">
                  {/* PA-4.2 — was USD-only; custom_services.revenue_lbp/
                      cost_lbp/profit_lbp were already returned and simply
                      never rendered. */}
                  <div className="flex justify-between">
                    <span>Charged Amount</span>
                    <span className="text-white">
                      {combinedAmountLabel(
                        summary.custom_services.revenue_usd,
                        summary.custom_services.revenue_lbp,
                        formatAmount,
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cost</span>
                    <span className="text-red-400">
                      -
                      {combinedAmountLabel(
                        summary.custom_services.cost_usd,
                        summary.custom_services.cost_lbp,
                        formatAmount,
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-700 pt-1">
                    <span className="font-semibold">Profit</span>
                    {/* LO-V9 — see Mobile Services' identical fix above. */}
                    <span className="font-semibold">
                      <ProfitAmountSpans
                        usd={summary.custom_services.profit_usd}
                        lbp={summary.custom_services.profit_lbp}
                        formatAmount={formatAmount}
                      />
                    </span>
                  </div>
                </div>
              </div>

              {/* Recharges */}
              {summary.recharges && summary.recharges.count > 0 && (
                <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      Mobile Recharges
                    </span>
                    <span className="text-xs bg-teal-500/20 text-teal-400 px-2 py-0.5 rounded-full">
                      {summary.recharges.count} txns
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    {/* PA-4.1 — was USD-only; recharges.revenue_lbp/
                        cost_lbp/profit_lbp were already returned and simply
                        never rendered. */}
                    <div className="flex justify-between">
                      <span>Charged Amount</span>
                      <span className="text-white">
                        {combinedAmountLabel(
                          summary.recharges.revenue_usd,
                          summary.recharges.revenue_lbp,
                          formatAmount,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cost</span>
                      <span className="text-red-400">
                        -
                        {combinedAmountLabel(
                          summary.recharges.cost_usd,
                          summary.recharges.cost_lbp,
                          formatAmount,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-700 pt-1">
                      <span className="font-semibold">Profit</span>
                      {/* LO-V9 — see Mobile Services' identical fix above. */}
                      <span className="font-semibold">
                        <ProfitAmountSpans
                          usd={summary.recharges.profit_usd}
                          lbp={summary.recharges.profit_lbp}
                          formatAmount={formatAmount}
                        />
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Maintenance */}
              <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">
                    Maintenance
                  </span>
                  <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                    {summary.maintenance.count} jobs
                  </span>
                </div>
                <div className="text-xs text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Charged Amount</span>
                    <span className="text-white">
                      {formatAmount(summary.maintenance.revenue_usd, "USD")}
                      {(summary.maintenance.revenue_lbp ?? 0) > 0 &&
                        ` + ${formatAmount(summary.maintenance.revenue_lbp, "LBP")}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cost</span>
                    <span className="text-red-400">
                      -{formatAmount(summary.maintenance.cost_usd, "USD")}
                      {(summary.maintenance.cost_lbp ?? 0) > 0 &&
                        ` − ${formatAmount(summary.maintenance.cost_lbp, "LBP")}`}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-700 pt-1">
                    <span className="font-semibold">Profit</span>
                    {/* LO-V9 — see Mobile Services' identical fix above. */}
                    <span className="font-semibold">
                      <ProfitAmountSpans
                        usd={summary.maintenance.profit_usd}
                        lbp={summary.maintenance.profit_lbp ?? 0}
                        formatAmount={formatAmount}
                      />
                    </span>
                  </div>
                </div>
              </div>

              {/* Loto */}
              {summary.loto && summary.loto.count > 0 && (
                <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      Loto Tickets
                    </span>
                    <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                      {summary.loto.count} tickets
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    <div className="flex justify-between">
                      <span>Ticket Sales</span>
                      <span className="text-white">
                        {formatAmount(summary.loto.revenue_lbp, "LBP")}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-700 pt-1">
                      <span className="font-semibold">Commission</span>
                      <span
                        className={`font-semibold ${profitClass(summary.loto.profit_lbp)}`}
                      >
                        {formatAmount(summary.loto.profit_lbp, "LBP")}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Exchange */}
              {summary.exchange && summary.exchange.count > 0 && (
                <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      Currency Exchange
                    </span>
                    <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded-full">
                      {summary.exchange.count} txns
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    <div className="flex justify-between">
                      <span>Volume</span>
                      <span className="text-white">
                        {formatAmount(summary.exchange.revenue_usd, "USD")}
                      </span>
                    </div>
                    {/* PA-4.11 — Volume only ever counts the USD pair; an
                        LBP-only or EUR-side exchange leg is invisible here.
                        Named rather than fixed (the audit marks this a
                        caption-only ask). */}
                    <p className="text-[10px] text-slate-500 italic">
                      Volume counts USD-paired exchanges only.
                    </p>
                    <div className="flex justify-between border-t border-slate-700 pt-1">
                      <span className="font-semibold">Profit</span>
                      <span
                        className={`font-semibold ${profitClass(summary.exchange.profit_usd)}`}
                      >
                        {formatAmount(summary.exchange.profit_usd, "USD")}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* PA-2.3 — TELECOM_CREDIT_BUYBACK + RECHARGE_TOPUP profit,
                  previously invisible on the Overview though already counted
                  in By Cashier/By Client. Profit-only, same card pattern as
                  Discounts/Supplier Commission below. */}
              {summary.topups_buybacks &&
                (summary.topups_buybacks.count > 0 ||
                  summary.topups_buybacks.profit_usd !== 0 ||
                  summary.topups_buybacks.profit_lbp !== 0) && (
                  <div
                    data-testid="overview-topups-buybacks-card"
                    className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">
                        Top-ups / Buybacks
                      </span>
                      <span className="text-xs bg-teal-500/20 text-teal-400 px-2 py-0.5 rounded-full">
                        {summary.topups_buybacks.count} txns
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 space-y-1">
                      {summary.topups_buybacks.profit_usd !== 0 && (
                        <div className="flex justify-between">
                          <span className="font-semibold">USD</span>
                          <span
                            className={`font-semibold ${profitClass(summary.topups_buybacks.profit_usd)}`}
                          >
                            {formatAmount(
                              summary.topups_buybacks.profit_usd,
                              "USD",
                            )}
                          </span>
                        </div>
                      )}
                      {summary.topups_buybacks.profit_lbp !== 0 && (
                        <div className="flex justify-between">
                          <span className="font-semibold">LBP</span>
                          <span
                            className={`font-semibold ${profitClass(summary.topups_buybacks.profit_lbp)}`}
                          >
                            {formatAmount(
                              summary.topups_buybacks.profit_lbp,
                              "LBP",
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {/* Other / kept change (T3): change the operator kept instead of
                  returning, stamped on debt repayments. Owner decision
                  2026-07-13 — visible as its own line, per currency.
                  PA-4.6 — a negative net (a REFUND reversal outweighing the
                  period's kept-change gains) used to be invisible: the
                  ">0" guards below hid it instead of showing a loss in red.
                  LO-V1 (round 2) — this card used to show ONLY debt-repayment
                  kept change; a sale's own LBP kept change (`sales.profit_lbp`)
                  and the off-currency kept change on a recharge/mobile-
                  service/loto row (`kept_change.usd/_lbp`, already folded
                  into gross server-side) were computed but never rendered
                  anywhere. The gate now also opens for either of those two
                  sources alone, so a period with ONLY a sale's kept change
                  (and no debt-repayment kept change at all) still shows this
                  card instead of vanishing. */}
              {(summary.debt_repayments &&
                (summary.debt_repayments.count > 0 ||
                  summary.debt_repayments.profit_usd !== 0 ||
                  summary.debt_repayments.profit_lbp !== 0)) ||
              (summary.sales.profit_lbp ?? 0) !== 0 ||
              (summary.kept_change &&
                ((summary.kept_change.usd ?? 0) !== 0 ||
                  (summary.kept_change.lbp ?? 0) !== 0)) ? (
                <div
                  data-testid="overview-kept-change-card"
                  className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      Other / Kept Change
                    </span>
                    {summary.debt_repayments &&
                      summary.debt_repayments.count > 0 && (
                        <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                          {summary.debt_repayments.count} repayments
                        </span>
                      )}
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    {summary.debt_repayments &&
                      summary.debt_repayments.profit_usd !== 0 && (
                        <div className="flex justify-between">
                          <span className="font-semibold">
                            Debt repayment kept (USD)
                          </span>
                          <span
                            className={`font-semibold ${profitClass(summary.debt_repayments.profit_usd)}`}
                          >
                            {formatAmount(
                              summary.debt_repayments.profit_usd,
                              "USD",
                            )}
                          </span>
                        </div>
                      )}
                    {summary.debt_repayments &&
                      summary.debt_repayments.profit_lbp !== 0 && (
                        <div className="flex justify-between">
                          <span className="font-semibold">
                            Debt repayment kept (LBP)
                          </span>
                          <span
                            className={`font-semibold ${profitClass(summary.debt_repayments.profit_lbp)}`}
                          >
                            {formatAmount(
                              summary.debt_repayments.profit_lbp,
                              "LBP",
                            )}
                          </span>
                        </div>
                      )}
                    {/* LO-V1 — a sale's own LBP kept change (the ONLY LBP
                        profit a sale ever carries). */}
                    {(summary.sales.profit_lbp ?? 0) !== 0 && (
                      <div
                        className="flex justify-between"
                        data-testid="kept-change-sales-lbp"
                      >
                        <span className="font-semibold">
                          Sale kept change (LBP)
                        </span>
                        <span
                          className={`font-semibold ${profitClass(summary.sales.profit_lbp ?? 0)}`}
                        >
                          {formatAmount(summary.sales.profit_lbp ?? 0, "LBP")}
                        </span>
                      </div>
                    )}
                    {/* LO-V1 — off-currency kept change on a recharge,
                        mobile-service or loto transaction (e.g. a USD
                        recharge tendered with LBP kept as change). Already
                        counted in the period's gross profit — this is
                        visibility only. */}
                    {summary.kept_change &&
                      (summary.kept_change.usd ?? 0) !== 0 && (
                        <div
                          className="flex justify-between"
                          data-testid="kept-change-other-usd"
                        >
                          <span className="font-semibold">
                            Recharge/service/loto kept change (USD)
                          </span>
                          <span
                            className={`font-semibold ${profitClass(summary.kept_change.usd)}`}
                          >
                            {formatAmount(summary.kept_change.usd, "USD")}
                          </span>
                        </div>
                      )}
                    {summary.kept_change &&
                      (summary.kept_change.lbp ?? 0) !== 0 && (
                        <div
                          className="flex justify-between"
                          data-testid="kept-change-other-lbp"
                        >
                          <span className="font-semibold">
                            Recharge/service/loto kept change (LBP)
                          </span>
                          <span
                            className={`font-semibold ${profitClass(summary.kept_change.lbp)}`}
                          >
                            {formatAmount(summary.kept_change.lbp, "LBP")}
                          </span>
                        </div>
                      )}
                  </div>
                </div>
              ) : null}

              {/* Discounts (CQ-10, D1): signed profit — negative when the
                  shop forgave a client/partner debt, positive when a
                  supplier forgave part of what we owed them. Already folded
                  into the totals above; this is a visibility breakout. */}
              {summary.discounts &&
                (summary.discounts.usd !== 0 ||
                  summary.discounts.lbp !== 0) && (
                  <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">
                        Discounts
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 space-y-1">
                      {summary.discounts.usd !== 0 && (
                        <div className="flex justify-between">
                          <span className="font-semibold">USD</span>
                          <span
                            className={`font-semibold ${
                              summary.discounts.usd > 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {formatAmount(summary.discounts.usd, "USD")}
                          </span>
                        </div>
                      )}
                      {summary.discounts.lbp !== 0 && (
                        <div className="flex justify-between">
                          <span className="font-semibold">LBP</span>
                          <span
                            className={`font-semibold ${
                              summary.discounts.lbp > 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {formatAmount(summary.discounts.lbp, "LBP")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {/* Supplier commission (LIRA-137 fix): BILLS-ONLY Katsh/iPick
                  settlement commission (PA-2.4 — the cashless OMT/Whish
                  share now lives on the Financial Services card's
                  "Commission (at settlement)" line instead), entered at
                  settlement and stamped directly on the SUPPLIER_SETTLEMENT
                  transaction. Already folded into the totals above; this is
                  a visibility breakout.
                  LIRA-158 D17: `count` now counts only settlements that
                  contributed RECOGNISED commission (see the field's doc
                  comment above) — a cashless settlement that deferred in
                  full contributes count 0 / profit 0 even though it
                  happened. Rendering nothing in that case would look
                  identical to "no settlements at all", which is no longer
                  true, so a fully-deferred window renders a small pointer
                  to the Deferred Profit card instead of vanishing —
                  chosen over silence because the whole point of D17 is that
                  this money must stay visible SOMEWHERE, and this card is
                  where the operator already looks for it.
                  PA-3.10 — that pointer used to gate on
                  `deferred.client_debt_profit_usd/_lbp`, which ALSO carries
                  ordinary debt-pending recharge/service/loto/maintenance
                  profit that has nothing to do with a cashless settlement —
                  so the pointer wrongly rendered for any period with plain
                  unpaid debt, even one with zero settlements at all. Gated
                  on `cashless_deferred_profit_usd/_lbp` alone now — the D17
                  share, and nothing else. */}
              {summary.supplier_commission &&
                (summary.supplier_commission.count > 0 ||
                summary.supplier_commission.profit_usd !== 0 ||
                summary.supplier_commission.profit_lbp !== 0 ? (
                  <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">
                        Supplier Commission
                      </span>
                      <span
                        data-testid="supplier-commission-count"
                        className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full"
                      >
                        {summary.supplier_commission.count} settlements
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 space-y-1">
                      {summary.supplier_commission.profit_usd !== 0 && (
                        <div className="flex justify-between">
                          <span className="font-semibold">USD</span>
                          <span
                            data-testid="supplier-commission-usd"
                            className={`font-semibold ${profitClass(summary.supplier_commission.profit_usd)}`}
                          >
                            {formatAmount(
                              summary.supplier_commission.profit_usd,
                              "USD",
                            )}
                          </span>
                        </div>
                      )}
                      {summary.supplier_commission.profit_lbp !== 0 && (
                        <div className="flex justify-between">
                          <span className="font-semibold">LBP</span>
                          <span
                            className={`font-semibold ${profitClass(summary.supplier_commission.profit_lbp)}`}
                          >
                            {formatAmount(
                              summary.supplier_commission.profit_lbp,
                              "LBP",
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  ((summary.deferred?.cashless_deferred_profit_usd ?? 0) !==
                    0 ||
                    (summary.deferred?.cashless_deferred_profit_lbp ?? 0) !==
                      0) && (
                    <div
                      data-testid="supplier-commission-fully-deferred"
                      className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white">
                          Supplier Commission
                        </span>
                        <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                          Deferred
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        No commission recognised this period — this period's
                        cashless settlements are deferred until the client
                        repays. See Deferred Profit above.
                      </p>
                    </div>
                  )
                ))}
            </div>

            {/* Expense breakdown */}
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-white">
                  Expenses Deducted
                </span>
                <span className="text-xs text-slate-400">
                  {summary.expenses.count} entries
                </span>
              </div>
              {/* LO-V9 — the USD column used to render unconditionally, so
                  an LBP-only period showed a fabricated "USD: -$0.00"
                  alongside the real LBP figure. Hidden now whenever LBP
                  carried the period's expenses alone (same convention as
                  combinedAmountLabel/PA-4.7) — a genuinely all-zero period
                  still shows "USD: -$0.00", since there is nothing else to
                  show instead. */}
              <div className="flex gap-6 text-sm">
                {(summary.expenses.total_usd !== 0 ||
                  summary.expenses.total_lbp === 0) && (
                  <div>
                    <span className="text-slate-400">USD: </span>
                    <span className="text-red-400 font-semibold">
                      -{formatAmount(summary.expenses.total_usd, "USD")}
                    </span>
                  </div>
                )}
                {summary.expenses.total_lbp !== 0 && (
                  <div>
                    <span className="text-slate-400">LBP: </span>
                    <span className="text-red-400 font-semibold">
                      -{formatAmount(summary.expenses.total_lbp, "LBP")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================== By Module Tab ==================== */}
        {!loading && tab === "by-module" && byModuleError && (
          // PA-4.16: a visible error state, distinct from the empty-data
          // message the DataTable shows for a real no-activity period.
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300"
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-400" />
            <div>
              <p className="font-medium text-red-200">
                Failed to load profit by module
              </p>
              <p className="mt-0.5 text-red-400/80">{byModuleError}</p>
            </div>
          </div>
        )}
        {!loading && tab === "by-module" && !byModuleError && (
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
            {/* PA-4.12 — Count 0 on an allocation-only row (e.g. the
                cashless share folded into a FINANCIAL_SERVICE_<provider> row
                via a settlement allocation join) is not "nothing happened" —
                it means the money arrived through a settlement, not a
                directly counted transaction. Named once here rather than a
                per-row tooltip nobody hovers. */}
            <p className="px-4 pt-3 text-[10px] text-slate-500 italic">
              A row with Count 0 but nonzero profit was allocated at
              settlement, not counted transaction-by-transaction.
            </p>
            <DataTable<ModuleRow>
              columns={[
                { header: "Module", className: "text-left px-4 py-3" },
                { header: "Revenue (USD)", className: "text-right px-4 py-3" },
                { header: "Revenue (LBP)", className: "text-right px-4 py-3" },
                { header: "Cost (USD)", className: "text-right px-4 py-3" },
                { header: "Cost (LBP)", className: "text-right px-4 py-3" },
                { header: "Profit (USD)", className: "text-right px-4 py-3" },
                { header: "Profit (LBP)", className: "text-right px-4 py-3" },
                { header: "Count", className: "text-right px-4 py-3" },
                { header: "Margin", className: "text-right px-4 py-3" },
              ]}
              data={byModule}
              exportExcel
              exportPdf
              exportFilename="profit-by-module"
              className="w-full text-sm"
              theadClassName="border-b border-slate-700 text-slate-400 text-xs uppercase"
              emptyMessage="No data for this period"
              // PA-4.12 — TOTAL footer row: Σ revenue/cost/profit per
              // currency across every module, plus a combined USD+LBP
              // margin when an LBP rate is configured (never fabricated —
              // see computeMargin/formatMargin).
              footerContent={
                byModule.length > 0
                  ? (() => {
                      const totalRevenueUsd = byModule.reduce(
                        (s, r) => s + r.revenue_usd,
                        0,
                      );
                      const totalRevenueLbp = byModule.reduce(
                        (s, r) => s + r.revenue_lbp,
                        0,
                      );
                      const totalCostUsd = byModule.reduce(
                        (s, r) => s + (r.cost_usd ?? 0),
                        0,
                      );
                      const totalCostLbp = byModule.reduce(
                        (s, r) => s + (r.cost_lbp ?? 0),
                        0,
                      );
                      // LO-R3 (round 3 adversarial review) — a row's
                      // kept_change_usd/_lbp is ADDITIVE, not already folded
                      // into that row's own profit_usd/profit_lbp (see
                      // ModuleRow.kept_change_usd's doc comment above), so
                      // summing profit_usd/profit_lbp alone silently
                      // dropped every FS-commission/recharge/mobile/loto
                      // row's off-currency kept change from the TOTAL
                      // column — leaving TOTAL profit disagree with the
                      // Overview's gross (and with the net row rendered
                      // directly beneath it) by exactly that amount. Folded
                      // in here, the same way the core PA-2.10
                      // reconciliation test's own Σ does it.
                      const totalKeptChangeUsd = byModule.reduce(
                        (s, r) => s + (r.kept_change_usd ?? 0),
                        0,
                      );
                      const totalKeptChangeLbp = byModule.reduce(
                        (s, r) => s + (r.kept_change_lbp ?? 0),
                        0,
                      );
                      const totalProfitUsd =
                        byModule.reduce((s, r) => s + r.profit_usd, 0) +
                        totalKeptChangeUsd;
                      const totalProfitLbp =
                        byModule.reduce((s, r) => s + r.profit_lbp, 0) +
                        totalKeptChangeLbp;
                      const totalCount = byModule.reduce(
                        (s, r) => s + r.count,
                        0,
                      );
                      // note #3 (2026-09-24, CLOSED "no change") — the field
                      // this read (`combined_rate_used`) was removed along
                      // with the combined net-profit line; `lbp_buy_rate` is
                      // the SAME tenant-scoped LBP buy_rate, kept ONLY to
                      // weight this TOTAL row's mixed-currency margin_pct
                      // (LIRA-183), never to compute a combined figure again.
                      const buyRate = summary?.totals.lbp_buy_rate ?? null;
                      const hasUsd =
                        totalRevenueUsd !== 0 || totalProfitUsd !== 0;
                      const hasLbp =
                        totalRevenueLbp !== 0 || totalProfitLbp !== 0;
                      const mixed = hasUsd && hasLbp;
                      const totalMarginPct = mixed
                        ? buyRate
                          ? ((totalProfitLbp + totalProfitUsd * buyRate) /
                              (totalRevenueLbp + totalRevenueUsd * buyRate ||
                                1)) *
                            100
                          : null
                        : hasLbp
                          ? totalRevenueLbp !== 0
                            ? (totalProfitLbp / totalRevenueLbp) * 100
                            : null
                          : totalRevenueUsd !== 0
                            ? (totalProfitUsd / totalRevenueUsd) * 100
                            : null;
                      // LO-V4 (round 2 adversarial review) — the spec asks
                      // for a footer with "Σ gross − expenses = net (+ the
                      // combined line)"; the TOTAL row above only ever
                      // summed revenue/cost/profit/count and a margin, with
                      // no expenses, no net and no combined figure at all.
                      // Sourced from `summary.totals`/`summary.expenses`
                      // (getProfitSummary, co-fetched for this tab — see
                      // LO-R1/LO-V8's fix on the tab-switch effect) rather
                      // than re-derived from the visible rows: that is the
                      // SAME Gross/Expenses/Net the Overview headline shows
                      // for this period, so the two tabs never disagree
                      // with each other about what "net" means. (The
                      // former "narrow gap" noted here — a commission row's
                      // own off-currency kept change missing from the
                      // Overview's gross — is CLOSED as of LO-R2/LO-R3: the
                      // server now folds it into `summary.totals` and the
                      // TOTAL row above now folds the same rows' own
                      // kept_change_usd/_lbp in too, so the two figures
                      // agree again.)
                      //
                      // LO-R1 / LO-V8 (round 3) — `summary` is now refetched
                      // whenever THIS tab's date range changes (see the
                      // tab-switch effect), but a fetch in flight (or one
                      // that fails) can still leave `summary` holding a
                      // PREVIOUS period's response for a moment. Comparing
                      // `summary.period` against the range actually showing
                      // on screen right now catches that window and falls
                      // back to the same named "—"/error state used for a
                      // hard failure, instead of ever rendering a stale
                      // period's numbers beside this render's TOTAL row.
                      const summaryMatchesRange =
                        !!summary && summary.period === `${from} to ${to}`;
                      const netUsd = summaryMatchesRange
                        ? summary!.totals.net_profit_usd
                        : null;
                      const netLbp = summaryMatchesRange
                        ? summary!.totals.net_profit_lbp
                        : null;
                      return (
                        <>
                          <tr
                            data-testid="by-module-total-row"
                            className="border-t-2 border-slate-600 bg-slate-800/80 font-bold"
                          >
                            <td className="px-4 py-3 text-white">TOTAL</td>
                            <td className="px-4 py-3 text-right text-white">
                              {formatAmount(totalRevenueUsd, "USD")}
                            </td>
                            <td className="px-4 py-3 text-right text-white">
                              {totalRevenueLbp !== 0
                                ? formatAmount(totalRevenueLbp, "LBP")
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-red-400">
                              {formatAmount(totalCostUsd, "USD")}
                            </td>
                            <td className="px-4 py-3 text-right text-red-400">
                              {totalCostLbp !== 0
                                ? formatAmount(totalCostLbp, "LBP")
                                : "—"}
                            </td>
                            <td
                              className={`px-4 py-3 text-right ${profitClass(totalProfitUsd)}`}
                            >
                              {formatAmount(totalProfitUsd, "USD")}
                            </td>
                            <td
                              className={`px-4 py-3 text-right ${profitClass(totalProfitLbp)}`}
                            >
                              {totalProfitLbp !== 0
                                ? formatAmount(totalProfitLbp, "LBP")
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-300">
                              {totalCount}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-300">
                              {formatMargin(totalMarginPct, mixed)}
                            </td>
                          </tr>
                          <tr
                            data-testid="by-module-net-row"
                            className="border-t border-slate-700 bg-slate-900/40"
                          >
                            <td
                              colSpan={9}
                              className="px-4 py-2 text-xs text-slate-400"
                            >
                              {summaryMatchesRange ? (
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span>
                                    {combinedAmountLabel(
                                      summary!.totals.gross_profit_usd,
                                      summary!.totals.gross_profit_lbp,
                                      formatAmount,
                                    )}
                                  </span>
                                  <span className="text-slate-500">
                                    (Gross)
                                  </span>
                                  <span className="text-slate-500">−</span>
                                  <span className="text-red-400">
                                    {combinedAmountLabel(
                                      summary!.expenses.total_usd,
                                      summary!.expenses.total_lbp,
                                      formatAmount,
                                    )}
                                  </span>
                                  <span className="text-slate-500">
                                    (Expenses)
                                  </span>
                                  <span className="text-slate-500">=</span>
                                  {/* LO-R6 (round 3) — was ONE span colored
                                      by netUsd's sign only, so an LBP-only
                                      net LOSS rendered neutral grey instead
                                      of red. Per-currency spans, matching
                                      the headline equation's own LO-R6
                                      fix. */}
                                  <span
                                    data-testid="by-module-net-value"
                                    className="font-semibold"
                                  >
                                    <ProfitAmountSpans
                                      usd={netUsd ?? 0}
                                      lbp={netLbp ?? 0}
                                      formatAmount={formatAmount}
                                    />
                                  </span>
                                  <span className="text-slate-500">
                                    (Net)
                                  </span>
                                  {/* note #3 (2026-09-24, CLOSED "no
                                      change") — the "≈ X LBP combined (at
                                      buy rate N)" figure that used to sit
                                      here is REMOVED: net_profit_usd/
                                      net_profit_lbp above stay separate
                                      per-currency figures, never folded
                                      into one number. */}
                                </span>
                              ) : (
                                <span className="italic">
                                  {summaryError
                                    ? `Expenses/rate unavailable (${summaryError})`
                                    : "—"}
                                </span>
                              )}
                            </td>
                          </tr>
                        </>
                      );
                    })()
                  : undefined
              }
              renderRow={(row) => {
                const isExpanded = expandedModules.has(row.module);
                const isMaintenance = row.module === "MAINTENANCE";
                // PFU-a-3 — the SALE row's sale_kept_change_usd/_lbp
                // (ProfitService.getByModule) is DERIVED as
                // `profit − (revenue − cost)`, the exact residual T3
                // keep-change adds to this row's OWN profit stamp — a
                // DIFFERENT field from every other module's kept_change_usd/
                // _lbp (off-currency money already counted elsewhere,
                // rendered as the separate note below; NOT already inside
                // that row's own profit — see ProfitByModule's own doc
                // comment on both fields in ProfitService.ts). SALE renders
                // its own residual INSIDE the equation instead
                // (`revenue − cost + kept change = profit`); the generic
                // off-currency note never fires for SALE since it never
                // populates the generic kept_change_usd/_lbp fields.
                const isSale = row.module === "SALE";
                // PA-4.23 (a) — which detail line this row's expanded
                // USD/LBP blocks render: the Revenue − Cost = Profit
                // equation (a real priced module — SALE, RECHARGE_*,
                // CUSTOM_SERVICE, MAINTENANCE, PM_FEE, the cost/price mobile
                // providers, and EXCHANGE, a real spread — PFU-doc-stale:
                // EXCHANGE was previously miscategorized here as a
                // commission row; it is EQUATION, per
                // classifyProfitModuleRow's own doc comment, PFU-a-4), a bare
                // "Commission: <amount>" (pass-through principal — OMT/WHISH/
                // OMT_APP/WHISH_APP/BINANCE/loto), or a bare "Profit:
                // <amount>" (no revenue/cost pair at all — kept change,
                // discounts, supplier commission, top-up fees). See
                // classifyProfitModuleRow's own doc comment for the full
                // rationale.
                const rowClass = classifyProfitModuleRow(row.module);
                const hasCost =
                  (row.cost_usd ?? 0) !== 0 || (row.cost_lbp ?? 0) !== 0;
                // LO-V11 (round 2) — DataTable maps rows straight into
                // `<tbody>` with no key of its own; a bare `<>` Fragment
                // here (wrapping the row + its optional expanded-detail
                // row) had no key, so React logged a missing-key warning on
                // every render of this table.
                return (
                  <Fragment key={row.module}>
                    <tr
                      className="border-b border-slate-700/50 hover:bg-slate-700/30"
                    >
                      <td className="px-4 py-3 font-medium text-white">
                        {/* PA-4.23 — expandable row: click to see
                            Revenue − Cost = Profit per currency, and for
                            Maintenance, the parts/labour split that has
                            always been computed but never rendered
                            (LIRA-176). */}
                        <button
                          type="button"
                          data-testid={`by-module-expand-${row.module}`}
                          onClick={() =>
                            setExpandedModules((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.module)) {
                                next.delete(row.module);
                              } else {
                                next.add(row.module);
                              }
                              return next;
                            })
                          }
                          className="inline-flex items-center gap-1.5 text-left hover:text-blue-400"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
                          )}
                          {row.label}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right text-white">
                        {formatAmount(row.revenue_usd, "USD")}
                      </td>
                      <td className="px-4 py-3 text-right text-white">
                        {row.revenue_lbp > 0
                          ? formatAmount(row.revenue_lbp, "LBP")
                          : "—"}
                      </td>
                      {/* PA-2.9 — cost by currency, previously hard-coded 0
                          for every FS-provider row. */}
                      <td className="px-4 py-3 text-right text-red-400">
                        {(row.cost_usd ?? 0) !== 0
                          ? formatAmount(row.cost_usd ?? 0, "USD")
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-red-400">
                        {(row.cost_lbp ?? 0) !== 0
                          ? formatAmount(row.cost_lbp ?? 0, "LBP")
                          : "—"}
                      </td>
                      {/* PA-4.5 — sign-colored, not hard-coded green. */}
                      <td
                        className={`px-4 py-3 text-right font-medium ${profitClass(row.profit_usd)}`}
                      >
                        {formatAmount(row.profit_usd, "USD")}
                      </td>
                      {/* LIRA-153 — a LOSS must be visible. This used to render
                          any non-positive total as an em dash, which made a
                          negative module profit indistinguishable from "no data":
                          the owner watched Mobile Services go from "96,000 LBP" to
                          "—" after one mis-stamped Only-Days sale and had no way to
                          tell the figure had gone negative. Only an exact ZERO is
                          an em dash now; negatives render in red, matching how the
                          USD column has always behaved (formatAmount is
                          unconditional there). */}
                      <td
                        className={`px-4 py-3 text-right ${profitClass(row.profit_lbp)}`}
                      >
                        {row.profit_lbp !== 0
                          ? formatAmount(row.profit_lbp, "LBP")
                          : "—"}
                      </td>
                      <td
                        className="px-4 py-3 text-right text-slate-300"
                        title={
                          row.count === 0
                            ? "Allocated at settlement — no distinct transactions counted here"
                            : undefined
                        }
                      >
                        {row.count}
                      </td>
                      {/* PA-4.21 — server-computed margin (falls back to the
                          old client-side USD-only formatPct only when an
                          older cached payload has no margin_pct at all). */}
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.margin_pct !== undefined
                          ? formatMargin(row.margin_pct, row.margin_converted)
                          : formatPct(row.profit_usd, row.revenue_usd)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr
                        key={`${row.module}-detail`}
                        data-testid={`by-module-detail-${row.module}`}
                        className="border-b border-slate-700/50 bg-slate-900/40"
                      >
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-400">
                            <div>
                              <p className="font-semibold text-slate-300 mb-1">
                                USD
                              </p>
                              <p data-testid={`by-module-detail-${row.module}-usd`}>
                                {rowClass === PROFIT_ROW_CLASS.EQUATION ? (
                                  <>
                                    {formatAmount(row.revenue_usd, "USD")} −{" "}
                                    {formatAmount(row.cost_usd ?? 0, "USD")}
                                    {isSale &&
                                      (row.sale_kept_change_usd ?? 0) !==
                                        0 && (
                                        <>
                                          {" "}
                                          {(row.sale_kept_change_usd ?? 0) > 0
                                            ? "+"
                                            : "−"}{" "}
                                          {formatAmount(
                                            Math.abs(
                                              row.sale_kept_change_usd ?? 0,
                                            ),
                                            "USD",
                                          )}{" "}
                                          {/* PFU-a-3-residual (verifier
                                              round 2) — this residual
                                              (profit − (revenue − cost)) is
                                              only KNOWN to be kept change
                                              when positive; a negative value
                                              means the ledger stamp and the
                                              sale_items margin disagree for
                                              some other reason (e.g. a
                                              stale/wrong-cost stamp), so it
                                              is labeled an unexplained
                                              difference instead of asserted
                                              to be kept change — see
                                              ProfitByModule
                                              .sale_kept_change_usd's own doc
                                              comment (ProfitService.ts). */}
                                          {(row.sale_kept_change_usd ?? 0) > 0
                                            ? "kept change"
                                            : "unexplained difference"}
                                        </>
                                      )}{" "}
                                    ={" "}
                                    <span
                                      className={profitClass(row.profit_usd)}
                                    >
                                      {formatAmount(row.profit_usd, "USD")}
                                    </span>
                                  </>
                                ) : rowClass ===
                                  PROFIT_ROW_CLASS.COMMISSION ? (
                                  <>
                                    Commission:{" "}
                                    <span
                                      className={profitClass(row.profit_usd)}
                                    >
                                      {formatAmount(row.profit_usd, "USD")}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    Profit:{" "}
                                    <span
                                      className={profitClass(row.profit_usd)}
                                    >
                                      {formatAmount(row.profit_usd, "USD")}
                                    </span>
                                  </>
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="font-semibold text-slate-300 mb-1">
                                LBP
                              </p>
                              <p data-testid={`by-module-detail-${row.module}-lbp`}>
                                {rowClass === PROFIT_ROW_CLASS.EQUATION ? (
                                  <>
                                    {formatAmount(row.revenue_lbp, "LBP")} −{" "}
                                    {formatAmount(row.cost_lbp ?? 0, "LBP")}
                                    {isSale &&
                                      (row.sale_kept_change_lbp ?? 0) !==
                                        0 && (
                                        <>
                                          {" "}
                                          {(row.sale_kept_change_lbp ?? 0) > 0
                                            ? "+"
                                            : "−"}{" "}
                                          {formatAmount(
                                            Math.abs(
                                              row.sale_kept_change_lbp ?? 0,
                                            ),
                                            "LBP",
                                          )}{" "}
                                          {/* PFU-a-3-residual — see the
                                              matching USD block's comment
                                              above; same sign-based
                                              relabeling. */}
                                          {(row.sale_kept_change_lbp ?? 0) > 0
                                            ? "kept change"
                                            : "unexplained difference"}
                                        </>
                                      )}{" "}
                                    ={" "}
                                    <span
                                      className={profitClass(row.profit_lbp)}
                                    >
                                      {formatAmount(row.profit_lbp, "LBP")}
                                    </span>
                                  </>
                                ) : rowClass ===
                                  PROFIT_ROW_CLASS.COMMISSION ? (
                                  <>
                                    Commission:{" "}
                                    <span
                                      className={profitClass(row.profit_lbp)}
                                    >
                                      {formatAmount(row.profit_lbp, "LBP")}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    Profit:{" "}
                                    <span
                                      className={profitClass(row.profit_lbp)}
                                    >
                                      {formatAmount(row.profit_lbp, "LBP")}
                                    </span>
                                  </>
                                )}
                              </p>
                            </div>
                            {/* PA-4.23 — Maintenance parts/labour split
                                (LIRA-176): computed since that migration,
                                never rendered anywhere until now. Parts are
                                always USD (owner decision — never
                                converted). */}
                            {isMaintenance &&
                              (row.parts_revenue_usd !== undefined ||
                                row.labour_profit_usd !== undefined) && (
                                <div
                                  data-testid="by-module-maintenance-parts-labour"
                                  className="sm:col-span-2 border-t border-slate-700 pt-2"
                                >
                                  <p className="font-semibold text-slate-300 mb-1">
                                    Parts / Labour split
                                  </p>
                                  <p>
                                    Parts: {formatAmount(row.parts_revenue_usd ?? 0, "USD")}{" "}
                                    revenue −{" "}
                                    {formatAmount(row.parts_cost_usd ?? 0, "USD")}{" "}
                                    cost ={" "}
                                    <span
                                      className={profitClass(
                                        row.parts_profit_usd ?? 0,
                                      )}
                                    >
                                      {formatAmount(
                                        row.parts_profit_usd ?? 0,
                                        "USD",
                                      )}
                                    </span>
                                  </p>
                                  <p>
                                    Labour:{" "}
                                    <span
                                      className={profitClass(
                                        row.labour_profit_usd ?? 0,
                                      )}
                                    >
                                      {formatAmount(
                                        row.labour_profit_usd ?? 0,
                                        "USD",
                                      )}
                                    </span>
                                    {(row.labour_profit_lbp ?? 0) !== 0 &&
                                      ` + ${formatAmount(row.labour_profit_lbp ?? 0, "LBP")}`}
                                  </p>
                                </div>
                              )}
                            {/* LO-V1 (round 2) — off-currency kept change
                                stamped on this module's own transactions
                                (a FINANCIAL_SERVICE_* or RECHARGE_* row —
                                the only two that can carry one, e.g. a USD
                                recharge tendered with LBP kept as change).
                                Already counted in the period's gross
                                profit (see the footer above) — NOT already
                                folded into this row's own Profit column,
                                which keeps meaning "this row's own margin".
                                Additive visibility only, so this money is
                                never silently invisible (rule 8). */}
                            {((row.kept_change_usd ?? 0) !== 0 ||
                              (row.kept_change_lbp ?? 0) !== 0) && (
                              <div
                                data-testid={`by-module-kept-change-${row.module}`}
                                className="sm:col-span-2 border-t border-slate-700 pt-2"
                              >
                                <p className="font-semibold text-slate-300 mb-1">
                                  Off-currency kept change
                                </p>
                                <p>
                                  {combinedAmountLabel(
                                    row.kept_change_usd ?? 0,
                                    row.kept_change_lbp ?? 0,
                                    formatAmount,
                                  )}{" "}
                                  — already counted in the period&rsquo;s
                                  gross profit, not in this row&rsquo;s own
                                  Profit column above.
                                </p>
                              </div>
                            )}
                            {/* PFU-a-7 — cost is only a concept for an
                                EQUATION row (revenue − cost = profit); a
                                COMMISSION/PROFIT_ONLY row never carries a
                                cost figure at all, so this note read oddly
                                under "Commission: $x"/"Profit: $x" (kept
                                change, a discount, a mobile-service
                                commission row). */}
                            {rowClass === PROFIT_ROW_CLASS.EQUATION &&
                              !hasCost && (
                                <p className="sm:col-span-2 text-[10px] text-slate-500 italic">
                                  No cost recorded for this module in this
                                  period.
                                </p>
                              )}
                            {/* PROF-DD (OWNER_NOTES_REMAINING_BUILD.md #14
                                slice 2) — "Show transactions" drill-down,
                                SALE + RECHARGE_<carrier> only. Slice 3 (every
                                other module) is a later ticket, so no button
                                renders for those rows yet — matching
                                ProfitService.getModuleDetail's own "not
                                built yet" boundary instead of offering a
                                button that would only throw. */}
                            {(row.module === "SALE" ||
                              row.module.startsWith("RECHARGE_")) && (
                              <div
                                data-testid={`by-module-transactions-${row.module}`}
                                className="sm:col-span-2 border-t border-slate-700 pt-2"
                              >
                                {(() => {
                                  const entry = moduleDetail[row.module];
                                  if (!entry) {
                                    return (
                                      <button
                                        type="button"
                                        data-testid={`by-module-show-transactions-${row.module}`}
                                        onClick={() =>
                                          loadModuleDetail(row.module)
                                        }
                                        className="text-xs text-blue-400 hover:text-blue-300 underline"
                                      >
                                        Show transactions
                                      </button>
                                    );
                                  }
                                  if (entry.status === "loading") {
                                    return (
                                      <p className="text-xs text-slate-500 italic">
                                        Loading transactions…
                                      </p>
                                    );
                                  }
                                  if (entry.status === "error") {
                                    return (
                                      <p
                                        data-testid={`by-module-transactions-error-${row.module}`}
                                        className="text-xs text-red-400"
                                      >
                                        {entry.error}
                                      </p>
                                    );
                                  }
                                  {
                                    const detail = entry.data;
                                    return (
                                      <div className="space-y-2">
                                        <p className="font-semibold text-slate-300">
                                          Transactions —{" "}
                                          {detail.counted.length} counted
                                          {detail.not_counted.length > 0
                                            ? `, ${detail.not_counted.length} not counted yet`
                                            : ""}
                                        </p>
                                        <div className="overflow-x-auto">
                                          <table
                                            data-testid={`by-module-transactions-counted-${row.module}`}
                                            className="w-full text-[11px]"
                                          >
                                            <thead>
                                              <tr className="text-slate-500">
                                                <th className="text-left py-1 pr-2">
                                                  Date
                                                </th>
                                                <th className="text-left py-1 pr-2">
                                                  Client
                                                </th>
                                                <th className="text-left py-1 pr-2">
                                                  Detail
                                                </th>
                                                <th className="text-right py-1 pr-2">
                                                  Profit
                                                </th>
                                                <th className="text-right py-1">
                                                  Counted
                                                </th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {detail.counted.map((r) => (
                                                <Fragment key={r.id}>
                                                  <tr className="border-t border-slate-800">
                                                    <td className="py-1 pr-2 text-slate-400">
                                                      {parseDbDate(
                                                        r.date,
                                                      ).toLocaleDateString()}
                                                    </td>
                                                    <td className="py-1 pr-2 text-slate-300">
                                                      {r.counterpart}
                                                    </td>
                                                    <td className="py-1 pr-2 text-slate-400">
                                                      {r.detail || "—"}
                                                      {r.fee_note && (
                                                        <span className="text-red-400">
                                                          {" "}
                                                          · {r.fee_note}
                                                        </span>
                                                      )}
                                                    </td>
                                                    {/* PROF-DD-FIX (review
                                                        round, M3) — the
                                                        counted-side figure
                                                        MUST be the WEIGHTED
                                                        counted_profit_usd/lbp
                                                        (what this row
                                                        actually contributes
                                                        to counted_total_*
                                                        below), never the raw
                                                        unweighted
                                                        profit_usd/lbp — a 50%
                                                        partner row used to
                                                        show its FULL profit
                                                        next to "50%". Both
                                                        currencies render when
                                                        both are non-zero
                                                        (a sale's USD margin
                                                        plus an LBP kept-change
                                                        stamp). */}
                                                    <td className="py-1 pr-2 text-right">
                                                      <ProfitAmountSpans
                                                        usd={
                                                          r.counted_profit_usd
                                                        }
                                                        lbp={
                                                          r.counted_profit_lbp
                                                        }
                                                        formatAmount={
                                                          formatAmount
                                                        }
                                                      />
                                                    </td>
                                                    <td className="py-1 text-right text-slate-400">
                                                      {r.counted_pct}%
                                                    </td>
                                                  </tr>
                                                  {/* PROF-DD-FIX (M3) — a
                                                      partial row (counted_pct
                                                      < 100, e.g. a partner
                                                      50%-settled sale) still
                                                      needs its reason
                                                      visible, not just a
                                                      bare percentage. */}
                                                  {r.reason && (
                                                    <tr>
                                                      <td
                                                        colSpan={5}
                                                        className="pb-1 pr-2 text-slate-500 italic"
                                                      >
                                                        {r.reason}
                                                      </td>
                                                    </tr>
                                                  )}
                                                </Fragment>
                                              ))}
                                              {detail.counted.length ===
                                                0 && (
                                                <tr>
                                                  <td
                                                    colSpan={5}
                                                    className="py-2 text-center text-slate-500 italic"
                                                  >
                                                    No counted transactions in
                                                    this period.
                                                  </td>
                                                </tr>
                                              )}
                                            </tbody>
                                            {/* PROF-DD-FIX (M3) — the owner's
                                                own ask ("counted rows add up
                                                EXACTLY to the module row")
                                                needs a visible total so it
                                                can be checked; there was none
                                                before. */}
                                            <tfoot>
                                              <tr
                                                data-testid={`by-module-transactions-counted-total-${row.module}`}
                                                className="border-t-2 border-slate-700 font-semibold"
                                              >
                                                <td
                                                  colSpan={3}
                                                  className="py-1 pr-2 text-slate-300"
                                                >
                                                  Counted total
                                                </td>
                                                <td className="py-1 pr-2 text-right">
                                                  <ProfitAmountSpans
                                                    usd={
                                                      detail.counted_total_profit_usd
                                                    }
                                                    lbp={
                                                      detail.counted_total_profit_lbp
                                                    }
                                                    formatAmount={
                                                      formatAmount
                                                    }
                                                  />
                                                </td>
                                                <td />
                                              </tr>
                                            </tfoot>
                                          </table>
                                        </div>
                                        {detail.not_counted.length > 0 && (
                                          <div
                                            data-testid={`by-module-transactions-not-counted-${row.module}`}
                                            className="opacity-60"
                                          >
                                            <p className="font-semibold text-slate-400 mb-1">
                                              Not counted yet
                                            </p>
                                            <table className="w-full text-[11px]">
                                              <tbody>
                                                {detail.not_counted.map(
                                                  (r) => (
                                                    <tr
                                                      key={r.id}
                                                      className="border-t border-slate-800"
                                                    >
                                                      <td className="py-1 pr-2 text-slate-500">
                                                        {parseDbDate(
                                                          r.date,
                                                        ).toLocaleDateString()}
                                                      </td>
                                                      <td className="py-1 pr-2 text-slate-500">
                                                        {r.counterpart}
                                                      </td>
                                                      <td className="py-1 pr-2 text-slate-500 italic">
                                                        {r.reason}
                                                        {/* PROF-DD-FIX
                                                            (review round,
                                                            OA14-3) — an
                                                            auto-booked fee
                                                            still shows next
                                                            to a NOT-counted
                                                            row too (e.g. a
                                                            debt-pending
                                                            recharge that
                                                            already accrued
                                                            its SMS fee) —
                                                            it was silently
                                                            left out before. */}
                                                        {r.fee_note && (
                                                          <span className="text-red-400 not-italic">
                                                            {" "}
                                                            · {r.fee_note}
                                                          </span>
                                                        )}
                                                      </td>
                                                    </tr>
                                                  ),
                                                )}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  }
                                })()}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }}
            />
          </div>
        )}

        {/* ==================== By Date Tab ==================== */}
        {!loading && tab === "by-date" && byDateError && (
          // PA-4.16: a visible error state, distinct from the empty-data
          // message the DataTable shows for a real no-activity period.
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300"
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-400" />
            <div>
              <p className="font-medium text-red-200">
                Failed to load profit by date
              </p>
              <p className="mt-0.5 text-red-400/80">{byDateError}</p>
            </div>
          </div>
        )}
        {!loading && tab === "by-date" && !byDateError && (
          <div className="space-y-4">
            {/* Visual bar chart */}
            {byDate.length > 0 &&
              (() => {
                // PA-4.13 — the server returns dates newest-first
                // (`ORDER BY dates.d DESC`); mapped straight into the bar
                // chart that put the most recent day on the LEFT, reading
                // backwards in time. Reversed for the chart ONLY — the
                // table below is left in the server's own order.
                const chartDates = [...byDate].reverse();
                const maxVal = Math.max(
                  ...chartDates.map((d) => Math.abs(d.net_profit_usd)),
                  1,
                );
                return (
                  <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
                    <h3 className="text-sm font-semibold text-slate-400 mb-3">
                      Daily Net Profit (USD)
                    </h3>
                    <div
                      data-testid="by-date-chart"
                      className="flex items-end gap-1 h-40"
                    >
                      {chartDates.map((d) => {
                        const pct = Math.abs(d.net_profit_usd) / maxVal;
                        const isPositive = d.net_profit_usd >= 0;
                        return (
                          <div
                            key={d.date}
                            data-testid={`by-date-bar-${d.date}`}
                            className="flex-1 flex flex-col justify-end items-center group relative"
                          >
                            <div
                              className={`w-full rounded-t ${
                                isPositive
                                  ? "bg-emerald-500/70"
                                  : "bg-red-500/70"
                              }`}
                              style={{
                                height: `${Math.max(pct * 100, 2)}%`,
                                minHeight: "2px",
                              }}
                            />
                            {/* Tooltip */}
                            <div className="absolute bottom-full mb-1 hidden group-hover:block bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white whitespace-nowrap z-10">
                              {d.date}: {formatAmount(d.net_profit_usd, "USD")}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                      <span>{chartDates[0]?.date}</span>
                      <span>{chartDates[chartDates.length - 1]?.date}</span>
                    </div>
                  </div>
                );
              })()}

            {/* Table */}
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
              <DataTable<DateRow>
                columns={[
                  { header: "Date", className: "text-left px-4 py-3" },
                  { header: "Revenue (USD)", className: "text-right px-4 py-3" },
                  { header: "Revenue (LBP)", className: "text-right px-4 py-3" },
                  {
                    header: "Gross Profit (USD)",
                    className: "text-right px-4 py-3",
                  },
                  {
                    header: "Gross Profit (LBP)",
                    className: "text-right px-4 py-3",
                  },
                  { header: "Expenses (USD)", className: "text-right px-4 py-3" },
                  {
                    header: "Expenses (LBP)",
                    className: "text-right px-4 py-3",
                  },
                  {
                    header: "Net Profit (USD)",
                    className: "text-right px-4 py-3",
                  },
                  {
                    header: "Net Profit (LBP)",
                    className: "text-right px-4 py-3",
                  },
                ]}
                data={byDate}
                exportExcel
                exportPdf
                exportFilename="profit-by-date"
                className="w-full text-sm"
                theadClassName="border-b border-slate-700 text-slate-400 text-xs uppercase"
                emptyMessage="No data for this period"
                footerContent={
                  byDate.length > 0
                    ? (() => {
                        const totalRevenueUsd = byDate.reduce(
                          (s, d) => s + d.revenue_usd,
                          0,
                        );
                        const totalRevenueLbp = byDate.reduce(
                          (s, d) => s + (d.revenue_lbp ?? 0),
                          0,
                        );
                        const totalProfitUsd = byDate.reduce(
                          (s, d) => s + d.profit_usd,
                          0,
                        );
                        const totalProfitLbp = byDate.reduce(
                          (s, d) => s + d.profit_lbp,
                          0,
                        );
                        const totalExpensesUsd = byDate.reduce(
                          (s, d) => s + d.expenses_usd,
                          0,
                        );
                        const totalExpensesLbp = byDate.reduce(
                          (s, d) => s + (d.expenses_lbp ?? 0),
                          0,
                        );
                        const totalNetUsd = byDate.reduce(
                          (s, d) => s + d.net_profit_usd,
                          0,
                        );
                        const totalNetLbp = byDate.reduce(
                          (s, d) => s + d.net_profit_lbp,
                          0,
                        );
                        return (
                          <tr
                            data-testid="by-date-total-row"
                            className="border-t-2 border-slate-600 bg-slate-800/80 font-bold"
                          >
                            <td className="px-4 py-3 text-white">TOTAL</td>
                            <td className="px-4 py-3 text-right text-white">
                              {formatAmount(totalRevenueUsd, "USD")}
                            </td>
                            <td className="px-4 py-3 text-right text-white">
                              {totalRevenueLbp !== 0
                                ? formatAmount(totalRevenueLbp, "LBP")
                                : "—"}
                            </td>
                            <td
                              className={`px-4 py-3 text-right ${profitClass(totalProfitUsd)}`}
                            >
                              {formatAmount(totalProfitUsd, "USD")}
                            </td>
                            <td
                              className={`px-4 py-3 text-right ${profitClass(totalProfitLbp)}`}
                            >
                              {totalProfitLbp !== 0
                                ? formatAmount(totalProfitLbp, "LBP")
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-red-400">
                              -{formatAmount(totalExpensesUsd, "USD")}
                            </td>
                            <td className="px-4 py-3 text-right text-red-400">
                              {totalExpensesLbp !== 0
                                ? `-${formatAmount(totalExpensesLbp, "LBP")}`
                                : "—"}
                            </td>
                            <td
                              className={`px-4 py-3 text-right ${profitClass(totalNetUsd)}`}
                            >
                              {formatAmount(totalNetUsd, "USD")}
                            </td>
                            <td
                              className={`px-4 py-3 text-right ${profitClass(totalNetLbp)}`}
                            >
                              {totalNetLbp !== 0
                                ? formatAmount(totalNetLbp, "LBP")
                                : "—"}
                            </td>
                          </tr>
                        );
                      })()
                    : undefined
                }
                renderRow={(d) => (
                  <tr
                    key={d.date}
                    className="border-b border-slate-700/50 hover:bg-slate-700/30"
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      {d.date}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatAmount(d.revenue_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {(d.revenue_lbp ?? 0) !== 0
                        ? formatAmount(d.revenue_lbp ?? 0, "LBP")
                        : "—"}
                    </td>
                    <td
                      className={`px-4 py-3 text-right ${profitClass(d.profit_usd)}`}
                    >
                      {formatAmount(d.profit_usd, "USD")}
                    </td>
                    <td
                      className={`px-4 py-3 text-right ${profitClass(d.profit_lbp)}`}
                    >
                      {d.profit_lbp !== 0
                        ? formatAmount(d.profit_lbp, "LBP")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-red-400">
                      {d.expenses_usd > 0
                        ? `-${formatAmount(d.expenses_usd, "USD")}`
                        : "—"}
                    </td>
                    {/* PA-4.14 — expenses_lbp was already returned by
                        getByDate and never rendered. */}
                    <td className="px-4 py-3 text-right text-red-400">
                      {(d.expenses_lbp ?? 0) > 0
                        ? `-${formatAmount(d.expenses_lbp ?? 0, "LBP")}`
                        : "—"}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${profitClass(d.net_profit_usd)}`}
                    >
                      {formatAmount(d.net_profit_usd, "USD")}
                    </td>
                    {/* PA-4.14 — net_profit_lbp was already returned by
                        getByDate and never rendered. */}
                    <td
                      className={`px-4 py-3 text-right font-semibold ${profitClass(d.net_profit_lbp)}`}
                    >
                      {d.net_profit_lbp !== 0
                        ? formatAmount(d.net_profit_lbp, "LBP")
                        : "—"}
                    </td>
                  </tr>
                )}
              />
            </div>
          </div>
        )}

        {/* ==================== Cash Intake by Method Tab ==================== */}
        {!loading && tab === "by-payment" && (
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
            {byPaymentError ? (
              // PA-4.16: a visible error state, distinct from the empty-data
              // message the DataTable shows for a real no-activity period.
              <div
                role="alert"
                className="m-4 flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300"
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-400" />
                <div>
                  <p className="font-medium text-red-200">
                    Failed to load payment method data
                  </p>
                  <p className="mt-0.5 text-red-400/80">{byPaymentError}</p>
                </div>
              </div>
            ) : (
              <DataTable<PaymentMethodRow>
                columns={[
                  {
                    header: "Payment Method",
                    className: "text-left px-4 py-3",
                  },
                  { header: "Total (USD)", className: "text-right px-4 py-3" },
                  { header: "Total (LBP)", className: "text-right px-4 py-3" },
                  {
                    // Owner decision 3 (2026-09-24): debt-repayment intake
                    // is now its OWN column instead of the old all-or-nothing
                    // "No Profit" flag — a method can take both new-sales
                    // and debt-repayment money in the same period.
                    header: "Debt Repayment",
                    className: "text-right px-4 py-3",
                  },
                  { header: "Count", className: "text-right px-4 py-3" },
                  { header: "Status", className: "text-right px-4 py-3" },
                  { header: "Share", className: "text-right px-4 py-3" },
                ]}
                data={byPayment}
                exportExcel
                exportPdf
                exportFilename="cash-intake-by-method"
                className="w-full text-sm"
                theadClassName="border-b border-slate-700 text-slate-400 text-xs uppercase"
                emptyMessage="No payment data for this period"
                renderRow={(row) => {
                  // PA-3.5: the Share column is a percentage of TENDER
                  // (money that actually landed in a drawer by method) — a
                  // Commission row is profit reporting riding in the same
                  // array, not a payment method, so it must not inflate this
                  // denominator. `r.method !== "PM_FEE"` is kept as a
                  // defensive no-op — PM_FEE itself no longer reaches this
                  // array at all (excluded at the SQL layer) — never as
                  // dead code to delete (LPAY-V10's "dead isPmFee branches"
                  // means the RENDER branches below, which really can never
                  // fire; this filter predicate costs nothing to keep).
                  // Owner decision 3: debt-repayment intake now counts in
                  // Share too (both numerator and denominator), so the old
                  // `!r.is_debt_repayment_only` exclusion is gone.
                  const shareEligible = (r: PaymentMethodRow) =>
                    r.method !== "PM_FEE" &&
                    !r.method.startsWith("Commission") &&
                    r.is_settled !== 0;
                  const shareUsd = (r: PaymentMethodRow) =>
                    r.total_usd + (r.debt_repayment_usd ?? 0);
                  const shareLbp = (r: PaymentMethodRow) =>
                    r.total_lbp + (r.debt_repayment_lbp ?? 0);
                  // LPAY-V-3 (round-1 review, OWNER_NOTES_2026-09-21.md §6.9
                  // status table): a row's own share can now be negative
                  // (LPAY-X1's cross-currency change, LPAY-X4's partial
                  // refund) even after this lane's own unit-level floor —
                  // summing SIGNED shares into the denominator let a large
                  // negative row drag `totalAll`/`totalAllLbp` down (even
                  // below 0), which sent a genuinely-positive row's own
                  // percentage over 100% or negative. Each row is floored
                  // at 0 BEFORE it enters the denominator (a negative row
                  // still renders as "—" at `shareUsd(row) > 0`/
                  // `shareLbp(row) > 0` below, unaffected by this), so the
                  // denominator only ever counts the genuinely-positive
                  // contributors and no single row's bar/percentage can
                  // exceed 100%.
                  const totalAll = byPayment
                    .filter(shareEligible)
                    .reduce((s, r) => s + Math.max(0, shareUsd(r)), 0);
                  // LPAY-R3-6: a per-CURRENCY denominator too — the USD-only
                  // one above made a tender taken only in LBP always show
                  // 0% (total_usd is 0 for it) regardless of how much LBP it
                  // actually took in.
                  const totalAllLbp = byPayment
                    .filter(shareEligible)
                    .reduce((s, r) => s + Math.max(0, shareLbp(r)), 0);
                  const isPending = row.is_settled === 0;
                  const isCommission = row.method.startsWith("Commission");
                  const debtRepaymentUsd = row.debt_repayment_usd ?? 0;
                  const debtRepaymentLbp = row.debt_repayment_lbp ?? 0;
                  // D15: model-0 legacy pending commission keeps a dollar
                  // figure; model-1 pending commission is unknowable until
                  // settlement, so it is a count instead ("N transactions
                  // awaiting settlement"). A row can carry both at once (a
                  // mixed legacy + new-model period), so neither may hide
                  // the other.
                  const pendingUsd = row.pending_commission_usd ?? 0;
                  const pendingLbp = row.pending_commission_lbp ?? 0;
                  const awaitingCount = row.awaiting_settlement_count ?? 0;
                  const displayLbp = isPending ? pendingLbp : row.total_lbp;
                  return (
                    <tr
                      key={row.method}
                      className={`border-b border-slate-700/50 hover:bg-slate-700/30 ${
                        isPending ? "bg-amber-950/20" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-white">
                        <div className="flex items-center gap-2">
                          <CreditCard
                            className={`h-4 w-4 ${
                              isCommission
                                ? "text-emerald-400"
                                : "text-slate-400"
                            }`}
                          />
                          {row.method}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {isPending ? (
                          <div className="flex flex-col items-end gap-0.5">
                            {pendingUsd > 0 && (
                              <span className="text-amber-400">
                                {/* LPAY-R3-6: 2 decimals, matching every
                                    other dollar figure on this tab (formatAmount
                                    below never renders 4). */}
                                ${pendingUsd.toFixed(2)}
                              </span>
                            )}
                            {awaitingCount > 0 && (
                              <span
                                className={
                                  pendingUsd > 0
                                    ? "text-[11px] text-amber-500/70"
                                    : "text-amber-400"
                                }
                              >
                                {awaitingCount} transaction
                                {awaitingCount === 1 ? "" : "s"} awaiting
                                settlement
                              </span>
                            )}
                            {pendingUsd === 0 && awaitingCount === 0 && (
                              <span className="text-slate-500">—</span>
                            )}
                          </div>
                        ) : (
                          <span
                            className={
                              row.total_usd < 0
                                ? "text-red-400"
                                : isCommission
                                  ? "text-emerald-400 font-semibold"
                                  : "text-white"
                            }
                          >
                            {formatAmount(row.total_usd, "USD")}
                          </span>
                        )}
                      </td>
                      {/* LIRA-153 — same fix as the By Module tab: a negative
                          LBP total is real information (a commission row can go
                          negative on a reversal) and must not read as "no data".
                          For a pending row, the LBP figure comes from
                          pending_commission_lbp (D15 fix) — total_lbp stays 0
                          by design ("not yet in hand").
                          LPAY-X1 (round 5, OWNER_NOTES_2026-09-21.md §6.8):
                          the USD total can now ALSO go negative (unit-level
                          net-of-change flooring — a unit tendered in LBP with
                          USD change nets negative on the USD side while still
                          qualifying via its positive LBP net), so the USD
                          column gets the SAME red-on-negative treatment the
                          LBP column already had. */}
                      <td
                        className={`px-4 py-3 text-right ${
                          displayLbp < 0
                            ? "text-red-400"
                            : isPending
                              ? "text-amber-400"
                              : "text-white"
                        }`}
                      >
                        {displayLbp !== 0
                          ? formatAmount(displayLbp, "LBP")
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {/* LPAY-X1 (round 5, OWNER_NOTES_2026-09-21.md §6.8):
                            a debt-repayment unit's currency legs are now
                            netted at the unit level too, so ONE of these can
                            be negative (tendered in one currency, change
                            given in the other) while the unit as a whole
                            still qualifies. The old `> 0` gates dropped a
                            genuine negative leg silently — `!== 0` shows it,
                            colored red like every other negative money figure
                            on this tab. */}
                        {debtRepaymentUsd !== 0 || debtRepaymentLbp !== 0 ? (
                          <div className="flex flex-col items-end gap-0.5">
                            {debtRepaymentUsd !== 0 && (
                              <span
                                className={
                                  debtRepaymentUsd < 0 ? "text-red-400" : ""
                                }
                              >
                                {formatAmount(debtRepaymentUsd, "USD")}
                              </span>
                            )}
                            {debtRepaymentLbp !== 0 && (
                              <span
                                className={
                                  debtRepaymentLbp < 0 ? "text-red-400" : ""
                                }
                              >
                                {formatAmount(debtRepaymentLbp, "LBP")}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.count}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isPending ? (
                          <span className="text-xs font-medium text-amber-400">
                            Profit Pending
                          </span>
                        ) : isCommission ? (
                          <span className="text-xs font-medium text-emerald-400">
                            Settled
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!isPending && !isCommission && (
                          <div className="flex flex-col items-end gap-1">
                            {/* LPAY-R3-6: show whichever currency this row
                                actually carries — a USD row against the USD
                                denominator, an LBP row against the LBP
                                denominator, both when the row has both. An
                                LBP-only tender used to always read "0%" here
                                (it was compared against a USD-only total).
                                Owner decision 3: the numerator/denominator
                                both include debt-repayment intake now. */}
                            {shareUsd(row) > 0 && (
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-16 bg-slate-700 rounded-full h-1.5">
                                  <div
                                    className="bg-blue-500 h-1.5 rounded-full"
                                    style={{
                                      width: `${totalAll > 0 ? (shareUsd(row) / totalAll) * 100 : 0}%`,
                                    }}
                                  />
                                </div>
                                <span className="text-slate-300 text-xs w-16 text-right">
                                  {formatPct(shareUsd(row), totalAll)} USD
                                </span>
                              </div>
                            )}
                            {shareLbp(row) > 0 && (
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-16 bg-slate-700 rounded-full h-1.5">
                                  <div
                                    className="bg-emerald-500 h-1.5 rounded-full"
                                    style={{
                                      width: `${totalAllLbp > 0 ? (shareLbp(row) / totalAllLbp) * 100 : 0}%`,
                                    }}
                                  />
                                </div>
                                <span className="text-slate-300 text-xs w-16 text-right">
                                  {formatPct(shareLbp(row), totalAllLbp)} LBP
                                </span>
                              </div>
                            )}
                            {shareUsd(row) === 0 && shareLbp(row) === 0 && (
                              <span className="text-slate-600 text-xs">—</span>
                            )}
                          </div>
                        )}
                        {isPending && (
                          <span className="text-xs text-amber-500/70">
                            → Settle in Settings
                          </span>
                        )}
                        {/* PA-3.5: a Commission row is profit reporting, not a
                            tender's share of cash intake — no bar, no percent. */}
                        {isCommission && (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                }}
              />
            )}
          </div>
        )}

        {/* ==================== By User/Cashier Tab ==================== */}
        {!loading && tab === "by-user" && (
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
            {byUserError ? (
              // PA-4.16: a visible error state, distinct from the empty-data
              // message the DataTable shows for a real no-activity period.
              <div
                role="alert"
                className="m-4 flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300"
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-400" />
                <div>
                  <p className="font-medium text-red-200">
                    Failed to load profit by cashier
                  </p>
                  <p className="mt-0.5 text-red-400/80">{byUserError}</p>
                </div>
              </div>
            ) : (
              <>
                {/* LCC-V3 (Round 2): exchange profit IS now attributed here
                    (ExchangeRepository.createTransaction stamps a real
                    user_id on every exchange row — see ProfitRepository
                    .getByUser's own doc comment), so the caption no longer
                    claims it is excluded. Counterparty (debt/supplier/
                    partner-ledger) discounts stay excluded — a discount's
                    "who earned this" is genuinely three-way ambiguous. */}
                <p className="px-4 pt-3 text-xs text-slate-500">
                  Excludes counterparty discounts — not attributable to a
                  single cashier.
                </p>
                <DataTable<UserRow>
                  columns={[
                    { header: "Cashier", className: "text-left px-4 py-3" },
                    {
                      header: "Revenue",
                      className: "text-right px-4 py-3",
                    },
                    { header: "Profits", className: "text-right px-4 py-3" },
                    {
                      header: "Pending Profits",
                      className: "text-right px-4 py-3",
                    },
                    {
                      header: "Transactions",
                      className: "text-right px-4 py-3",
                    },
                    {
                      header: "Avg Profit/Txn",
                      className: "text-right px-4 py-3",
                    },
                  ]}
                  data={byUser}
                  exportExcel
                  exportPdf
                  exportFilename="profit-by-cashier"
                  className="w-full text-sm"
                  theadClassName="border-b border-slate-700 text-slate-400 text-xs uppercase"
                  emptyMessage="No data for this period"
                  renderRow={(row) => (
                    <tr
                      key={row.user_id}
                      className="border-b border-slate-700/50 hover:bg-slate-700/30"
                    >
                      <td className="px-4 py-3 font-medium text-white">
                        <div className="flex items-center gap-2">
                          <UserCheck className="h-4 w-4 text-slate-400" />
                          {row.username}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-white">
                        {formatAmount(row.revenue_usd, "USD")}
                        {/* PA-1.7: revenue_lbp was computed but never shown. */}
                        {(row.revenue_lbp ?? 0) !== 0 && (
                          <div className="text-xs text-slate-400">
                            {formatAmount(row.revenue_lbp, "LBP")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {/* LCC-X10 (Round 3): was hard-coded emerald even for
                            a loss (a legitimate refund, or the LCC-X1/X2
                            double-count these fixes close) — reuse the
                            shared profitClass(v) helper (PA-4.5) instead. */}
                        <span className={profitClass(row.profit_usd)}>
                          {formatAmount(row.profit_usd, "USD")}
                        </span>
                        {(row.profit_lbp ?? 0) !== 0 && (
                          <div
                            className={`text-xs ${profitClass(row.profit_lbp)}`}
                          >
                            {formatAmount(row.profit_lbp, "LBP")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {/* PA-1.3: pending_profit_lbp was silently added into
                            a USD-labeled column — now split and shown per
                            currency. */}
                        {(row.pending_profit_usd ?? 0) > 0 ||
                        (row.pending_profit_lbp ?? 0) > 0 ? (
                          <span className="text-amber-400 font-medium">
                            {(row.pending_profit_usd ?? 0) > 0 && (
                              <span>
                                ⚠ {formatAmount(row.pending_profit_usd, "USD")}
                              </span>
                            )}
                            {(row.pending_profit_lbp ?? 0) > 0 && (
                              <div className="text-xs">
                                ⚠ {formatAmount(row.pending_profit_lbp, "LBP")}
                              </div>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.transaction_count}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {/* PA-4.19: divide by recognized_transaction_count,
                            not raw transaction_count — a SALE+its REFUND, a
                            SUPPLIER_SETTLEMENT batch, and an unrecognized FS
                            row all inflated the denominator without
                            representing a distinct profit-bearing event. */}
                        {(row.recognized_transaction_count ?? 0) > 0
                          ? formatAmount(
                              row.profit_usd / row.recognized_transaction_count,
                              "USD",
                            )
                          : "—"}
                        {/* LCC-V6 (Round 2): the USD-only average read close
                            to $0 for an LBP-heavy cashier — show the LBP
                            average underneath, same denominator. */}
                        {(row.recognized_transaction_count ?? 0) > 0 &&
                          (row.profit_lbp ?? 0) !== 0 && (
                            <div className="text-xs text-slate-500">
                              {formatAmount(
                                row.profit_lbp / row.recognized_transaction_count,
                                "LBP",
                              )}
                            </div>
                          )}
                      </td>
                    </tr>
                  )}
                />
              </>
            )}
          </div>
        )}

        {/* ==================== By Client Tab ==================== */}
        {!loading && tab === "by-client" && (
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
            {byClientError ? (
              // PA-4.16: see the By Cashier tab's identical fix above.
              <div
                role="alert"
                className="m-4 flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300"
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-400" />
                <div>
                  <p className="font-medium text-red-200">
                    Failed to load profit by client
                  </p>
                  <p className="mt-0.5 text-red-400/80">{byClientError}</p>
                </div>
              </div>
            ) : (
              <>
                {/* PA-2.6: see the By Cashier tab's identical caption above. */}
                <p className="px-4 pt-3 text-xs text-slate-500">
                  Excludes exchange profit and counterparty discounts — not
                  attributable to a single client.
                </p>
                {/* PA-4.19: getProfitByClient is silently capped at the top
                    30 clients by profit — say so instead of letting the list
                    read as "the whole client base". LCC-V11 (Round 2): the
                    ranking/cap is by USD profit only (ProfitRepository
                    .getByClient's ORDER BY), so an LBP-only client could sit
                    below the cutoff — the notice now says so. */}
                {byClient.length >= 30 && (
                  <p className="px-4 pb-1 text-xs text-slate-500">
                    Showing the top 30 clients by profit for this period,
                    ranked by USD profit (LBP-only profit is not included in
                    the ranking).
                  </p>
                )}
                <DataTable<ClientRow>
                  columns={[
                    { header: "#", className: "text-left px-4 py-3" },
                    { header: "Client", className: "text-left px-4 py-3" },
                    {
                      header: "Revenue",
                      className: "text-right px-4 py-3",
                    },
                    { header: "Profits", className: "text-right px-4 py-3" },
                    {
                      header: "Pending Profits",
                      className: "text-right px-4 py-3",
                    },
                    {
                      header: "Transactions",
                      className: "text-right px-4 py-3",
                    },
                  ]}
                  data={byClient}
                  exportExcel
                  exportPdf
                  exportFilename="profit-by-client"
                  className="w-full text-sm"
                  theadClassName="border-b border-slate-700 text-slate-400 text-xs uppercase"
                  emptyMessage="No data for this period"
                  renderRow={(row, i) => (
                    <tr
                      key={row.client_id ?? `session-${row.client_name}-${i}`}
                      className="border-b border-slate-700/50 hover:bg-slate-700/30"
                    >
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {i + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">
                          {row.client_name}
                        </div>
                        {row.client_phone && (
                          <div className="text-xs text-slate-500">
                            {row.client_phone}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-white">
                        {formatAmount(row.revenue_usd, "USD")}
                        {/* PA-1.7: revenue_lbp was computed but never shown. */}
                        {(row.revenue_lbp ?? 0) !== 0 && (
                          <div className="text-xs text-slate-400">
                            {formatAmount(row.revenue_lbp, "LBP")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {/* LCC-X10 (Round 3): see the By Cashier tab's
                            identical fix above — reuse profitClass(v). */}
                        <span className={profitClass(row.profit_usd)}>
                          {formatAmount(row.profit_usd, "USD")}
                        </span>
                        {(row.profit_lbp ?? 0) !== 0 && (
                          <div
                            className={`text-xs ${profitClass(row.profit_lbp)}`}
                          >
                            {formatAmount(row.profit_lbp, "LBP")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {/* PA-1.3: pending_profit_lbp split from USD. */}
                        {(row.pending_profit_usd ?? 0) > 0 ||
                        (row.pending_profit_lbp ?? 0) > 0 ? (
                          <span className="text-amber-400 font-medium">
                            {(row.pending_profit_usd ?? 0) > 0 && (
                              <span>
                                ⚠ {formatAmount(row.pending_profit_usd, "USD")}
                              </span>
                            )}
                            {(row.pending_profit_lbp ?? 0) > 0 && (
                              <div className="text-xs">
                                ⚠ {formatAmount(row.pending_profit_lbp, "LBP")}
                              </div>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.transaction_count}
                      </td>
                    </tr>
                  )}
                />
              </>
            )}
          </div>
        )}

        {/* ==================== Commissions Tab ==================== */}
        {/* PA-4.16: a genuine fetch error used to be indistinguishable from
            "still loading" (the old guard was `!loading && !commissionsData`,
            true on BOTH a swallowed error and a load in progress) — this tab
            could show "Loading..." forever. Own loader/tab only. */}
        {!loading && tab === "commissions" && commissionsError && (
          <div className="flex items-start gap-3 rounded-xl border border-red-800/50 bg-red-950/30 p-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-400" />
            <div>
              <p className="font-medium text-red-300">
                Couldn't load commissions
              </p>
              <p className="mt-1 text-xs text-red-400/80">
                {commissionsError}
              </p>
            </div>
          </div>
        )}
        {loading && tab === "commissions" && !commissionsReport && (
          <div className="text-center py-12 text-slate-500">Loading...</div>
        )}
        {tab === "commissions" && commissionsReport && (
          <div className="space-y-6">
            {/* Overview Cards — PA-4.17: the whole tab now reads the SAME
                [from,to] the date picker drives, unlike the old fixed
                "Today"/"Month" cards. PA-1.1: realized is filtered to real
                commission providers (COMMISSION_REPORT_PROVIDERS) and split
                USD/LBP instead of a single USD-labelled sum. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                <p className="text-slate-400 text-sm font-medium uppercase mb-4">
                  Realized Earnings (Selected Period)
                </p>
                <div className="flex flex-col gap-1">
                  <span className="text-3xl font-bold text-white">
                    {formatAmount(commissionsReport.realized_usd, "USD")}
                  </span>
                  {commissionsReport.realized_lbp !== 0 && (
                    <span className="text-lg font-semibold text-slate-300">
                      {formatAmount(commissionsReport.realized_lbp, "LBP")}
                    </span>
                  )}
                </div>
                {/* LC-4 (round-2 review): this figure is the FS profit
                    stamp plus at-settlement allocations — for model-1
                    OMT/WHISH that includes kept change, the D1 Whish
                    RECEIVE fee (not commission — see FEATURE_GUIDE §D1),
                    and any cost-price margin, and it leaves out pure-BILL
                    OMT/WHISH settlement commission entirely (that arm is
                    cashless-only; bills-only commission sits in the
                    Overview's Supplier Commission bucket, which isn't
                    per-provider). "Realized Commissions" overstated the
                    precision of what this card actually shows. */}
                <p className="text-[11px] text-slate-500 mt-2 leading-snug">
                  Commission, fees and kept change already booked. Excludes
                  bills-only settlement commission (see Overview → Supplier
                  Commission).
                </p>
              </div>

              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                <p className="text-slate-400 text-sm font-medium uppercase mb-4">
                  Pending Commissions (As Of Now)
                </p>
                <div className="flex flex-col gap-1">
                  <span className="text-3xl font-bold text-amber-400">
                    {formatAmount(commissionsReport.pending_usd, "USD")}
                  </span>
                  {commissionsReport.pending_lbp !== 0 && (
                    <span className="text-lg font-semibold text-amber-400/80">
                      {formatAmount(commissionsReport.pending_lbp, "LBP")}
                    </span>
                  )}
                </div>
                {/* LIRA-163/PA-3.7: an unsettled model-1 row's real
                    commission doesn't exist until settlement, so this count
                    (never a fabricated $0.0000) is the only honest thing to
                    show for it. Not scoped to [from,to] either — "as of now",
                    same as pending_usd/lbp above. */}
                {commissionsReport.awaiting_settlement_count > 0 && (
                  <p
                    data-testid="commissions-awaiting-settlement"
                    className="text-xs text-amber-400/80 mt-2"
                  >
                    {commissionsReport.awaiting_settlement_count} awaiting
                    settlement
                  </p>
                )}
              </div>

              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                <p className="text-slate-400 text-sm font-medium uppercase mb-4">
                  Transactions (Selected Period)
                </p>
                <div className="flex items-end gap-3">
                  <span className="text-3xl font-bold text-blue-400">
                    {commissionsReport.byProvider.reduce(
                      (sum, p) => sum + p.count,
                      0,
                    )}
                  </span>
                  <span className="text-slate-500 mb-1">
                    commission-provider services
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Market Share / Provider Breakdown */}
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg">
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  <PieChartIcon size={18} className="text-pink-500" />
                  Volume by Provider (USD)
                </h3>
                {/* LC-5 (round-2 review): the inner ring is `revenue_usd`
                    (transfer principal / pass-through volume — a provider
                    moving a lot of money, not necessarily earning much) and
                    the outer ring is `pending_usd` (a real, but unrelated,
                    commission figure) — plotting them on one "Revenue by
                    Provider" pie implied they were the same kind of number.
                    Renamed to "Volume" (what the inner ring actually is) and
                    captioned; the LBP side of both figures is in the table
                    below, not a second currency-mismatched pie. */}
                <p className="text-[11px] text-slate-500 mb-2 leading-snug">
                  Inner ring: transfer/transaction volume moved through each
                  provider (not profit). Outer ring: commission pending, as
                  of now. LBP figures are in the table.
                </p>
                <div className="mb-4">
                  {awaitingSettlementCount > 0 && (
                    <p
                      data-testid="revenue-by-provider-awaiting-caption"
                      className="text-xs text-amber-400/80"
                    >
                      {awaitingSettlementCount} awaiting settlement — commission
                      unknown until settled, not reflected in the chart above
                    </p>
                  )}
                </div>
                <div className="h-80">
                  <Suspense
                    fallback={
                      <div className="h-80 animate-pulse bg-slate-700/30 rounded-xl" />
                    }
                  >
                    {/* PA-4.18: this used to plot `commission`, mislabelled
                        "Revenue by Provider" — it now genuinely plots
                        revenue (i.e. volume, LC-5). USD-only (CommissionsChart
                        is a shared Dashboard component that hardcodes its
                        tooltip currency); the LBP figures are in the detailed table
                        below instead of a second currency-mismatched pie. */}
                    <CommissionsChart
                      pieData={commissionsReport.byProvider.map((p) => ({
                        name: p.provider,
                        value: p.revenue_usd,
                        pending: p.pending_usd,
                      }))}
                      formatAmount={formatAmount}
                    />
                  </Suspense>
                </div>
              </div>

              {/* Detailed Table — PA-4.18: one row per provider, both
                  currencies as sibling fields (never a provider+currency
                  keyed map that can silently collide). */}
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700/50 shadow-lg flex flex-col">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <Activity size={18} className="text-blue-400" />
                  Provider Performance (Selected Period / As Of Now)
                </h3>
                <div className="flex-1 overflow-auto">
                  <DataTable
                    columns={[
                      { header: "Provider", className: "pb-3" },
                      { header: "Transactions", className: "pb-3 text-right" },
                      {
                        header: "Realized",
                        className: "pb-3 text-right",
                      },
                      {
                        header: "Pending (now)",
                        className: "pb-3 text-right",
                      },
                      { header: "Status", className: "pb-3 text-right" },
                    ]}
                    data={commissionsReport.byProvider}
                    exportExcel
                    exportPdf
                    exportFilename="commissions"
                    className="w-full text-left"
                    theadClassName="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/50"
                    tbodyClassName="divide-y divide-slate-700/30"
                    emptyMessage="No provider data"
                    renderRow={(p) => {
                      const hasRealized =
                        p.realized_usd !== 0 || p.realized_lbp !== 0;
                      // A real, known dollar figure is pending — distinct
                      // from awaiting_settlement_count below, which is a
                      // COUNT of rows whose commission is UNKNOWABLE until
                      // settlement (LIRA-163 D15 — never fabricate a $0.00
                      // for those; show the count instead).
                      const hasPendingAmount =
                        p.pending_usd !== 0 || p.pending_lbp !== 0;
                      const hasAwaitingSettlement =
                        p.awaiting_settlement_count > 0;
                      return (
                        <tr
                          key={p.provider}
                          className="group hover:bg-slate-700/30 transition-colors"
                        >
                          <td className="py-4 font-medium text-slate-200">
                            {p.provider}
                          </td>
                          <td className="py-4 text-right text-slate-400">
                            {p.count}
                          </td>
                          <td className="py-4 text-right font-mono font-medium">
                            {hasRealized ? (
                              <div className="flex flex-col items-end gap-0.5 text-emerald-400">
                                {p.realized_usd !== 0 && (
                                  <span>
                                    {formatAmount(p.realized_usd, "USD")}
                                  </span>
                                )}
                                {p.realized_lbp !== 0 && (
                                  <span>
                                    {formatAmount(p.realized_lbp, "LBP")}
                                  </span>
                                )}
                              </div>
                            ) : hasAwaitingSettlement ? (
                              <span className="text-slate-500 text-xs italic font-normal">
                                Awaiting settlement
                              </span>
                            ) : (
                              <span className="text-slate-600">
                                {formatAmount(0, "USD")}
                              </span>
                            )}
                          </td>
                          <td className="py-4 text-right text-amber-400 font-mono">
                            {hasPendingAmount || hasAwaitingSettlement ? (
                              <div className="flex flex-col items-end gap-0.5">
                                {p.pending_usd !== 0 && (
                                  <span>
                                    {formatAmount(p.pending_usd, "USD")}
                                  </span>
                                )}
                                {p.pending_lbp !== 0 && (
                                  <span>
                                    {formatAmount(p.pending_lbp, "LBP")}
                                  </span>
                                )}
                                {hasAwaitingSettlement && (
                                  <span className="text-xs font-normal text-slate-400">
                                    {p.awaiting_settlement_count} awaiting
                                    settlement
                                  </span>
                                )}
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-4 text-right">
                            {hasPendingAmount ? (
                              <span className="text-xs font-medium text-amber-400">
                                Profit Pending
                              </span>
                            ) : hasRealized ? (
                              <span className="text-xs font-medium text-emerald-400">
                                Settled
                              </span>
                            ) : hasAwaitingSettlement ? (
                              <span className="text-xs font-medium text-slate-400">
                                Awaiting Settlement
                              </span>
                            ) : (
                              <span className="text-slate-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    }}
                  />
                </div>
              </div>
            </div>

            {/* LC-1 (round-2 review): a commission provider (e.g. BINANCE)
                whose fee this report cannot currently render a truthful
                USD/LBP figure for (it settles in USDT) is left OUT of
                byProvider entirely rather than shown as a misleading
                $0.00 — but silently dropping it would look identical to
                "this shop has no Binance activity". Surface it instead. */}
            {(commissionsReport.excludedProviders?.length ?? 0) > 0 && (
              <div
                data-testid="commissions-excluded-providers"
                className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4 text-xs text-slate-400 space-y-1"
              >
                {commissionsReport.excludedProviders!.map((ex) => (
                  <p key={ex.provider}>
                    <span className="font-medium text-slate-300">
                      {ex.provider}
                    </span>{" "}
                    is not included above — {ex.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ==================== Pending Profit Tab ==================== */}
        {/* PA-4.16: a genuine fetch error used to render as the exact same
            "No data for this period" placeholder as a legitimately-empty
            period, so a broken query silently looked like a quiet day. */}
        {!loading && tab === "pending" && pendingError && (
          <div className="flex items-start gap-3 rounded-xl border border-red-800/50 bg-red-950/30 p-4">
            <AlertTriangle
              size={18}
              className="mt-0.5 shrink-0 text-red-400"
            />
            <div>
              <p className="font-medium text-red-300">
                Couldn't load pending profit
              </p>
              <p className="mt-1 text-xs text-red-400/80">{pendingError}</p>
            </div>
          </div>
        )}

        {/* ── Unsettled commissions section (OMT/WHISH RECEIVE pending settlement) ── */}
        {/* PA-3.7: also opens when there are ZERO legacy (model-0) rows but
            SOME model-1 rows are awaiting supplier settlement — before this
            fix, a shop fully cut over to AT_SETTLEMENT providers had an
            always-empty `unsettled_commissions` list, so this whole section
            (and every post-cutover pending OMT/WHISH/BILL commission with
            it) simply never rendered on this tab. */}
        {!loading &&
          tab === "pending" &&
          pendingData &&
          (pendingData.unsettled_commissions.length > 0 ||
            (pendingData.unsettled_totals.awaiting_settlement_count ?? 0) >
              0) && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">
                  Pending OMT/WHISH Commissions
                </h3>
                {/* LP-4: unlike the always-all-time unpaid-sales table below,
                    this section (and the Deferred card) IS bound to the date
                    picker above — say so, so the two don't read as the same
                    kind of "pending". */}
                <span className="text-[11px] text-slate-500 normal-case tracking-normal">
                  for the selected period
                </span>
                {pendingData.unsettled_commissions.length > 0 && (
                  <span className="text-xs bg-amber-900/50 text-amber-400 px-2 py-0.5 rounded-full border border-amber-700">
                    {pendingData.unsettled_totals.count} txns
                  </span>
                )}
                {(pendingData.unsettled_totals.awaiting_settlement_count ??
                  0) > 0 && (
                  <span
                    className="text-xs bg-amber-900/50 text-amber-400 px-2 py-0.5 rounded-full border border-amber-700"
                    title="Post-cutover OMT/WHISH/BILL rows — the real commission is unknowable until settlement, so this is a count, never a $ figure."
                  >
                    {pendingData.unsettled_totals.awaiting_settlement_count}{" "}
                    awaiting settlement
                  </span>
                )}
              </div>
              {pendingData.unsettled_commissions.length > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4">
                      <p className="text-xs text-amber-400/70 uppercase tracking-wider mb-1">
                        Pending Commission (USD)
                      </p>
                      <p className="text-2xl font-bold text-amber-300 font-mono">
                        {/* PA-4.13 (LO): same defect as the per-row commission
                            column below — hard-coded `$` + toFixed(4) instead
                            of formatAmount's 2-decimal convention. Found while
                            fixing the row line; same block, same bug class. */}
                        {formatAmount(
                          pendingData.unsettled_totals
                            .total_pending_commission_usd,
                          "USD",
                        )}
                      </p>
                      <p className="text-xs text-amber-500/70 mt-1">
                        Will be realized after settlement with supplier
                      </p>
                    </div>
                    {pendingData.unsettled_totals
                      .total_pending_commission_lbp > 0 && (
                      <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4">
                        <p className="text-xs text-amber-400/70 uppercase tracking-wider mb-1">
                          Pending Commission (LBP)
                        </p>
                        <p className="text-2xl font-bold text-amber-300 font-mono">
                          {pendingData.unsettled_totals.total_pending_commission_lbp.toLocaleString()}{" "}
                          LBP
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="grid grid-cols-12 gap-2 bg-slate-800 text-slate-400 text-xs font-semibold uppercase px-4 py-2">
                      <div className="col-span-2">Provider</div>
                      <div className="col-span-3">Service Type</div>
                      <div className="col-span-2 text-right">Amount</div>
                      <div className="col-span-2 text-right">OMT Fee</div>
                      <div className="col-span-2 text-right">Commission</div>
                      <div className="col-span-1 text-right">Date</div>
                    </div>
                    {pendingData.unsettled_commissions.map((r) => (
                      <div
                        key={r.id}
                        className="grid grid-cols-12 gap-2 px-4 py-2.5 text-sm border-t border-slate-700/50"
                      >
                        <div className="col-span-2 font-medium text-white">
                          {r.provider}
                        </div>
                        <div className="col-span-3 text-slate-400 text-xs">
                          {r.omt_service_type || "—"}
                        </div>
                        {/* PA-1.5: was hard-coded `$`, mislabeling every LBP
                            row's Amount/OMT Fee/Commission as dollars. */}
                        <div className="col-span-2 text-right font-mono text-white">
                          {formatAmount(Math.abs(r.amount), r.currency)}
                        </div>
                        <div className="col-span-2 text-right font-mono text-amber-400">
                          {r.omt_fee
                            ? formatAmount(r.omt_fee, r.currency)
                            : "—"}
                        </div>
                        <div className="col-span-2 text-right font-mono text-amber-300 font-bold">
                          {/* PA-4.13 (LO): was a hard-coded ternary —
                              `$${r.commission.toFixed(4)}` for every
                              non-LBP row, so a USD row showed 4 decimals
                              and a EUR row showed a bare '$'. formatAmount
                              already knows every currency's symbol and
                              decimal_places (LBP included), so it replaces
                              the ternary outright. */}
                          {formatAmount(r.commission, r.currency)}
                        </div>
                        <div className="col-span-1 text-right text-xs text-slate-500">
                          {parseDbDate(r.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <p className="text-xs text-slate-500">
                → Settle these in{" "}
                <span className="text-white font-medium">
                  Settings → Supplier Ledger
                </span>
              </p>
            </div>
          )}

        {/* PA-3.7: Deferred Profit — profit already stamped but stranded
            behind an uncovered partner settlement or client-debt repayment
            (incl. cashless OMT/WHISH settlement commission), previously
            visible only on the Overview tab. Additive visibility only —
            never netted into any total on this page. Hidden when there is
            genuinely nothing deferred, so it never sits on screen as a
            permanent wall of zeroes. */}
        {!loading &&
          tab === "pending" &&
          pendingData?.deferred &&
          (pendingData.deferred.partner_profit_usd !== 0 ||
            pendingData.deferred.partner_profit_lbp !== 0 ||
            pendingData.deferred.client_debt_profit_usd !== 0 ||
            pendingData.deferred.client_debt_profit_lbp !== 0) && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">
                  Deferred Profit (partner &amp; client-debt pending)
                </h3>
                {/* LP-4: this card is date-picker-bound (getDeferredProfit
                    takes fromDt/toDt), unlike the unpaid-sales table below —
                    say so, so the two don't silently read as the same
                    "as of now" scope. */}
                <span className="text-[11px] text-slate-500 normal-case tracking-normal">
                  for the selected period
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4">
                  <p className="text-xs text-amber-400/70 uppercase tracking-wider mb-1">
                    Awaiting partner settlement
                  </p>
                  <p className="text-xl font-bold text-amber-300 font-mono">
                    {formatAmount(
                      pendingData.deferred.partner_profit_usd,
                      "USD",
                    )}
                  </p>
                  {pendingData.deferred.partner_profit_lbp !== 0 && (
                    <p className="text-xl font-bold text-amber-300 font-mono">
                      {formatAmount(
                        pendingData.deferred.partner_profit_lbp,
                        "LBP",
                      )}
                    </p>
                  )}
                </div>
                <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4">
                  <p className="text-xs text-amber-400/70 uppercase tracking-wider mb-1">
                    Awaiting client repayment
                  </p>
                  <p className="text-xl font-bold text-amber-300 font-mono">
                    {formatAmount(
                      pendingData.deferred.client_debt_profit_usd,
                      "USD",
                    )}
                  </p>
                  {pendingData.deferred.client_debt_profit_lbp !== 0 && (
                    <p className="text-xl font-bold text-amber-300 font-mono">
                      {formatAmount(
                        pendingData.deferred.client_debt_profit_lbp,
                        "LBP",
                      )}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Already stamped, not yet earned — separate from the unpaid
                sales below (recognized once the partner or client pays), and
                not included in any total on this page.
              </p>
            </div>
          )}

        {!loading && tab === "pending" && !pendingError && !pendingData && (
          <div className="text-center py-12 text-slate-500">
            No data for this period
          </div>
        )}
        {!loading && tab === "pending" && pendingData && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
              <SummaryCard
                label="Unpaid Sales"
                value={String(pendingData.totals.count)}
                icon={Clock}
                color="text-amber-400"
              />
              <SummaryCard
                label="Outstanding Amount"
                value={formatAmount(
                  pendingData.totals.total_outstanding_usd,
                  "USD",
                )}
                icon={DollarSign}
                color="text-red-400"
              />
              <SummaryCard
                label="Pending Profit"
                value={formatAmount(
                  pendingData.totals.total_pending_profit_usd,
                  "USD",
                )}
                // LP-1 (round 2): a for-partner sale no longer appears in
                // this list/total at all — its pending share lives
                // exclusively in the Deferred card above, at every coverage
                // level. This figure is now purely ordinary customer-debt
                // sales, so the old "(or as the covering partner settles,
                // for partner-obligation sales)" qualifier no longer applies
                // to anything counted here and would mislead.
                subValue="Recognized once each sale is fully paid — partner-obligation sales are tracked separately in the Deferred card above"
                icon={TrendingUp}
                color="text-amber-400"
              />
            </div>
            <p className="text-xs text-slate-500">
              Unpaid sales below are shown regardless of the date range above
              — pending means as of now, not "unpaid within this period".
            </p>

            {/* Table */}
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
              <DataTable<(typeof pendingData.rows)[number]>
                columns={[
                  { header: "Date", className: "text-left px-4 py-3" },
                  { header: "Client", className: "text-left px-4 py-3" },
                  { header: "Items", className: "text-left px-4 py-3" },
                  { header: "Sale Total", className: "text-right px-4 py-3" },
                  { header: "Paid", className: "text-right px-4 py-3" },
                  { header: "Outstanding", className: "text-right px-4 py-3" },
                  {
                    header: "Pending Profit",
                    className: "text-right px-4 py-3",
                  },
                ]}
                data={pendingData.rows}
                exportExcel
                exportPdf
                exportFilename="pending-profit"
                className="w-full text-sm"
                theadClassName="border-b border-slate-700 text-slate-400 text-xs uppercase"
                // LP-4: this table is date-independent (PA-3.8 — "pending
                // means as of now"), so "in this period" was actively
                // contradictory; the caption above already explains the
                // all-time scope.
                emptyMessage="No unpaid sales"
                renderRow={(row) => (
                  <tr
                    key={row.sale_id}
                    className="border-b border-slate-700/50 hover:bg-slate-700/30"
                  >
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {parseDbDate(row.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">
                        {row.client_name}
                      </div>
                      {row.client_phone && (
                        <div className="text-xs text-slate-500">
                          {row.client_phone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs max-w-[200px] truncate">
                      {row.items_summary}
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {formatAmount(row.total_amount_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400">
                      {formatAmount(row.paid_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-red-400 font-medium">
                      {formatAmount(row.outstanding_usd, "USD")}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-400 font-medium">
                      {formatAmount(row.potential_profit_usd, "USD")}
                    </td>
                  </tr>
                )}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
