// Cash-flow direction for the transactions table badge.
//
// Lives in a non-component module (same rationale as auditConstants.ts) so the
// pure logic can be unit-tested without importing the TransactionsViewer page.
//
// The per-type direction now comes from `transactionPresentation.ts` — one
// exhaustive `Record<TransactionType, …>` shared with the viewer's label and
// colour lookups, so a new transaction type cannot silently render with no
// badge. Only metadata-dependent types keep a branch below. That module is
// itself dependency-free (its core import is `import type`, erased at
// compile time), so this one stays unit-testable without the DB stack.
import {
  presentationFor,
  type CashFlowDirection,
} from "./transactionPresentation";

/**
 * Which way cash physically moved for a transaction type, driving the
 * green ↓ (in) / red ↑ (out) badge in the transactions table.
 *
 * FINANCIAL_SERVICE depends on the service direction (metadata.service_type):
 *  - SEND / BILL: the customer hands us cash → in
 *  - RECEIVE: the shop pays the customer out of the drawer(s) → out
 *    (the customer pays nothing; the per-currency payout legs are shown by
 *    the payment-legs subtext)
 *
 * SUPPLIER_PAYMENT likewise spans both directions and is resolved from
 * `metadata.counterparty.flow` / `metadata.direction` — see its case below.
 *
 * PARTNER_SETTLEMENT / PARTNER_PAYMENT are unusual: unlike every other type,
 * their `amount_usd`/`amount_lbp` are SIGNED (positive = cash into the
 * drawer, negative = out) instead of encoding direction via the type — see
 * PartnerRepository.recordSettlementMoneyMovement. `signedAmounts` (the
 * row's own amount_usd/amount_lbp, unmodified) lets this function read that
 * sign for historical rows written before the CQ-8 counterparty contract;
 * new rows carry `metadata.counterparty.flow` ('IN'|'OUT') and that is
 * preferred whenever present.
 */
// Provider *stock* drawers — value the SHOP holds with a provider (telecom
// credit stock, app balance), never customer/owner cash. Mirrors
// TransactionRepository.ts's own `PROVIDER_STOCK_DRAWERS` (rule 14: one
// definition of "is this drawer cash-equivalent"). This frontend module has
// no import path into packages/core (it is deliberately dependency-free so
// it can be unit-tested without the Electron/DB stack), so the set is
// restated here rather than re-derived — change both in lockstep if the
// provider-stock roster ever changes.
const PROVIDER_STOCK_DRAWERS = new Set(["MTC", "Alfa", "Katsh", "iPick"]);

/** True for General/OMT_System/Whish_System/OMT_App/Whish_App — every drawer
 *  the app already treats as customer/owner-facing money. False for the four
 *  provider stock drawers above (and for a missing/unknown name). */
function isCashEquivalentDrawer(
  drawerName: string | null | undefined,
): boolean {
  return !!drawerName && !PROVIDER_STOCK_DRAWERS.has(drawerName);
}

