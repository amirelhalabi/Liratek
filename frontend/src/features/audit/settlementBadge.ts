/**
 * LIRA-322 (FR-013b) — one OMT account settlement can pay OMT in one
 * currency and take money from OMT in the other. Its cash-flow badge then
 * shows both directions side by side ("OUT $497.00 · IN 2,000,000 LBP")
 * instead of the static SUPPLIER_SETTLEMENT direction.
 *
 * Gate: only when `metadata_json.per_currency` holds a USD and an LBP
 * section with OPPOSITE directions. A one-direction settlement (even one
 * whose change came back in the other currency) keeps today's single badge.
 *
 * Per currency: the direction and amount come from that currency's signed
 * payment legs (< 0 OUT, > 0 IN, change legs included). A currency with no
 * legs falls back to its section's direction (PAY = OUT, COLLECT = IN) and
 * the row's stored amount in that currency.
 */
import type { TransactionPaymentLeg } from "./cashFlow";

export interface MixedSettlementPart {
  currency: "USD" | "LBP";
  direction: "in" | "out";
  /** Magnitude. */
  amount: number;
}

type SectionDirection = "PAY" | "COLLECT";

function readSectionDirections(
  metaJson: string | null | undefined,
): Record<"USD" | "LBP", SectionDirection> | null {
  if (!metaJson) return null;
  let meta: unknown;
  try {
    meta = JSON.parse(metaJson);
  } catch {
    return null;
  }
  if (typeof meta !== "object" || meta === null) return null;
  const perCurrency = (meta as { per_currency?: unknown }).per_currency;
  if (typeof perCurrency !== "object" || perCurrency === null) return null;
  const dirOf = (c: "USD" | "LBP"): SectionDirection | null => {
    const section = (perCurrency as Record<string, unknown>)[c];
    if (typeof section !== "object" || section === null) return null;
    const d = (section as { direction?: unknown }).direction;
    return d === "PAY" || d === "COLLECT" ? d : null;
  };
  const usd = dirOf("USD");
  const lbp = dirOf("LBP");
  if (!usd || !lbp || usd === lbp) return null;
  return { USD: usd, LBP: lbp };
}

/** The two badge parts of a mixed-direction settlement, or null. */
export function mixedSettlementParts(
  type: string,
  metaJson: string | null | undefined,
  legs: TransactionPaymentLeg[] | undefined,
  stored: { usd: number; lbp: number },
): MixedSettlementPart[] | null {
  if (type !== "SUPPLIER_SETTLEMENT") return null;
  const directions = readSectionDirections(metaJson);
  if (!directions) return null;
  const parts: MixedSettlementPart[] = [];
  for (const currency of ["USD", "LBP"] as const) {
    const own = (legs ?? []).filter((l) => l.currency_code === currency);
    const net = own.reduce((s, l) => s + (l.signed_amount || 0), 0);
    const eps = currency === "USD" ? 0.005 : 0.5;
    if (own.length > 0 && Math.abs(net) > eps) {
      parts.push({
        currency,
        direction: net < 0 ? "out" : "in",
        amount: Math.abs(net),
      });
      continue;
    }
    const storedAmount = Math.abs(currency === "USD" ? stored.usd : stored.lbp);
    if (storedAmount > eps) {
      parts.push({
        currency,
        direction: directions[currency] === "PAY" ? "out" : "in",
        amount: storedAmount,
      });
    }
  }
  return parts.length > 0 ? parts : null;
}

/** "$497.00" / "2,000,000 LBP". */
export function formatSettlementPart(part: MixedSettlementPart): string {
  return part.currency === "USD"
    ? `$${part.amount.toFixed(2)}`
    : `${Math.round(part.amount).toLocaleString()} LBP`;
}
