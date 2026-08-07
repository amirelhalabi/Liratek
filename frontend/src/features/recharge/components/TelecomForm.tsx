import { useState, useEffect } from "react";
import logger from "@/utils/logger";
import { Phone, User, Search, X, CreditCard } from "lucide-react";
import {
  ServiceTypeTabs,
  type ServiceTypeOption,
  useApi,
  hasNewClientInfo,
  type PaymentLine,
  appEvents,
} from "@liratek/ui";
import type {
  FinancialTransaction,
  ProviderConfig,
  RechargeType,
} from "../types";
import { TELECOM_SERVICE_TYPES, ALFA_GIFT_TIERS } from "../types";
import { HistoryModal } from "./HistoryModal";
import { useSellRate } from "@/hooks/useSellRate";
import { PaymentSheet } from "./PaymentSheet";
import { CardGridPayView, type CardGridPayItem } from "./CardGridPayView";
import { CarrierLinesPanel } from "./CarrierLinesPanel";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import { snapValidityDaysUp } from "../utils/validityDays";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { convertLBPToUSD } from "@/utils/paymentUtils";
import { useSession } from "@/features/sessions/context/SessionContext";
import {
  ForPartnerToggle,
  ForPartnerNotice,
} from "@/features/partners/components/ForPartnerToggle";

/** CARRIER_LINES_VALIDITY_PLAN.md Phase 6 — Days/Alfa Gift block + redirect
 *  shown when the typed phone number is this carrier's own shop line.
 *  Text-only: there is no reliable 1:1 carrier→provider mapping to auto-jump
 *  to the matching iPick/Katsh item (a self-charge-eligible item's category
 *  can span either provider), so this only tells the operator where to go. */
function ShopLineRedirectNotice({
  carrierLabel,
  target,
}: {
  carrierLabel: string;
  target: "Days" | "Alfa Gift";
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div
        className="max-w-md rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-center"
        data-testid="shop-line-redirect-notice"
      >
        <p className="text-sm font-semibold text-amber-300 mb-2">
          This is the shop&apos;s own {carrierLabel} line
        </p>
        <p className="text-sm text-slate-300">
          {target === "Days" ? "Validity" : "Gift value"} can only be added
          by charging an iPick or Katsh catalog item to this line — use{" "}
          <span className="font-semibold text-white">
            &quot;Charge to shop line&quot;
          </span>{" "}
          on the matching item card.
        </p>
      </div>
    </div>
  );
}

/** CARRIER_LINES_VALIDITY_PLAN.md Phase 6 — a buy-back payout only ever
 *  leaves via a real drawer/wallet or a customer's account; GIFT_CARD makes
 *  no sense as a cashout target. */
const BUYBACK_PAYMENT_METHOD_CODES = new Set([
  "CASH",
  "CUSTOMER_ACCOUNT",
  "OMT",
  "WHISH",
  "BINANCE",
]);

interface TelecomFormProps {
  isMTC: boolean;
  rechargeType: RechargeType;
  setRechargeType: (type: RechargeType) => void;
  isSubmitting: boolean;
  handleQuickAmount: (val: number) => void;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  rechargeHistory: FinancialTransaction[];
  marginAlertThreshold?: number;
  telecomAmount: string;
  setTelecomAmount: (val: string) => void;
  /** Sets the amount AND re-derives the suggested client price (like Quick Amount). */
  onTelecomAmountChange: (val: string) => void;
  telecomPrice: string;
  setTelecomPrice: (val: string) => void;
  phoneNumber: string;
  setPhoneNumber: (val: string) => void;
  paidBy: string;
  setPaidBy: (val: string) => void;
  methods: { code: string; label: string }[];
  showClientSearch: boolean;
  setShowClientSearch: (val: boolean) => void;
  telecomClientId: number | null;
  setTelecomClientId: (val: number | null) => void;
  telecomClientName: string;
  setTelecomClientName: (val: string) => void;
  telecomClientPhone: string;
  setTelecomClientPhone: (val: string) => void;
  searchClients: (query: string) => void;
  clientSearchResults: any[];
  selectClient: (client: any) => void;
  activeProvider: string | null;
  activeConfig: ProviderConfig | undefined;
  handleTelecomSubmit: () => void;
  giftTierKey: keyof typeof ALFA_GIFT_TIERS | "";
  setGiftTierKey: (val: keyof typeof ALFA_GIFT_TIERS | "") => void;
  giftAmountUsd: string;
  setGiftAmountUsd: (val: string) => void;
  giftPriceLbp: string;
  setGiftPriceLbp: (val: string) => void;
  giftCostLbp: string;
  setGiftCostLbp: (val: string) => void;
  handleAlfaGiftSubmit: () => void;
  paymentLines: PaymentLine[];
  setPaymentLines: (lines: PaymentLine[]) => void;
  clientName: string;
  setClientName: (val: string) => void;
  alfaCreditCostRate?: number;
  telecomDaysCostUsd: string;
  setTelecomDaysCostUsd: (val: string) => void;
  /** Admin sees cost + profit margin on gift/voucher cards. */
  isAdmin?: boolean;
  onDiscountChange?: (discount: number) => void;
  onReturnChange?: (returnLegs: PaymentLine[]) => void;
  /** T3 keep-change opt-in (plumbed to PaymentSheet → MultiPaymentInput). */
  onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
  /** Payment-Legs Integrity plan (false-reject fix): fires with the rate the
   *  PaymentSheet is ACTUALLY using for its conversions (the operator may
   *  edit the sheet's header rate field away from the `exchangeRate` this
   *  form passed it) — the parent should send this as `tender_exchange_rate`
   *  on submit instead of re-deriving its own buy/sell rate. */
  onEffectiveRateChange?: (rate: number) => void;
  /** Called after a successful metadata edit to reload the history list */
  onRefreshHistory?: () => void;
  /** Called after a successful "For Partner" submit to refresh the parent's
   *  drawer-balance widget (the normal path already refreshes it via its own
   *  loadDrawerBalances call in the parent's handleTelecomSubmit). */
  onRefreshBalances?: () => void;
  onTransactionTimeChange?: (time: string | undefined) => void;
  /** CARRIER_LINES_VALIDITY_PLAN.md Phase 6 (D7): true when the typed
   *  `phoneNumber` matches this carrier's own primary line — computed ONCE
   *  in the parent (Recharge/index.tsx owns the `getPrimaryCarrierLine`
   *  fetch) and passed down so there is a single source of truth shared by
   *  this form AND `handleTelecomSubmit`. Flips the Credit tab to a
   *  buy-back (cash OUT for credits IN) and blocks/redirects Days & Alfa
   *  Gift, which can only add validity via an iPick/Katsh self-charge. */
  isShopLineMatch: boolean;
}

