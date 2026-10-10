/**
 * How a transactions-list row DESCRIBES its money — the transaction amount,
 * the cash that moved ("paid $5.00 · change $0.50"), a session basket's
 * pooled line, a checkpoint's counted totals, a bills-only commission.
 * Shared by the web Transactions page and the phone's Activity tab (rule 14);
 * moved verbatim from frontend/src/features/audit/transactionDisplay.ts,
 * which re-exports it. The only addition: an optional money formatter, so the
 * phone can shorten LBP ("200k LBP") on its list row.
 *
 * Pure: type imports and pure siblings only (safe in browser.ts and on the phone).
 */
import type { TransactionPaymentLeg } from "../repositories/TransactionRepository.js";
import { REFUND_KEPT_CHANGE_META } from "../validators/transaction.js";
import { extraCurrencyLegs, isSupplierCredit } from "./cashFlow.js";
import { formatCashMoney } from "./transactionText.js";

/** Formats one amount in one currency, e.g. "$5.00" or "450,000 LBP". */
export type MoneyFormatter = (amount: number, currency: string) => string;

/** The row fields these helpers read — a subset of `getRecent`'s row. */
export interface TransactionRowFields {
  type: string;
  amount_usd: number;
  amount_lbp: number;
  metadata_json: string | null;
  reverses_id?: number | null;
  payments?: TransactionPaymentLeg[];
  account_payments?: TransactionPaymentLeg[];
  session_payments?: TransactionPaymentLeg[];
  session_account_payments?: TransactionPaymentLeg[];
}

/**
 * The two ways a bills-only commission settlement can be collected — see
 * `SupplierRepository._bookBillsCommissionDrawerTopUp`.
 */
export const COMMISSION_MODE_TOP_UP = "TOP_UP";
export const COMMISSION_MODE_OTHER_PAYMENT = "OTHER_PAYMENT";

/**
 * The amount fields the Amount column and the cash-flow badge show: the
 * TRANSACTION's own value, never the cash handed over. Sale #99 ($4.25, paid
 * $5) used to read "$5", and its void "$0.5" — the tender, summed from the IN
 * legs (`saleTenderTotals`). The cash now has its own line
 * (`cashMovementLine`).
 *
 * A SALE is USD-priced, so its value is `amount_usd` alone: rows written
 * before the value-not-tender fix (SalesRepository) also stamped the LBP the
 * customer handed over into `amount_lbp`, and showing both would read
 * "$5 + 450,000 LBP" for a $5 sale. A SALE with no USD figure falls back to
 * its LBP field. Every other type shows its stored fields as they are.
 *
 * Signed: a void/refund carries the negated value and renders "−$4.25".
 * `amountSortValue` applies the same rule so sorting matches what is shown.
 */
export function displayAmountFields(
  row: Pick<TransactionRowFields, "type" | "amount_usd" | "amount_lbp">,
): { usd: number; lbp: number } {
  if (row.type === "SALE" && row.amount_usd) {
    return { usd: row.amount_usd, lbp: 0 };
  }
  return { usd: row.amount_usd, lbp: row.amount_lbp };
}


/** Per-currency total of one side's legs, e.g. "$5.00 + 450,000 LBP". */
function sumSide(
  legs: TransactionPaymentLeg[],
  side: "in" | "out",
  money: MoneyFormatter,
): string | null {
  const totals = new Map<string, number>();
  for (const leg of legs) {
    if (leg.direction !== side) continue;
    totals.set(
      leg.currency_code,
      (totals.get(leg.currency_code) ?? 0) + leg.amount,
    );
  }
  const parts = [...totals.entries()].map(([c, a]) => money(a, c));
  return parts.length ? parts.join(" + ") : null;
}


/** Wording for each side of the cash, by row shape. */
const CASH_WORDS = {
  sale: { in: "paid", out: "change" },
  // A void hands the tender back OUT and takes the change back IN.
  saleVoid: { out: "handed back", in: "change taken back" },
  refund: { out: "handed back", in: "taken back" },
} as const;


