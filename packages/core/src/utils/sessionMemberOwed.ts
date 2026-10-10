/**
 * LIRA-304 — which basket items the on-account part of a checkout belongs
 * to (owner decision 2026-10-10, "OMT first"): cash paid at checkout covers
 * the shop's primary-system transfers first, so the debt left on the
 * basket's non-sale items lands on the OTHER items first and on the
 * primary-system transfers last. Sales are not in here — their share is
 * pre-covered on the basket row and tracked on `sales.paid_usd`, as before.
 *
 * Pure and Node-free (rule 29).
 */

export interface BasketMemberShareInput {
  /** customer_session_transactions.id */
  id: number;
  /** The member's own charge, per currency (its linked amount). */
  amountUsd: number;
  amountLbp: number;
  /** A transfer on the shop's primary system (OMT or Whish system). */
  isPrimary: boolean;
}

export interface BasketMemberOwed {
  id: number;
  owedUsd: number;
  owedLbp: number;
}

const roundUsd = (n: number): number => Math.round(n * 100) / 100;
const roundLbp = (n: number): number => Math.round(n);

/**
 * Spread the basket row's non-sale debt (`outstandingUsd`/`outstandingLbp`,
 * i.e. the row's amount minus its checkout pre-cover) over the non-sale
 * members. Each currency is filled first from members charged in that same
 * currency (non-primary first, then primary, each in id order), capped at
 * the member's own charge; whatever is left (a USD debt on an LBP-priced
 * item, say) fills the members' remaining value at `rate`, same order. The
 * last unit always lands somewhere, so Σ owed = the outstanding exactly.
 */
export function allocateBasketMemberOwed(input: {
  outstandingUsd: number;
  outstandingLbp: number;
  members: BasketMemberShareInput[];
  rate: number;
}): BasketMemberOwed[] {
  const rate = input.rate > 0 ? input.rate : 1;
  const order = [
    ...input.members.filter((m) => !m.isPrimary).sort((a, b) => a.id - b.id),
    ...input.members.filter((m) => m.isPrimary).sort((a, b) => a.id - b.id),
  ];
  const out = new Map<number, BasketMemberOwed>(
    order.map((m) => [m.id, { id: m.id, owedUsd: 0, owedLbp: 0 }]),
  );
  if (order.length === 0) return [];

  let leftUsd = roundUsd(Math.max(0, input.outstandingUsd));
  let leftLbp = roundLbp(Math.max(0, input.outstandingLbp));

  // Same currency first.
  for (const m of order) {
    const o = out.get(m.id)!;
    const u = roundUsd(Math.min(leftUsd, Math.max(0, m.amountUsd)));
    const l = roundLbp(Math.min(leftLbp, Math.max(0, m.amountLbp)));
    o.owedUsd = roundUsd(o.owedUsd + u);
    o.owedLbp = roundLbp(o.owedLbp + l);
    leftUsd = roundUsd(leftUsd - u);
    leftLbp = roundLbp(leftLbp - l);
  }

  // Cross-currency leftovers: fill each member's remaining value.
  const remainingValue = (m: BasketMemberShareInput): number => {
    const o = out.get(m.id)!;
    return Math.max(
      0,
      m.amountUsd +
        m.amountLbp / rate -
        (o.owedUsd + o.owedLbp / rate),
    );
  };
  for (const m of order) {
    if (leftUsd <= 0) break;
    const u = roundUsd(Math.min(leftUsd, remainingValue(m)));
    if (u <= 0) continue;
    const o = out.get(m.id)!;
    o.owedUsd = roundUsd(o.owedUsd + u);
    leftUsd = roundUsd(leftUsd - u);
  }
  for (const m of order) {
    if (leftLbp <= 0) break;
    const l = roundLbp(Math.min(leftLbp, remainingValue(m) * rate));
    if (l <= 0) continue;
    const o = out.get(m.id)!;
    o.owedLbp = roundLbp(o.owedLbp + l);
    leftLbp = roundLbp(leftLbp - l);
  }

  // Never lose a unit: anything still left (rounding, or a debt larger than
  // the items' value) goes to the last member in the order.
  const last = out.get(order[order.length - 1].id)!;
  if (leftUsd > 0) last.owedUsd = roundUsd(last.owedUsd + leftUsd);
  if (leftLbp > 0) last.owedLbp = roundLbp(last.owedLbp + leftLbp);

  return order.map((m) => out.get(m.id)!);
}
