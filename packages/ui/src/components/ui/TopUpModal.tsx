import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Wallet, X, AlertTriangle, Info, UserRound, Users } from "lucide-react";
import type { TopUpFromClientInput } from "@liratek/core";
import MultiPaymentInput from "./MultiPaymentInput";
import type { PaymentLine } from "./MultiPaymentInput";

function fmtCommas(value: string): string {
  if (!value) return value;
  const parts = value.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function isPartialDecimal(value: string): boolean {
  return /^[0-9]*\.?[0-9]*$/.test(value);
}

/** Fallback payment method list for the "From Client" payout when the page
 *  doesn't pass `clientPaymentMethods` — a bare CASH leg, always drawer-
 *  affecting and always valid against `RechargeRepository.topUpFromClient`. */
const DEFAULT_CLIENT_PAYOUT_METHODS: Array<{ code: string; label: string }> = [
  { code: "CASH", label: "Cash" },
];

export type TopUpProvider =
  | "MTC"
  | "Alfa"
  | "OMT_APP"
  | "WHISH_APP"
  | "iPick"
  | "Katsh";

export type TopUpCurrency = "USD" | "LBP";

export interface DrawerBalanceWithBalance {
  name: string;
  usdBalance: number;
  lbpBalance: number;
}

export interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: {
    amount: number;
    currency: TopUpCurrency;
    sourceDrawer: string;
  }) => void;
  /**
   * When provided for Katsh/iPick, replaces the from-drawer layout with a
   * supplier credit layout: the supplier extends credit, no cash leaves any
   * drawer. The operator settles with the supplier later via the Suppliers page.
   *
   * When provided for OMT_APP, this is one of TWO funding sources the
   * operator can pick between (D4) — "On OMT credit" (default) or "Transfer
   * from drawer" (`onConfirm`, unchanged) — rather than the only option.
   */
  onConfirmSupplier?: (data: {
    amount: number;
    currency: TopUpCurrency;
  }) => Promise<void>;
  /**
   * When provided for WHISH_APP, enables the "Via Partner" sub-mode: the
   * Whish App balance is topped up from a partner's credit line.
   */
  onConfirmPartner?: (data: {
    partnerId: number;
    amount: number;
    currency: TopUpCurrency;
  }) => Promise<void>;
  /**
   * When provided for WHISH_APP, enables the "From Client" sub-mode: a client
   * transfers credits to the shop line, the shop keeps an optional fee and
   * pays out the remainder through `MultiPaymentInput` payout legs.
   *
   * Payload type is `TopUpFromClientInput`, imported from `@liratek/core`
   * (rule 21) — never hand-copied. `payments[]` is REQUIRED (the server
   * derives `cashPaid` from it; the retired scalar is gone from the wire)
   * and any leg with `direction: "OUT"` is hard-rejected by
   * `RechargeRepository.topUpFromClient` — a payout has no customer tender
   * to hand change back from. `fee` is ALSO REQUIRED (may be 0 — the shop's
   * profit on this transaction IS the fee) and the server now reconciles
   * `payments[]` against `amount - fee` with EXACT equality, not the old
   * one-sided "at or under" tolerance.
   */
  onConfirmClient?: (data: TopUpFromClientInput) => Promise<void>;
  /** Rendered inside the modal for the "Via Partner" sub-mode (the page passes a PartnerSelector). */
  partnerSelector?: ReactNode;
  /** The partner id currently selected in `partnerSelector` (the page owns this state). */
  selectedPartnerId?: number | null;
  /**
   * Payment methods offered by the "From Client" payout's
   * `MultiPaymentInput` (WHISH_APP only). MUST be drawer-affecting methods
   * (CASH/OMT/WHISH/BINANCE — never CUSTOMER_ACCOUNT/GIFT_CARD):
   * `RechargeRepository.topUpFromClient` hard-rejects any leg whose method
   * doesn't move a real drawer, since a client top-up payout has no
   * debt/voucher concept. The page owns payment-method loading (mirrors
   * `partnerSelector` above) — pass `usePaymentMethods().drawerAffectingMethods`.
   * Defaults to a CASH-only method when omitted.
   */
  clientPaymentMethods?: Array<{ code: string; label: string }>;
  /**
   * Rendered inside the modal for the "From Client" sub-mode, in place of a
   * free-text name field — the page passes a real client picker (e.g.
   * `ClientAutocompleteInput`) bound to its own name/phone/clientId state.
   * Mirrors `partnerSelector`. Client-linking is optional here — OMT/Whish
   * App transfers allow a fully null client (FEATURE_GUIDE §6).
   */
  clientSelector?: ReactNode;
  /** The client id currently selected alongside `clientSelector` (the page
   *  owns this state) — propagated end-to-end (rule 11) as
   *  `TopUpFromClientInput.clientId`. */
  selectedClientId?: number | null;
  /** The client name currently typed/selected alongside `clientSelector` —
   *  sent as `TopUpFromClientInput.clientName` (a display-only fallback; the
   *  repository re-resolves the name from `clientId` when one is present). */
  selectedClientName?: string;
  provider: TopUpProvider;
  allDrawers: DrawerBalanceWithBalance[];
  destinationDrawer: string;
  defaultSourceDrawer: string;
}

