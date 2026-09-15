import { useEffect, useMemo, useRef, useState } from "react";
import { appEvents, MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { X } from "lucide-react";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import {
  useSupplierAccountUnsettledQuery,
  useSettleSupplierAccountMutation,
  type AccountBalance,
  type AccountUnsettledRow,
} from "../hooks/useSuppliers";
import {
  accountRowKey,
  collapseNetBalance,
  computeSelectionTotals,
  sortOldestFirst,
} from "../utils/accountSettleMath";

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, wave 2, lane W6) — one action
 * settles the WHOLE OMT open-credit account (the counter, OMT App, iPick)
 * in a single call (rule 16). Modelled on the existing D5 batch-settle
 * confirm step (`Suppliers/index.tsx`'s `showSettleConfirm` block, itself
 * built on the shared `CounterpartySettleModal`) for layout/visual
 * consistency, but this component renders its OWN modal shell rather than
 * `CounterpartySettleModal` itself: that shared component's Confirm/Cancel
 * footer buttons take no `data-testid` prop, and it lives in
 * `packages/ui/src/components/ui/` — a file no lane in this wave owns, so it
 * cannot be extended to add one. Every fixed testid below (CONTRACT_W2.md
 * §2.3) needs to land on a real DOM node this lane controls, so the shell
 * (backdrop, panel, footer) is inlined here instead; `MultiPaymentInput`
 * itself IS still reused directly (rule 14 — it's the one real payment-leg
 * widget, not re-implemented) for the actual payment-leg input.
 *
 * Contract (CONTRACT_W2.md §2.3) — every testid below is FIXED, exact:
 *   supplier-account-settle-sheet / -direction-pay / -direction-collect /
 *   -row / -row-toggle / -selected-total / -net / -deferred-commission /
 *   -submit. The button that OPENS this sheet
 *   (`supplier-account-settle-button`) lives in `Suppliers/index.tsx`.
 *
 * Allocation (D8): rows are fetched via `getSupplierAccountUnsettled`
 * (LIRA-188, read-only in that wave) and pre-selected ENTIRELY on open —
 * every open row starts checked, so the oldest rows are trivially included
 * — the admin then unticks whichever it doesn't want in this batch (D8:
 * "oldest pre-selected, admin can change the selection"). A selected row is
 * all-or-nothing (plan §9.3 — `supplier_ledger` has no partial-coverage
 * column): if the entered payment doesn't cover the selection, this sheet
 * says so and leaves it to the admin to deselect rather than silently
 * accepting a partial settle of an indivisible row.
 *
 * Mixed signs (§8.4): a cashout's LEDGER row is already negative (the
 * account owes the shop) — summing selected rows' signed amounts nets
 * credits against debts for free, no special-casing needed here.
 *
 * Cash routing (D3): the payment legs below go through the SAME
 * `MultiPaymentInput` + `payments[]` wire shape the rest of this page's
 * settle/cashflow flows use — a CASH leg resolves to the OMT Cash Drawer
 * server-side via `resolveServiceCashDrawer` with the PARENT's provider
 * context (core, lane W1). This component never picks a drawer itself.
 *
 * Deferred cashout commission (D14, §8.3a): summed from each selected row's
 * `commission_usd`/`commission_lbp` (see `AccountUnsettledRow`'s doc comment,
 * re-exported from `@liratek/ui` via `useSuppliers.ts`) — core populates
 * these unconditionally (0 for any non-cashout row), so this never guesses
 * at a server-computed commission.
 */

const NET_EPS = 0.01;

/** Handles a negative `amount` by putting the sign BEFORE the currency
 *  marker ("-$337.34", "-1,234 LBP") rather than after it — used for the
 *  NET figure, which is signed (§8.4: negative = the account owes the
 *  shop). Every other call site here only ever passes a non-negative
 *  magnitude, so the sign branch is inert for them. */
function formatMoney(amount: number, currency: "USD" | "LBP"): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return currency === "LBP"
    ? `${sign}${Math.round(abs).toLocaleString()} LBP`
    : `${sign}$${abs.toFixed(2)}`;
}

function rowTypeLabel(row: AccountUnsettledRow): string {
  return row.source_name || row.source_provider || "—";
}

