import { useMemo, useState, type ReactNode } from "react";
import { appEvents, MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { X } from "lucide-react";
import type { AccountSettleAllocResult, OmtCoveredType } from "@liratek/core";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import {
  useSupplierAccountUnsettledQuery,
  useSettleSupplierAccountMutation,
  type AccountBalance,
  type AccountUnsettledRow,
  type SettleAccountRequest,
} from "../hooks/useSuppliers";
import {
  accountRowKey,
  allocateSection,
  directionFromOwed,
  isWaitingRow,
  roundMoney,
  rowRemaining,
  rowsInCurrency,
  scopeOwed,
  settlementScope,
  sortOldestFirst,
  SETTLE_CURRENCIES,
  SETTLE_EPS,
  type SettleCurrency,
  type SettleDirection,
} from "../utils/accountSettleMath";
import OmtCoveredTypesPicker from "./OmtCoveredTypesPicker";
import {
  loadCoveredTypes,
  saveCoveredTypes,
} from "../utils/omtCoveredTypesStorage";

/**
 * Settle Account — ONE action pays or collects the WHOLE OMT open-credit
 * account (the counter, OMT App and iPick) in a single call (rule 16).
 *
 * LIRA-322 (specs/322-omt-amount-first-settle) — settle by AMOUNT, one
 * currency at a time:
 *
 * - One section per currency that has rows (or that the operator chose to
 *   enter money in). OMT never settles one currency with the other, so the
 *   sheet never shows a merged, converted figure (FR-003).
 * - Each section has its own direction, from the sign of what is owed in
 *   that currency ("You pay OMT $497.00" / "OMT pays you 2,000,000 LBP").
 *   Only a currency that owes nothing offers a small Pay / Collect choice.
 * - Each section has its own `MultiPaymentInput`, offering only its own
 *   currency for the money (change may come back in either currency, cash
 *   only — LIRA-315), and its own commission figure.
 * - The payment boxes start EMPTY: the operator types what is handed over
 *   (usually not the full figure). The box still shows what is owed.
 * - The preview is the core allocator (`allocateAccountSettlement`), the
 *   SAME function the server runs: which transfers close, the one that is
 *   part-paid, which stay untouched, what is still owed after and any extra
 *   that goes on the account (FR-007).
 * - Ticking transfers is an optional override behind "Pick transfers"
 *   (US5); with nothing ticked the whole account is in scope.
 * - `expected_owed` is the signed in-scope remaining the preview used; the
 *   server refuses the settlement if it changed (FR-021) and the sheet
 *   refetches the queue, keeping the lines the operator entered.
 *
 * Cash routing (D3): a CASH leg resolves to the OMT drawer server-side
 * (`resolveServiceCashDrawer` with the parent's provider). This component
 * never picks a drawer itself.
 */

const STALE_ERROR_PREFIX = "OMT's balance changed since you opened this sheet.";

/** "$497.00" / "900,000 LBP" — magnitudes only. */
function formatMoney(amount: number, currency: SettleCurrency): string {
  const abs = Math.abs(amount);
  return currency === "LBP"
    ? `${Math.round(abs).toLocaleString()} LBP`
    : `$${abs.toFixed(2)}`;
}

/** Compact form for the preview chips: "$47", "$20.30", "100,000 LBP". */
function formatCompact(amount: number, currency: SettleCurrency): string {
  const abs = Math.abs(amount);
  if (currency === "LBP") return `${Math.round(abs).toLocaleString()} LBP`;
  const cents = Math.round(abs * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

function rowTypeLabel(row: AccountUnsettledRow): string {
  return row.source_name || row.source_provider || "—";
}

/** What a picker row still owes, in its currency. */
function rowRemainingLabel(row: AccountUnsettledRow): string {
  const usd = rowRemaining(row, "USD");
  const lbp = rowRemaining(row, "LBP");
  if (Math.abs(lbp) > SETTLE_EPS.LBP && Math.abs(usd) <= SETTLE_EPS.USD) {
    return `${lbp > 0 ? "+" : "-"}${formatMoney(lbp, "LBP")}`;
  }
  return `${usd > 0 ? "+" : usd < 0 ? "-" : ""}${formatMoney(usd, "USD")}`;
}

function isPartPaid(row: AccountUnsettledRow): boolean {
  return (row.covered_usd || 0) > 0 || (row.covered_lbp || 0) > 0;
}

function isCreditRow(row: AccountUnsettledRow): boolean {
  return rowRemaining(row, "USD") < 0 || rowRemaining(row, "LBP") < 0;
}

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, "")) || 0;
}

