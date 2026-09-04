/**
 * The green ↓ / red ↑ cash-flow badge shown beside a row's summary.
 *
 * Lives in its own file because `react-refresh/only-export-components`
 * (rightly) refuses to let a module export both a component and the pure
 * helpers around it — that mix is what made the old TransactionsViewer hard
 * to navigate in the first place.
 */
import { formatAmount, isSignedPartnerType } from "../transactionDisplay";
import { getCashFlowDirection, type TransactionPaymentLeg } from "../cashFlow";

export interface CashFlowBadgeProps {
  type: string;
  amountUsd: number;
  amountLbp: number;
  metaJson?: string | null;
  /** BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md owner decision #10: the row's
   *  structured payment legs (already loaded by the caller for the
   *  payment-legs subtext) — lets getCashFlowDirection detect a fee-on-top
   *  RECEIVE's customer-paid-IN leg alongside the payout-OUT leg and render
   *  "both" instead of a plain "out". */
  legs?: TransactionPaymentLeg[] | undefined;
  /** LIRA-140: true when this row's money landed in a provider balance, not
   *  a till (the legacy `is_credit` supplier receivable, or a LIRA-137
   *  bills-only settlement's drawer top-up). Computed by `deriveRow`
   *  (`isProviderBalanceInflow`) rather than here, because that predicate
   *  needs the row's STORED `amount_usd`/`amount_lbp` — the props below are
   *  already a DERIVED display amount (`SummaryCell` passes the commission
   *  figure for a bills-only row, not the stored 0/0) — this component never
   *  sees the stored amounts to re-derive it from. */
  providerBalance: boolean;
}

export function CashFlowBadge({
  type,
  amountUsd,
  amountLbp,
  metaJson,
  legs,
  providerBalance,
}: CashFlowBadgeProps) {
  // LIRA-140: money that landed in a PROVIDER BALANCE, not a till — matches
  // the split the closing count sheet already makes (till cash and provider
  // balances are different money), and the Transactions page is the one
  // place they currently look the same. Covers two shapes: the legacy
  // cashless `is_credit` supplier receivable (a bill commission owed to us
  // with no cash movement) AND the LIRA-137 bills-only settlement's drawer
  // top-up (the commission credited straight into the provider's own
  // drawer, never through a till). Show a distinct amber "credit" marker
  // instead of the plain green cash-in arrow, with a positive magnitude
  // (defensive abs for any legacy signed rows).
  //
  // `data-direction` stays "in" deliberately — the money IS coming in; only
  // its LOCATION differs, which is what `data-cash-location` says instead.
  // `lira-141`'s e2e helper (`assertCashFlowBadge`) asserts exactly that
  // contract: badge visible, `data-testid="cash-flow-badge"`,
  // `data-direction="in"` — do not fold the provider distinction into
  // `data-direction` or that spec breaks.
  if (providerBalance) {
    const amountStr = formatAmount(
      Math.abs(amountUsd),
      Math.abs(amountLbp),
      metaJson,
    );
    return (
      <span
        data-testid="cash-flow-badge"
        data-direction="in"
        data-cash-location="provider"
        className="inline-flex items-center gap-1 text-[11px] font-mono"
      >
        <span className="text-amber-400">+</span>
        <span className="text-amber-400">{amountStr}</span>
      </span>
    );
  }

  const direction = getCashFlowDirection(
    type,
    metaJson,
    {
      usd: amountUsd,
      lbp: amountLbp,
    },
    legs,
  );
  if (!direction) return null;

  // Partner rows carry a signed magnitude (see isSignedPartnerType) — the
  // sign was only needed above to resolve direction; show the plain amount.
  const amountStr = isSignedPartnerType(type)
    ? formatAmount(Math.abs(amountUsd), Math.abs(amountLbp), metaJson, type)
    : formatAmount(amountUsd, amountLbp, metaJson, type);

  if (direction === "both") {
    return (
      <span
        data-testid="cash-flow-badge"
        data-direction="both"
        className="inline-flex items-center gap-1 text-[11px] font-mono"
      >
        <span className="text-emerald-400">↓</span>
        <span className="text-emerald-400">/</span>
        <span className="text-red-400">↑</span>
        <span className="text-slate-300">{amountStr}</span>
      </span>
    );
  }

  if (direction === "in") {
    return (
      <span
        data-testid="cash-flow-badge"
        data-direction="in"
        className="inline-flex items-center gap-1 text-[11px] font-mono"
      >
        <span className="text-emerald-400">↓</span>
        <span className="text-emerald-400">{amountStr}</span>
      </span>
    );
  }

  return (
    <span
      data-testid="cash-flow-badge"
      data-direction="out"
      className="inline-flex items-center gap-1 text-[11px] font-mono"
    >
      <span className="text-red-400">↑</span>
      <span className="text-red-400">{amountStr}</span>
    </span>
  );
}

// Void/refund + receipt gating sets live in auditConstants.ts (shared with
// the actionGating guard test that ties them to core's NON_REVERSIBLE set).