function rowAmountLabel(row: AccountUnsettledRow): string {
  const usd = row.amount_usd || 0;
  const lbp = row.amount_lbp || 0;
  if (Math.abs(lbp) > 0.5 && Math.abs(usd) <= 0.005) {
    return `${lbp > 0 ? "+" : ""}${Math.round(lbp).toLocaleString()} LBP`;
  }
  return `${usd > 0 ? "+" : ""}$${usd.toFixed(2)}`;
}

export interface AccountSettleSheetProps {
  account: AccountBalance;
  onClose: () => void;
  /** Fired after a successful settle — the page closes the sheet and lets
   *  its own queries (already invalidated by the mutation) refresh. */
  onSettled: () => void;
}

export function AccountSettleSheet({
  account,
  onClose,
  onSettled,
}: AccountSettleSheetProps) {
  const { methods } = usePaymentMethods();
  const { buyRate: exchangeRate } = useSellRate();

  const unsettledQuery = useSupplierAccountUnsettledQuery(
    account.account_supplier_id,
  );
  const rows = useMemo(
    () => sortOldestFirst((unsettledQuery.data ?? []) as AccountUnsettledRow[]),
    [unsettledQuery.data],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [directionOverride, setDirectionOverride] = useState<
    "PAY" | "COLLECT" | null
  >(null);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [commissionUsdInput, setCommissionUsdInput] = useState("");
  const [commissionLbpInput, setCommissionLbpInput] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // D8 — pre-select every open row the FIRST time the queue resolves (not
  // on every refetch, which would silently re-check rows the admin had
  // deliberately unticked after e.g. a background refresh).
  const preselectedRef = useRef(false);
  useEffect(() => {
    if (!unsettledQuery.isSuccess || preselectedRef.current) return;
    preselectedRef.current = true;
    setSelected(new Set(rows.map(accountRowKey)));
  }, [unsettledQuery.isSuccess, rows]);

  const totals = useMemo(
    () => computeSelectionTotals(rows, selected),
    [rows, selected],
  );

  const collapsedNet = useMemo(
    () => collapseNetBalance(totals.netUsd, totals.netLbp, exchangeRate),
    [totals.netUsd, totals.netLbp, exchangeRate],
  );
  const direction = directionOverride ?? collapsedNet.direction;
  const targetAmount = Math.abs(collapsedNet.amount);
  const hasTarget = targetAmount > NET_EPS;

  // Reset the payment legs whenever the target the admin must cover changes
  // (a different selection or a manual direction flip) — a stale leg from a
  // previous selection must never silently carry into a new one.
  const multiPaymentKey = `${direction}-${targetAmount.toFixed(2)}-${collapsedNet.currency}`;

  const activeLines = paymentLines.filter((p) => p.amount > 0);
  const hasActiveLegs = activeLines.length > 0;

  const enteredAmount = useMemo(() => {
    let usd = 0;
    let lbp = 0;
    for (const line of activeLines) {
      if (line.currencyCode === "LBP") lbp += line.amount;
      else usd += line.amount;
    }
    return Math.abs(collapseNetBalance(usd, lbp, exchangeRate).amount);
  }, [activeLines, exchangeRate]);

  // §9.3 — a selected row is all-or-nothing: an entered amount that falls
  // short of the selected total can't partially settle a row, so this is a
  // hard block, not just a warning the admin can submit past.
  //
  // Money-safety (owner-reported overpay bug) — an entered amount ABOVE the
  // target is ALSO a hard block, not just the lower bound. This sheet
  // deliberately does NOT wire MultiPaymentInput's `onReturnChange` /
  // `onKeptChange`, so every leg it produces is IN — there is no customer
  // here for a supplier settlement to return change to, and the core
  // repository now rejects any leg with `direction: "OUT"` outright. Until
  // an overpay flow is designed for this sheet, a raw overpaid IN leg must
  // never reach the backend — this is exactly the reviewer-proven "$150 leg
  // settles a $100 debt, drawer drops $150, ledger nets to 0" bug.
  const underpaid = hasTarget && enteredAmount < targetAmount - NET_EPS;
  const overpaid = hasTarget && enteredAmount > targetAmount + NET_EPS;
  const reconciles = !underpaid && !overpaid;

  const settleMutation = useSettleSupplierAccountMutation(
    account.account_supplier_id,
  );

  const confirmDisabled =
    selected.size === 0 ||
    submitting ||
    (hasTarget ? !hasActiveLegs || !reconciles : hasActiveLegs);

  const handleToggleRow = (row: AccountUnsettledRow) => {
    const key = accountRowKey(row);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const selections = rows
        .filter((r) => selected.has(accountRowKey(r)))
        .map((r) => ({ kind: r.kind, id: r.id }));
      const commissionUsd =
        parseFloat(commissionUsdInput.replace(/,/g, "")) || 0;
      const commissionLbp =
        parseFloat(commissionLbpInput.replace(/,/g, "")) || 0;
      const trimmedNote = note.trim();

      const result = await settleMutation.mutateAsync({
        direction,
        selections,
        amount_usd: Math.abs(totals.netUsd),
        amount_lbp: Math.abs(totals.netLbp),
        commission_usd: commissionUsd,
        commission_lbp: commissionLbp,
        exchange_rate: exchangeRate,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        ...(activeLines.length > 0
          ? {
              payments: activeLines.map((p) => ({
                method: p.method,
                currency_code: p.currencyCode,
                amount: p.amount,
              })),
            }
          : {}),
      });

      if (!result.success) {
        alert(result.error || "Settlement failed");
        return;
      }

      appEvents.emit(
        "notification:show",
        `${account.account_name} account ${direction === "PAY" ? "settled" : "collected"} — ${formatMoney(targetAmount, collapsedNet.currency)}`,
        "success",
      );
      onSettled();
    } catch {
      alert("Settlement failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="supplier-account-settle-sheet"
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-2xl shadow-2xl overflow-hidden"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-white">
              Settle {account.account_name} account
            </h3>
            <div className="text-xs text-slate-400 mt-1">
              One payment across the counter, OMT App and iPick.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2">
            {(["PAY", "COLLECT"] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                data-testid={`supplier-account-settle-direction-${dir.toLowerCase()}`}
                onClick={() => setDirectionOverride(dir)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  direction === dir
                    ? dir === "PAY"
                      ? "bg-red-600 text-white"
                      : "bg-green-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {dir === "PAY" ? "Pay OMT" : "Collect from OMT"}
              </button>
            ))}
          </div>

          <div className="border border-slate-700 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 gap-2 bg-slate-900/60 text-slate-400 text-xs font-semibold px-3 py-2">
              <div className="col-span-1" aria-hidden="true" />
              <div className="col-span-3">Type</div>
              <div className="col-span-3 text-right">Amount</div>
              <div className="col-span-5">Date</div>
            </div>
            <div className="max-h-[30vh] overflow-y-auto divide-y divide-slate-700">
              {unsettledQuery.isLoading ? (
                <div className="text-slate-400 text-xs py-4 text-center">
                  Loading unsettled queue…
                </div>
              ) : rows.length === 0 ? (
                <div className="text-slate-500 text-xs py-4 text-center">
                  Nothing to settle on the {account.account_name} account.
                </div>
              ) : (
                rows.map((row) => {
                  const key = accountRowKey(row);
                  const checked = selected.has(key);
                  return (
                    <label
                      key={key}
                      data-testid="supplier-account-settle-row"
                      data-kind={row.kind}
                      data-row-id={row.id}
                      className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center hover:bg-slate-700/30 cursor-pointer"
                    >
                      <div className="col-span-1">
                        <input
                          type="checkbox"
                          data-testid="supplier-account-settle-row-toggle"
                          checked={checked}
                          onChange={() => handleToggleRow(row)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-900"
                        />
                      </div>
                      <div className="col-span-3 text-slate-300 truncate">
                        {rowTypeLabel(row)}
                      </div>
                      <div className="col-span-3 text-right font-mono text-white">
                        {rowAmountLabel(row)}
                      </div>
                      <div className="col-span-5 text-slate-400">
                        {parseDbDate(row.created_at).toLocaleString()}
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-slate-300">
              <span>Selected total</span>
              <span
                data-testid="supplier-account-settle-selected-total"
                className="font-mono font-semibold text-white"
              >
                {[
                  totals.selectedTotalUsd > 0.005
                    ? formatMoney(totals.selectedTotalUsd, "USD")
                    : null,
                  totals.selectedTotalLbp > 0.5
                    ? formatMoney(totals.selectedTotalLbp, "LBP")
                    : null,
                ]
                  .filter(Boolean)
                  .join(" + ") || "$0.00"}
              </span>
            </div>
            <div className="flex justify-between font-bold">
              <span className="text-white">
                Net {direction === "PAY" ? "you pay" : "you collect"}
              </span>
              <span
                data-testid="supplier-account-settle-net"
                className={`font-mono text-base ${
                  direction === "PAY" ? "text-red-400" : "text-green-400"
                }`}
              >
                {/* Signed (not the |targetAmount| magnitude used for the
                    payment-leg input below): positive = shop owes OMT
                    (PAY), negative = OMT owes the shop (COLLECT, §8.4) —
                    the natural computed sign of the selection, independent
                    of `directionOverride` (the server re-validates
                    `direction` against this same recomputed net and
                    rejects a mismatch, so the override can't silently
                    contradict what's shown here). */}
                {formatMoney(collapsedNet.amount, collapsedNet.currency)}
              </span>
            </div>
            <div className="flex justify-between text-slate-300">
              <span>Deferred cashout commission recognised now</span>
              <span
                data-testid="supplier-account-settle-deferred-commission"
                className="font-mono text-emerald-400"
              >
                {[
                  totals.deferredCommissionUsd > 0.005
                    ? formatMoney(totals.deferredCommissionUsd, "USD")
                    : null,
                  totals.deferredCommissionLbp > 0.5
                    ? formatMoney(totals.deferredCommissionLbp, "LBP")
                    : null,
                ]
                  .filter(Boolean)
                  .join(" + ") || "$0.00"}
              </span>
            </div>
            {hasTarget && !reconciles && (
              <p
                className="text-amber-400 text-xs"
                data-testid="supplier-account-settle-mismatch"
              >
                {underpaid
                  ? "The entered payment doesn't cover the selected rows — a selected row can't be partially paid. Enter the full net amount or deselect some rows."
                  : `The entered payment is ${formatMoney(
                      enteredAmount - targetAmount,
                      collapsedNet.currency,
                    )} more than the net amount. Settlement legs must match exactly — reduce the payment to ${formatMoney(
                      targetAmount,
                      collapsedNet.currency,
                    )}.`}
              </p>
            )}
          </div>

          {/* Settlement-day commission for whichever selected rows are
              commission-eligible (the OMT counter, LUMP — iPick never earns
              one, plan §1). Kept LUMP-only here: the per-supplier Settle tab
              still owns the RATE-mode UI for a single-provider batch; this
              is the account-wide sibling for the shared counter rows. */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
                Settlement commission (USD)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={commissionUsdInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/,/g, "");
                  if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                    setCommissionUsdInput(raw);
                  }
                }}
                placeholder="0.00"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
                Settlement commission (LBP)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={commissionLbpInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/,/g, "");
                  if (raw === "" || /^\d+$/.test(raw)) {
                    setCommissionLbpInput(raw);
                  }
                }}
                placeholder="0"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {hasTarget && (
            <MultiPaymentInput
              key={multiPaymentKey}
              totals={[{ amount: targetAmount, currency: collapsedNet.currency }]}
              totalAmountCurrency={collapsedNet.currency}
              currency={collapsedNet.currency}
              onChange={setPaymentLines}
              showPmFee={false}
              showDiscount={false}
              paymentMethods={methods}
              currencies={[
                { code: "USD", symbol: "$" },
                { code: "LBP", symbol: "LBP" },
              ]}
              exchangeRate={exchangeRate}
            />
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Note (optional)
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              placeholder={`Settlement: ${account.account_name} account`}
            />
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="supplier-account-settle-submit"
              onClick={handleSubmit}
              disabled={confirmDisabled}
              className="flex-1 py-3 rounded-xl font-bold text-white shadow-lg active:scale-95 transition-all disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none bg-blue-600 hover:bg-blue-500 shadow-blue-900/20"
            >
              {submitting ? "Processing..." : "Settle Account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AccountSettleSheet;