function sumAmounts(lines: PaymentLine[], currency?: SettleCurrency): number {
  return lines
    .filter((l) => l.amount > 0 && (!currency || l.currencyCode === currency))
    .reduce((s, l) => s + l.amount, 0);
}

type PerCurrency<T> = Record<SettleCurrency, T>;

/** Everything one currency section needs, derived once per render. */
interface SectionState {
  currency: SettleCurrency;
  /** In-scope rows that still owe something in this currency, oldest first. */
  rows: AccountUnsettledRow[];
  /** Signed in-scope total owed in this currency. */
  owed: number;
  direction: SettleDirection;
  /** Nothing owed: the operator chooses the direction. */
  canChooseDirection: boolean;
  /** Rendered as a full section (rows owed, or the operator opened it). */
  shown: boolean;
  /** Money or commission entered in this section. */
  hasMoney: boolean;
  commission: number;
  /** Sent in `per_currency` (see `included` below). */
  included: boolean;
  /** The preview: the allocation of what is sent, or null (untouched). */
  alloc: AccountSettleAllocResult | null;
  commissionProblem: string | null;
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
  // Owner decision 2026-10-07: the rate the cashier actually used on a
  // payment box (hand-edited or not; reported on mount too). Stamp-only —
  // the server settles each currency natively.
  const [paymentRate, setPaymentRate] = useState<number | undefined>();

  // `refetchOnMount: "always"` — this sheet decides how much money changes
  // hands, so it never works off a cached queue that predates a change made
  // elsewhere (see the hook's own doc comment).
  const unsettledQuery = useSupplierAccountUnsettledQuery(
    account.account_supplier_id,
    { refetchOnMount: "always" },
  );
  const rows = useMemo(
    () => sortOldestFirst((unsettledQuery.data ?? []) as AccountUnsettledRow[]),
    [unsettledQuery.data],
  );

  // LIRA-256 — the OMT commission types this statement covers (this
  // device's last choice; undefined = all types).
  const [coveredTypes, setCoveredTypes] = useState<
    OmtCoveredType[] | undefined
  >(() => loadCoveredTypes(account.account_supplier_id));
  // US5 — optional override: nothing ticked = the whole account.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [directionChoice, setDirectionChoice] = useState<
    PerCurrency<SettleDirection | null>
  >({ USD: null, LBP: null });
  const [lines, setLines] = useState<PerCurrency<PaymentLine[]>>({
    USD: [],
    LBP: [],
  });
  const [returnLegs, setReturnLegs] = useState<PerCurrency<PaymentLine[]>>({
    USD: [],
    LBP: [],
  });
  const [commissionInput, setCommissionInput] = useState<PerCurrency<string>>({
    USD: "",
    LBP: "",
  });
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settleMutation = useSettleSupplierAccountMutation(
    account.account_supplier_id,
  );

  const handleCoveredChange = (next: OmtCoveredType[] | undefined) => {
    setCoveredTypes(next);
    saveCoveredTypes(account.account_supplier_id, next);
    // A row that now waits for a later statement can no longer be ticked.
    setPicked((prev) => {
      const kept = new Set<string>();
      for (const r of rows) {
        const key = accountRowKey(r);
        if (prev.has(key) && !isWaitingRow(r, next)) kept.add(key);
      }
      return kept;
    });
  };