export function TelecomForm({
  isMTC,
  rechargeType,
  setRechargeType,
  isSubmitting,
  handleQuickAmount,
  showHistory,
  setShowHistory,
  rechargeHistory,
  marginAlertThreshold = 100000,
  telecomAmount,
  setTelecomAmount: _setTelecomAmount,
  onTelecomAmountChange,
  telecomPrice,
  setTelecomPrice,
  phoneNumber,
  setPhoneNumber,
  paidBy: _paidBy,
  setPaidBy,
  methods,
  showClientSearch,
  setShowClientSearch,
  telecomClientId,
  setTelecomClientId,
  telecomClientName,
  setTelecomClientName,
  telecomClientPhone,
  setTelecomClientPhone,
  searchClients,
  clientSearchResults,
  selectClient,
  activeProvider: _activeProvider,
  activeConfig: _activeConfig,
  handleTelecomSubmit,
  giftTierKey,
  setGiftTierKey,
  giftAmountUsd,
  setGiftAmountUsd,
  giftPriceLbp,
  setGiftPriceLbp,
  giftCostLbp,
  setGiftCostLbp,
  handleAlfaGiftSubmit,
  paymentLines,
  setPaymentLines,
  clientName,
  setClientName,
  alfaCreditCostRate = 85000,
  telecomDaysCostUsd,
  setTelecomDaysCostUsd,
  isAdmin = false,
  onDiscountChange,
  onReturnChange,
  onKeptChange,
  onEffectiveRateChange,
  onRefreshHistory,
  onRefreshBalances,
  onTransactionTimeChange,
  isShopLineMatch,
}: TelecomFormProps) {
  const api = useApi();
  const { activeSession } = useSession();
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("CASH");
  const [daysPriceCurrency, setDaysPriceCurrency] = useState<"USD" | "LBP">(
    "USD",
  );
  const [daysPriceUsdInput, setDaysPriceUsdInput] = useState("");
  // Payments use the BUY rate (owner decision 2026-07-06): the MultiPaymentInput
  // converts LBP↔USD at buyRate. (The tier-price `sellRate` local below is a
  // separate pricing rate and is unaffected.)
  const { buyRate: exchangeRate } = useSellRate();
  const [costRate, setCostRate] = useState(85000);
  const [discount, setDiscount] = useState(0);
  void discount; // surfaced to parent via onDiscountChange; kept locally for future use
  const [sheetOpen, setSheetOpen] = useState(false);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();

  // PFT-3a (Partner FOR-Transactions, full-amount model): a "for partner"
  // recharge has NO walk-in customer and takes NO counter cash — the
  // partner owes the FULL price, settled later on the Partners page. The
  // PaymentSheet (and the client picker nested inside it) is skipped
  // entirely below; submission bypasses handleTelecomSubmit/PaymentSheet and
  // calls the recharge process directly with partnerId + partnerMode:"FOR"
  // and no payment legs (mirrors CheckoutModal's forPartner path).
  const [forPartner, setForPartner] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(
    null,
  );
  const [isSubmittingPartner, setIsSubmittingPartner] = useState(false);

  // Fetch the Alfa credit cost rate on mount (the USD→LBP rate now comes from
  // the shared useSellRate hook above).
  useEffect(() => {
    const loadCostRate = async () => {
      try {
        const settings = await api.getAllSettings();
        const settingsMap = new Map(
          settings.map((s: { key_name: string; value: string }) => [
            s.key_name,
            s.value,
          ]),
        );
        const costVal = Number(settingsMap.get("alfa_credit_cost_lbp"));
        if (costVal > 0) setCostRate(costVal);
      } catch (error) {
        logger.error("Failed to load Alfa credit cost rate:", error);
      }
    };
    loadCostRate();
  }, [api]);

  // Reset Days price currency toggle when switching tabs
  useEffect(() => {
    setDaysPriceCurrency("USD");
    setDaysPriceUsdInput("");
  }, [rechargeType]);

  const handleDiscountChange = (d: number) => {
    setDiscount(d);
    onDiscountChange?.(d);
  };

  // When the user types both a name and phone for a brand-new client (no
  // existing client ID), promote CUSTOMER_ACCOUNT to the active payment method
  // so they can tap "Pay" immediately — the parent will create the client on
  // submit. Mirrors the existing select-from-search auto-switch.
  useEffect(() => {
    const newClientReady = hasNewClientInfo({
      clientId: telecomClientId,
      name: telecomClientName,
      phone: telecomClientPhone,
    });
    if (newClientReady && initialPaymentMethod !== "CUSTOMER_ACCOUNT") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialPaymentMethod("CUSTOMER_ACCOUNT");

      setPaymentInputKey((k) => k + 1);
    }
  }, [
    telecomClientId,
    telecomClientName,
    telecomClientPhone,
    initialPaymentMethod,
  ]);

  // Required for API compatibility but not used in this component
  void _paidBy;
  void clientName;
  void setClientName;
  // Gift price/value/cost are derived into giftItems and written via their
  // setters in onSelect; the raw prop values are no longer read directly here.
  void giftAmountUsd;
  void giftPriceLbp;
  void giftCostLbp;

  const accent = isMTC ? "cyan" : "red";
  const carrierLabel = isMTC ? "MTC" : "Alfa";

  // CARRIER_LINES_VALIDITY_PLAN.md Phase 6 (D7): the Credit tab flips to a
  // buy-back (cash OUT for credits IN) only when the typed phone number
  // matches this carrier's own primary line. `isShopLineMatch` alone is not
  // enough — it is computed from the SHARED `phoneNumber` state (see the
  // Days/Alfa Gift block below, which reuses the same flag while ON those
  // tabs). Review follow-up: the parent (Recharge/index.tsx) now clears
  // `phoneNumber` whenever the operator switches AWAY from Credit, so a
  // value typed here no longer survives onto Days/Alfa Gift after a tab
  // switch — only a same-tab edit (still on Credit) keeps this flag live,
  // which is what actually matters for flipping THIS line's UI.
  const isCreditBuyback = rechargeType === "CREDIT_TRANSFER" && isShopLineMatch;
  // Phase 6: a payout item inside an IN-direction session basket is a design
  // problem the plan defaults to blocking outright (basket formData carries
  // no payment fields — checkout collects once — so there is nowhere for a
  // payout leg to live). The parent's handleTelecomSubmit short-circuits
  // this too; disabling here just keeps the control from looking clickable.
  const isBuybackBlockedBySession = isCreditBuyback && !!activeSession;

  // Normalized card models for the shared CardGridPayView. Only one of these is
  // rendered at a time (gift for Alfa, vouchers for MTC).
  const giftItems: CardGridPayItem[] = Object.entries(ALFA_GIFT_TIERS).map(
    ([key, tier]) => {
      const sellRate =
        Number(localStorage.getItem("alfa_credit_sell_rate_lbp") || "100000") /
        1000;
      return {
        id: key,
        label: tier.label,
        valueUsd: tier.usd,
        costLbp: tier.usd * costRate,
        sellLbp: Math.round(tier.usd * sellRate * 1000),
      };
    },
  );

  const handleCardTransactionTime = (t: string | undefined) => {
    setTransactionTime(t);
    onTransactionTimeChange?.(t);
  };

  const handleCardPaymentChange = (lines: PaymentLine[]) => {
    setPaymentLines(lines);
    if (lines.length === 1) setPaidBy(lines[0].method);
  };

  // PFT-3a: direct submission for a "for partner" recharge — bypasses
  // handleTelecomSubmit (the parent's normal path, which builds a payload
  // from paymentLines/clientId and is out of scope to touch) and the
  // PaymentSheet entirely, calling the recharge process straight from here
  // with the full price + partner fields and payments: [] (no legs). The
  // backend books the full price to the partner's ledger and rejects any
  // counter-payment leg in partner mode.
  const handleForPartnerSubmit = async () => {
    if (!telecomAmount || !telecomPrice) return;
    if (rechargeType === "DAYS" && !(parseFloat(telecomDaysCostUsd) > 0))
      return;
    if (!selectedPartnerId) {
      appEvents.emit(
        "notification:show",
        "Select a partner for this recharge.",
        "warning",
      );
      return;
    }

    const amount = parseFloat(telecomAmount);
    const price = parseFloat(telecomPrice) || 0;
    const cost =
      rechargeType === "DAYS"
        ? parseFloat(telecomDaysCostUsd) * (alfaCreditCostRate || 85000)
        : amount * (alfaCreditCostRate || 85000);

    setIsSubmittingPartner(true);
    try {
      const result = await api.processRecharge({
        provider: isMTC ? "MTC" : "Alfa",
        type: rechargeType,
        phoneNumber:
          rechargeType === "CREDIT_TRANSFER" ? phoneNumber : undefined,
        amount,
        cost,
        price,
        currency: "LBP",
        // No counter payment at all in partner mode — the backend rejects
        // any leg here (payment-leg-contract: IN legs only, and partner mode
        // must have none).
        payments: [],
        partnerId: selectedPartnerId,
        partnerMode: "FOR" as const,
      });
      if (result && !result.success) {
        appEvents.emit(
          "notification:show",
          result.error || "Failed to process partner recharge",
          "error",
        );
        return;
      }

      appEvents.emit(
        "notification:show",
        "Partner recharge recorded successfully",
        "success",
      );
      _setTelecomAmount("");
      setTelecomPrice("");
      setTelecomDaysCostUsd("");
      setPhoneNumber("");
      onRefreshHistory?.();
      onRefreshBalances?.();
    } catch (err) {
      logger.error("Failed to submit partner recharge:", err);
      appEvents.emit(
        "notification:show",
        err instanceof Error
          ? err.message
          : "Failed to process partner recharge",
        "error",
      );
    } finally {
      setIsSubmittingPartner(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* W6.a: compact panel of the shop's own SIM lines for this carrier —
          credits + days-remaining, inline quick-update. Informational only
          (no drawer legs, no checkout/closing involvement). */}
      <CarrierLinesPanel carrier={isMTC ? "mtc" : "alfa"} />

      {/* Service Type Tabs */}
      <ServiceTypeTabs
        options={
          TELECOM_SERVICE_TYPES.filter((svc) => {
            // Hide Alfa Gift for MTC
            if (svc.id === "ALFA_GIFT" && isMTC) return false;
            return true;
          }) as ServiceTypeOption[]
        }
        value={rechargeType}
        onChange={(val) => setRechargeType(val as RechargeType)}
        accentColor={isMTC ? "cyan" : "red"}
        size="sm"
      />

      {rechargeType === "ALFA_GIFT" && isShopLineMatch ? (
        /* CARRIER_LINES_VALIDITY_PLAN.md Phase 6: a shop-line number can only
         * gain credits (buy-back, Credit tab) — never validity/gift value.
         * Block + redirect instead of rendering the card grid at all
         * (deliberately NOT wired to auto-switch the provider tab: an
         * iPick/Katsh item's self-charge-eligible category does not map
         * 1:1 to a single provider, so a text-only redirect is the
         * conservative choice — see the report for detail). */
        <ShopLineRedirectNotice carrierLabel={carrierLabel} target="Alfa Gift" />
      ) : rechargeType === "ALFA_GIFT" ? (
        /* Alfa Gift — shared card-grid pay flow */
        <CardGridPayView
          heading="Select Alfa Gift"
          items={giftItems}
          selectedId={giftTierKey || null}
          onSelect={(item) => {
            setGiftTierKey(item.id as keyof typeof ALFA_GIFT_TIERS);
            setGiftAmountUsd(String(item.valueUsd ?? ""));
            setGiftPriceLbp(String(item.sellLbp));
            setGiftCostLbp(String(item.costLbp));
          }}
          accent={accent}
          showProfit={isAdmin}
          sheetTitle="Alfa Gift Payment"
          onConfirm={handleAlfaGiftSubmit}
          isSubmitting={isSubmitting}
          paymentMethods={methods}
          clientId={telecomClientId}
          exchangeRate={exchangeRate}
          {...(onEffectiveRateChange
            ? { onExchangeRateChange: onEffectiveRateChange }
            : {})}
          onPaymentChange={handleCardPaymentChange}
          {...(onReturnChange ? { onReturnChange } : {})}
          onDiscountChange={handleDiscountChange}
          clientName={telecomClientName}
          onClientNameChange={setTelecomClientName}
          transactionTime={transactionTime}
          onTransactionTimeChange={handleCardTransactionTime}
          hasActiveSession={!!activeSession}
        />
      ) : rechargeType === "DAYS" && isShopLineMatch ? (
        /* CARRIER_LINES_VALIDITY_PLAN.md Phase 6: same block + redirect as
         * Alfa Gift above — a DAYS sale adds validity, which a shop-line
         * number can never receive via this form. */
        <ShopLineRedirectNotice carrierLabel={carrierLabel} target="Days" />
      ) : (
        /* Recharge Form */
        <div className="flex flex-col gap-3 flex-1">
          <div className="grid grid-cols-12 gap-5 flex-1">
            <div className="col-span-7 bg-slate-800 rounded-2xl border border-slate-700/50 p-6 flex flex-col gap-6">
              {rechargeType === "CREDIT_TRANSFER" && (
                <div>
                  <label
                    htmlFor="telecom-phone"
                    className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider flex items-center gap-1.5"
                  >
                    <Phone size={12} />
                    Phone Number
                  </label>
                  {isShopLineMatch && (
                    <p
                      className="text-xs text-amber-400 font-medium mb-2 -mt-1"
                      data-testid="shop-line-buyback-note"
                    >
                      This is the shop&apos;s own line — this will be
                      recorded as a credit buy-back
                    </p>
                  )}
                  <div className="relative">
                    <div
                      className={`absolute left-0 top-0 bottom-0 flex items-center pl-4 pr-3 rounded-l-xl bg-${accent}-500/10 border-r border-slate-700`}
                    >
                      <span className={`text-${accent}-400 font-bold text-sm`}>
                        +961
                      </span>
                    </div>
                    <input
                      id="telecom-phone"
                      type="text"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-20 pr-4 py-4 text-2xl font-bold text-white focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all tracking-widest font-mono`}
                      placeholder="XX XXX XXX"
                      maxLength={8}
                    />
                  </div>
                </div>
              )}
              {rechargeType === "CREDIT_TRANSFER" && (
                <div className="flex-1">
                  <span
                    aria-hidden="true"
                    className="block text-xs font-medium text-slate-500 mb-3 uppercase tracking-wider"
                  >
                    Quick Amount
                  </span>
                  <div className="grid grid-cols-4 gap-3">
                    {[3, 6, 9, 12, 15, 18, 21, 30].map((amt) => (
                      <button
                        key={amt}
                        onClick={() => handleQuickAmount(amt)}
                        className={`py-4 rounded-xl font-bold text-lg transition-all border ${
                          telecomAmount === amt.toString()
                            ? `bg-${accent}-500/15 text-${accent}-400 border-${accent}-500/40 shadow-lg`
                            : "bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                        }`}
                      >
                        ${amt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {rechargeType === "DAYS" && (
                <div className="flex-1">
                  <span
                    aria-hidden="true"
                    className="block text-xs font-medium text-slate-500 mb-3 uppercase tracking-wider"
                  >
                    Quick Days
                  </span>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { days: 10, label: "10d" },
                      { days: 20, label: "20d" },
                      { days: 30, label: "1mo" },
                      { days: 60, label: "2mo" },
                      { days: 90, label: "3mo" },
                      { days: 120, label: "4mo" },
                      { days: 180, label: "6mo" },
                      { days: 360, label: "12mo" },
                    ].map(({ days, label }) => (
                      <button
                        key={days}
                        onClick={() => handleQuickAmount(days)}
                        className={`py-4 rounded-xl font-bold text-base transition-all border ${
                          telecomAmount === days.toString()
                            ? `bg-${accent}-500/15 text-${accent}-400 border-${accent}-500/40 shadow-lg`
                            : "bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="col-span-5 bg-slate-800 rounded-2xl border border-slate-700/50 p-6 flex flex-col gap-5">
              <div>
                <label
                  htmlFor="telecom-amount"
                  className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider"
                >
                  {rechargeType === "DAYS" ? "Days" : "Amount / Value"}
                </label>
                <div className="relative">
                  {rechargeType !== "DAYS" && (
                    <span
                      className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-${accent}-400`}
                    >
                      $
                    </span>
                  )}
                  <input
                    id="telecom-amount"
                    type="number"
                    value={telecomAmount}
                    onChange={(e) => onTelecomAmountChange(e.target.value)}
                    onBlur={(e) => {
                      // Days are sold by SMS, 10 days each — snap free text up
                      // to the next whole block so the quantity, the prorated
                      // cost and what the carrier actually delivers agree
                      // (CARRIER_LINES_VALIDITY_PLAN.md §0.2). The Quick Days
                      // buttons are already multiples of 10.
                      if (rechargeType !== "DAYS") return;
                      const snapped = snapValidityDaysUp(e.target.value);
                      if (snapped !== e.target.value)
                        onTelecomAmountChange(snapped);
                    }}
                    className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl ${rechargeType !== "DAYS" ? "pl-9" : "pl-4"} pr-4 py-3 text-white font-bold focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all`}
                    placeholder={rechargeType === "DAYS" ? "0" : "0.00"}
                  />
                </div>
              </div>

              {/* Cost field — manual entry for Days type */}
              {rechargeType === "DAYS" && (
                <div>
                  <label
                    htmlFor="telecom-days-cost"
                    className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider"
                  >
                    Cost ($)
                  </label>
                  <div className="relative mb-1.5">
                    <span
                      className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-${accent}-400`}
                    >
                      $
                    </span>
                    <input
                      id="telecom-days-cost"
                      type="number"
                      value={telecomDaysCostUsd}
                      onChange={(e) => setTelecomDaysCostUsd(e.target.value)}
                      className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-9 pr-4 py-3 text-white font-bold focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all`}
                      placeholder="0.00"
                      min="0"
                      step="0.1"
                    />
                  </div>
                  <div className="text-xs text-slate-500 font-mono pl-1">
                    {parseFloat(telecomDaysCostUsd) > 0
                      ? `≈ ${(parseFloat(telecomDaysCostUsd) * alfaCreditCostRate).toLocaleString()} LBP`
                      : ""}
                  </div>
                </div>
              )}

              {/* Dual-currency price display */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {rechargeType === "CREDIT_TRANSFER" && isShopLineMatch
                      ? "Price to Customer"
                      : "Price to Client"}
                  </label>
                  {rechargeType === "DAYS" && (
                    <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-600 p-0.5">
                      {(["USD", "LBP"] as const).map((cur) => (
                        <button
                          key={cur}
                          type="button"
                          onClick={() => {
                            if (cur === daysPriceCurrency) return;
                            setDaysPriceCurrency(cur);
                            setDaysPriceUsdInput("");
                            setTelecomPrice("");
                          }}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                            daysPriceCurrency === cur
                              ? `bg-${accent}-600 text-white`
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {cur}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {rechargeType === "DAYS" && daysPriceCurrency === "USD" ? (
                  <>
                    <div className="relative mb-1.5">
                      <span
                        className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-${accent}-400`}
                      >
                        $
                      </span>
                      <input
                        id="telecom-price"
                        type="number"
                        value={daysPriceUsdInput}
                        onChange={(e) => {
                          setDaysPriceUsdInput(e.target.value);
                          const num = parseFloat(e.target.value);
                          setTelecomPrice(
                            num > 0 ? (num * exchangeRate).toString() : "",
                          );
                        }}
                        className={`w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-9 pr-4 py-3 text-white font-bold focus:outline-none focus:border-${accent}-500 focus:ring-1 focus:ring-${accent}-500/30 transition-all`}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="text-xs text-slate-500 font-mono pl-1">
                      {parseFloat(daysPriceUsdInput) > 0
                        ? `≈ ${(parseFloat(daysPriceUsdInput) * exchangeRate).toLocaleString()} LBP`
                        : ""}
                    </div>
                  </>
                ) : (
                  <>
                    {/* LBP field — editable */}
                    <div className="relative mb-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-emerald-400 text-xs">
                        LBP
                      </span>
                      <input
                        id="telecom-price"
                        type="text"
                        inputMode="decimal"
                        value={
                          telecomPrice
                            ? Number(telecomPrice).toLocaleString()
                            : ""
                        }
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/,/g, "");
                          if (/^[0-9]*\.?[0-9]*$/.test(cleaned)) {
                            setTelecomPrice(cleaned);
                          }
                        }}
                        className="w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-14 pr-4 py-3 text-emerald-400 font-bold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all"
                        placeholder="0"
                      />
                    </div>
                    {/* USD equivalent — read-only */}
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs">
                        USD
                      </span>
                      <div className="w-full bg-slate-900/40 border border-slate-700/50 rounded-xl pl-14 pr-4 py-3 text-slate-300 font-bold font-mono text-sm select-none">
                        {telecomPrice && exchangeRate > 0
                          ? `$${convertLBPToUSD(parseFloat(telecomPrice), exchangeRate).toFixed(2)}`
                          : "$0.00"}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Hidden for a buy-back: this formula is price − cost, which
                  is meaningless here — real profit is credits gained − cash
                  paid out, and the PaymentSheet's own totals are the only
                  preview needed (CARRIER_LINES_VALIDITY_PLAN.md Phase 6). */}
              {!isCreditBuyback &&
                telecomPrice &&
                (rechargeType === "DAYS"
                  ? parseFloat(telecomDaysCostUsd) > 0
                  : !!telecomAmount) && (
                  <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/50">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">Profit</span>
                      <span
                        className={`font-bold font-mono ${
                          parseFloat(telecomPrice) -
                            (rechargeType === "DAYS"
                              ? parseFloat(telecomDaysCostUsd) *
                                alfaCreditCostRate
                              : parseFloat(telecomAmount) *
                                alfaCreditCostRate) >=
                          0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {(
                          parseFloat(telecomPrice || "0") -
                          (rechargeType === "DAYS"
                            ? parseFloat(telecomDaysCostUsd || "0") *
                              alfaCreditCostRate
                            : parseFloat(telecomAmount || "0") *
                              alfaCreditCostRate)
                        ).toLocaleString()}{" "}
                        LBP
                      </span>
                    </div>
                  </div>
                )}

              {/* PFT-3a: "For Partner" opt-in — routes the FULL price to a
                  selected partner's ledger instead of collecting counter
                  cash. Hides the Payment Sheet below (no walk-in customer,
                  no cash taken). */}
              <div>
                <ForPartnerToggle
                  testId="recharge-for-partner-toggle"
                  checked={forPartner}
                  onChange={setForPartner}
                  selectedPartnerId={selectedPartnerId}
                  onPartnerChange={setSelectedPartnerId}
                  autoSelectSingle
                />
              </div>

              {/* Payment Sheet — skipped entirely for a partner recharge:
                  it collects no cash, so show a short notice instead. */}
              {forPartner ? (
                <ForPartnerNotice testId="recharge-partner-no-payment-notice">
                  No payment is collected for a partner recharge. The full{" "}
                  <span className="font-bold">
                    {(telecomPrice
                      ? parseFloat(telecomPrice)
                      : 0
                    ).toLocaleString()}{" "}
                    LBP
                  </span>{" "}
                  goes on the selected partner&apos;s account, settled later on
                  the Partners page.
                </ForPartnerNotice>
              ) : (
                <PaymentSheet
                  open={sheetOpen}
                  onClose={() => setSheetOpen(false)}
                  onConfirm={handleTelecomSubmit}
                  isSubmitting={isSubmitting}
                  title={
                    isCreditBuyback
                      ? `${carrierLabel} Credit Buy-back`
                      : `${isMTC ? "MTC" : "Alfa"} ${rechargeType === "DAYS" ? "Days" : "Credit Transfer"}`
                  }
                  {...(isCreditBuyback
                    ? { confirmLabel: "Confirm Cashout" }
                    : {})}
                  accentColor={`bg-${accent}-600 hover:bg-${accent}-500 text-white`}
                  totalAmount={
                    telecomPrice
                      ? parseFloat(telecomPrice)
                      : rechargeType === "DAYS"
                        ? 0
                        : parseFloat(telecomAmount || "0") * alfaCreditCostRate
                  }
                  totalAmountCurrency="LBP"
                  currency="LBP"
                  paymentMethods={
                    isCreditBuyback
                      ? methods.filter((m) =>
                          BUYBACK_PAYMENT_METHOD_CODES.has(m.code),
                        )
                      : methods
                  }
                  clientId={telecomClientId}
                  fetchClientVouchers={fetchClientVouchers}
                  exchangeRate={exchangeRate}
                  {...(onEffectiveRateChange
                    ? { onExchangeRateChange: onEffectiveRateChange }
                    : {})}
                  showDiscount={true}
                  maxDiscount={Math.max(
                    0,
                    (telecomPrice ? parseFloat(telecomPrice) : 0) -
                      (rechargeType === "DAYS"
                        ? parseFloat(telecomDaysCostUsd || "0") *
                          alfaCreditCostRate
                        : parseFloat(telecomAmount || "0") *
                          alfaCreditCostRate),
                  )}
                  onPaymentChange={(lines) => {
                    setPaymentLines(lines);
                    if (lines.length === 1) {
                      setPaidBy(lines[0].method);
                    }
                  }}
                  onDiscountChange={handleDiscountChange}
                  {...(onReturnChange ? { onReturnChange } : {})}
                  {...(onKeptChange ? { onKeptChange } : {})}
                  hasClient={!!telecomClientId}
                  // Charge flow: shortfall → debt on the resolved client.
                  // Buy-back (D7): HARD off, regardless of client — an auto
                  // IN-direction debt leg would invert the sign of the
                  // unpaid remainder on this money-OUT flow (MultiPaymentInput's
                  // own warning; see FEATURE_GUIDE §7 / plan Phase 6).
                  autoDebtRemainder={isCreditBuyback ? false : !!telecomClientId}
                  // Buy-back: only require a client when the operator
                  // actually picked a CUSTOMER_ACCOUNT leg — otherwise a
                  // CASH/wallet-only cashout needs no client at all.
                  requiresClientForDebt={
                    isCreditBuyback
                      ? paymentLines.some((l) => l.method === "CUSTOMER_ACCOUNT")
                      : true
                  }
                  paymentInputKey={paymentInputKey}
                  initialPaymentMethod={initialPaymentMethod}
                  summary={[
                    {
                      label: rechargeType === "DAYS" ? "Days" : "Amount",
                      value:
                        rechargeType === "DAYS"
                          ? `${telecomAmount || "0"} days`
                          : `$${telecomAmount || "0"}`,
                    },
                    {
                      label: "Price",
                      value: `${(telecomPrice ? parseFloat(telecomPrice) : parseFloat(telecomAmount || "0") * alfaCreditCostRate).toLocaleString()} LBP`,
                      color: "text-emerald-400",
                    },
                  ]}
                >
                  {/* Client selector - always visible; auto-selects CUSTOMER_ACCOUNT when a registered client is picked or a new name+phone is entered */}
                  <div className="relative">
                    <label
                      htmlFor="telecom-debt-client"
                      className={`block text-xs font-medium mb-2 uppercase tracking-wider flex items-center gap-1.5 ${
                        paymentLines.some(
                          (l) => l.method === "CUSTOMER_ACCOUNT",
                        )
                          ? "text-orange-400"
                          : "text-slate-400"
                      }`}
                    >
                      <User size={12} />
                      {paymentLines.some((l) => l.method === "CUSTOMER_ACCOUNT")
                        ? "Client (required for debt)"
                        : "Client (optional)"}
                    </label>
                    {telecomClientId ? (
                      <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3">
                        <User size={16} className="text-orange-400" />
                        <div className="flex-1 min-w-0">
                          <div className="text-white font-medium truncate">
                            {telecomClientName}
                          </div>
                          {telecomClientPhone && (
                            <div className="text-xs text-orange-300/80 font-mono truncate">
                              {telecomClientPhone}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setTelecomClientId(null);
                            setTelecomClientName("");
                            setTelecomClientPhone("");
                          }}
                          className="text-slate-400 hover:text-white transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                            <Search size={16} />
                          </div>
                          <input
                            type="text"
                            value={telecomClientName}
                            onChange={(e) => {
                              setTelecomClientName(e.target.value);
                              setShowClientSearch(true);
                              searchClients(e.target.value);
                            }}
                            onFocus={() => {
                              if (telecomClientName.length >= 2) {
                                setShowClientSearch(true);
                                searchClients(telecomClientName);
                              }
                            }}
                            className="w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                            placeholder="Search client by name..."
                          />
                          {showClientSearch &&
                            clientSearchResults.length > 0 && (
                              <div className="absolute z-10 top-full mt-1 w-full bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-48 overflow-auto">
                                {clientSearchResults.map((c: any) => (
                                  <button
                                    key={c.id}
                                    onClick={() => {
                                      selectClient(c);
                                      setInitialPaymentMethod(
                                        "CUSTOMER_ACCOUNT",
                                      );
                                      setPaymentInputKey((k) => k + 1);
                                    }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-slate-700 text-sm text-white transition-colors first:rounded-t-xl last:rounded-b-xl flex items-center justify-between gap-2"
                                  >
                                    <span className="truncate">
                                      {c.full_name || c.name}
                                    </span>
                                    {c.phone_number && (
                                      <span className="text-xs text-slate-400 font-mono shrink-0">
                                        {c.phone_number}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                        </div>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                            <Phone size={14} />
                          </div>
                          <input
                            type="tel"
                            inputMode="numeric"
                            value={telecomClientPhone}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTelecomClientPhone(val);
                              // Search by phone too — backend matches name OR phone
                              if (val.trim().length >= 3) {
                                setShowClientSearch(true);
                                searchClients(val.trim());
                              }
                            }}
                            className="w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-10 pr-4 py-3 text-white font-mono focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                            placeholder="Phone number (registers a new client)"
                          />
                        </div>
                        {telecomClientName.trim() &&
                          telecomClientPhone.trim() &&
                          !telecomClientId && (
                            <p className="text-xs text-orange-300/80 px-1">
                              New client will be created on confirm.
                            </p>
                          )}
                      </div>
                    )}
                  </div>
                  <TransactionTimeOverride
                    value={transactionTime}
                    onChange={(t) => {
                      setTransactionTime(t);
                      onTransactionTimeChange?.(t);
                    }}
                  />
                </PaymentSheet>
              )}
            </div>
          </div>

          {/* Bottom bar — amount summary + Proceed to Pay */}
          <div className="flex items-center justify-end gap-3 pt-1">
            {telecomAmount && (
              <div className="text-right leading-tight">
                {telecomPrice && (
                  <div className="text-xs text-emerald-400 font-mono font-semibold">
                    {Number(telecomPrice).toLocaleString()} LBP
                    {exchangeRate > 0 && (
                      <span className="text-slate-400 ml-1.5">
                        ($
                        {convertLBPToUSD(
                          parseFloat(telecomPrice),
                          exchangeRate,
                        ).toFixed(2)}
                        )
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={`text-xs text-${accent}-400 font-mono font-semibold`}
                >
                  {rechargeType === "DAYS"
                    ? `${telecomAmount} days`
                    : `$${telecomAmount}`}
                </div>
              </div>
            )}
            <button
              onClick={() => {
                // PFT-3a: a partner recharge bypasses the PaymentSheet AND
                // handleTelecomSubmit entirely — no walk-in customer, no
                // counter cash, so it never opens the sheet or adds to the
                // active session's cart either.
                if (forPartner) {
                  handleForPartnerSubmit();
                  return;
                }
                // Session mode: add to cart directly (basket owns the payment),
                // skipping the PaymentSheet. Non-session: open the PaymentSheet.
                if (activeSession) {
                  handleTelecomSubmit();
                } else {
                  setSheetOpen(true);
                }
              }}
              disabled={
                isSubmitting ||
                isSubmittingPartner ||
                !telecomAmount ||
                (rechargeType === "DAYS" &&
                  (!(parseFloat(telecomDaysCostUsd) > 0) || !telecomPrice)) ||
                (forPartner && (!telecomPrice || !selectedPartnerId)) ||
                isBuybackBlockedBySession
              }
              className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all whitespace-nowrap flex items-center gap-1.5 ${
                isSubmitting ||
                isSubmittingPartner ||
                !telecomAmount ||
                (rechargeType === "DAYS" &&
                  (!(parseFloat(telecomDaysCostUsd) > 0) || !telecomPrice)) ||
                (forPartner && (!telecomPrice || !selectedPartnerId)) ||
                isBuybackBlockedBySession
                  ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                  : `bg-${accent}-600 hover:bg-${accent}-500 text-white shadow-lg shadow-${accent}-500/20`
              }`}
              title={
                isBuybackBlockedBySession
                  ? "A shop-line credit buy-back cannot be added to an active customer session"
                  : undefined
              }
            >
              <CreditCard size={15} />
              {/* Review finding #5: `isBuybackBlockedBySession` (used for
                  `disabled` above) is `isCreditBuyback && !!activeSession` —
                  there is no non-blocked "buy-back with an active session"
                  case (a payout has no cart representation at all, so
                  `handleTelecomSubmit` always short-circuits it before the
                  cart branch). Checking `isCreditBuyback` BEFORE
                  `activeSession` here means a session-blocked buy-back keeps
                  showing "Proceed to Pay Out" (still disabled, same tooltip)
                  instead of the misleading "Add to Cart" a disabled button
                  can never do. Every other combination is unchanged. */}
              {forPartner
                ? "Submit to Partner"
                : isCreditBuyback
                  ? "Proceed to Pay Out"
                  : activeSession
                    ? "Add to Cart"
                    : "Proceed to Pay"}
            </button>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={rechargeHistory}
          provider={isMTC ? "MTC" : "Alfa"}
          amountLabel="Credits"
          amountAlwaysUsd
          marginAlertThreshold={marginAlertThreshold}
          sourceTable="recharges"
          transactionType="RECHARGE"
          onClose={() => setShowHistory(false)}
          onRefresh={onRefreshHistory ?? (() => {})}
          formatAmount={(val, currency) =>
            currency === "LBP"
              ? `${val.toLocaleString()} LBP`
              : `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          }
          onUpdateMetadata={async (id, data) => {
            const result = await window.api.recharge.updateMetadata({
              id,
              ...data,
            });
            if (result.success) {
              onRefreshHistory?.();
            }
            return result;
          }}
        />
      )}
    </div>
  );
}
