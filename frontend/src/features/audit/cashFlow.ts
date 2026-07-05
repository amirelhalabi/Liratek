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
 */
export function getCashFlowDirection(
  type: string,
  metaJson?: string | null,
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
    case "EXPENSE":
    case "LOTO_MONTHLY_FEE":
    case "LOTO_SETTLEMENT":
    case "LOTO_CASH_PRIZE": // prize payout: shop cash out (B7 — was unmapped)
    case "SUPPLIER_SETTLEMENT":
    case "CREDIT_CASH_OUT": // shop pays the client their credit
      return "out";
    case "EXCHANGE":
      return "both";
    default:
      return null;
  }
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
