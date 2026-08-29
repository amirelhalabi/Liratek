/**
 * The green ↓ / red ↑ cash-flow badge shown beside a row's summary.
 *
 * Lives in its own file because `react-refresh/only-export-components`
 * (rightly) refuses to let a module export both a component and the pure
 * helpers around it — that mix is what made the old TransactionsViewer hard
 * to navigate in the first place.
 */
import {
  formatAmount,
  isSignedPartnerType,
  isSupplierCredit,
} from "../transactionDisplay";
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
}

export function CashFlowBadge({
  type,
  amountUsd,
  amountLbp,
  metaJson,
  legs,
}: CashFlowBadgeProps) {
  // Supplier credit (e.g. a bill commission owed to us): a receivable, not drawer
  // cash. Show a distinct amber "credit" marker instead of the green cash-in
  // arrow, and a positive magnitude (defensive abs for any legacy signed rows).
  if (isSupplierCredit(type, metaJson)) {
    const amountStr = formatAmount(
      Math.abs(amountUsd),
      Math.abs(amountLbp),
      metaJson,
    );
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono">
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