/** The two sides of `legs` in words, in the order the wording reads best. */
function describeLegs(
  legs: TransactionPaymentLeg[],
  words: { in: string; out: string },
  order: readonly ("in" | "out")[],
  money: MoneyFormatter,
): string[] {
  const parts: string[] = [];
  for (const side of order) {
    const total = sumSide(legs, side, money);
    if (total) parts.push(`${words[side]} ${total}`);
  }
  return parts;
}


/** Refund shapes whose REFUND row is written with FRESH metadata (not a copy
 *  of the original's) and stamps its own kept change as plain
 *  `kept_change_*` — SalesRepository's item refund, the session item refund. */
const OWN_METADATA_REFUND_TYPES = new Set(["item", "sessionItem"]);


/** The kept change a REFUND row booked. The whole-transaction refund
 *  (`_createRefundRow`) copies the ORIGINAL's metadata — its plain
 *  `kept_change_*` is the sale-time kept change, not this refund's — and
 *  records its own under `REFUND_KEPT_CHANGE_META`. Item refunds write fresh
 *  metadata, where plain `kept_change_*` IS the refund's own. */
function refundKeptChange(
  metaJson: string | null,
  money: MoneyFormatter,
): string | null {
  if (!metaJson) return null;
  try {
    const m = JSON.parse(metaJson) as Record<string, unknown>;
    const parts: string[] = [];
    const own =
      typeof m.refundType === "string" &&
      OWN_METADATA_REFUND_TYPES.has(m.refundType);
    const usd =
      m[REFUND_KEPT_CHANGE_META.usd] ?? (own ? m.kept_change_usd : null);
    const lbp =
      m[REFUND_KEPT_CHANGE_META.lbp] ?? (own ? m.kept_change_lbp : null);
    if (typeof usd === "number" && usd > 0)
      parts.push(money(usd, "USD"));
    if (typeof lbp === "number" && lbp > 0)
      parts.push(money(lbp, "LBP"));
    return parts.length ? parts.join(" + ") : null;
  } catch {
    return null;
  }
}


/**
 * The cash that moved, in words, for the line under a SALE, a sale's void,
 * or a REFUND — the rows whose cash differs from their amount because of
 * change: "paid $5.00 · change $0.50", "handed back $5.00 · change taken
 * back $0.50", "handed back $4.00 · kept $0.25". Returns null for every other
 * type (they keep the generic "in: … · out: …" line) and when there is
 * nothing to say.
 */
export function cashMovementLine(
  row: TransactionRowFields,
  money: MoneyFormatter = formatCashMoney,
): string | null {
  const legs = cashLegsFor(row);
  let parts: string[];
  if (row.type === "SALE") {
    parts =
      row.reverses_id == null
        ? describeLegs(legs, CASH_WORDS.sale, ["in", "out"], money)
        : describeLegs(legs, CASH_WORDS.saleVoid, ["out", "in"], money);
  } else if (row.type === "REFUND") {
    parts = describeLegs(legs, CASH_WORDS.refund, ["out", "in"], money);
    const kept = refundKeptChange(row.metadata_json, money);
    if (kept) parts.push(`kept ${kept}`);
  } else {
    return null;
  }
  return parts.length ? parts.join(" · ") : null;
}


/**
 * The "Basket reversed: …" line for a session basket that was voided or
 * refunded as a whole — the pooled legs core flags `reversal`, worded like a
 * sale's void. Null when the basket has no reversal legs.
 */
export function sessionReversalLine(
  pooled: TransactionPaymentLeg[],
  money: MoneyFormatter = formatCashMoney,
): string | null {
  const reversed = pooled.filter((l) => l.reversal);
  if (!reversed.length) return null;
  const parts = describeLegs(reversed, CASH_WORDS.saleVoid, ["out", "in"], money);
  return parts.length ? `Basket reversed: ${parts.join(" · ")}` : null;
}


/** Title-cases an unmapped method code as a fallback, e.g. "PM_FEE" → "Pm Fee". */
export function fallbackMethodLabel(method: string): string {
  return method
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}