export default function TopUpModal({
  isOpen,
  onClose,
  onConfirm,
  onConfirmSupplier,
  onConfirmPartner,
  onConfirmClient,
  partnerSelector,
  selectedPartnerId,
  clientPaymentMethods,
  clientSelector,
  selectedClientId,
  selectedClientName,
  provider,
  allDrawers,
  destinationDrawer,
  defaultSourceDrawer,
}: TopUpModalProps) {
  // Fix Electron/Windows focus bug: nudge window focus when modal closes
  useEffect(() => {
    if (!isOpen) return;
    const isWindows = navigator.userAgent.includes("Windows");
    if (!isWindows) return;
    return () => {
      try {
        (window as any).api?.display?.fixFocus?.();
      } catch {
        /* ignore */
      }
    };
  }, [isOpen]);

  // OMT App: unlike iPick/Katsh (supplier credit is the ONLY option), the
  // owner kept the drawer-to-drawer transfer available as an explicit
  // alternative to the new OMT-credit default (D4). So OMT App gets a
  // funding-source CHOICE instead of a fixed mode — the two other supplier
  // members don't need one because they never had a transfer path to begin
  // with.
  const isOmtApp = provider === "OMT_APP";
  const omtAppHasCreditOption = isOmtApp && !!onConfirmSupplier;
  const [omtAppFundingMode, setOmtAppFundingMode] = useState<
    "credit" | "transfer"
  >("credit");

  // Katsh/iPick: the supplier extends credit — no cash leaves any drawer.
  // OMT App reaches the same supplier-credit path only while the funding
  // choice above is set to "On OMT credit".
  const isSupplierCredit =
    ((provider === "iPick" || provider === "Katsh") && !!onConfirmSupplier) ||
    (omtAppHasCreditOption && omtAppFundingMode === "credit");

  // Whish App: top up either from a partner credit line or by buying credits
  // from a client (client transfers credits, shop keeps a fee, pays out cash).
  const isWhishTopUp =
    provider === "WHISH_APP" && (!!onConfirmPartner || !!onConfirmClient);

  const [whishMode, setWhishMode] = useState<"partner" | "client">("partner");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<TopUpCurrency>("USD");
  const [sourceDrawer, setSourceDrawer] = useState<string>(defaultSourceDrawer);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Whish "From Client" fee (mirrors OmtWhishAppTransferForm)
  const [manualFee, setManualFee] = useState<string>("");
  const [includingFees, setIncludingFees] = useState<boolean>(false);
  // The payout legs (shop → client) collected by MultiPaymentInput, and the
  // exchange rate it is actually using for any cross-currency leg — the
  // LIRA-194 follow-on (not LIRA-195 — that ticket is a separate, already-
  // archived plan; see docs/plans/done_plans/): `cashPaid` is retired from
  // the wire, replaced by these
  // structured legs (CLAUDE.md rule 16 — undirected, never OUT).
  const [clientPayoutLines, setClientPayoutLines] = useState<PaymentLine[]>(
    [],
  );
  const [clientPayoutExchangeRate, setClientPayoutExchangeRate] = useState<
    number | undefined
  >(undefined);

  const providerLabels: Record<TopUpProvider, string> = {
    MTC: "MTC",
    Alfa: "Alfa",
    OMT_APP: "OMT App",
    WHISH_APP: "Whish App",
    iPick: "iPick",
    Katsh: "Katsh",
  };

  const getProviderLabel = () => {
    return providerLabels[provider] || "Provider";
  };

  // Filter out destination drawer from available sources
  const availableDrawers = allDrawers.filter(
    (drawer) => drawer.name !== destinationDrawer,
  );

  // Get source drawer balance
  const sourceDrawerData = availableDrawers.find(
    (d) => d.name === sourceDrawer,
  );
  const sourceBalance =
    currency === "USD"
      ? (sourceDrawerData?.usdBalance ?? 0)
      : (sourceDrawerData?.lbpBalance ?? 0);

  // Whish "From Client" fee math (replicates OmtWhishAppTransferForm RECEIVE):
  // 1% auto fee on USD amounts, overridable by a manual fee. The client
  // transfers `parsedAmount` credits, the shop keeps `providerFee`, and pays
  // out the remainder as cash.
  const whishParsedAmount = parseFloat(amount) || 0;
  const whishAutoFee =
    currency === "USD" && whishParsedAmount > 0 ? whishParsedAmount * 0.01 : 0;
  const whishManualFee = parseFloat(manualFee) || 0;
  const whishProviderFee = whishManualFee > 0 ? whishManualFee : whishAutoFee;
  const whishCashPaid = Math.max(0, whishParsedAmount - whishProviderFee);
  // Nothing left to pay out once the fee consumes the whole amount — offering
  // MultiPaymentInput (which requires a positive leg amount) would just
  // reject with a confusing schema error at submit; surface it up front.
  const clientPayoutTargetInvalid =
    whishMode === "client" && whishParsedAmount > 0 && whishCashPaid <= 0;
  const clientPayoutMethods =
    clientPaymentMethods && clientPaymentMethods.length > 0
      ? clientPaymentMethods
      : DEFAULT_CLIENT_PAYOUT_METHODS;
  const clientPayoutPositiveLegs = clientPayoutLines.filter(
    (l) => l.amount > 0,
  );

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setCurrency("USD");
      setSourceDrawer(defaultSourceDrawer);
      setIsSubmitting(false);
      setWhishMode("partner");
      setManualFee("");
      setIncludingFees(false);
      setClientPayoutLines([]);
      setClientPayoutExchangeRate(undefined);
      // D4: OMT credit is the default every time the modal (re)opens.
      setOmtAppFundingMode("credit");
    }
  }, [isOpen, defaultSourceDrawer]);

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Please enter a valid amount greater than 0");
      return;
    }

    if (isWhishTopUp) {
      if (whishMode === "partner") {
        if (!onConfirmPartner) return;
        if (!selectedPartnerId) {
          alert("Please select a partner");
          return;
        }
        setIsSubmitting(true);
        try {
          await onConfirmPartner({
            partnerId: selectedPartnerId,
            amount: amountNum,
            currency,
          });
          onClose();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Top-up failed");
        } finally {
          setIsSubmitting(false);
        }
        return;
      }

      // whishMode === "client"
      if (!onConfirmClient) return;
      if (clientPayoutTargetInvalid) {
        alert("The fee exceeds the amount received — nothing left to pay out");
        return;
      }
      const payoutLegs = clientPayoutPositiveLegs.map((l) => ({
        method: l.method,
        currencyCode: l.currencyCode,
        amount: l.amount,
      }));
      if (payoutLegs.length === 0) {
        alert("Enter at least one payout amount");
        return;
      }
      // Only a leg whose currency differs from the credits' currency needs a
      // rate to convert at — the component's own rate callback, never a
      // hand-rolled value (LIRA-194 follow-on).
      const hasCrossCurrencyLeg = clientPayoutPositiveLegs.some(
        (l) => l.currencyCode !== currency,
      );
      setIsSubmitting(true);
      try {
        const trimmedClientName = selectedClientName?.trim();
        await onConfirmClient({
          amount: amountNum,
          currency,
          // `fee` is REQUIRED by `topUpFromClientSchema` and may legitimately
          // be 0 (owner: the shop's profit on this transaction IS the fee,
          // which may be zero) — always sent as a literal field, never behind
          // a truthiness/`?? undefined` guard, or a genuine $0 fee would be
          // dropped from the wire (rule 22).
          fee: whishProviderFee,
          payments: payoutLegs,
          ...(hasCrossCurrencyLeg && clientPayoutExchangeRate
            ? { exchangeRate: clientPayoutExchangeRate }
            : {}),
          ...(selectedClientId ? { clientId: selectedClientId } : {}),
          ...(trimmedClientName ? { clientName: trimmedClientName } : {}),
        });
        onClose();
      } catch (error) {
        alert(error instanceof Error ? error.message : "Top-up failed");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (isSupplierCredit && onConfirmSupplier) {
      setIsSubmitting(true);
      try {
        await onConfirmSupplier({ amount: amountNum, currency });
        onClose();
      } catch (error) {
        alert(error instanceof Error ? error.message : "Top-up failed");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (amountNum > sourceBalance) {
      alert("Insufficient balance in source drawer");
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm({ amount: amountNum, currency, sourceDrawer });
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Top-up failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Wallet className="text-slate-400" size={18} />
            Top Up {getProviderLabel()} Drawer
          </h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {isWhishTopUp && (
            <>
              {/* Sub-mode toggle: Via Partner / From Client */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setWhishMode("partner")}
                  disabled={isSubmitting || !onConfirmPartner}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                    whishMode === "partner"
                      ? "bg-violet-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  } disabled:opacity-50`}
                >
                  <Users size={14} />
                  Via Partner
                </button>
                <button
                  type="button"
                  onClick={() => setWhishMode("client")}
                  disabled={isSubmitting || !onConfirmClient}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                    whishMode === "client"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  } disabled:opacity-50`}
                >
                  <UserRound size={14} />
                  From Client
                </button>
              </div>

              {/* Currency selector (shared by both whish sub-modes) */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Currency
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrency("USD");
                      setAmount("");
                    }}
                    disabled={isSubmitting}
                    className={`flex-1 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                      currency === "USD"
                        ? "bg-violet-600 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    } disabled:opacity-50`}
                  >
                    USD
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrency("LBP");
                      setAmount("");
                    }}
                    disabled={isSubmitting}
                    className={`flex-1 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                      currency === "LBP"
                        ? "bg-violet-600 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    } disabled:opacity-50`}
                  >
                    LBP
                  </button>
                </div>
              </div>

              {/* Via Partner sub-mode */}
              {whishMode === "partner" && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Partner
                  </label>
                  {partnerSelector}
                  {!selectedPartnerId && (
                    <p className="text-xs text-slate-500 mt-1">
                      Select the partner whose credit line funds this top-up.
                    </p>
                  )}
                </div>
              )}

              {/* Amount input (shared) */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  {whishMode === "client"
                    ? "Credits Received from Client"
                    : "Amount"}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={fmtCommas(amount)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/,/g, "");
                      if (isPartialDecimal(cleaned)) setAmount(cleaned);
                    }}
                    placeholder={currency === "LBP" ? "0" : "0.00"}
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                    autoFocus
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    {currency}
                  </span>
                </div>
              </div>

              {/* From Client sub-mode — fee + client name */}
              {whishMode === "client" && (
                <>
                  <div className="rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                      Fee Breakdown
                    </h3>

                    {/* Manual Fee Input */}
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Fee Amount (USD)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                          $
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={fmtCommas(manualFee)}
                          onChange={(e) => {
                            const cleaned = e.target.value.replace(/,/g, "");
                            if (isPartialDecimal(cleaned))
                              setManualFee(cleaned);
                          }}
                          disabled={isSubmitting}
                          placeholder={
                            whishAutoFee > 0
                              ? whishAutoFee.toFixed(2) + " (auto)"
                              : "0.00"
                          }
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-8 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all disabled:opacity-50"
                        />
                      </div>
                      {whishAutoFee > 0 && !manualFee && (
                        <p className="text-xs text-slate-400 mt-1">
                          Auto-calculated fee:{" "}
                          <span className="text-white font-medium">
                            ${whishAutoFee.toFixed(2)}
                          </span>{" "}
                          (1% of amount)
                        </p>
                      )}
                    </div>

                    {/* Fee kept by shop */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Fee kept by shop:</span>
                      <span className="text-white font-mono">
                        ${whishProviderFee.toFixed(2)}
                      </span>
                    </div>

                    {/* Fee included in amount checkbox + breakdown */}
                    <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3 space-y-2">
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includingFees}
                          onChange={(e) => setIncludingFees(e.target.checked)}
                          disabled={isSubmitting}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-violet-600 focus:ring-violet-500"
                        />
                        <span className="text-sm font-medium">
                          Fee included in amount
                        </span>
                      </label>
                      {whishParsedAmount > 0 && includingFees && (
                        <div className="text-xs space-y-0.5 pl-6 border-l border-slate-600 ml-2">
                          <p className="text-slate-400">
                            Credits in:{" "}
                            <span className="text-white font-mono font-medium">
                              {currency === "LBP"
                                ? `${whishParsedAmount.toLocaleString()} LBP`
                                : `$${whishParsedAmount.toFixed(2)}`}
                            </span>
                          </p>
                          <p className="text-slate-400">
                            Fee kept:{" "}
                            <span className="text-amber-400 font-mono font-medium">
                              -${whishProviderFee.toFixed(2)}
                            </span>
                          </p>
                          <p className="text-slate-400">
                            Cash paid to client:{" "}
                            <span className="text-emerald-400 font-mono font-medium">
                              {currency === "LBP"
                                ? `${whishCashPaid.toLocaleString()} LBP`
                                : `$${whishCashPaid.toFixed(2)}`}
                            </span>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Optional client link (rule 11) — a real client picker,
                      owned by the page (mirrors partnerSelector), replaces
                      the old free-text-only name field so clientId actually
                      reaches the wire. */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                      Client (optional)
                    </label>
                    {clientSelector}
                  </div>

                  {/* Payout — MultiPaymentInput composes the payout target
                      (amount − fee, computed above) across the shop's own
                      drawers/currencies. This is a money-OUT flow: no
                      autoDebtRemainder, no change/return legs (a payout has
                      no customer tender to return change from — the
                      repository hard-rejects any OUT leg). */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                      Pay Out
                    </label>
                    {clientPayoutTargetInvalid ? (
                      <p className="text-xs text-red-400">
                        The fee exceeds the amount received — nothing left to
                        pay out.
                      </p>
                    ) : (
                      <MultiPaymentInput
                        key={currency}
                        label="Payout"
                        currency={currency}
                        totalAmountCurrency={currency}
                        totals={[{ amount: whishCashPaid, currency }]}
                        currencies={[
                          { code: "USD", symbol: "$" },
                          { code: "LBP", symbol: "LBP" },
                        ]}
                        paymentMethods={clientPayoutMethods}
                        onChange={setClientPayoutLines}
                        onExchangeRateChange={setClientPayoutExchangeRate}
                        showDiscount={false}
                        requiresClientForDebt={false}
                        hasClient={!!selectedClientId}
                        autoDebtRemainder={false}
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {omtAppHasCreditOption && (
            /* Funding source choice — OMT App only (D4). "On OMT credit" is
               the default; "Transfer from drawer" keeps the pre-existing
               drawer-to-drawer path available as an explicit alternative. */
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Funding Source
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="topup-funding-credit"
                  onClick={() => setOmtAppFundingMode("credit")}
                  disabled={isSubmitting}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors ${
                    omtAppFundingMode === "credit"
                      ? "bg-violet-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  } disabled:opacity-50`}
                >
                  On OMT credit
                </button>
                <button
                  type="button"
                  data-testid="topup-funding-transfer"
                  onClick={() => setOmtAppFundingMode("transfer")}
                  disabled={isSubmitting}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors ${
                    omtAppFundingMode === "transfer"
                      ? "bg-violet-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  } disabled:opacity-50`}
                >
                  Transfer from drawer
                </button>
              </div>
            </div>
          )}

          {!isWhishTopUp && isSupplierCredit && (
            /* Supplier credit explainer */
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <Info className="w-4 h-4 flex-shrink-0 text-amber-400" />
              <p className="text-xs leading-snug text-slate-300">
                The supplier credits your {getProviderLabel()} balance. No cash
                leaves any drawer — settle the amount with your supplier via the
                Suppliers page.
              </p>
            </div>
          )}

          {!isWhishTopUp && (
            <>
              {/* Currency Selector */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Currency
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrency("USD")}
                    disabled={isSubmitting}
                    className={`flex-1 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                      currency === "USD"
                        ? "bg-violet-600 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    } disabled:opacity-50`}
                  >
                    USD
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrency("LBP")}
                    disabled={isSubmitting}
                    className={`flex-1 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                      currency === "LBP"
                        ? "bg-violet-600 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    } disabled:opacity-50`}
                  >
                    LBP
                  </button>
                </div>
              </div>

              {/* Amount Input */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Amount
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={fmtCommas(amount)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/,/g, "");
                      if (isPartialDecimal(cleaned)) setAmount(cleaned);
                    }}
                    placeholder={currency === "LBP" ? "0" : "0.00"}
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                    autoFocus
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    {currency}
                  </span>
                </div>
                {!isSupplierCredit &&
                  amount &&
                  parseFloat(amount) > sourceBalance && (
                    <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      Amount exceeds source drawer balance
                    </p>
                  )}
              </div>

              {/* Source Drawer Selector (hidden for supplier credit) */}
              {!isSupplierCredit && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    From Drawer
                  </label>
                  <select
                    value={sourceDrawer}
                    onChange={(e) => setSourceDrawer(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                  >
                    {availableDrawers.map((drawer) => (
                      <option key={drawer.name} value={drawer.name}>
                        {drawer.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Selected drawer balance:{" "}
                    <span className="text-white font-medium">
                      {currency === "USD"
                        ? `$${sourceBalance.toFixed(2)}`
                        : `${sourceBalance.toLocaleString()} LBP`}
                    </span>
                  </p>
                </div>
              )}
            </>
          )}

          {/* Info Alert */}
          <div>
            <div className="p-2 rounded bg-slate-800/50 border border-slate-700">
              <div className="flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                <p className="text-[10px] leading-tight text-slate-400">
                  {isWhishTopUp
                    ? whishMode === "partner"
                      ? `${getProviderLabel()} balance will be increased from the selected partner's credit line. Settle with the partner via the Partners page.`
                      : `The client transfers credits to your ${getProviderLabel()} line; the shop keeps the fee and pays out the remainder as cash.`
                    : isSupplierCredit
                      ? `${getProviderLabel()} balance will be increased. Your supplier will be credited — settle with them via the Suppliers page.`
                      : `Transfer funds to your ${getProviderLabel()} drawer. No fees.`}
                </p>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 border border-slate-600 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                isSubmitting ||
                !amount ||
                parseFloat(amount) <= 0 ||
                (isWhishTopUp
                  ? whishMode === "partner"
                    ? !selectedPartnerId
                    : clientPayoutTargetInvalid ||
                      clientPayoutPositiveLegs.length === 0
                  : !isSupplierCredit && parseFloat(amount) > sourceBalance)
              }
              className={`flex-1 px-4 py-2.5 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${
                isWhishTopUp && whishMode === "client"
                  ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20"
                  : "bg-violet-600 hover:bg-violet-500 shadow-violet-500/20"
              }`}
            >
              {isSubmitting
                ? "Processing..."
                : isWhishTopUp
                  ? whishMode === "partner"
                    ? "Top Up via Partner"
                    : "Buy Credits from Client"
                  : isSupplierCredit
                    ? "Confirm Supplier Credit"
                    : "Confirm Top-Up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