export function getCashFlowDirection(
  type: string,
  metaJson?: string | null,
  signedAmounts?: { usd: number; lbp: number },
  legs?: Array<{ direction: "in" | "out" }>,
): CashFlowDirection | null {
  // Types whose direction follows from the type ALONE now live in the one
  // exhaustive presentation registry, so a newly added TransactionType can no
  // longer slip through with no badge — the record won't compile until it is
  // classified (DRAWER_TOPUP silently did exactly that, see the module doc).
  // Only the genuinely metadata-dependent types fall through to the switch.
  const { direction } = presentationFor(type);
  if (direction !== "dynamic") return direction;

  switch (type) {
    case "FINANCIAL_SERVICE": {
      if (metaJson) {
        try {
          const m = JSON.parse(metaJson) as { service_type?: string };
          if (m.service_type === "RECEIVE") {
            // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md owner decision #10: a
            // fee-on-top RECEIVE books an ADDITIONAL customer-paid-IN leg
            // (the fee) alongside the shop's payout-OUT leg — the plain
            // "out" badge would hide that cash also came IN. `legs` is
            // `row.payments` (TransactionPaymentLeg[]) — already loaded by
            // the caller (TransactionsViewer) for the payment-legs subtext,
            // so passing it through here (rather than re-deriving direction
            // from metadata fee fields, which don't record whether the fee
            // was actually collected via a leg vs netted/deferred) is the
            // one source of truth for "did cash actually move both ways".
            // Every other RECEIVE row (no fee leg, fee-included, or a
            // CUSTOMER_ACCOUNT-only payout with no drawer leg) keeps the
            // plain "out" badge — unchanged.
            const hasInLeg = legs?.some((l) => l.direction === "in");
            const hasOutLeg = legs?.some((l) => l.direction === "out");
            if (hasInLeg && hasOutLeg) return "both";
            return "out";
          }
        } catch {
          /* fall through to default "in" */
        }
      }
      return "in";
    }
    // RECHARGE_TOPUP covers four funding/destination shapes (Top-Up
    // Cash-Flow Direction Audit, TOPUP_CASHFLOW_DIRECTION_AUDIT.md — owner-
    // approved rule: "in" when no cash-equivalent drawer is actually
    // debited (funded by new supplier/partner debt); "both" when a
    // cash-equivalent drawer is debited INTO another cash-equivalent
    // drawer; "out" when the debited cash buys provider STOCK or leaves
    // the business):
    //  - topUpFromPartner: funded by partner credit, no drawer debited
    //    anywhere → "in" (unchanged).
    //  - topUpFromSupplier (the owner's reported Katsh bug):
    //    `sourceDrawer: "SUPPLIER"`, funded by NEW supplier debt, writes
    //    ZERO payment legs, no drawer debited anywhere → "in" (was "out").
    //  - topUpFromClient: General is REALLY debited by `cashPaid` (a raw
    //    `UPDATE`, guarded by `cashPaid > 0`) into Whish_App — both
    //    cash-equivalent → "both" whenever `cashPaid > 0` (was "in",
    //    hiding a genuine till decrease); `cashPaid === 0` still means no
    //    real debit happened, so it stays "in".
    //  - topUpApp (generic "from drawer"; only OMT_App is reachable from
    //    the current UI's TopUpModal — Katsh/iPick always route through
    //    onConfirmSupplier, Whish_App always through the partner/client
    //    sub-modes): a real source drawer is ALWAYS debited (required
    //    field, no partnerId/cashPaid in its metadata) into `destDrawer` —
    //    "both" when destDrawer is cash-equivalent (was "out"); "out" when
    //    destDrawer is a provider *stock* drawer (MTC/Alfa/Katsh/iPick),
    //    matching the cash-for-goods convention (a SALE's inventory
    //    decrease isn't badged either).
    case "RECHARGE_TOPUP": {
      if (metaJson) {
        try {
          const m = JSON.parse(metaJson) as {
            partnerId?: number | null;
            cashPaid?: number | null;
            sourceDrawer?: string | null;
            destDrawer?: string | null;
          };
          if (m.partnerId != null) return "in";
          if (m.cashPaid != null) return m.cashPaid > 0 ? "both" : "in";
          if (m.sourceDrawer === "SUPPLIER") return "in";
          if (m.sourceDrawer != null) {
            return isCashEquivalentDrawer(m.destDrawer) ? "both" : "out";
          }
        } catch {
          /* fall through to default "out" */
        }
      }
      return "out";
    }
    // SUPPLIER_PAYMENT spans BOTH cash directions, so a fixed mapping is always
    // wrong for half its rows: paying a supplier down empties the drawer
    // (direction PAY → out) while a supplier paying us back fills it
    // (RECEIVE → in). The pre-fix code returned "in" for every row, so a
    // manual "paid to <supplier>" payment rendered a green ↓ next to its own
    // "out: $2,000" payment-legs subtext (owner-reported 2026-07-28). Every
    // producer already stamps the CQ-8 counterparty contract
    // (SupplierRepository.recordSupplierCashflow — flow OUT for PAY, IN for
    // RECEIVE — and both addLedgerEntry branches), so read that first;
    // `metadata.direction` is the secondary read. Historical rows carrying
    // neither keep the legacy "in" default. NOTE: `is_credit` rows (cashless
    // supplier credit) never reach here — CashFlowBadge intercepts them with
    // the amber "+" marker.
    case "SUPPLIER_PAYMENT": {
      if (metaJson) {
        try {
          const m = JSON.parse(metaJson) as {
            direction?: string;
            counterparty?: { flow?: "IN" | "OUT" };
          };
          const flow = m.counterparty?.flow;
          if (flow === "OUT") return "out";
          if (flow === "IN") return "in";
          if (m.direction === "PAY") return "out";
          if (m.direction === "RECEIVE") return "in";
        } catch {
          /* fall through to the legacy "in" default */
        }
      }
      return "in";
    }
    case "PARTNER_SETTLEMENT":
    case "PARTNER_PAYMENT": {
      if (metaJson) {
        try {
          const m = JSON.parse(metaJson) as {
            counterparty?: { flow?: "IN" | "OUT"; method?: string };
          };
          // LIRA-066 residual fix: a CLIENT_ACCOUNT settlement moves no real
          // drawer cash (PartnerRepository.recordSettlementMoneyMovement
          // skips the payments row/drawer delta for this method) — same
          // "no badge" treatment as PARTNER_ADJUSTMENT/COUNTERPARTY_DISCOUNT,
          // checked ahead of `flow` (which is still stamped for contract
          // completeness but would otherwise misrepresent cash movement).
          if (m.counterparty?.method === "CLIENT_ACCOUNT") return null;
          const flow = m.counterparty?.flow;
          if (flow === "IN") return "in";
          if (flow === "OUT") return "out";
        } catch {
          /* fall through to the sign-based fallback below */
        }
      }
      // Historical rows (pre-counterparty-contract): read the sign of the
      // row's own signed amount. Only one currency is ever populated per
      // row, so whichever is non-zero carries the sign.
      if (signedAmounts) {
        const signed = signedAmounts.usd || signedAmounts.lbp;
        if (signed > 0) return "in";
        if (signed < 0) return "out";
      }
      return null;
    }
    // SUPPLIER_SETTLEMENT is "out" almost always (the shop pays a supplier's
    // net amount out of a drawer) — EXCEPT a bills-only commission-at-
    // settlement batch (BILL_COMMISSION_SETTLEMENT_PLAN.md, LIRA-137), where
    // the ONLY money that moves is the entered commission arriving IN (a
    // top-up to the provider's own drawer, funded by the provider — "Katsh
    // owes you, they pay it to us"). `SupplierRepository.settleTransactions`
    // stamps `metadata.counterparty.flow` for every row (CQ-8 contract) —
    // "IN" for that one shape, "OUT" for every other (byte-identical to the
    // pre-existing behavior this replaces). Historical rows with no
    // metadata, or a batch predating the CQ-8 contract, default to "out" —
    // unchanged.
    case "SUPPLIER_SETTLEMENT": {
      if (metaJson) {
        try {
          const m = JSON.parse(metaJson) as {
            counterparty?: { flow?: "IN" | "OUT" };
          };
          const flow = m.counterparty?.flow;
          if (flow === "IN") return "in";
          if (flow === "OUT") return "out";
        } catch {
          /* fall through to the default "out" */
        }
      }
      return "out";
    }
    // DRAWER_TOPUP was entirely absent from this switch (rendered NO badge
    // at all — Top-Up Cash-Flow Direction Audit, TOPUP_CASHFLOW_DIRECTION_
    // AUDIT.md finding #4) despite covering two shapes, both always into the
    // General drawer (cash-equivalent). That class of miss is what the
    // presentation registry now makes impossible; this branch survives only
    // because the choice between the two shapes needs the row's metadata:
    //  - "External (Cash In)" (`DrawerTopUpRepository.createTopUp`):
    //    genuinely NEW money entering from outside the system, no source
    //    drawer debited at all — metadata has no `source_drawer` key → "in".
    //  - "From Drawer" (`DrawerTopUpRepository.createTopUpFromDrawer`): a
    //    real named source drawer (e.g. OMT_System/Whish_System, itself
    //    cash-equivalent) is debited via a raw UPDATE straight into General
    //    — metadata stamps `source_drawer` → "both". This is the identical
    //    real-world move `DRAWER_TRANSFER`'s `to_general` direction already
    //    renders "both" for, through a separate legacy code path (see the
    //    audit's §5 note).
    case "DRAWER_TOPUP": {
      if (metaJson) {
        try {
          const m = JSON.parse(metaJson) as { source_drawer?: string | null };
          if (m.source_drawer) return "both";
        } catch {
          /* fall through to default "in" */
        }
      }
      return "in";
    }
    default:
      return null;
  }
}