/**
 * LIRA-201b (owner note #11-B), fix round M3: the session basket's pooled
 * CASH legs, for the group-header row's OWN, SEPARATELY LABELLED "Session:"
 * line (`SummaryCell`) — never merged into `cashLegsFor`/`methodLegsFor`.
 *
 * Earlier this fed straight into the header row's own in/out line and Method
 * cell, so a header member that ALSO carries its own customer-facing legs
 * (e.g. an exchange linked via `session:linkTransaction`) printed a single
 * mixed own+pooled figure that was neither its own amount nor the pooled
 * total, and the expanded detail/Method cell couldn't tell the two apart.
 * The caller now decides whether to render this (only when the row is the
 * chosen group header) and renders it as its own line, so the row's own
 * legs stay own-only unconditionally — the spec's "each member shows only
 * its own amount and legs" holds for the header member too.
 */
export function sessionPooledCashLegsFor(
  row: TransactionRowFields,
): TransactionPaymentLeg[] {
  return row.session_payments ?? [];
}


/**
 * The session basket's pooled legs for the Method column / payment-detail
 * expander's "Session:" section — cash legs plus the basket's pooled
 * CUSTOMER_ACCOUNT settlement (`session_account_payments`). Same
 * own/pooled separation as `sessionPooledCashLegsFor` above.
 */
export function sessionPooledMethodLegsFor(
  row: TransactionRowFields,
): TransactionPaymentLeg[] {
  return [
    ...(row.session_payments ?? []),
    ...(row.session_account_payments ?? []),
  ];
}


/**
 * Legs for the Method column only: THIS row's own cash/wallet `payments`
 * legs plus any CUSTOMER_ACCOUNT settlement from `account_payments`
 * (debt_ledger). Always own-only, including on a session group-header row
 * (LIRA-201b fix round M3) — the pooled basket legs render separately via
 * `sessionPooledMethodLegsFor`, never merged in here. Kept out of
 * `row.payments` itself so the Summary column's cash-only in:/out: line is
 * unaffected — see the `account_payments` field doc on TransactionRow.
 */
export function methodLegsFor(row: TransactionRowFields): TransactionPaymentLeg[] {
  return [
    ...(row.payments ?? []),
    ...(row.account_payments ?? []),
    // Foreign-currency top-up / cash-out legs, rebuilt from metadata because
    // the upstream customer-cash filter strips them from `row.payments` —
    // without them the Method column reads "—" on a CASH deposit and the
    // "▸ payment detail" expander never appears. See `extraCurrencyLegs`.
    ...extraCurrencyLegs(row.type, row.metadata_json),
  ];
}


/**
 * Cash-only legs for the Summary column's `in: ... · out: ...` line: THIS
 * row's own `payments` only — always, including on a session group-header
 * row (LIRA-201b fix round M3; see `sessionPooledCashLegsFor` for the
 * pooled basket total's own line). Deliberately WITHOUT `account_payments`
 * (CUSTOMER_ACCOUNT never touches a drawer, so it has never belonged in the
 * cash-only line).
 *
 * m1 (fix round) — NOT fed to `CashFlowBadge`: that component reads
 * `row.payments` directly (`SummaryCell`), not this function's output.
 */
export function cashLegsFor(row: TransactionRowFields): TransactionPaymentLeg[] {
  return [
    ...(row.payments ?? []),
    ...extraCurrencyLegs(row.type, row.metadata_json),
  ];
}


export type CheckpointAmountEntry = {
  drawer_name: string;
  currency_code: string;
  physical_amount: number;
};


