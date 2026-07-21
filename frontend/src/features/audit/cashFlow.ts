// Cash-flow direction for the transactions table badge.
//
// Lives in a non-component module (same rationale as auditConstants.ts) so the
// pure logic can be unit-tested without importing the TransactionsViewer page.

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
 * PARTNER_SETTLEMENT / PARTNER_PAYMENT are unusual: unlike every other type,
 * their `amount_usd`/`amount_lbp` are SIGNED (positive = cash into the
 * drawer, negative = out) instead of encoding direction via the type — see
 * PartnerRepository.recordSettlementMoneyMovement. `signedAmounts` (the
 * row's own amount_usd/amount_lbp, unmodified) lets this function read that
 * sign for historical rows written before the CQ-8 counterparty contract;
 * new rows carry `metadata.counterparty.flow` ('IN'|'OUT') and that is
 * preferred whenever present.
 */
export function getCashFlowDirection(
  type: string,
  metaJson?: string | null,
  signedAmounts?: { usd: number; lbp: number },
): "in" | "out" | "both" | null {
  switch (type) {
    case "FINANCIAL_SERVICE": {
      if (metaJson) {
        try {
          const m = JSON.parse(metaJson) as { service_type?: string };
          if (m.service_type === "RECEIVE") return "out";
        } catch {
          /* fall through to default "in" */
        }
      }
      return "in";
    }
    case "SALE":
    case "RECHARGE":
    case "CUSTOM_SERVICE":
    case "MAINTENANCE":
    case "DEBT_REPAYMENT":
    case "SUPPLIER_PAYMENT":
    case "MTC_TOPUP":
    case "ALFA_TOPUP":
    case "CREDIT_CASH_IN": // customer hands the shop cash for account credit
    case "LOTO": // ticket sale: customer cash in (B7 — was unmapped, blank badge)
      return "in";
    case "RECHARGE_TOPUP": {
      // RECHARGE_TOPUP covers two opposite flows. The classic "from drawer"
      // top-up spends cash (out). But Whish App credit-acquisition top-ups —
      // funded by a partner (partnerId) or bought from a client (cashPaid) —
      // increase the provider drawer, so they are inflows (like MTC/ALFA_TOPUP).
      if (metaJson) {
        try {
          const m = JSON.parse(metaJson) as {
            partnerId?: number | null;
            cashPaid?: number | null;
          };
          if (m.partnerId != null || m.cashPaid != null) return "in";
        } catch {
          /* fall through to default "out" */
        }
      }
      return "out";
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
    // LIRA-066: a paper (no-cash) manual partner_ledger correction — the
    // general Partners-page "Record Tx" entry with "Cash moved" OFF. Unlike
    // PARTNER_SETTLEMENT/PARTNER_PAYMENT (which always move a real drawer),
    // this type never does — an explicit null here (rather than falling
    // through to default) is the deliberate choice, same treatment as
    // COUNTERPARTY_DISCOUNT: a green/red cash arrow would misrepresent a row
    // where no cash moved.
    case "PARTNER_ADJUSTMENT":
      return null;
    // LIRA-080: a paper (no-cash) manual debt_ledger correction — the
    // Accounts-page "Add Credit / Debt" entry with "Cash moved" OFF. Unlike
    // CREDIT_CASH_IN/DEBT_CASH_OUT (which always move a real drawer), this
    // type never does — same deliberate blank-badge treatment as
    // PARTNER_ADJUSTMENT/COUNTERPARTY_DISCOUNT.
    case "ACCOUNT_ADJUSTMENT":
      return null;
    // LIRA-080: a paper (no-cash) manual supplier_ledger correction — the
    // Suppliers-page "Add Credit / Debt" entry with "Cash moved" OFF. Its
    // cash-moved counterpart is a SUPPLIER_PAYMENT (which has its own "in"
    // mapping above); this paper variant never moves a drawer, so the badge is
    // deliberately blank — same treatment as PARTNER_ADJUSTMENT/
    // ACCOUNT_ADJUSTMENT.
    case "SUPPLIER_ADJUSTMENT":
      return null;
    case "EXPENSE":
    case "LOTO_MONTHLY_FEE":
    case "LOTO_SETTLEMENT":
    case "LOTO_CASH_PRIZE": // prize payout: shop cash out (B7 — was unmapped)
    case "SUPPLIER_SETTLEMENT":
    case "CREDIT_CASH_OUT": // shop pays the client their credit
    case "DEBT_CASH_OUT": // shop hands the client a cash advance (new debt)
    case "DRAWER_CASHOUT": // owner's draw — cash physically leaves the General drawer
      return "out";
    case "EXCHANGE":
      return "both";
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
 * (customer-facing) payment legs used the CASH method — CASH legs post to the
 * General drawer. Wallet-only transactions (OMT/WHISH app legs, on-account
 * charges) are not till cash. Drives the "Cash only (till)" filter (B6).
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