  const handleTogglePick = (row: AccountUnsettledRow) => {
    const key = accountRowKey(row);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const scope = useMemo(
    () => settlementScope(rows, picked, coveredTypes),
    [rows, picked, coveredTypes],
  );
  const expectedOwed = useMemo(() => scopeOwed(scope), [scope]);

  const sections: PerCurrency<SectionState> = useMemo(() => {
    const base = {} as PerCurrency<
      Omit<SectionState, "included" | "alloc" | "commissionProblem">
    >;
    for (const currency of SETTLE_CURRENCIES) {
      const cRows = rowsInCurrency(scope, currency);
      const owed = cRows.reduce((s, r) => s + rowRemaining(r, currency), 0);
      const fromRows = directionFromOwed(owed, currency);
      const commission = parseAmount(commissionInput[currency]);
      base[currency] = {
        currency,
        rows: cRows,
        owed,
        direction: fromRows ?? directionChoice[currency] ?? "PAY",
        canChooseDirection: fromRows === null,
        shown: cRows.length > 0 || directionChoice[currency] !== null,
        hasMoney:
          sumAmounts(lines[currency]) > 0 ||
          sumAmounts(returnLegs[currency]) > 0 ||
          commission > 0,
        commission,
      };
    }
    const moneyOf = (c: SettleCurrency) => ({
      inSame: sumAmounts(lines[c], c),
      outSame: sumAmounts(returnLegs[c], c),
      commission: base[c].commission,
    });
    // A currency goes in the payload when money or commission was entered
    // in it (FR-002: an untouched currency stays unchanged). With nothing
    // entered anywhere, a currency whose credits close debts on their own
    // is sent as a pure-netting section (`payments: []`).
    const anyMoney = SETTLE_CURRENCIES.some((c) => base[c].hasMoney);
    const out = {} as PerCurrency<SectionState>;
    for (const c of SETTLE_CURRENCIES) {
      const s = base[c];
      let alloc: AccountSettleAllocResult | null = null;
      if (s.rows.length > 0 || s.hasMoney) {
        const candidate = allocateSection(scope, c, s.direction, moneyOf(c));
        if (s.hasMoney || (!anyMoney && candidate.closed.length > 0)) {
          alloc = candidate;
        }
      }
      let commissionProblem: string | null = null;
      if (alloc && s.commission > 0) {
        const commissionTaken = alloc.takes
          .filter((t) => t.source === "COMMISSION")
          .reduce((sum, t) => sum + t.amount, 0);
        if (alloc.commission_without_closed_model1) {
          commissionProblem =
            "Commission counts only when this payment fully pays at least one transfer that carries commission.";
        } else if (commissionTaken < s.commission - SETTLE_EPS[c]) {
          commissionProblem = "The commission is more than what is owed.";
        }
      }
      out[c] = { ...s, included: alloc !== null, alloc, commissionProblem };
    }
    return out;
  }, [scope, lines, returnLegs, commissionInput, directionChoice]);

  const includedSections = SETTLE_CURRENCIES.map((c) => sections[c]).filter(
    (s) => s.included,
  );
  const hasCommissionProblem = includedSections.some(
    (s) => s.commissionProblem !== null,
  );
  const confirmDisabled =
    submitting ||
    !unsettledQuery.isSuccess ||
    includedSections.length === 0 ||
    hasCommissionProblem;

  const handleSubmit = async () => {
    if (confirmDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const perCurrency: NonNullable<SettleAccountRequest["per_currency"]> = {};
      for (const s of includedSections) {
        const c = s.currency;
        perCurrency[c] = {
          direction: s.direction,
          // ONE payload (rule 22): money handed over + change handed back
          // (OUT legs, any currency, cash only — LIRA-315).
          payments: [
            ...lines[c]
              .filter((l) => l.amount > 0)
              .map((l) => ({
                method: l.method,
                currency_code: l.currencyCode,
                amount: roundMoney(l.amount, c),
              })),
            ...returnLegs[c]
              .filter((l) => l.amount > 0)
              .map((l) => ({
                method: l.method,
                currency_code: l.currencyCode,
                amount: roundMoney(
                  l.amount,
                  l.currencyCode === "LBP" ? "LBP" : "USD",
                ),
                direction: "OUT" as const,
              })),
          ],
          ...(s.commission > 0
            ? { commission: roundMoney(s.commission, c) }
            : {}),
        };
      }
      const trimmedNote = note.trim();
      const pickedRows = scope.filter((r) => picked.has(accountRowKey(r)));
      const payload: SettleAccountRequest = {
        per_currency: perCurrency,
        expected_owed: { usd: expectedOwed.usd, lbp: expectedOwed.lbp },
        exchange_rate: paymentRate ?? exchangeRate,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        // LIRA-256 — only when the statement covers some types.
        ...(coveredTypes ? { covered_omt_service_types: coveredTypes } : {}),
        // US5 — the ticked transfers, only when some are ticked.
        ...(picked.size > 0 && pickedRows.length > 0
          ? {
              selections: pickedRows.map((r) => ({ kind: r.kind, id: r.id })),
            }
          : {}),
      };

      const result = await settleMutation.mutateAsync(payload);
      if (!result.success) {
        const message = result.error || "Settlement failed";
        setError(message);
        // FR-021 — someone else changed the account: show the new amounts,
        // keep what the operator typed.
        if (message.startsWith(STALE_ERROR_PREFIX)) {
          void unsettledQuery.refetch();
        }
        return;
      }

      const summary = includedSections
        .map((s) => {
          const paid = sumAmounts(lines[s.currency], s.currency);
          if (paid <= 0) return null;
          return `${s.direction === "PAY" ? "paid" : "received"} ${formatMoney(paid, s.currency)}`;
        })
        .filter(Boolean)
        .join(", ");
      appEvents.emit(
        "notification:show",
        `${account.account_name} account settled${summary ? ` — ${summary}` : ""}`,
        "success",
      );
      onSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Settlement failed");
    } finally {
      setSubmitting(false);
    }
  };

  const hasCredit = account.total_usd < -0.01 || account.total_lbp < -0.5;
  const visibleSections = SETTLE_CURRENCIES.map((c) => sections[c]).filter(
    (s) => s.shown,
  );
  const hiddenSections = SETTLE_CURRENCIES.map((c) => sections[c]).filter(
    (s) => !s.shown,
  );

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
              Enter what you pay or receive in each currency — the oldest
              transfers in that currency close first.
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
          {hasCredit && (
            <div
              className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl px-3 py-2 text-xs text-emerald-300"
              data-testid="supplier-account-settle-available-credit"
            >
              This account has an available credit of{" "}
              <span className="font-mono font-semibold">
                {[
                  account.total_usd < -0.01
                    ? formatMoney(account.total_usd, "USD")
                    : null,
                  account.total_lbp < -0.5
                    ? formatMoney(account.total_lbp, "LBP")
                    : null,
                ]
                  .filter(Boolean)
                  .join(" + ")}
              </span>{" "}
              — it is netted against the oldest debt in its own currency.
            </div>
          )}

          <OmtCoveredTypesPicker
            value={coveredTypes}
            onChange={handleCoveredChange}
            testIdPrefix="supplier-account-settle-covered"
            heading="Which OMT shares does this statement include?"
          />

          {unsettledQuery.isLoading ? (
            <div className="text-slate-400 text-xs py-4 text-center">
              Loading unsettled queue…
            </div>
          ) : unsettledQuery.isError ? (
            <div className="text-red-400 text-xs py-4 text-center">
              Couldn&apos;t load the {account.account_name} account. Close and
              try again.
            </div>
          ) : rows.length === 0 ? (
            <div className="text-slate-500 text-xs py-4 text-center">
              Nothing to settle on the {account.account_name} account.
            </div>
          ) : (
            <PickTransfers
              rows={rows}
              picked={picked}
              open={pickerOpen}
              coveredTypes={coveredTypes}
              onToggleOpen={() => setPickerOpen((o) => !o)}
              onTogglePick={handleTogglePick}
              onClear={() => setPicked(new Set())}
            />
          )}

          {unsettledQuery.isSuccess &&
            visibleSections.map((s) => (
              <CurrencySection
                key={s.currency}
                section={s}
                accountName={account.account_name}
                commissionInput={commissionInput[s.currency]}
                onCommissionChange={(raw) =>
                  setCommissionInput((prev) => ({ ...prev, [s.currency]: raw }))
                }
                onChooseDirection={(dir) =>
                  setDirectionChoice((prev) => ({ ...prev, [s.currency]: dir }))
                }
                returnLegs={returnLegs[s.currency]}
                paymentInput={
                  <MultiPaymentInput
                    // Keyed by currency + direction only: a refetch after a
                    // stale refusal keeps the lines the operator typed.
                    key={`${s.currency}-${s.direction}`}
                    label={
                      s.direction === "PAY"
                        ? `You pay (${s.currency})`
                        : `You receive (${s.currency})`
                    }
                    totals={[
                      {
                        amount: roundMoney(Math.abs(s.owed), s.currency),
                        currency: s.currency,
                      },
                    ]}
                    // Starts empty: the operator types the amount handed
                    // over; the box still shows what is owed.
                    fillTotals={[{ amount: 0, currency: s.currency }]}
                    totalAmountCurrency={s.currency}
                    currency={s.currency}
                    onChange={(next) =>
                      setLines((prev) => ({ ...prev, [s.currency]: next }))
                    }
                    // LIRA-315 — change handed back (OUT legs) or, when not
                    // handed back, left on the account (server books it).
                    onReturnChange={(next) =>
                      setReturnLegs((prev) => ({ ...prev, [s.currency]: next }))
                    }
                    unreturnedChangeTo="ACCOUNT_BALANCE"
                    accountLabel={`${account.account_name}'s account`}
                    cashOnlyReturn
                    showPmFee={false}
                    showDiscount={false}
                    paymentMethods={methods}
                    // FR-001 — money in this section is in its own currency.
                    currencies={[
                      s.currency === "USD"
                        ? { code: "USD", symbol: "$" }
                        : { code: "LBP", symbol: "LBP" },
                    ]}
                    returnCurrencies={["USD", "LBP"]}
                    exchangeRate={exchangeRate}
                    onExchangeRateChange={setPaymentRate}
                    payer={s.direction === "PAY" ? "shop" : "customer"}
                    {...(s.direction === "COLLECT"
                      ? { owedLabel: `${account.account_name} still owes` }
                      : {})}
                    // Owner decision 2026-10-12 — no Waive on the Suppliers
                    // page (the server supports it per currency, FR-011).
                    waiveDisabled
                  />
                }
              />
            ))}

          {unsettledQuery.isSuccess && hiddenSections.length > 0 && (
            <div className="space-y-1">
              {hiddenSections.map((s) => (
                <div
                  key={s.currency}
                  data-testid={`supplier-account-settle-nothing-owed-${s.currency.toLowerCase()}`}
                  className="flex items-center justify-between gap-2 text-xs text-slate-500 px-1"
                >
                  <span>Nothing owed in {s.currency}</span>
                  <DirectionChoice
                    currency={s.currency}
                    value={null}
                    onChoose={(dir) =>
                      setDirectionChoice((prev) => ({
                        ...prev,
                        [s.currency]: dir,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
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

          {error && (
            <p
              className="text-red-400 text-xs"
              data-testid="supplier-account-settle-error"
              role="alert"
            >
              {error}
            </p>
          )}

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

/** Pay OMT / Collect from OMT — only for a currency that owes nothing. */
function DirectionChoice({
  currency,
  value,
  onChoose,
}: {
  currency: SettleCurrency;
  value: SettleDirection | null;
  onChoose: (dir: SettleDirection) => void;
}) {
  return (
    <div className="flex gap-1">
      {(["PAY", "COLLECT"] as const).map((dir) => (
        <button
          key={dir}
          type="button"
          data-testid={`supplier-account-settle-direction-${dir.toLowerCase()}-${currency.toLowerCase()}`}
          onClick={() => onChoose(dir)}
          className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
            value === dir
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
  );
}

function CurrencySection({
  section,
  accountName,
  commissionInput,
  onCommissionChange,
  onChooseDirection,
  returnLegs,
  paymentInput,
}: {
  section: SectionState;
  accountName: string;
  commissionInput: string;
  onCommissionChange: (raw: string) => void;
  onChooseDirection: (dir: SettleDirection) => void;
  returnLegs: PaymentLine[];
  paymentInput: ReactNode;
}) {
  const { currency, owed, direction, alloc } = section;
  const lc = currency.toLowerCase();
  const nothingOwed = section.canChooseDirection;
  const stillOwed = alloc ? alloc.remaining_after : owed;
  const extra = alloc ? alloc.extra : 0;
  const changeInOtherCurrency = returnLegs.some(
    (l) => l.amount > 0 && l.currencyCode !== currency,
  );
  const closedKeys = new Set(alloc?.closed.map(accountRowKey) ?? []);

  return (
    <div
      data-testid={`supplier-account-settle-section-${lc}`}
      className="bg-slate-800 rounded-xl p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-white font-bold text-sm">
          {nothingOwed
            ? `Nothing owed in ${currency}`
            : direction === "PAY"
              ? `You pay ${accountName}`
              : `${accountName} pays you`}
        </span>
        {nothingOwed ? (
          <DirectionChoice
            currency={currency}
            value={direction}
            onChoose={onChooseDirection}
          />
        ) : (
          <span
            data-testid={`supplier-account-settle-owed-${lc}`}
            className={`font-mono font-bold text-base ${
              direction === "PAY" ? "text-red-400" : "text-green-400"
            }`}
          >
            {formatMoney(owed, currency)}
          </span>
        )}
      </div>

      {/* Settlement-day commission in THIS currency (LIRA-322 F4): counts
          toward coverage next to the money; recognised only on transfers
          this settlement closes. */}
      <div>
        <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">
          Settlement commission ({currency})
        </label>
        <input
          type="text"
          inputMode={currency === "USD" ? "decimal" : "numeric"}
          data-testid={`supplier-account-settle-commission-${lc}`}
          value={commissionInput}
          onChange={(e) => {
            const raw = e.target.value.replace(/,/g, "");
            const ok =
              currency === "USD" ? /^\d*\.?\d*$/.test(raw) : /^\d*$/.test(raw);
            if (raw === "" || ok) onCommissionChange(raw);
          }}
          placeholder={currency === "USD" ? "0.00" : "0"}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
        />
        {section.commissionProblem && (
          <p
            className="text-amber-400 text-xs mt-1"
            data-testid={`supplier-account-settle-commission-warning-${lc}`}
          >
            {section.commissionProblem}
          </p>
        )}
      </div>

      {paymentInput}

      {section.rows.length > 0 && (
        <div
          data-testid={`supplier-account-settle-preview-${lc}`}
          className="border border-slate-700 rounded-xl overflow-hidden"
        >
          <div className="max-h-[24vh] overflow-y-auto divide-y divide-slate-700">
            {section.rows.map((row) => {
              const key = accountRowKey(row);
              const before = rowRemaining(row, currency);
              const isPartial =
                alloc?.partial != null && accountRowKey(alloc.partial) === key;
              const status = isPartial
                ? "part-paid"
                : closedKeys.has(key)
                  ? "closes"
                  : "untouched";
              return (
                <div
                  key={key}
                  data-testid="supplier-account-settle-preview-row"
                  data-kind={row.kind}
                  data-row-id={row.id}
                  data-status={status}
                  className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center"
                >
                  <div className="col-span-4 text-slate-300 truncate flex items-center gap-1">
                    {rowTypeLabel(row)}
                    {before < 0 && (
                      <span className="px-1 py-0.5 rounded bg-emerald-900/50 text-emerald-400 text-[9px] font-semibold uppercase tracking-wide">
                        Credit
                      </span>
                    )}
                  </div>
                  <div className="col-span-3 text-right font-mono text-white">
                    {formatMoney(before, currency)}
                  </div>
                  <div className="col-span-5 text-right">
                    {status === "closes" ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/50 text-green-300">
                        Closes
                      </span>
                    ) : status === "part-paid" && alloc?.partial ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/50 text-amber-300">
                        {`${formatCompact(alloc.partial.applied, currency)} of ${formatCompact(before, currency)} · ${formatCompact(alloc.partial.remaining, currency)} owed`}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-400">
                        Untouched
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-slate-300">
          <span>
            {stillOwed < -SETTLE_EPS[currency]
              ? `${accountName} still owes you after`
              : "Still owed after"}
          </span>
          <span
            data-testid={`supplier-account-settle-still-owed-${lc}`}
            className="font-mono font-semibold text-white"
          >
            {formatMoney(roundMoney(stillOwed, currency), currency)}
          </span>
        </div>
        {alloc && alloc.cashout_commission_recognised > 0 && (
          <div className="flex justify-between text-slate-300">
            <span>Deferred cashout commission recognised now</span>
            <span
              data-testid={`supplier-account-settle-deferred-commission-${lc}`}
              className="font-mono text-emerald-400"
            >
              {formatMoney(alloc.cashout_commission_recognised, currency)}
            </span>
          </div>
        )}
        {Math.abs(extra) > SETTLE_EPS[currency] && (
          <p
            className="text-emerald-300 text-xs"
            data-testid={`supplier-account-settle-extra-${lc}`}
          >
            {changeInOtherCurrency
              ? `Extra ${formatMoney(extra, currency)} — change handed back in the other currency.`
              : `Extra ${formatMoney(extra, currency)} goes on the account.`}
          </p>
        )}
      </div>
    </div>
  );
}

/** US5 — the optional "Pick transfers" override, collapsed by default. */
function PickTransfers({
  rows,
  picked,
  open,
  coveredTypes,
  onToggleOpen,
  onTogglePick,
  onClear,
}: {
  rows: AccountUnsettledRow[];
  picked: ReadonlySet<string>;
  open: boolean;
  coveredTypes: OmtCoveredType[] | undefined;
  onToggleOpen: () => void;
  onTogglePick: (row: AccountUnsettledRow) => void;
  onClear: () => void;
}) {
  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-slate-900/60 px-3 py-2">
        <button
          type="button"
          data-testid="supplier-account-settle-pick-toggle"
          onClick={onToggleOpen}
          aria-expanded={open}
          className="text-xs font-semibold text-slate-300 hover:text-white"
        >
          {open ? "▾" : "▸"} Pick transfers
          {picked.size > 0 ? ` (${picked.size} picked)` : " (optional)"}
        </button>
        {picked.size > 0 && (
          <button
            type="button"
            data-testid="supplier-account-settle-pick-clear"
            onClick={onClear}
            className="text-xs text-slate-400 hover:text-white"
          >
            Clear — whole account
          </button>
        )}
      </div>
      {open && (
        <div className="max-h-[30vh] overflow-y-auto divide-y divide-slate-700">
          {rows.map((row) => {
            const key = accountRowKey(row);
            const waiting = isWaitingRow(row, coveredTypes);
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
                    checked={!waiting && picked.has(key)}
                    disabled={waiting}
                    onChange={() => onTogglePick(row)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-900 disabled:opacity-40"
                  />
                </div>
                <div className="col-span-4 text-slate-300 truncate flex items-center gap-1">
                  {rowTypeLabel(row)}
                  {waiting && (
                    <span className="px-1 py-0.5 rounded bg-slate-700 text-slate-400 text-[9px] font-semibold">
                      Waiting — not in this statement
                    </span>
                  )}
                  {isCreditRow(row) && (
                    <span className="px-1 py-0.5 rounded bg-emerald-900/50 text-emerald-400 text-[9px] font-semibold uppercase tracking-wide">
                      Credit
                    </span>
                  )}
                  {isPartPaid(row) && (
                    <span className="px-1 py-0.5 rounded bg-amber-900/50 text-amber-300 text-[9px] font-semibold">
                      Part-paid
                    </span>
                  )}
                </div>
                <div className="col-span-3 text-right font-mono text-white">
                  {rowRemainingLabel(row)}
                </div>
                <div className="col-span-4 text-slate-400">
                  {parseDbDate(row.created_at).toLocaleString()}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AccountSettleSheet;
