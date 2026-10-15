/**
 * LIRA-322 — the ONE description of an OMT account settlement payload
 * (rule 14), for both payload shapes:
 *
 * - legacy whole-row (`direction` + `selections`) — byte-identical to the
 *   audit text the IPC handler and the REST route wrote before;
 * - amount-first (`per_currency`) — one part per currency, e.g.
 *   "USD PAY $300.00, LBP —".
 *
 * Used by `suppliers:settle-account` (IPC), `POST /api/suppliers/:id/
 * settle-account` (REST) and the settlement transaction's own summary.
 * Pure and defensive: it reads an already-validated payload but never
 * throws on a missing key (an audit line must never break a settlement).
 */

export interface SettleAccountAuditLeg {
  currency_code: string;
  amount: number;
  direction?: "IN" | "OUT";
}

export interface SettleAccountAuditSection {
  direction: "PAY" | "COLLECT";
  payments?: readonly SettleAccountAuditLeg[];
  commission?: number;
  waive?: number;
}

export interface SettleAccountAuditPayload {
  account_supplier_id: number;
  direction?: "PAY" | "COLLECT";
  selections?: readonly unknown[];
  surplus_usd?: number;
  surplus_lbp?: number;
  per_currency?: {
    USD?: SettleAccountAuditSection;
    LBP?: SettleAccountAuditSection;
  };
}

const CURRENCIES = ["USD", "LBP"] as const;
type Currency = (typeof CURRENCIES)[number];

function money(v: number, currency: Currency): string {
  return currency === "USD"
    ? `$${Math.abs(v).toFixed(2)}`
    : `${Math.round(Math.abs(v)).toLocaleString("en-US")} LBP`;
}

/** Money moved in the section's own currency: IN legs − change (OUT) legs. */
export function settleAccountSectionPaid(
  section: SettleAccountAuditSection | undefined,
  currency: Currency,
): number {
  let paid = 0;
  for (const leg of section?.payments ?? []) {
    if (leg?.currency_code !== currency) continue;
    const amt = Math.abs(Number(leg.amount) || 0);
    paid += leg.direction === "OUT" ? -amt : amt;
  }
  return paid;
}

/** "USD PAY $300.00, LBP —" (commission / waive appended when entered). */
export function formatSettleAccountSections(
  perCurrency: SettleAccountAuditPayload["per_currency"],
): string {
  return CURRENCIES.map((currency) => {
    const s = perCurrency?.[currency];
    if (!s) return `${currency} —`;
    let text = `${currency} ${s.direction} ${money(settleAccountSectionPaid(s, currency), currency)}`;
    if ((s.commission ?? 0) > 0)
      text += ` + commission ${money(s.commission ?? 0, currency)}`;
    if ((s.waive ?? 0) > 0) text += ` + waive ${money(s.waive ?? 0, currency)}`;
    return text;
  }).join(", ");
}

/** The audit summary + metadata for `suppliers:settle-account`. */
export function describeSettleAccountForAudit(
  payload: SettleAccountAuditPayload,
): { summary: string; metadata: Record<string, unknown> } {
  const id = payload?.account_supplier_id;
  if (payload?.per_currency !== undefined) {
    const perCurrency: Record<string, unknown> = {};
    for (const currency of CURRENCIES) {
      const s = payload.per_currency?.[currency];
      if (!s) continue;
      perCurrency[currency] = {
        direction: s.direction,
        paid: settleAccountSectionPaid(s, currency),
        commission: s.commission ?? 0,
        waive: s.waive ?? 0,
      };
    }
    return {
      summary: `Settled OMT account #${id} (${formatSettleAccountSections(payload.per_currency)})`,
      metadata: {
        account_supplier_id: id,
        mode: "AMOUNT_FIRST",
        per_currency: perCurrency,
        count: payload.selections?.length ?? null,
      },
    };
  }
  const count = payload?.selections?.length ?? 0;
  return {
    summary: `Settled OMT account #${id} (${payload?.direction}, ${count} row${count === 1 ? "" : "s"})`,
    metadata: {
      account_supplier_id: id,
      direction: payload?.direction,
      count,
      // LIRA-203 — 0/0 when no overpayment was declared.
      surplus_usd: payload?.surplus_usd ?? 0,
      surplus_lbp: payload?.surplus_lbp ?? 0,
    },
  };
}