export function formatCheckpointAmounts(
  metaJson: string | null,
): string | null {
  if (!metaJson) return null;
  try {
    const meta = JSON.parse(metaJson) as { amounts?: CheckpointAmountEntry[] };
    if (!meta.amounts || meta.amounts.length === 0) return null;

    // Group non-zero amounts by drawer
    const byDrawer = new Map<string, CheckpointAmountEntry[]>();
    for (const entry of meta.amounts) {
      if (entry.physical_amount === 0) continue;
      if (!byDrawer.has(entry.drawer_name)) byDrawer.set(entry.drawer_name, []);
      byDrawer.get(entry.drawer_name)!.push(entry);
    }
    if (byDrawer.size === 0) return null;

    return [...byDrawer.entries()]
      .map(([drawer, entries]) => {
        const amtStr = entries
          .map((e) => {
            if (e.currency_code === "USD")
              return `$${e.physical_amount.toLocaleString()}`;
            if (e.currency_code === "LBP")
              return `${e.physical_amount.toLocaleString()} L`;
            return `${e.physical_amount.toLocaleString()} ${e.currency_code}`;
          })
          .join(" + ");
        return `${drawer}: ${amtStr}`;
      })
      .join(" · ");
  } catch {
    return null;
  }
}


export function checkpointPhysicalTotals(
  metaJson: string | null,
): { usd: number; lbp: number } | null {
  if (!metaJson) return null;
  try {
    const meta = JSON.parse(metaJson) as { amounts?: CheckpointAmountEntry[] };
    if (!meta.amounts) return null;
    let usd = 0,
      lbp = 0;
    for (const e of meta.amounts) {
      if (e.currency_code === "USD") usd += e.physical_amount;
      else if (e.currency_code === "LBP") lbp += e.physical_amount;
    }
    return { usd, lbp };
  } catch {
    return null;
  }
}


/**
 * LIRA-140: true when this row's money landed in a PROVIDER BALANCE rather
 * than a till — it matches the split the closing count sheet already makes
 * (till cash and provider balances are different money), and the
 * Transactions page is the one place they currently look the same (both
 * rendered the plain green "cash in" arrow).
 *
 * Covers exactly TWO shapes, composed from their own existing gates rather
 * than re-derived here (rule 14 — never copy-paste a business predicate):
 *
 *   1. The legacy cashless `SUPPLIER_PAYMENT` receivable — delegated
 *      entirely to `isSupplierCredit`, untouched.
 *   2. The LIRA-137 bills-only settlement drawer top-up — gated first by
 *      `billsOnlyCommissionAmount` (the bills-only shape itself: a real
 *      SUPPLIER_SETTLEMENT with the contractual 0/0 stored amount), then by
 *      `metadata_json.commission_collection_mode`:
 *        - COMMISSION_MODE_TOP_UP, or the field ABSENT: the commission was
 *          credited into the provider's own drawer — provider balance, not
 *          till cash. An absent field still means TOP_UP ran —
 *          `SupplierRepository.ts:1500-1501` stamps
 *          `data.commission_collection_mode ?? "TOP_UP"`, so a real
 *          bills-only row never has a meaningfully-absent value here.
 *        - COMMISSION_MODE_OTHER_PAYMENT: excluded — this mode collects a
 *          real payment leg, which really does hit a drawer, so it is till
 *          money and keeps the plain green arrow.
 *
 * `isSupplierCredit` itself is unchanged and remains exported — it still
 * renders legacy rows on its own, and remains the ready-made hook for
 * LIRA-138.
 */
export function isProviderBalanceInflow(row: TransactionRowFields): boolean {
  if (isSupplierCredit(row.type, row.metadata_json)) return true;
  if (!billsOnlyCommissionAmount(row)) return false;
  try {
    const meta = JSON.parse(row.metadata_json ?? "{}") as {
      commission_collection_mode?: unknown;
    };
    // Only an explicit OTHER_PAYMENT collected a real leg into a real
    // drawer; TOP_UP, an absent field, or any non-string value all default
    // to the provider-balance (TOP_UP) reading — see the doc comment above.
    return meta.commission_collection_mode !== COMMISSION_MODE_OTHER_PAYMENT;
  } catch {
    return false;
  }
}


/**
 * PARTNER_SETTLEMENT/PARTNER_PAYMENT and, since LIRA-252 wave 2,
 * CARRIER_LINE_ADJUSTMENT all store SIGNED amount_usd/amount_lbp (positive =
 * cash/credits in, negative = cash/credits out) instead of the unsigned
 * magnitude every other transaction type uses — see
 * PartnerRepository.recordSettlementMoneyMovement and
 * CarrierLineRepository.postCarrierDrawerAdjustment respectively. The sign
 * itself is read by cashFlow.ts's per-type "dynamic" branch; display always
 * wants the plain magnitude (same treatment as the supplier-credit case
 * above). Named generically (not `isSignedPartnerType`) now that a second,
 * unrelated type shares the same signed-amount shape.
 */
