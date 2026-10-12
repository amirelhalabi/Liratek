import { useEffect, useMemo, useRef, useState } from "react";
import { appEvents, MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { X } from "lucide-react";
import { isOmtRowCovered, type OmtCoveredType } from "@liratek/core";
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
import OmtCoveredTypesPicker from "./OmtCoveredTypesPicker";
import {
  loadCoveredTypes,
  saveCoveredTypes,
} from "../utils/omtCoveredTypesStorage";

/**
 * LIRA-256 — a new-style (commission_model = 1) OMT transfer whose type the
 * statement does not cover waits for a later statement: it cannot be
 * selected here (the server would refuse the batch). Old-style rows and
 * LEDGER rows are never restricted. Uses the ONE core predicate (rule 14).
 */
function isWaitingRow(
  row: AccountUnsettledRow,
  covered: OmtCoveredType[] | undefined,
): boolean {
  return (
    row.kind === "FINANCIAL_SERVICE" &&
    row.commission_model === 1 &&
    !isOmtRowCovered(
      {
        provider: row.source_provider,
        omt_service_type: row.omt_service_type ?? null,
      },
      covered,
    )
  );
}

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
 *
 * Overpayment (LIRA-315, owner decisions 2026-10-12/13 — replaces LIRA-203's
 * separate "record an overpayment" field): paying (PAY) or collecting
 * (COLLECT) MORE than the selected rows net to is allowed. The payment box's
 * change section decides what happens to the extra: "Get change back" /
 * "Return change" (the default — the other side hands it back, sent as OUT
 * legs) or "To account" (no leg — the server books the extra on the
 * account). Only an underpayment blocks Confirm. Existing
 * open credit (a prior overpayment, or a `WALLET_CASHOUT`) needs NO new UI
 * to "apply": it is already a negative row in the list above, pre-selected
 * like any other, and ticking/unticking it already nets against debt via
 * `computeSelectionTotals` — this component only adds a banner surfacing
 * `account.total_usd`/`total_lbp` (already fetched, no new query) so the
 * operator knows credit is sitting there to apply.
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
  // Owner decision 2026-10-07: the rate the cashier actually used on the
  // payment input (hand-edited or not; reported via onExchangeRateChange,
  // also on mount). Sent as `exchange_rate` and stamped on the
  // SUPPLIER_SETTLEMENT row — stamp-only, the server settles per currency.
  // Deliberately NOT fed into the target/collapse below: the payment
  // input is keyed on the target, so re-deriving it from a typed rate would
  // remount the input and discard the rate the cashier just typed.
  const [paymentRate, setPaymentRate] = useState<number | undefined>();

  // `refetchOnMount: "always"` — this sheet decides how much money changes
  // hands, so it must never work off a cached queue that predates a change
  // made outside this file's own mutations (a top-up from Recharge, an OMT
  // SEND, another tab) — see `useSupplierAccountUnsettledQuery`'s own doc
  // comment for the full staleness gap this closes.
  const unsettledQuery = useSupplierAccountUnsettledQuery(
    account.account_supplier_id,
    { refetchOnMount: "always" },
  );
  const rows = useMemo(
    () => sortOldestFirst((unsettledQuery.data ?? []) as AccountUnsettledRow[]),
    [unsettledQuery.data],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // LIRA-256 — the OMT commission types this statement covers, lazily read
  // from this device's last choice (shared with the statement check panel
  // and the Settle tab). undefined = All types (unchanged behaviour).
  const [coveredTypes, setCoveredTypes] = useState<
    OmtCoveredType[] | undefined
  >(() => loadCoveredTypes(account.account_supplier_id));
  const [directionOverride, setDirectionOverride] = useState<
    "PAY" | "COLLECT" | null
  >(null);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [commissionUsdInput, setCommissionUsdInput] = useState("");
  const [commissionLbpInput, setCommissionLbpInput] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // LIRA-315 — change handed back on an overpaid settlement (OUT legs).
  // Change NOT handed back stays on the account: the server books it.
  const [returnLegs, setReturnLegs] = useState<PaymentLine[]>([]);

  // D8 — pre-select every open row the FIRST time the queue resolves (not
  // on every refetch, which would silently re-check rows the admin had
  // deliberately unticked after e.g. a background refresh).
  const preselectedRef = useRef(false);
  useEffect(() => {
    if (!unsettledQuery.isSuccess || preselectedRef.current) return;
    preselectedRef.current = true;
    // LIRA-256 — waiting (uncovered) transfers are never pre-selected.
    setSelected(
      new Set(
        rows.filter((r) => !isWaitingRow(r, coveredTypes)).map(accountRowKey),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first resolve only; the choice's own changes re-derive in handleCoveredChange
  }, [unsettledQuery.isSuccess, rows]);

  // LIRA-256 — a change of covered types re-derives the selection (covered
  // rows oldest-first, as on open) and is remembered on this device.
  const handleCoveredChange = (next: OmtCoveredType[] | undefined) => {
    setCoveredTypes(next);
    saveCoveredTypes(account.account_supplier_id, next);
    setSelected(
      new Set(rows.filter((r) => !isWaitingRow(r, next)).map(accountRowKey)),
    );
  };

  const totals = useMemo(
    () => computeSelectionTotals(rows, selected),
    [rows, selected],
  );

  const collapsedNet = useMemo(
    () => collapseNetBalance(totals.netUsd, totals.netLbp, exchangeRate),
    [totals.netUsd, totals.netLbp, exchangeRate],
  );
  const direction = directionOverride ?? collapsedNet.direction;
  const rowsTargetAmount = Math.abs(collapsedNet.amount);

  // What the payment must AT LEAST cover — the rows' own net. Anything
  // above it is overpay (LIRA-315): handed back as change, or left on the
  // account.
  const targetAmount = rowsTargetAmount;
  const hasTarget = targetAmount > NET_EPS;

  // Reset the payment legs whenever the target the admin must cover changes
  // (a different selection or a manual direction flip) — a
  // stale leg from a previous selection must never silently carry into a
  // new one.
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
  // LIRA-315 (owner decisions 2026-10-12/13): an amount ABOVE the rows' net
  // is no longer blocked. The extra is change handed back (OUT legs, from
  // `onReturnChange`) or stays on the account — the server derives and
  // books it (`_resolveSettlementLegs`), so the old "undeclared overpay
  // drops the drawer with no ledger fact" leak cannot happen.
  const underpaid = hasTarget && enteredAmount < targetAmount - NET_EPS;
  const reconciles = !underpaid;

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
        // Rows-only net — the ticked rows settle exactly (D18). Any extra the
        // legs carry is derived and booked server-side (LIRA-315).
        amount_usd: Math.abs(totals.netUsd),
        amount_lbp: Math.abs(totals.netLbp),
        commission_usd: commissionUsd,
        commission_lbp: commissionLbp,
        exchange_rate: paymentRate ?? exchangeRate,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        ...(activeLines.length > 0
          ? {
              // ONE payload (rule 22): paid lines + change handed back as
              // OUT legs (LIRA-315).
              payments: [
                ...activeLines.map((p) => ({
                  method: p.method,
                  currency_code: p.currencyCode,
                  amount: p.amount,
                })),
                ...returnLegs
                  .filter((l) => l.amount > 0)
                  .map((l) => ({
                    method: l.method,
                    currency_code: l.currencyCode,
                    amount: l.amount,
                    direction: "OUT" as const,
                  })),
              ],
            }
          : {}),
        // LIRA-256 — only when the statement covers some types, never for
        // "All types" (absent = unchanged behaviour).
        ...(coveredTypes ? { covered_omt_service_types: coveredTypes } : {}),
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
        className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
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

          {/* LIRA-203 — the account already carries a credit (a prior
              overpayment, or a WALLET_CASHOUT) when its rollup balance is
              negative. Reuses the `account` prop this sheet already
              receives (LIRA-188's `getAccountBalances`) — no new query.
              "Applying" it needs no dedicated control: it's already a
              negative row in the list below, pre-selected like any other —
              this banner only makes that fact visible. */}
          {(account.total_usd < -NET_EPS || account.total_lbp < -0.5) && (
            <div
              className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl px-3 py-2 text-xs text-emerald-300"
              data-testid="supplier-account-settle-available-credit"
            >
              This account has an available credit of{" "}
              <span className="font-mono font-semibold">
                {[
                  account.total_usd < -NET_EPS
                    ? formatMoney(-account.total_usd, "USD")
                    : null,
                  account.total_lbp < -0.5
                    ? formatMoney(-account.total_lbp, "LBP")
                    : null,
                ]
                  .filter(Boolean)
                  .join(" + ")}
              </span>{" "}
              — the credit row is already ticked below; leave it selected to
              apply it toward this settlement.
            </div>
          )}

          <OmtCoveredTypesPicker
            value={coveredTypes}
            onChange={handleCoveredChange}
            testIdPrefix="supplier-account-settle-covered"
            heading="Which OMT shares does this statement include?"
          />

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
                  const waiting = isWaitingRow(row, coveredTypes);
                  const checked = !waiting && selected.has(key);
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
                          disabled={waiting}
                          onChange={() => handleToggleRow(row)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-900 disabled:opacity-40"
                        />
                      </div>
                      <div className="col-span-3 text-slate-300 truncate flex items-center gap-1">
                        {rowTypeLabel(row)}
                        {waiting && (
                          <span className="px-1 py-0.5 rounded bg-slate-700 text-slate-400 text-[9px] font-semibold">
                            Waiting — not in this statement
                          </span>
                        )}
                        {/* LIRA-203/§8.4 — any negative row (an overpayment
                            surplus OR a WALLET_CASHOUT) is account credit,
                            not debt; badge it so ticking it reads as
                            "applying credit", not "paying a bill". */}
                        {(row.amount_usd < 0 || row.amount_lbp < 0) && (
                          <span className="px-1 py-0.5 rounded bg-emerald-900/50 text-emerald-400 text-[9px] font-semibold uppercase tracking-wide">
                            Credit
                          </span>
                        )}
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
                The entered payment doesn&apos;t cover the selected rows — a
                selected row can&apos;t be partially paid. Enter the full net
                amount or deselect some rows.
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
              totals={[
                { amount: targetAmount, currency: collapsedNet.currency },
              ]}
              totalAmountCurrency={collapsedNet.currency}
              currency={collapsedNet.currency}
              onChange={setPaymentLines}
              // LIRA-315 (owner decisions 2026-10-12/13) — the extra is
              // change handed back (default) or left on the account.
              onReturnChange={setReturnLegs}
              unreturnedChangeTo="ACCOUNT_BALANCE"
              accountLabel={`${account.account_name}'s account`}
              cashOnlyReturn
              showPmFee={false}
              showDiscount={false}
              paymentMethods={methods}
              currencies={[
                { code: "USD", symbol: "$" },
                { code: "LBP", symbol: "LBP" },
              ]}
              exchangeRate={exchangeRate}
              onExchangeRateChange={setPaymentRate}
              // LIRA-310 — on PAY the shop is the payer: the Remaining row
              // reads "Remaining to pay" (labels only — this sheet wires no
              // kept change).
              payer={direction === "PAY" ? "shop" : "customer"}
              // Owner decision 2026-10-12 — no Waive anywhere on the
              // Suppliers page (a gap is typed into the Pay tab's Discount).
              waiveDisabled
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
