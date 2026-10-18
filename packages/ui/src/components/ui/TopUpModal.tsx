import { useState, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { Wallet, X, AlertTriangle, Info, UserRound, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TopUpFromClientInput } from "@liratek/core";
import { walletReceiveAmounts, walletReceiveInflow } from "@liratek/core";
import MultiPaymentInput from "./MultiPaymentInput";
import { useModalFocusFix } from "../../hooks/useModalFocusFix";
import type { PaymentLine } from "./MultiPaymentInput";
import { formatNumber } from "../../i18n/format";
import { normalizeDigits } from "../../i18n/digits";

function fmtCommas(value: string): string {
  if (!value) return value;
  const parts = value.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function isPartialDecimal(value: string): boolean {
  return /^[0-9]*\.?[0-9]*$/.test(value);
}

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
  /**
   * True while the page is still fetching fresh drawer balances. The modal
   * opens at once (shop-day 2026-10-16: waiting for the balances first made
   * the Top-Up button look dead for seconds); only the "from drawer" path
   * needs them, so only it shows a loading line and holds its confirm.
   */
  drawersLoading?: boolean;
  /** Why the drawer balances could not be loaded — shown with `onRetryDrawers`. */
  drawersError?: string | null;
  /** Re-fetch the drawer balances after `drawersError`. */
  onRetryDrawers?: () => void;
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
  drawersLoading = false,
  drawersError = null,
  onRetryDrawers,
}: TopUpModalProps) {
  // Electron/Windows focus bug: the shared hook (one copy, @liratek/ui).
  useModalFocusFix(isOpen);
  const { t } = useTranslation("ui");
  const { t: tc } = useTranslation("common");

  /** Fallback payment method list for the "From Client" payout when the page
   *  doesn't pass `clientPaymentMethods` — a bare CASH leg, always drawer-
   *  affecting and always valid against `RechargeRepository.topUpFromClient`.
   *  Only the label is translated; the code stays "CASH". Memoised so
   *  MultiPaymentInput sees a stable array, as with the old module constant. */
  const defaultClientPayoutMethods = useMemo<
    Array<{ code: string; label: string }>
  >(() => [{ code: "CASH", label: tc("payment.CASH") }], [tc]);

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
  const [clientPayoutLines, setClientPayoutLines] = useState<PaymentLine[]>([]);
  const [clientPayoutExchangeRate, setClientPayoutExchangeRate] = useState<
    number | undefined
  >(undefined);
  // Payout kept change (owner decisions 2026-10-07): the shop hands out a
  // round figure a little short of the payout target and keeps the leftover
  // (under $1 / 100,000 LBP, payout currency) as profit. Reported by the
  // payout-mode MultiPaymentInput below; the server verifies it.
  const [clientPayoutKept, setClientPayoutKept] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  // LIRA-334 — payout round-up: the shop hands out a little MORE than it
  // owes (up to $5 / 450,000 LBP, payout currency) and books the extra as
  // change rounding. Reported by the same payout MultiPaymentInput; never
  // together with kept change (short vs over); the server verifies it.
  const [clientPayoutRoundUp, setClientPayoutRoundUp] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);

  // i18n-exempt: brand names, shown as they are
  const providerLabels: Record<TopUpProvider, string> = {
    MTC: "MTC",
    Alfa: "Alfa",
    OMT_APP: "OMT App",
    WHISH_APP: "Whish App",
    iPick: "iPick",
    Katsh: "Katsh",
  };

  const getProviderLabel = () => {
    return providerLabels[provider] || t("topUp.providerFallback");
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
  // The from-drawer transfer is checked against `sourceBalance`, so it waits
  // for fresh balances; supplier / partner / client top-ups never read them.
  const drawersNotReady = drawersLoading || !!drawersError;

  // Whish "From Client" fee math (replicates OmtWhishAppTransferForm RECEIVE):
  // 1% auto fee on USD amounts, overridable by a manual fee. The client
  // transfers `parsedAmount` credits, the shop keeps `providerFee`, and pays
  // out the remainder as cash.
  const whishParsedAmount = parseFloat(amount) || 0;
  const whishAutoFee =
    currency === "USD" && whishParsedAmount > 0 ? whishParsedAmount * 0.01 : 0;
  const whishManualFee = parseFloat(manualFee) || 0;
  const whishProviderFee = whishManualFee > 0 ? whishManualFee : whishAutoFee;
  // Owner decision 2026-10-16 — "Fee included in amount" follows the usual
  // RECEIVE rule (core `walletReceiveInflow` / `walletReceiveAmounts`, the
  // same rule the server pays out by): ticked → the client sends the typed
  // credits and the fee comes out of them; unticked → the client sends
  // credits + fee and is paid the full typed amount. `whishCreditsIn` is
  // what arrives in the Whish App wallet — the API's `amount`.
  const whishCreditsIn = walletReceiveInflow({
    typedAmount: whishParsedAmount,
    fee: whishProviderFee,
    feeIncluded: includingFees,
  });
  const whishCashPaid = Math.max(
    0,
    walletReceiveAmounts({
      walletInflow: whishCreditsIn,
      fee: whishProviderFee,
    }).payout,
  );
  // Nothing left to pay out once the fee consumes the whole amount — offering
  // MultiPaymentInput (which requires a positive leg amount) would just
  // reject with a confusing schema error at submit; surface it up front.
  const clientPayoutTargetInvalid =
    whishMode === "client" && whishParsedAmount > 0 && whishCashPaid <= 0;
  const clientPayoutMethods =
    clientPaymentMethods && clientPaymentMethods.length > 0
      ? clientPaymentMethods
      : defaultClientPayoutMethods;
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
      setClientPayoutKept(null);
      setClientPayoutRoundUp(null);
      // D4: OMT credit is the default every time the modal (re)opens.
      setOmtAppFundingMode("credit");
    }
  }, [isOpen, defaultSourceDrawer]);

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert(t("topUp.invalidAmount"));
      return;
    }

    if (isWhishTopUp) {
      if (whishMode === "partner") {
        if (!onConfirmPartner) return;
        if (!selectedPartnerId) {
          alert(t("topUp.selectPartner"));
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
          alert(error instanceof Error ? error.message : t("topUp.failed"));
        } finally {
          setIsSubmitting(false);
        }
        return;
      }

      // whishMode === "client"
      if (!onConfirmClient) return;
      if (clientPayoutTargetInvalid) {
        alert(t("topUp.feeExceedsAlert"));
        return;
      }
      const payoutLegs = clientPayoutPositiveLegs.map((l) => ({
        method: l.method,
        currencyCode: l.currencyCode,
        amount: l.amount,
      }));
      if (payoutLegs.length === 0) {
        alert(t("topUp.noPayout"));
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
          // The credits that arrive (the fee folded in when it is on top).
          amount: whishCreditsIn,
          currency,
          // `fee` is REQUIRED by `topUpFromClientSchema` and may legitimately
          // be 0 (owner: the shop's profit on this transaction IS the fee,
          // which may be zero) — always sent as a literal field, never behind
          // a truthiness/`?? undefined` guard, or a genuine $0 fee would be
          // dropped from the wire (rule 22).
          fee: whishProviderFee,
          // The "Fee included in amount" choice, kept on the transaction's
          // details; it is already folded into `amount` above.
          includingFees,
          payments: payoutLegs,
          ...(hasCrossCurrencyLeg && clientPayoutExchangeRate
            ? { exchangeRate: clientPayoutExchangeRate }
            : {}),
          // Payout kept change rides the SAME payload as the legs it
          // shortens (rule 22).
          ...(clientPayoutKept &&
          (clientPayoutKept.usd > 0 || clientPayoutKept.lbp > 0)
            ? {
                kept_change_usd: clientPayoutKept.usd,
                kept_change_lbp: clientPayoutKept.lbp,
              }
            : {}),
          // LIRA-334 — the round-up rides the same payload too (rule 22).
          ...(clientPayoutRoundUp &&
          (clientPayoutRoundUp.usd > 0 || clientPayoutRoundUp.lbp > 0)
            ? {
                rounding_given_usd: clientPayoutRoundUp.usd,
                rounding_given_lbp: clientPayoutRoundUp.lbp,
              }
            : {}),
          ...(selectedClientId ? { clientId: selectedClientId } : {}),
          ...(trimmedClientName ? { clientName: trimmedClientName } : {}),
        });
        onClose();
      } catch (error) {
        alert(error instanceof Error ? error.message : t("topUp.failed"));
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
        alert(error instanceof Error ? error.message : t("topUp.failed"));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (drawersNotReady) return;
    if (amountNum > sourceBalance) {
      alert(t("topUp.insufficient"));
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm({ amount: amountNum, currency, sourceDrawer });
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : t("topUp.failed"));
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
        className="relative w-full max-w-lg max-h-[90vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Wallet className="text-slate-400" size={18} />
            {t("topUp.title", { provider: getProviderLabel() })}
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
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
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
                  {t("topUp.viaPartner")}
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
                  {t("topUp.fromClient")}
                </button>
              </div>

              {/* Currency selector (shared by both whish sub-modes) */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  {t("topUp.currency")}
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
                    {t("topUp.partner")}
                  </label>
                  {partnerSelector}
                  {!selectedPartnerId && (
                    <p className="text-xs text-slate-500 mt-1">
                      {t("topUp.partnerHint")}
                    </p>
                  )}
                </div>
              )}

              {/* Amount input (shared) */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  {whishMode === "client"
                    ? t("topUp.creditsReceived")
                    : t("topUp.amount")}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={fmtCommas(amount)}
                    onChange={(e) => {
                      const cleaned = normalizeDigits(e.target.value).replace(/,/g, "");
                      if (isPartialDecimal(cleaned)) setAmount(cleaned);
                    }}
                    placeholder={currency === "LBP" ? "0" : "0.00"}
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                    autoFocus
                  />
                  <span className="absolute end-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    {currency}
                  </span>
                </div>
              </div>

              {/* From Client sub-mode — fee + client name */}
              {whishMode === "client" && (
                <>
                  <div className="rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                      {t("topUp.feeBreakdown")}
                    </h3>

                    {/* Manual Fee Input */}
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        {t("topUp.feeAmountUsd")}
                      </label>
                      <div className="relative">
                        <span className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                          $
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={fmtCommas(manualFee)}
                          onChange={(e) => {
                            const cleaned = normalizeDigits(e.target.value).replace(/,/g, "");
                            if (isPartialDecimal(cleaned))
                              setManualFee(cleaned);
                          }}
                          disabled={isSubmitting}
                          placeholder={
                            whishAutoFee > 0
                              ? t("topUp.autoPlaceholder", {
                                  fee: whishAutoFee.toFixed(2),
                                })
                              : "0.00"
                          }
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg ps-8 pe-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all disabled:opacity-50"
                        />
                      </div>
                      {whishAutoFee > 0 && !manualFee && (
                        <p className="text-xs text-slate-400 mt-1">
                          {t("topUp.autoFee")}{" "}
                          <span className="text-white font-medium">
                            ${whishAutoFee.toFixed(2)}
                          </span>{" "}
                          {t("topUp.autoFeeNote")}
                        </p>
                      )}
                    </div>

                    {/* Fee kept by shop */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">
                        {t("topUp.feeKeptByShop")}
                      </span>
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
                          {t("topUp.feeIncluded")}
                        </span>
                      </label>
                      {whishParsedAmount > 0 && (
                        <div className="text-xs space-y-0.5 ps-6 border-s border-slate-600 ms-2">
                          <p className="text-slate-400">
                            {t("topUp.clientSends")}{" "}
                            <span className="text-white font-mono font-medium">
                              {currency === "LBP"
                                ? `${formatNumber(whishCreditsIn)} LBP`
                                : `$${whishCreditsIn.toFixed(2)}`}
                            </span>
                          </p>
                          <p className="text-slate-400">
                            {t("topUp.feeKept")}{" "}
                            <span className="text-amber-400 font-mono font-medium">
                              -${whishProviderFee.toFixed(2)}
                            </span>
                          </p>
                          <p className="text-slate-400">
                            {t("topUp.cashPaid")}{" "}
                            <span className="text-emerald-400 font-mono font-medium">
                              {currency === "LBP"
                                ? `${formatNumber(whishCashPaid)} LBP`
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
                      {t("topUp.clientOptional")}
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
                      {t("topUp.payOut")}
                    </label>
                    {clientPayoutTargetInvalid ? (
                      <p className="text-xs text-red-400">
                        {t("topUp.feeExceeds")}
                      </p>
                    ) : (
                      <MultiPaymentInput
                        key={currency}
                        label={t("topUp.payout")}
                        currency={currency}
                        totalAmountCurrency={currency}
                        totals={[{ amount: whishCashPaid, currency }]}
                        currencies={[
                          { code: "USD", symbol: "$" },
                          { code: "LBP", symbol: "LBP" },
                        ]}
                        paymentMethods={clientPayoutMethods}
                        // The shop pays the client: no change legs ever, and
                        // a small shortfall is kept as profit.
                        payer="payout"
                        onChange={setClientPayoutLines}
                        onKeptChange={setClientPayoutKept}
                        onRoundUpChange={setClientPayoutRoundUp}
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
                {t("topUp.fundingSource")}
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
                  {t("topUp.onOmtCredit")}
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
                  {t("topUp.transferFromDrawer")}
                </button>
              </div>
            </div>
          )}

          {!isWhishTopUp && isSupplierCredit && (
            /* Supplier credit explainer */
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <Info className="w-4 h-4 flex-shrink-0 text-amber-400" />
              <p className="text-xs leading-snug text-slate-300">
                {t("topUp.supplierExplainer", { provider: getProviderLabel() })}
              </p>
            </div>
          )}

          {!isWhishTopUp && (
            <>
              {/* Currency Selector */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  {t("topUp.currency")}
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
                  {t("topUp.amount")}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={fmtCommas(amount)}
                    onChange={(e) => {
                      const cleaned = normalizeDigits(e.target.value).replace(/,/g, "");
                      if (isPartialDecimal(cleaned)) setAmount(cleaned);
                    }}
                    placeholder={currency === "LBP" ? "0" : "0.00"}
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                    autoFocus
                  />
                  <span className="absolute end-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    {currency}
                  </span>
                </div>
                {!isSupplierCredit &&
                  !drawersNotReady &&
                  amount &&
                  parseFloat(amount) > sourceBalance && (
                    <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      {t("topUp.amountExceeds")}
                    </p>
                  )}
              </div>

              {/* Source Drawer Selector (hidden for supplier credit) */}
              {!isSupplierCredit && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    {t("topUp.fromDrawer")}
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
                  {drawersError ? (
                    <div
                      data-testid="topup-drawers-error"
                      className="mt-1 flex items-center justify-between gap-2 text-xs text-red-400"
                    >
                      <span className="flex items-center gap-1">
                        <AlertTriangle size={12} />
                        {t("topUp.loadError", { error: drawersError })}
                      </span>
                      {onRetryDrawers && (
                        <button
                          type="button"
                          onClick={onRetryDrawers}
                          className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                        >
                          {tc("actions.retry")}
                        </button>
                      )}
                    </div>
                  ) : drawersLoading ? (
                    <p
                      data-testid="topup-drawers-loading"
                      className="text-xs text-slate-500 mt-1"
                    >
                      {t("topUp.loadingBalances")}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 mt-1">
                      {t("topUp.selectedBalance")}{" "}
                      <span className="text-white font-medium">
                        {currency === "USD"
                          ? `$${sourceBalance.toFixed(2)}`
                          : `${formatNumber(sourceBalance)} LBP`}
                      </span>
                    </p>
                  )}
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
                      ? t("topUp.infoPartner", { provider: getProviderLabel() })
                      : t("topUp.infoClient", { provider: getProviderLabel() })
                    : isSupplierCredit
                      ? t("topUp.infoSupplier", { provider: getProviderLabel() })
                      : t("topUp.infoTransfer", { provider: getProviderLabel() })}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 flex gap-3 px-6 py-4 border-t border-slate-700/60">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2.5 border border-slate-600 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
          >
            {tc("actions.cancel")}
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
                : !isSupplierCredit &&
                  (drawersNotReady || parseFloat(amount) > sourceBalance))
            }
            className={`flex-1 px-4 py-2.5 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${
              isWhishTopUp && whishMode === "client"
                ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20"
                : "bg-violet-600 hover:bg-violet-500 shadow-violet-500/20"
            }`}
          >
            {isSubmitting
              ? t("topUp.processing")
              : isWhishTopUp
                ? whishMode === "partner"
                  ? t("topUp.submitPartner")
                  : t("topUp.submitClient")
                : isSupplierCredit
                  ? t("topUp.submitSupplier")
                  : t("topUp.submitTransfer")}
          </button>
        </div>
      </div>
    </div>
  );
}