/**
 * SALE rows show the TENDER — what the customer actually handed over, summed
 * per currency from the IN payment legs — in the Amount column and cash-flow
 * badge, instead of the row's amount fields. The amount fields carry the
 * sale's USD value; rendering value + tendered LBP together read as
 * "$5 + 450,000 LBP" for a $5 sale paid in LBP. Returns null when there are
 * no IN legs (deferred/debt sales, legacy rows) so callers fall back to the
 * value fields. Change is not netted here — the "out:" legs line below the
 * summary already shows it (a $10-cash payment on a $5 sale reads
 * "$10" + "out: $5", i.e. paid vs returned).
 */
export function saleTenderTotals(
  type: string,
  legs:
    | Array<{ direction: "in" | "out"; amount: number; currency_code: string }>
    | undefined,
): { usd: number; lbp: number } | null {
  if (type !== "SALE" || !legs?.length) return null;
  let usd = 0;
  let lbp = 0;
  for (const leg of legs) {
    if (leg.direction !== "in") continue;
    if (leg.currency_code === "USD") usd += leg.amount;
    else if (leg.currency_code === "LBP") lbp += leg.amount;
  }
  return usd || lbp ? { usd, lbp } : null;
}

/**
 * True when the transaction physically touched the till: at least one of its
 * (customer-facing) payment legs used the CASH method. Under the Primary Cash
 * Drawer model (plan §1) a CASH leg no longer always posts to the General
 * drawer — a primary-system SEND/RECEIVE CASH leg resolves to the PCD
 * (OMT_System/Whish_System) instead — but this check is method-based, not
 * drawer-based, so it stays correct either way. Wallet-only transactions
 * (OMT/WHISH app legs, on-account charges) are not till cash. Drives the
 * "Cash only (till)" filter (B6).
 */