export function isSignedAmountType(type: string): boolean {
  return (
    type === "PARTNER_SETTLEMENT" ||
    type === "PARTNER_PAYMENT" ||
    type === "CARRIER_LINE_ADJUSTMENT"
  );
}


/**
 * LIRA-137 residual (BILL_COMMISSION_SETTLEMENT_PLAN.md): a bills-only
 * commission settlement stores `amount_usd`/`amount_lbp` as a contractual
 * 0/0 — a bill's principal already left at creation, so there is no gross
 * amount owed to net. The real money is the commission credited into the
 * provider's own drawer (`SupplierRepository._bookBillsCommissionDrawerTopUp`)
 * — but that leg's `drawer_name` ("Katsh"/"iPick") is in
 * `TransactionRepository`'s `PROVIDER_STOCK_DRAWERS`, so `isInternalLegJs`
 * strips it out of `row.payments` entirely, one layer before the array
 * this page receives is even built (`_attachPaymentLegs`'s `toLeg`, which
 * returns null for it) — there is no leg to read here, by design, and this
 * function does not touch that filter.
 *
 * The SAME commission figure is also stamped onto `metadata_json` —
 * `commission_usd`/`commission_lbp`, sourced from the identical settlement
 * input that funded the drawer leg (SupplierRepository.ts's own doc comment
 * calls these "the real money-bearing totals" for exactly this batch shape)
 * — so this reads THAT field instead of inventing a new one.
 *
 * DISPLAY ONLY: returns a value for the Amount column alone. The row's own
 * `amount_usd`/`amount_lbp` are never touched — they keep meaning "cash
 * through a till" for receipts, the refund-override candidate set, and
 * ProfitRepository's own queries.
 *
 * Gated narrowly: only a bills-only batch (`commission_model === 1` AND
 * `counterparty.flow === "IN"`) with the contractual 0/0 stored amount.
 * Returns null for a legacy OMT/WHISH settlement (`commission_model` 0 or
 * absent) and for every other row type, which keep rendering exactly as
 * before. Parses defensively — a null/absent/malformed `metadata_json`, a
 * missing `counterparty`, or a non-numeric commission field all degrade to
 * null (today's $0.00), never a thrown error or a blanked row.
 */
export function billsOnlyCommissionAmount(
  row: TransactionRowFields,
): { usd: number; lbp: number } | null {
  if (row.type !== "SUPPLIER_SETTLEMENT") return null;
  if (row.amount_usd !== 0 || row.amount_lbp !== 0) return null;
  if (!row.metadata_json) return null;
  try {
    const meta = JSON.parse(row.metadata_json) as {
      commission_model?: unknown;
      commission_usd?: unknown;
      commission_lbp?: unknown;
      counterparty?: { flow?: unknown } | null;
    };
    if (meta.commission_model !== 1) return null;
    if (meta.counterparty?.flow !== "IN") return null;
    const usd =
      typeof meta.commission_usd === "number" ? meta.commission_usd : 0;
    const lbp =
      typeof meta.commission_lbp === "number" ? meta.commission_lbp : 0;
    if (!usd && !lbp) return null;
    return { usd, lbp };
  } catch {
    return null;
  }
}


// ---------------------------------------------------------------------------
// Session baskets (LIRA-201b) — moved from the web app's
// sessionGroupHeaders.ts / transactionDisplay.ts so the phone colours and
// heads a basket exactly like the web Transactions page.
// ---------------------------------------------------------------------------

/** The row fields the session-basket helpers read. */
export interface SessionRowFields {
  id: number;
  session_id?: number | null;
  status?: string;
  session_payments?: TransactionPaymentLeg[];
  session_account_payments?: TransactionPaymentLeg[];
}

/** Maps session ID → hue (0–359) via the golden angle (~137.5°) so any two
 *  sessions stay maximally separated in colour space — no palette cap. */
export function sessionHue(sessionId: number): number {
  return Math.round(Math.abs(sessionId * 137.508)) % 360;
}

function hasPooledLegs(row: SessionRowFields): boolean {
  return (
    (row.session_payments?.length ?? 0) > 0 ||
    (row.session_account_payments?.length ?? 0) > 0
  );
}

/**
 * Map of session_id -> the id of the row chosen to render that session's
 * pooled header, computed from whatever rows are CURRENTLY VISIBLE (the
 * caller's already-filtered, already-fetched set — `TransactionsViewer`
 * passes its `filteredRows`, the same array `DataTable` is given as `data`).
 *
 * Deliberately computed from that pre-sort, pre-export set rather than from
 * DataTable's own sorted row order:
 *  - survives column sorting — sorting only changes WHERE a row renders,
 *    never its id, so the designated header id still designates the same
 *    row wherever it lands after a sort;
 *  - survives a type filter that hides some session members — recomputed
 *    from whatever subset is actually visible, so if today's header member
 *    gets filtered out, the lowest-id member still present picks it up
 *    instead of the pooled summary silently vanishing from the table;
 *  - survives the fetch/LIMIT window — same reasoning: only members that
 *    were actually returned are ever considered, and a single surviving
 *    member is automatically its own session's header;
 *  - survives Excel/PDF export — DataTable's export walks the SAME `data`
 *    array (ignoring only its own on-screen pagination, which this page
 *    doesn't use), via the SAME `exportRow`/`renderRow` closures, so the
 *    export sees an identical header choice to the screen.
 *
 * M2 (fix round) — a row is only a HEADER CANDIDATE if it actually carries
 * pooled legs (`hasPooledLegs`). Pre-fix, the header was picked from ALL
 * session members regardless, so a session with no pooled basket payment at
 * all (an all-on-account basket, or one built purely via
 * `session:linkTransaction`) still got a "pooled basket total" marker on a
 * row whose Summary line showed only its own (unrelated) legs. A session
 * with no pooled-leg-carrying member anywhere in the visible set therefore
 * gets NO entry in the returned map — every member renders as a plain row.
 *
 * m2 (fix round) — among candidates, a VOIDED row is skipped when a
 * non-voided candidate exists, so the pooled total doesn't render
 * struck-through by default; if every candidate happens to be voided, the
 * lowest-id one is still chosen rather than dropping the header entirely.
 *
 * The lowest transaction id (within the eligible pool) is the deterministic
 * tie-breaker — ids are assigned in insertion order, so this is also
 * "whichever eligible member was created first" — stable across reloads for
 * the same underlying data.
 */
export function computeSessionGroupHeaders(
  rows: readonly SessionRowFields[],
): Map<number, number> {
  const candidatesBySession = new Map<number, SessionRowFields[]>();
  for (const row of rows) {
    if (row.session_id == null || !hasPooledLegs(row)) continue;
    const list = candidatesBySession.get(row.session_id) ?? [];
    list.push(row);
    candidatesBySession.set(row.session_id, list);
  }

  const headerBySession = new Map<number, number>();
  for (const [sessionId, candidates] of candidatesBySession) {
    const nonVoided = candidates.filter((r) => r.status !== "VOIDED");
    const pool = nonVoided.length > 0 ? nonVoided : candidates;
    const headerId = pool.reduce(
      (min, r) => (r.id < min ? r.id : min),
      pool[0]!.id,
    );
    headerBySession.set(sessionId, headerId);
  }
  return headerBySession;
}

/** Whether `row` is the chosen header for its session, given a map already
 *  computed by `computeSessionGroupHeaders`. False for every non-session row. */
export function isSessionGroupHeader(
  row: Pick<SessionRowFields, "id" | "session_id">,
  headerBySession: Map<number, number>,
): boolean {
  return (
    row.session_id != null && headerBySession.get(row.session_id) === row.id
  );
}