export function isCashTransaction(
  payments: Array<{ method: string }> | undefined,
): boolean {
  return !!payments?.some((p) => p.method === "CASH");
}

/**
 * Structured payment leg as returned by TransactionRepository.getRecent
 * (LIRA-064). `signed_amount` keeps the sign; `amount` is the absolute value;
 * `direction` is derived from the sign ("in" = customer paid the shop, "out" =
 * change returned). Mirrors the backend / electron.d.ts shape.
 */
export type TransactionPaymentLeg = {
  direction: "in" | "out";
  amount: number;
  signed_amount: number;
  currency_code: string;
  method: string;
};

/** Format a single payment amount with its currency, e.g. "$50" or "100,000 LBP". */
export function formatLegAmount(leg: TransactionPaymentLeg): string {
  const value = leg.amount.toLocaleString();
  return leg.currency_code === "USD"
    ? `$${value}`
    : `${value} ${leg.currency_code}`;
}

/**
 * Build the "in: ... · out: ..." string from the structured payment legs,
 * joined entirely client-side. Returns null when there are no legs so callers
 * can skip rendering. Same-currency legs on the same side are summed so the
 * label stays compact (e.g. two USD cash legs → one "$50").
 *
 * Payment-Legs Integrity plan (S3 — tender-first display): this reads ONLY
 * `leg.currency_code`/`leg.amount`/`leg.direction` — never the row's own
 * service currency (amount_usd/amount_lbp) — so a USD-denominated service
 * paid with a single LBP leg renders "in: 900,000 LBP", not "in: $10". The
 * function is currency-agnostic by construction; there is no code path that
 * could conflate the two.
 */
export function formatPaymentLegs(
  legs: TransactionPaymentLeg[] | undefined,
): string | null {
  if (!legs || legs.length === 0) return null;

  const sumByCurrency = (side: "in" | "out"): string[] => {
    const totals = new Map<string, number>();
    for (const leg of legs) {
      if (leg.direction !== side) continue;
      totals.set(
        leg.currency_code,
        (totals.get(leg.currency_code) ?? 0) + leg.amount,
      );
    }
    return [...totals.entries()].map(([currency_code, amount]) =>
      formatLegAmount({
        direction: side,
        amount,
        signed_amount: amount,
        currency_code,
        method: "",
      }),
    );
  };

  const inParts = sumByCurrency("in");
  const outParts = sumByCurrency("out");

  const segments: string[] = [];
  if (inParts.length) segments.push(`in: ${inParts.join(" + ")}`);
  if (outParts.length) segments.push(`out: ${outParts.join(" + ")}`);

  return segments.length ? segments.join(" · ") : null;
}

/** The two General-drawer money moves that can carry currencies other than
 *  USD/LBP, both stamping the same `metadata_json.extra_currencies` shape:
 *  DRAWER_TOPUP's External (Cash In) mode (`DrawerTopUpRepository.createTopUp`)
 *  and its sign-flipped sibling `DrawerCashoutRepository.createCashout`.
 *  DRAWER_TOPUP's From-Drawer mode never populates that key (see the
 *  `extra_currencies` doc on `CreateDrawerTopUpData` for why), so it falls
 *  through this map untouched. */
const EXTRA_CURRENCY_DRAWER_MOVES: Record<string, "in" | "out"> = {
  DRAWER_TOPUP: "in",
  DRAWER_CASHOUT: "out",
};

/** Both repositories post these legs with the fixed CASH method — an
 *  owner deposit / owner draw of physical money at the till. Mirrors
 *  `TOPUP_METHOD` / `CASHOUT_METHOD` in core (restated, not imported, for
 *  the same reason `PROVIDER_STOCK_DRAWERS` above is). */
const DRAWER_MOVE_METHOD = "CASH";

type ExtraCurrencyEntry = { currency_code?: unknown; amount?: unknown };

/**
 * Owner report 2026-08-28: a €100 General top-up rendered with no amount, no
 * currency and no method — `↓ —  Drawer Top-Up: General  @ 89,500`.
 *
 * A top-up/cash-out in a currency other than USD/LBP keeps its money OUT of
 * the transaction row's `amount_usd`/`amount_lbp` (those stay USD/LBP-only by
 * design) and in `metadata_json.extra_currencies`. Its real `payments` leg is
 * written — method CASH, drawer General — but never reaches this page:
 * `TransactionRepository.isInternalLegJs` classifies every non-USD/LBP leg as
 * internal (`CUSTOMER_CASH_CURRENCIES`), which is exactly what keeps USDT and
 * other crypto legs out of the D1 cash-flow report and the in/out summary.
 * That filter must not be loosened for a display bug.
 *
 * So this rebuilds the missing legs for DISPLAY ONLY, from the same metadata
 * the repository already stamped — identical remedy to the bills-only
 * commission amount (`billsOnlyCommissionAmount`), which is unreachable in
 * `row.payments` for the same upstream reason. Nothing here is ever written
 * back, summed into a drawer, or fed to a void/refund path.
 *
 * Amounts in metadata are POSITIVE for both flows (the cash-out repository
 * negates only when it posts), so the direction comes from the type, not the
 * sign. Returns [] for every other type, for absent/malformed metadata, and
 * for entries that aren't a positive amount with a currency code.
 */
export function extraCurrencyLegs(
  type: string,
  metaJson: string | null | undefined,
): TransactionPaymentLeg[] {
  const direction = EXTRA_CURRENCY_DRAWER_MOVES[type];
  if (!direction || !metaJson) return [];
  try {
    const meta = JSON.parse(metaJson) as {
      extra_currencies?: ExtraCurrencyEntry[] | null;
    };
    const entries = meta.extra_currencies;
    if (!Array.isArray(entries)) return [];
    const legs: TransactionPaymentLeg[] = [];
    for (const entry of entries) {
      const { currency_code, amount } = entry ?? {};
      if (typeof currency_code !== "string" || !currency_code) continue;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)
        continue;
      legs.push({
        direction,
        amount,
        signed_amount: direction === "out" ? -amount : amount,
        currency_code,
        method: DRAWER_MOVE_METHOD,
      });
    }
    return legs;
  } catch {
    return [];
  }
}
