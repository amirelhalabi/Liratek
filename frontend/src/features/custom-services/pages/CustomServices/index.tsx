/**
 * Custom Services Page
 *
 * Standalone module for recording any ad-hoc shop service with cost, price,
 * payment method, and customer details. Uses the dedicated custom_services API.
 *
 * Customer details (name, phone, save-as-client) are available for ALL
 * payment methods — not just DEBT.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import {
  categoryLabel,
  insuranceTypeLabel,
} from "@/features/custom-services/utils/labels";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import {
  Plus,
  History,
  TrendingUp,
  User,
  Phone,
  X,
  RefreshCw,
  Package,
  Tag,
  Settings,
  Wallet,
  Shield,
} from "lucide-react";
import {
  appEvents,
  canChargeToCustomerAccount,
  PageHeader,
  useApi,
  DecimalInput,
} from "@liratek/ui";
import {
  INSURANCE_TYPES,
  type FulfillmentStatus,
  type InsuranceType,
} from "@liratek/core";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useSessionAutoFill } from "@/features/sessions/hooks/useSessionAutoFill";
import { useCustomServices } from "../../hooks/useCustomServices";
import logger from "@/utils/logger";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import { MultiPaymentInput, type PaymentLine, SearchBar } from "@liratek/ui";
import { toSnakeLegs } from "@/utils/paymentUtils";
import { HistoryModal } from "./components/HistoryModal";
import { PresetManagerModal } from "./components/PresetManagerModal";
import { StatsCards } from "../../components/StatsCards";
import { HoldMoneySection } from "../../components/HoldMoneySection";
import { useSellRate } from "@/hooks/useSellRate";
import { useSaveAsClient } from "@/shared/hooks/useSaveAsClient";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import { SaveAsClientCheckbox } from "@/shared/components/SaveAsClientCheckbox";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { useAutoPrintReceipt } from "@/shared/hooks/useAutoPrintReceipt";
import type { Client } from "@liratek/ui";
import { ForPartnerNotice } from "@/features/partners/components/ForPartnerToggle";
import { PartnerModeSwitch } from "@/features/custom-services/components/PartnerModeSwitch";
import { useForPartnerOffInSession } from "@/features/partners/hooks/useForPartnerOffInSession";
import {
  partnerModeTransition,
  type PartnerMode,
} from "@/features/custom-services/utils/partnerModeTransition";
import { PartnerSelector } from "@/features/partners/components/PartnerSelector";
import { formatServiceAmount } from "@/features/custom-services/utils/formatServiceAmount";
import { PriceChangeWarning } from "@/shared/components/PriceChangeWarning";

// =============================================================================
// Helper
// =============================================================================

interface ProductSearchResult {
  id: number;
  name: string;
  cost_price: number;
  retail_price: number;
  barcode: string;
}

/** Category presets for quick selection. `value` is the stored code; the
 *  label is translated from it at render time (`categoryLabel`). */
const SERVICE_CATEGORIES = [
  { value: "", icon: "briefcase" },
  { value: "digital_account", icon: "monitor" },
  { value: "repair", icon: "wrench" },
  { value: "activation", icon: "zap" },
  { value: "other", icon: "tag" },
  // Special category — selecting it swaps the form for the Hold Money UI
  // (no presets / product search / cost-price; cash held in the General drawer).
  { value: "hold_money", icon: "wallet" },
  // LIRA-155 — insurance: unlike Hold Money, this is NOT a self-contained
  // section with its own table. It is an ordinary custom service that takes
  // the standard submit path, but selecting it swaps in two pieces of
  // behaviour (mirrors the hold_money precedent's "category selection swaps
  // form behaviour" mechanism, applied more narrowly here): (1) pre-selects
  // "Via Partner" — the insurer is normally the partner performing the
  // service (owner decision, item 2; see the category button's onClick
  // below) — and (2) stamps `fulfillment_status: "ORDERED"` on submit so the
  // row starts fulfilment-tracked (see handleSubmit). The operator can still
  // switch to "For Partner" or back to no partner; nothing here forces VIA.
  { value: "insurance", icon: "shield" },
] as const;

/** The category that swaps the custom-service form for the Hold Money UI. */
const HOLD_MONEY_CATEGORY = "hold_money";

/** LIRA-155 — the category that starts fulfilment tracking at ORDERED and
 *  pre-selects "Via Partner". See `insuranceFulfillment.ts` (imported below)
 *  for the ONE definition of the status list/transition rule this page never
 *  re-spells. */
export const INSURANCE_CATEGORY = "insurance";

interface ServicePreset {
  id: number;
  name: string;
  category: string;
  cost_usd: number;
  cost_lbp: number;
  price_usd: number;
  price_lbp: number;
}

// =============================================================================
// Component
// =============================================================================

export default function CustomServices() {
  const api = useApi();
  const { t } = useTranslation("customServices");
  const { methods } = usePaymentMethods();
  const { activeSession, addToCart: addToSessionCart } = useSession();
  // LIRA-069 W1.d — auto-print on a successful STANDALONE submit (skipped
  // when a session is active; the session gets its own Print button at
  // checkout, W1.b).
  const autoPrintReceipt = useAutoPrintReceipt();
  const {
    history,
    summary,
    loading: historyLoading,
    reload,
  } = useCustomServices();

  // ─── Form State ───
  const [description, setDescription] = useState("");
  // Shop-day B3 / owner decision Q4: text typed in the "Search Item or
  // Service" box but never committed with Enter is still the description.
  // Mirrors the SearchBar's own query; `searchBoxKey` remounts the box blank
  // after a submit so the old text cannot become the next service's.
  const [searchText, setSearchText] = useState("");
  const [searchBoxKey, setSearchBoxKey] = useState(0);
  // Once a description is set (product, preset or Enter) the box unmounts;
  // drop its text so a later remount (description cleared) starts clean.
  useEffect(() => {
    if (description) setSearchText("");
  }, [description]);
  // The ONE description the submit sends (payload and session-cart label).
  const resolvedDescription = description.trim() || searchText.trim();
  const resetSearchBox = () => {
    setSearchText("");
    setSearchBoxKey((k) => k + 1);
  };
  const [costUsd, setCostUsd] = useState("");
  const [costLbp, setCostLbp] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [priceLbp, setPriceLbp] = useState("");
  // Active currency for cost/price entry (one currency at a time)
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  // LIRA-155: derived, not its own state — resets for free whenever
  // `category` resets on submit/switch, same as HOLD_MONEY_CATEGORY's check.
  const isInsurance = category === INSURANCE_CATEGORY;
  // LIRA-360: which insurance — required on an insurance sale so a renewal
  // can be matched to the policy it renews. Cleared with `category`.
  const [insuranceType, setInsuranceType] = useState<InsuranceType | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();

  // ─── Payment lines (always multi-payment) ───
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [returnLegs, setReturnLegs] = useState<PaymentLine[]>([]);
  // T3 keep-change: kept (not returned) change → profit stamp on the service.
  const [keptChange, setKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  // LIRA-310 US5: the payment sheet's discount (typed, or added by its
  // built-in Waive), in the active currency. Lowers the price actually sent.
  const [csDiscount, setCsDiscount] = useState(0);
  // LIRA-319: the payment sheet's extra ("+ Extra" side of the same line),
  // in the active currency. Sent as its own field, never folded into price.
  const [csExtra, setCsExtra] = useState(0);

  // LIRA-081 (PFT-R) / LIRA-154: partner involvement is now a 3-way mode,
  // not a boolean —
  //   "none" — no partner, the ordinary walk-in flow.
  //   "FOR"  — no counter payment; the FULL price (per currency) books to
  //            the selected partner's tab instead (unchanged from PFT-R).
  //   "VIA"  — the MIRROR of FOR: the partner performs the service, the
  //            walk-in customer pays US now through the normal payment
  //            section, and we owe the partner the COST (not the price).
  // Picked on one segmented control, [ Customer | For Partner | Via Partner ]
  // (owner decision 2026-10-16; it replaced two mutually exclusive
  // checkboxes). The side effects of each change live in
  // handlePartnerModeChange below.
  const [partnerMode, setPartnerMode] = useState<PartnerMode>("none");
  const isForPartner = partnerMode === "FOR";
  const isViaPartner = partnerMode === "VIA";
  const hasPartnerMode = partnerMode !== "none";
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(
    null,
  );

  // OWNER_NOTES_REMAINING_BUILD.md #16 (Route A) — "Pay out": ONLY valid
  // alongside "Via Partner" (mirrors the core Zod refine). Not a 3rd
  // partnerMode value — a payout is still partner_mode='VIA' underneath,
  // this just flips `direction`. Cleared whenever VIA is left (see
  // handlePartnerModeChange) so it can never linger into a "none"/FOR
  // submission.
  const [isPayout, setIsPayout] = useState(false);
  // LIRA-363 — "Free — no charge": the job saves with price 0 and collects
  // nothing. Never For Partner or a payout (the server refuses both).
  const [isFree, setIsFree] = useState(false);

  // Partner-mode change — every side effect of the two checkboxes this
  // control replaced, pinned per transition in partnerModeTransition.
  const handlePartnerModeChange = (next: PartnerMode) => {
    const effects = partnerModeTransition(partnerMode, next);
    if (!effects) return;
    setPartnerMode(next);
    if (effects.clearPayout) setIsPayout(false);
    if (effects.clearPartner) setSelectedPartnerId(null);
    if (effects.clearPayments) {
      // Clear any lingering payment state so a leftover leg from before
      // switching to For Partner is never submitted.
      setPaymentLines([]);
      setReturnLegs([]);
      setKeptChange(null);
    }
  };

  // Owner rule 2026-10-16: a customer session never has partner sales. In a
  // session the "For Partner" segment is hidden (PartnerModeSwitch `hideFor`)
  // and a FOR picked before the session opened goes back to "Customer"
  // through the normal transition (which drops the partner). VIA stays.
  useForPartnerOffInSession(!!activeSession, isForPartner, () =>
    handlePartnerModeChange("none"),
  );

  // ─── Item Selector ───
  const [selectedProduct, setSelectedProduct] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const productSearchRef = useRef<HTMLDivElement>(null);
  // LIRA-260: the saved price the Price field was prefilled from (a preset or
  // an inventory product). Drives the warning-only PriceChangeWarning; null
  // for free-text services, which have no saved price.
  const [savedPrice, setSavedPrice] = useState<{
    currency: "USD" | "LBP";
    amount: number;
  } | null>(null);

  // ─── History Modal ───
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // ─── Preset Manager Modal ───
  const [showPresetManager, setShowPresetManager] = useState(false);

  // ─── DB-driven Presets ───
  const [presets, setPresets] = useState<ServicePreset[]>([]);

  const loadPresets = useCallback(async () => {
    // Dual-mode: api.servicePresets goes through IPC on desktop and the
    // `/api/service-presets` REST route on web (rule 19) — no transport gate
    // needed here anymore.
    try {
      const result = await api.servicePresets.list();
      if (result.success && result.data) {
        setPresets(result.data);
      }
    } catch (err) {
      logger.error("Failed to load service presets:", err);
    }
  }, []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  // ─── Customer Details (for ALL payment methods) ───
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientName, setClientName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [paymentInitialMethod, setPaymentInitialMethod] = useState<
    string | undefined
  >();
  const {
    saveAsClient,
    setSaveAsClient,
    showCheckbox: showSaveAsClient,
    trySaveAsClient,
    resetSaveAsClient,
  } = useSaveAsClient(clientName, phoneNumber);

  // Payments use the BUY rate (owner decision 2026-07-06): every
  // MultiPaymentInput converts LBP↔USD at buyRate.
  const { buyRate: exchangeRate } = useSellRate();

  // Payment-Legs Integrity plan pattern (mirrors FinancialForm/KatshForm/
  // OmtWhishAppTransferForm/CheckoutModal): the rate MultiPaymentInput
  // ACTUALLY converted tender at — the operator's own edit of "1 USD = X
  // LBP" inside the payment sheet, or the buyRate default it was seeded
  // with (onExchangeRateChange fires at least once either way, on mount).
  // This page never captured it, so the submit payload never carried
  // exchange_rate at all — the validator/repository already fully support
  // the field (packages/core/src/validators/customService.ts,
  // CustomServiceRepository.ts), they just never received a value.
  const [effectiveRate, setEffectiveRate] = useState<number | undefined>(
    undefined,
  );

  // ─── Product Search ───
  const clearProduct = () => {
    setSelectedProduct(null);
    setSavedPrice(null);
  };

  // Populate client name/phone from session, clear when session closes
  useSessionAutoFill([
    { select: (s) => s.customer_name, set: setClientName, clearValue: "" },
    { select: (s) => s.customer_phone, set: setPhoneNumber, clearValue: "" },
  ]);

  const selectClient = (client: Client) => {
    setClientName(client.full_name);
    setClientId(client.id);
    if (client.phone_number) setPhoneNumber(client.phone_number);
    resetSaveAsClient();
    const hasCustomerAccount = methods.some(
      (m) => m.code === "CUSTOMER_ACCOUNT",
    );
    const chargeable = canChargeToCustomerAccount({
      name: client.full_name,
      phone: client.phone_number,
    });
    if (hasCustomerAccount && chargeable) {
      setPaymentInitialMethod("CUSTOMER_ACCOUNT");
      setPaymentInputKey((k) => k + 1);
    }
  };

  const clearClient = () => {
    setClientId(null);
    setClientName("");
    setPhoneNumber("");
    resetSaveAsClient();
    setPaymentInitialMethod(undefined);
    setPaymentInputKey((k) => k + 1);
  };

  // ─── Computed ───
  const costUsdVal = parseFloat(costUsd) || 0;
  const costLbpVal = parseFloat(costLbp) || 0;
  const priceUsdVal = parseFloat(priceUsd) || 0;
  const priceLbpVal = parseFloat(priceLbp) || 0;
  // T3 keep-change: the kept amount that will actually be SENT with this
  // service (and so joins its profit stamp). One definition, used by both the
  // submit payload and the Profit preview, so the preview shows exactly what
  // the Profits page will show (LIRA-185). Applies to VIA too; never to FOR
  // (no counter payment) or a payout (no tender to make change from) — the
  // server refuses both. Never into a session basket either: the basket
  // checkout owns the customer's cash and its own kept change, and the
  // server books no item-level kept for a basket item (POSTING_MAP G42).
  const sentKeptChange =
    !isForPartner &&
    !isPayout &&
    !activeSession &&
    keptChange &&
    (keptChange.usd > 0 || keptChange.lbp > 0)
      ? keptChange
      : null;
  // Owner decision 2026-10-07: a service with no selling price only means
  // the price is not pre-filled — the cashier types it on the spot. Until
  // they do, the payment sheet has nothing to collect (it is never the cost)
  // and the sale cannot be submitted or added to a session basket. Applies
  // to For Partner too (owner follow-up, same day: the partner is booked the
  // selling price, so with none they would be booked nothing). Not for a
  // payout (its own Arrived/Paid Out rule). The server refuses the same case
  // (CustomServiceRepository.createService).
  // LIRA-363: a job ticked "Free" is priced 0 on purpose, so it never waits.
  const freeJob = isFree && !isForPartner && !isPayout;
  const awaitingSellingPrice =
    !isPayout && !freeJob && priceUsdVal <= 0 && priceLbpVal <= 0;
  // The payment sheet unmounts while it waits for a price; what it held
  // (legs, change legs, kept change) belonged to the old price, so drop it
  // rather than letting it ride into the next sale. Fires only when the
  // waiting state flips on, so the fresh arrays cannot loop.
  useEffect(() => {
    if (!awaitingSellingPrice) return;
    setPaymentLines([]);
    setReturnLegs([]);
    setKeptChange(null);
    setCsDiscount(0);
    setCsExtra(0);
  }, [awaitingSellingPrice]);
  // LIRA-310 US5 — the discount is real: capped at the margin (price − cost)
  // in the active currency, so a service is never sold below its cost, and
  // only where the payment sheet that reports it is shown (never FOR or a
  // payout — a stale value from before the toggle never rides along). The
  // price SENT is price − discount: the server reconciles the payment legs
  // against it (CustomServiceRepository) and books profit = price − cost.
  const maxCsDiscount =
    currency === "USD"
      ? Math.max(0, priceUsdVal - costUsdVal)
      : Math.max(0, priceLbpVal - costLbpVal);
  const appliedCsDiscount =
    !isForPartner && !isPayout && !awaitingSellingPrice
      ? Math.min(Math.max(0, csDiscount), maxCsDiscount)
      : 0;
  const chargedPriceUsd =
    currency === "USD"
      ? Math.round((priceUsdVal - appliedCsDiscount) * 100) / 100
      : priceUsdVal;
  const chargedPriceLbp =
    currency === "LBP"
      ? Math.round(priceLbpVal - appliedCsDiscount)
      : priceLbpVal;
  // LIRA-319 — the extra: only on an ordinary walk-in sale paid here. Never
  // for a partner (FOR or VIA), a payout, or a session basket line (the
  // basket takes its extra at the session checkout; the cart reuses this
  // payload). Capped at the selling price (FR-006); the server refuses the
  // same. Not part of the profit shown below — Profits reports it on its own.
  const csExtraAllowed =
    !hasPartnerMode && !isPayout && !activeSession && !awaitingSellingPrice;
  const maxCsExtra = currency === "USD" ? priceUsdVal : priceLbpVal;
  const appliedCsExtra = csExtraAllowed
    ? Math.min(Math.max(0, csExtra), maxCsExtra)
    : 0;
  const profitUsd = chargedPriceUsd - costUsdVal + (sentKeptChange?.usd ?? 0);
  const profitLbp = chargedPriceLbp - costLbpVal + (sentKeptChange?.lbp ?? 0);

  // ─── Submit ───
  const handleSubmit = async () => {
    if (
      costUsdVal <= 0 &&
      costLbpVal <= 0 &&
      priceUsdVal <= 0 &&
      priceLbpVal <= 0
    ) {
      alert(t("msg.enterCostOrPrice"));
      return;
    }
    if (awaitingSellingPrice) {
      alert(t("msg.enterSellingPrice"));
      return;
    }
    if (isInsurance && !insuranceType) {
      alert(t("msg.selectInsuranceType"));
      return;
    }
    const hasDebtLine = paymentLines.some(
      (l) => l.method === "CUSTOMER_ACCOUNT",
    );
    // FOR takes no counter payment at all, so this guard never applies to
    // it. VIA is a normal walk-in payment (just with an extra partner-cost
    // ledger booking underneath) so it's treated exactly like "none" here.
    if (!isForPartner && hasDebtLine && !clientId) {
      alert(t("msg.selectClientForDebt"));
      return;
    }
    if (
      !isForPartner &&
      !clientId &&
      returnLegs.some((l) => l.method === "CUSTOMER_ACCOUNT")
    ) {
      alert(t("msg.selectClientForChange"));
      return;
    }
    if (hasPartnerMode && !selectedPartnerId) {
      alert(t("msg.selectPartner"));
      return;
    }
    // OWNER_NOTES_REMAINING_BUILD.md #16 — a payout needs BOTH sides
    // (mirrors createCustomServiceSchema's refine): the amount that arrived
    // via the partner (price) AND the amount handed to the recipient
    // (cost). Checked BEFORE the VIA payment-leg guard below, which does not
    // apply to a payout (it pays OUT, it never collects a leg).
    if (
      isPayout &&
      !(
        (priceUsdVal > 0 || priceLbpVal > 0) &&
        (costUsdVal > 0 || costLbpVal > 0)
      )
    ) {
      alert(t("msg.payoutNeedsBoth"));
      return;
    }
    // LIRA-154 VIA submit guard: a walk-in customer is actually paying, so
    // VIA (unlike FOR) additionally requires at least one payment leg —
    // a CUSTOMER_ACCOUNT (debt) leg counts too, it's still a paymentLines
    // entry, just settled later instead of collected now. A payout takes no
    // counter leg at all (like FOR), so it's excluded here too.
    if (isViaPartner && !isPayout && !freeJob && paymentLines.length === 0) {
      alert(t("msg.addPayment"));
      return;
    }

    setIsSubmitting(true);
    try {
      // Auto-create client if "Save as client" is checked and no existing client selected
      let finalClientId = clientId;
      if (!isForPartner && !clientId && clientName.trim()) {
        const result = await trySaveAsClient();
        if (result.clientId) finalClientId = result.clientId;
      }

      // Derive paid_by from first payment line for backend compatibility
      const primaryMethod =
        paymentLines.length > 0 ? paymentLines[0].method : "CASH";

      // Tendered rate: prefer the operator's own edit of the payment
      // sheet's "1 USD = X LBP" field, else the buyRate default it was
      // seeded with (mirrors Services/index.tsx's resolvedTenderRate).
      // Guarded against a non-positive/non-finite value: the validator's
      // z.number().positive() would otherwise hard-reject the whole
      // submission — omitting the key entirely lets the repository's own
      // live snapshot-rate fallback apply instead.
      const resolvedRate = effectiveRate ?? exchangeRate;
      const exchangeRateForPayload =
        Number.isFinite(resolvedRate) && resolvedRate > 0
          ? resolvedRate
          : undefined;

      // LIRA-155: `fulfillment_status` is intersected in locally rather than
      // added to `addCustomService`'s own param type — that type lives in
      // the dual-transport files (backendApi.ts/ElectronApiAdapter.ts/
      // electron.d.ts/packages/ui's ApiAdapter), which this ticket's own
      // scope excludes from this pass. The field is already accepted by
      // `createCustomServiceSchema` (packages/core/src/validators/
      // customService.ts) end-to-end on the web/REST path; the desktop/IPC
      // path's local duplicate schema (electron-app/schemas/index.ts's
      // `CustomServiceCreateSchema`) still needs the same one-line addition
      // every other LIRA-154/155 field got there (partnerId/partnerMode/
      // product_id) before this reaches the repository over IPC — until
      // then Zod's default "strip unknown keys" behaviour just drops it
      // silently on desktop, matching this repo's usual only-partially-wired
      // failure mode for an unfinished transport pass, not a new one.
      const payload: Parameters<typeof api.addCustomService>[0] & {
        fulfillment_status?: FulfillmentStatus;
      } = {
        description: resolvedDescription,
        cost_usd: costUsdVal,
        cost_lbp: costLbpVal,
        // LIRA-310 US5: the price after the payment sheet's discount.
        price_usd: chargedPriceUsd,
        price_lbp: chargedPriceLbp,
        // LIRA-319: the discount, so the server can refuse "discount and
        // extra" (the price above is already net of it), and the extra as
        // its own field in the active currency. Omitted when 0.
        ...(appliedCsDiscount > 0
          ? currency === "USD"
            ? { discount_usd: appliedCsDiscount }
            : { discount_lbp: appliedCsDiscount }
          : {}),
        ...(appliedCsExtra > 0
          ? currency === "USD"
            ? { extra_usd: Math.round(appliedCsExtra * 100) / 100 }
            : { extra_lbp: Math.round(appliedCsExtra) }
          : {}),
        paid_by: primaryMethod,
        ...(exchangeRateForPayload !== undefined
          ? { exchange_rate: exchangeRateForPayload }
          : {}),
        // LIRA-081/LIRA-154: FOR takes NO counter payment at all — never
        // forward payment legs even if stale state lingers from before the
        // toggle was checked (PartnerRepository/CustomServiceRepository
        // reject any leg in FOR mode; this keeps the payload consistent
        // with what the UI actually shows). VIA is the opposite of FOR
        // here — it's a real walk-in payment, so it forwards legs exactly
        // like the no-partner case (`!isForPartner` is true for VIA too).
        // OWNER_NOTES_REMAINING_BUILD.md #16: a payout (isPayout) takes no
        // counter leg either — it PAYS the recipient, it never collects —
        // so it's excluded here the same way FOR is; the Payment Method
        // section isn't even rendered for it, so paymentLines/returnLegs
        // are empty anyway, but this stays explicit rather than relying on
        // that.
        ...(!isForPartner &&
        !isPayout &&
        (paymentLines.length > 0 || returnLegs.length > 0)
          ? { payments: toSnakeLegs(paymentLines, returnLegs) }
          : {}),
        // Voucher code for the GIFT_CARD leg (custom services use one primary method)
        ...(() => {
          const voucherLeg = paymentLines.find(
            (p) => p.method === "GIFT_CARD" && p.voucherCode,
          );
          return !isForPartner && !isPayout && voucherLeg?.voucherCode
            ? { voucher_code: voucherLeg.voucherCode }
            : {};
        })(),
        // T3 keep-change: kept amounts join the service's profit stamp.
        // Applies to VIA too — profit is still price - cost regardless of
        // who performed the service. Not for a payout — there is no change
        // to keep (the shop pays out, it doesn't collect a tender to make
        // change from).
        ...(sentKeptChange
          ? {
              kept_change_usd: sentKeptChange.usd,
              kept_change_lbp: sentKeptChange.lbp,
            }
          : {}),
        // LIRA-154: unlike every gate above (where VIA aligns with "none"),
        // this one is where VIA aligns WITH FOR — both are partner modes
        // and both need partnerId/partnerMode sent. The literal mode value
        // ("FOR" | "VIA") is forwarded as-is; TransactionRepository/
        // CustomServiceRepository/PartnerRepository decide what to do with
        // each (FOR = DEBIT the price, VIA = CREDIT the cost).
        ...(partnerMode !== "none" && selectedPartnerId
          ? { partnerId: selectedPartnerId, partnerMode }
          : {}),
        // OWNER_NOTES_REMAINING_BUILD.md #16 — omitted for every non-payout
        // submission (the repository treats a missing `direction` as "IN"),
        // so an upgraded desktop app talking to an un-upgraded core still
        // round-trips the existing behaviour byte-for-byte.
        ...(isPayout ? { direction: "OUT" as const } : {}),
        // LIRA-363: price 0 on purpose (the payment sheet is not mounted,
        // so no legs ride along).
        ...(freeJob ? { is_free: true } : {}),
      };
      if (finalClientId) payload.client_id = finalClientId;
      if (clientName.trim()) payload.client_name = clientName.trim();
      if (phoneNumber.trim()) payload.phone_number = phoneNumber.trim();
      if (note.trim()) payload.note = note.trim();
      if (category) payload.category = category;
      if (transactionTime) payload.transaction_time = transactionTime;
      // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 FINAL SPEC: only the
      // inventory-item path decrements stock — send product_id ONLY when the
      // operator actually picked a product from the SearchBar. Preset/
      // free-text never set selectedProduct, so this stays omitted -> NULL
      // -> unchanged (no stock movement).
      if (selectedProduct) payload.product_id = selectedProduct.id;
      // LIRA-155 (owner decision, item 2): an insurance sale starts
      // fulfilment-tracked at ORDERED — the paperwork was just placed with
      // the partner/insurer, nothing exists yet. Every other category omits
      // the field entirely -> NULL -> not tracked (unchanged behaviour).
      // Set before the session-cart branch below so a session-basket
      // insurance item carries it too — both branches read this SAME
      // `payload` object.
      if (isInsurance) payload.fulfillment_status = "ORDERED";
      // LIRA-360: same single payload for the walk-in and session-cart
      // branches below (rule 22).
      if (isInsurance && insuranceType) payload.insurance_type = insuranceType;

      // If session is active, add to cart instead of submitting — never for
      // a FOR-partner service (no walk-in customer, mirrors every other
      // FOR_% form: TelecomForm/KatshForm/etc. all bypass the session
      // entirely). LIRA-154: VIA is the one gate where this is INVERTED
      // relative to FOR — VIA has a real walk-in customer paying now, so
      // it goes THROUGH the session cart exactly like a plain service
      // (`!isForPartner` is true for VIA). Do not widen this to
      // `!hasPartnerMode` — that would wrongly bypass the session for VIA.
      // OWNER_NOTES_REMAINING_BUILD.md #16: a payout (isPayout) ALSO
      // bypasses the session, like FOR — there is no walk-in customer
      // basket to net against (owner's #11 netted-checkout note is about
      // cash PAID OUT of a session's own drawer, a different mechanism this
      // ticket does not build); a payout always posts immediately.
      // LIRA-363: a free job has nothing to collect, so it never joins the
      // basket — it is saved at once (the server refuses it in a basket).
      if (activeSession && !isForPartner && !isPayout && !freeJob) {
        // Never the cost — a basket line always has a selling price here
        // (awaitingSellingPrice is checked above).
        // LIRA-310 US5: the charged (after-discount) price, as in `payload`.
        const amountLabel =
          chargedPriceUsd > 0
            ? `$${chargedPriceUsd.toFixed(2)}`
            : `${formatNumber(chargedPriceLbp)} LBP`;
        // i18n-exempt: stored text sent to server (session basket item label)
        const label = `Service: ${resolvedDescription.substring(0, 40)} - ${amountLabel}`;

        addToSessionCart({
          module: "custom_service",
          label,
          // Single-currency model: pair amount with the active toggle currency
          // (an LBP service used to book amount 0 here — USD fields are
          // cleared when the toggle is on LBP).
          amount: currency === "USD" ? chargedPriceUsd : chargedPriceLbp,
          currency,
          // Must be the REAL handler channel — the session-checkout replayer
          // invokes it verbatim ("customService:create" was a dead channel
          // that failed every session checkout containing a service; lira-094).
          ipcChannel: "custom-services:add",
          formData: payload,
        });

        // Reset form
        setDescription("");
        resetSearchBox();
        setCostUsd("");
        setCostLbp("");
        setPriceUsd("");
        setPriceLbp("");
        setNote("");
        setCategory("");
        setInsuranceType("");
        setPaymentLines([]);
        setReturnLegs([]);
        setKeptChange(null);
        // LIRA-154: unlike FOR (which never reaches this branch), a VIA
        // item CAN land here now that the session cart is open to it —
        // reset the partner mode so it doesn't silently carry over onto
        // the next, unrelated cart line.
        setPartnerMode("none");
        setIsPayout(false);
        setSelectedPartnerId(null);
        clearProduct();
        clearClient();
        setIsSubmitting(false);
        return;
      }

      const result = await api.addCustomService(payload);

      if (result.success) {
        appEvents.emit(
          "notification:show",
          t("msg.recorded"),
          "success",
        );
        void autoPrintReceipt({
          type: "CUSTOM_SERVICE",
          sourceTable: "custom_services",
          sourceId: result.id,
          hasActiveSession: !!activeSession,
        });
        // Reset form
        setDescription("");
        resetSearchBox();
        setCostUsd("");
        setCostLbp("");
        setPriceUsd("");
        setPriceLbp("");
        setNote("");
        setCategory("");
        setInsuranceType("");
        setPaymentLines([]);
        setReturnLegs([]);
        setKeptChange(null);
        setTransactionTime(undefined);
        setPartnerMode("none");
        setIsPayout(false);
        setIsFree(false);
        setSelectedPartnerId(null);
        clearProduct();
        clearClient();
        reload();
      } else {
        alert(t("msg.error", { error: result.error }));
      }
    } catch (error) {
      logger.error("Custom service submit failed:", error);
      // LIRA-247: a thrown ApiError (e.g. a web 403 role refusal) used to be
      // discarded here in favor of this hardcoded string.
      alert(getApiErrorMessage(error, t("msg.recordFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Void ───
  const handleVoid = async (id: number) => {
    if (!confirm(t("msg.voidConfirm"))) return;
    try {
      const result = await api.deleteCustomService(id);
      if (result.success) {
        reload();
      } else {
        alert(t("msg.error", { error: result.error }));
      }
    } catch (error) {
      logger.error("Void failed:", error);
      // LIRA-247: surface the real refusal reason instead of this hardcoded
      // string.
      alert(getApiErrorMessage(error, t("msg.voidFailed")));
    }
  };

  // ─── Render ───
  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 pt-6 min-h-0 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      {/* Header with Stats and History */}
      <PageHeader
        title={t("page.title")}
        actions={
          <div className="flex items-center gap-2">
            <StatsCards
              count={summary.count}
              totalPriceUsd={summary.totalPriceUsd}
              totalPriceLbp={summary.totalPriceLbp}
              totalProfitUsd={summary.totalProfitUsd}
              totalProfitLbp={summary.totalProfitLbp}
            />
            <button
              onClick={() => setShowPresetManager(true)}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
            >
              <Settings size={16} />
              <span className="font-medium">{t("header.presets")}</span>
            </button>
            <button
              onClick={() => setShowHistoryModal(true)}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
            >
              <History size={16} />
              <span className="font-medium">{t("header.history")}</span>
            </button>
          </div>
        }
      />

      {/* Main: Form */}
      <div className="flex-1 min-h-0 overflow-y-auto -me-6 pe-6 pb-6">
        {/* New Service Form */}
        <div className="w-full bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-5 flex flex-col">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            {category === HOLD_MONEY_CATEGORY ? (
              <>
                <Wallet className="text-orange-400" size={20} />
                {t("form.titleHold")}
              </>
            ) : isInsurance ? (
              <>
                <Shield className="text-sky-400" size={20} />
                {t("form.titleInsurance")}
              </>
            ) : (
              <>
                <Plus className="text-teal-400" size={20} />
                {t("form.titleService")}
              </>
            )}
          </h2>

          <div className="space-y-4">
            {/* Category Selector */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                <Tag size={12} className="inline me-1" />
                {t("form.category")}
              </label>
              <div className="flex flex-wrap gap-2">
                {SERVICE_CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => {
                      setCategory(cat.value);
                      setInsuranceType("");
                      // If switching to digital_account, clear product selection for fresh preset pick
                      if (cat.value === "digital_account" && selectedProduct) {
                        clearProduct();
                        setDescription("");
                        setCostUsd("");
                        setPriceUsd("");
                      }
                      // LIRA-155 (owner decision, item 2): selecting Insurance
                      // pre-selects "Via Partner" — the insurer is normally
                      // the partner performing the service. Only when no
                      // partner mode is active yet, so re-clicking Insurance
                      // never stomps an operator who already deliberately
                      // chose "For Partner" or turned VIA back off.
                      if (
                        cat.value === INSURANCE_CATEGORY &&
                        partnerMode === "none"
                      ) {
                        setPartnerMode("VIA");
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      category === cat.value
                        ? "bg-teal-500/20 border-teal-500/50 text-teal-300"
                        : "bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                    }`}
                  >
                    {cat.value === ""
                      ? t("categories.all")
                      : categoryLabel(cat.value, t)}
                  </button>
                ))}
              </div>
            </div>

            {/* LIRA-360: insurance type — required, drives renewal reminders */}
            {isInsurance && (
              <div>
                <label
                  htmlFor="insurance-type-select"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                >
                  <Shield size={12} className="inline me-1" />
                  {t("form.insuranceType")}
                </label>
                <select
                  id="insurance-type-select"
                  data-testid="insurance-type-select"
                  required
                  value={insuranceType}
                  onChange={(e) =>
                    setInsuranceType(e.target.value as InsuranceType | "")
                  }
                  className={`w-full bg-slate-900/50 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500 ${
                    insuranceType ? "border-slate-700" : "border-amber-500/60"
                  }`}
                >
                  <option value="" disabled>
                    {t("msg.selectInsuranceType")}
                  </option>
                  {INSURANCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {insuranceTypeLabel(type, t)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Hold Money: special category — swap in its own UI */}
            {category === HOLD_MONEY_CATEGORY && <HoldMoneySection />}

            {/* Standard custom-service form (hidden for Hold Money) */}
            {category !== HOLD_MONEY_CATEGORY && (
              <>
                {/* Presets from DB — always visible under category */}
                {!description && !selectedProduct && (
                  <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 space-y-2">
                    <span className="block text-xs font-medium text-purple-400 uppercase tracking-wider">
                      {t("form.presets")}
                    </span>
                    {(() => {
                      const categoryPresets = presets.filter(
                        (p) => !category || p.category === category,
                      );
                      if (categoryPresets.length === 0) {
                        const label = category
                          ? categoryLabel(category, t)
                          : t("categories.all");
                        return (
                          <p className="text-xs text-slate-500">
                            {t("form.noPresets", { category: label })}
                          </p>
                        );
                      }
                      return (
                        <div className="flex flex-wrap gap-2">
                          {categoryPresets.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setDescription(preset.name);
                                setCategory(preset.category);
                                // Single-currency model: pick the preset's currency
                                // (prefer USD when present) and clear the other.
                                const usePreset =
                                  preset.price_usd > 0 || preset.cost_usd > 0
                                    ? "USD"
                                    : preset.price_lbp > 0 ||
                                        preset.cost_lbp > 0
                                      ? "LBP"
                                      : currency;
                                setCurrency(usePreset);
                                const presetPrice =
                                  usePreset === "USD"
                                    ? preset.price_usd
                                    : preset.price_lbp;
                                setSavedPrice(
                                  presetPrice > 0
                                    ? {
                                        currency: usePreset,
                                        amount: presetPrice,
                                      }
                                    : null,
                                );
                                if (usePreset === "USD") {
                                  setCostUsd(
                                    preset.cost_usd > 0
                                      ? String(preset.cost_usd)
                                      : "",
                                  );
                                  setPriceUsd(
                                    preset.price_usd > 0
                                      ? String(preset.price_usd)
                                      : "",
                                  );
                                  setCostLbp("");
                                  setPriceLbp("");
                                } else {
                                  setCostLbp(
                                    preset.cost_lbp > 0
                                      ? String(preset.cost_lbp)
                                      : "",
                                  );
                                  setPriceLbp(
                                    preset.price_lbp > 0
                                      ? String(preset.price_lbp)
                                      : "",
                                  );
                                  setCostUsd("");
                                  setPriceUsd("");
                                }
                              }}
                              className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-900/60 border border-slate-700 text-slate-300 hover:border-purple-500/40 hover:text-white transition-all"
                            >
                              <span className="block">{preset.name}</span>
                              <span className="text-[10px] text-slate-500">
                                {t("form.presetCostPrice", {
                                  cost: `$${preset.cost_usd.toFixed(2)}`,
                                  price: `$${preset.price_usd.toFixed(2)}`,
                                })}
                              </span>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}
                {/* Search Bar / Item Selector — replaces description field */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                    <Package size={12} className="inline me-1" />
                    {t("form.searchLabel")}
                  </label>
                  {selectedProduct ? (
                    /* Product selected — show selection chip */
                    <div className="flex items-center gap-2 bg-teal-500/10 border border-teal-500/30 rounded-lg px-4 py-2.5">
                      <Package size={14} className="text-teal-400" />
                      <span className="text-white font-medium text-sm flex-1">
                        {selectedProduct.name}
                      </span>
                      <button
                        onClick={() => {
                          clearProduct();
                          setDescription("");
                          setCostUsd("");
                          setPriceUsd("");
                        }}
                        className="text-slate-400 hover:text-white transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : !description ? (
                    /* No selection yet — show SearchBar */
                    <div ref={productSearchRef}>
                      <SearchBar<ProductSearchResult>
                        key={searchBoxKey}
                        data-testid="custom-service-item-search"
                        placeholder={t("form.searchPlaceholder")}
                        onSearch={async (query) => {
                          const results = await api.getProducts(query);
                          return results.slice(0, 8).map((p: any) => ({
                            id: p.id as number,
                            name: p.name as string,
                            cost_price: (p.cost_price ??
                              p.cost_price_usd ??
                              0) as number,
                            retail_price: (p.retail_price ??
                              p.selling_price_usd ??
                              0) as number,
                            barcode: (p.barcode ?? "") as string,
                          }));
                        }}
                        onSelect={(product) => {
                          setSelectedProduct({
                            id: product.id,
                            name: product.name,
                          });
                          setDescription(product.name);
                          // Products are priced in USD — switch to USD entry.
                          setCurrency("USD");
                          setCostLbp("");
                          setPriceLbp("");
                          setCostUsd(
                            product.cost_price > 0
                              ? String(product.cost_price)
                              : "",
                          );
                          setPriceUsd(
                            product.retail_price > 0
                              ? String(product.retail_price)
                              : "",
                          );
                          setSavedPrice(
                            product.retail_price > 0
                              ? {
                                  currency: "USD",
                                  amount: product.retail_price,
                                }
                              : null,
                          );
                        }}
                        onFreeText={(text) => {
                          setDescription(text);
                        }}
                        onQueryChange={setSearchText}
                        renderItem={(item) => (
                          <div className="flex items-center justify-between w-full">
                            <span className="font-medium">{item.name}</span>
                            <span className="text-slate-400 text-xs">
                              {t("form.itemCostPrice", {
                                cost: `$${item.cost_price.toFixed(2)}`,
                                price: `$${item.retail_price.toFixed(2)}`,
                              })}
                            </span>
                          </div>
                        )}
                        getKey={(item) => item.id}
                        ringColor="ring-teal-500/50"
                        noResultsMessage={t("form.noItems")}
                      />
                    </div>
                  ) : (
                    /* Free text description entered (no product match) */
                    <div className="relative">
                      <input
                        id="svc-description"
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/50 outline-none transition-all"
                        placeholder={t("form.descriptionPlaceholder")}
                        maxLength={500}
                      />
                      <button
                        onClick={() => {
                          setDescription("");
                          setSavedPrice(null);
                        }}
                        className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Cost & Price — Single Currency (USD/LBP toggle) */}
                <div className="p-4 rounded-xl bg-teal-400/5 border border-teal-400/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="block text-xs font-medium text-teal-400 uppercase tracking-wider">
                      {isPayout ? t("form.arrivedPaidOut") : t("form.costPrice")}
                    </span>
                    {/* Currency toggle */}
                    <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-600 p-0.5">
                      {(["USD", "LBP"] as const).map((cur) => (
                        <button
                          key={cur}
                          type="button"
                          onClick={() => {
                            setCurrency(cur);
                            // One currency at a time — clear the other currency.
                            if (cur === "USD") {
                              setCostLbp("");
                              setPriceLbp("");
                            } else {
                              setCostUsd("");
                              setPriceUsd("");
                            }
                          }}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                            currency === cur
                              ? "bg-teal-600 text-white"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {cur}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="svc-cost"
                        className="block text-[10px] text-slate-500 mb-1 uppercase"
                      >
                        {isPayout
                          ? t("form.paidOutIn", { currency })
                          : t("form.costIn", { currency })}
                      </label>
                      <div className="relative">
                        {currency === "USD" && (
                          <span className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                            $
                          </span>
                        )}
                        <DecimalInput
                          id="svc-cost"
                          value={
                            parseFloat(
                              currency === "USD" ? costUsd : costLbp,
                            ) || 0
                          }
                          onChange={(n) => {
                            const v = n ? String(n) : "";
                            if (currency === "USD") setCostUsd(v);
                            else setCostLbp(v);
                          }}
                          className={`w-full bg-slate-900/80 border border-slate-700 rounded-lg ${currency === "USD" ? "ps-8" : "ps-3"} pe-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all`}
                          placeholder={currency === "USD" ? "0.00" : "0"}
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor="svc-price"
                        className="block text-[10px] text-slate-500 mb-1 uppercase"
                      >
                        {isPayout
                          ? t("form.arrivedIn", { currency })
                          : t("form.priceIn", { currency })}
                      </label>
                      <div className="relative">
                        {currency === "USD" && (
                          <span className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                            $
                          </span>
                        )}
                        <DecimalInput
                          id="svc-price"
                          disabled={freeJob}
                          value={
                            parseFloat(
                              currency === "USD" ? priceUsd : priceLbp,
                            ) || 0
                          }
                          onChange={(n) => {
                            const v = n ? String(n) : "";
                            if (currency === "USD") setPriceUsd(v);
                            else setPriceLbp(v);
                          }}
                          className={`w-full bg-slate-900/80 border border-slate-700 rounded-lg ${currency === "USD" ? "ps-8" : "ps-3"} pe-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all`}
                          placeholder={currency === "USD" ? "0.00" : "0"}
                        />
                      </div>
                      {!isForPartner && !isPayout && (
                        <label className="flex items-center gap-2 mt-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            data-testid="custom-service-free-toggle"
                            checked={isFree}
                            onChange={(e) => {
                              setIsFree(e.target.checked);
                              // Free = price 0 and nothing collected: drop the
                              // typed price and any payment lines.
                              if (e.target.checked) {
                                setPriceUsd("");
                                setPriceLbp("");
                                setPaymentLines([]);
                                setReturnLegs([]);
                                setKeptChange(null);
                                setCsDiscount(0);
                                setCsExtra(0);
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                          <span className="text-xs text-slate-400">
                            {t("form.freeJob")}
                          </span>
                        </label>
                      )}
                      {/* LIRA-260: warning only. Compared only in the saved
                          price's own currency (a currency switch clears the
                          field, so a cross-currency compare is meaningless),
                          and never on a payout, where this field is the
                          amount that arrived, not a selling price. */}
                      {savedPrice &&
                        !isPayout &&
                        savedPrice.currency === currency && (
                          <PriceChangeWarning
                            catalogPrice={savedPrice.amount}
                            currentPrice={
                              // An empty field is "not entered yet", not a
                              // price of 0 — never warn on it.
                              (currency === "USD" ? priceUsd : priceLbp) === ""
                                ? undefined
                                : currency === "USD"
                                  ? priceUsdVal
                                  : priceLbpVal
                            }
                            currency={currency}
                            className="mt-1"
                          />
                        )}
                    </div>
                  </div>

                  {/* Profit indicator */}
                  {(costUsdVal > 0 ||
                    priceUsdVal > 0 ||
                    costLbpVal > 0 ||
                    priceLbpVal > 0) && (
                    <div className="flex items-center gap-2 pt-1">
                      <TrendingUp
                        size={14}
                        className={
                          profitUsd >= 0 && profitLbp >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      />
                      <span
                        className={`text-sm font-bold ${profitUsd >= 0 && profitLbp >= 0 ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {isPayout ? t("form.commission") : t("form.profit")}:{" "}
                        {formatServiceAmount(profitUsd, profitLbp)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Customer Name, Phone & Note — single inline row */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="relative">
                    <label
                      htmlFor="svc-client"
                      className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                    >
                      <User size={12} /> {t("form.customerName")}
                      {paymentLines.some(
                        (l) => l.method === "CUSTOMER_ACCOUNT",
                      ) && <span className="text-red-400 ms-1">*</span>}
                    </label>
                    {clientId ? (
                      <div className="flex items-center gap-2 bg-teal-500/10 border border-teal-500/30 rounded-lg px-4 py-2.5">
                        <User size={14} className="text-teal-400" />
                        <span className="text-white font-medium text-sm flex-1 truncate">
                          {clientName}
                        </span>
                        <button
                          onClick={clearClient}
                          className="text-slate-400 hover:text-white transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <ClientAutocompleteInput
                        id="svc-client"
                        value={clientName}
                        onChange={(v) => {
                          setClientName(v);
                          if (!v) clearClient();
                        }}
                        onClientSelect={selectClient}
                        placeholder={t("form.customerPlaceholder")}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-all"
                        showDebtBadge
                      />
                    )}
                    <SaveAsClientCheckbox
                      checked={saveAsClient}
                      onChange={setSaveAsClient}
                      hidden={!!clientId || !showSaveAsClient}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="svc-phone"
                      className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                    >
                      <Phone size={12} /> {t("form.phone")}
                    </label>
                    <input
                      id="svc-phone"
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-all"
                      placeholder={t("form.phonePlaceholder")}
                      disabled={!!clientId}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="svc-note"
                      className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                    >
                      <Tag size={12} /> {t("form.note")}
                    </label>
                    <input
                      id="svc-note"
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-all"
                      placeholder={t("form.notePlaceholder")}
                      maxLength={1000}
                    />
                  </div>
                </div>

                {/* LIRA-081 (PFT-R) / LIRA-154: who the service is for —
                    one segmented control. "For Partner": no counter
                    payment, the FULL price books to the partner's tab
                    (hides the Payment Method section below). "Via
                    Partner": the partner performs the service, the
                    customer still pays us now (payment section stays), and
                    we owe the partner the COST. The partner picker and
                    "Pay out" sit on the row below. */}
                <div className="space-y-3">
                  <PartnerModeSwitch
                    value={partnerMode}
                    onChange={handlePartnerModeChange}
                    hideFor={!!activeSession}
                  />
                  {(isForPartner || isViaPartner) && (
                    <div className="flex flex-wrap items-center gap-6">
                      <PartnerSelector
                        required
                        selectedPartnerId={selectedPartnerId}
                        onSelect={setSelectedPartnerId}
                      />
                      {/* OWNER_NOTES_REMAINING_BUILD.md #16 (Route A) — "Pay
                      out": the Syria transfer OUT. Only shown once "Via
                      Partner" is on (the schema rejects direction "OUT"
                      without partnerMode "VIA"); NOT its own ForPartnerToggle
                      — the partner is already picked by the selector beside it,
                      this is a plain sub-checkbox that just flips direction. */}
                      {isViaPartner && (
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            data-testid="custom-service-payout-toggle"
                            checked={isPayout}
                            onChange={(e) => {
                              setIsPayout(e.target.checked);
                              // A payout collects no payment legs (it PAYS the
                              // recipient CASH from General, per owner decision)
                              // — drop any leftover legs from before the toggle
                              // was checked, mirroring what switching to
                              // For Partner clears (handlePartnerModeChange).
                              if (e.target.checked) {
                                setPaymentLines([]);
                                setReturnLegs([]);
                                setKeptChange(null);
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                          />
                          <span className="text-xs text-slate-400">
                            {t("form.payOut")}
                          </span>
                        </label>
                      )}
                    </div>
                  )}
                </div>

                {/* Payment Method — replaced by a notice in FOR mode only.
                    FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5 originally
                    added a cost sentence here describing the PRE-§2a
                    behaviour (cost posted a real General-drawer cash
                    outflow at submit). §2a (d1a0ad2) removed that: cost is
                    now a profit input only (profit_usd = price_usd -
                    cost_usd) and NEVER posts a payment row or a drawer
                    delta on any branch, including for-partner. The old
                    "still leaves the General drawer" sentence became false
                    the moment §2a shipped and was left un-updated
                    (LIRA-121) — this now states the current truth.
                    LIRA-154: VIA is NOT an alternative branch of this
                    ternary — it keeps the Payment Method section mounted
                    (a real walk-in customer is paying through it) and adds
                    an informational notice ABOVE it instead of replacing
                    it. OWNER_NOTES_REMAINING_BUILD.md #16: "Pay out" IS a
                    3rd branch, alongside FOR — like FOR, a payout collects
                    no payment legs from a walk-in customer (the shop pays
                    OUT instead), so it replaces the Payment Method section
                    with a notice too, mirroring FOR's own shape exactly. */}
                {isForPartner ? (
                  <ForPartnerNotice
                    testId="custom-service-partner-no-payment-notice"
                    tone="teal"
                  >
                    {t("notice.forNoPrice")}
                    {awaitingSellingPrice ? (
                      // Owner decision 2026-10-07: the partner is booked the
                      // selling price, so the sale waits for one.
                      <> {t("msg.enterSellingPrice")}</>
                    ) : (
                      <>
                        {" "}
                        {t("notice.forFullBefore")}{" "}
                        <span className="font-bold">
                          <Ltr>{formatServiceAmount(priceUsdVal, priceLbpVal)}</Ltr>
                        </span>{" "}
                        {t("notice.forFullAfter")}
                      </>
                    )}
                    {(costUsdVal > 0 || costLbpVal > 0) && (
                      <>
                        {" "}
                        {t("notice.forCostBefore")}{" "}
                        <span className="font-bold">
                          <Ltr>{formatServiceAmount(costUsdVal, costLbpVal)}</Ltr>
                        </span>
                        {t("notice.forCostAfter")}
                      </>
                    )}
                  </ForPartnerNotice>
                ) : isPayout ? (
                  <ForPartnerNotice
                    testId="custom-service-payout-notice"
                    tone="rose"
                  >
                    {t("notice.payoutBefore")}{" "}
                    <span className="font-bold">
                      <Ltr>{formatServiceAmount(priceUsdVal, priceLbpVal)}</Ltr>
                    </span>{" "}
                    {t("notice.payoutMiddle")}{" "}
                    <span className="font-bold">
                      <Ltr>{formatServiceAmount(costUsdVal, costLbpVal)}</Ltr>
                    </span>{" "}
                    {t("notice.payoutAfter")}
                  </ForPartnerNotice>
                ) : freeJob ? (
                  // LIRA-363: nothing to collect, so no payment sheet.
                  <ForPartnerNotice
                    testId="custom-service-free-notice"
                    tone="teal"
                  >
                    {t("notice.freeNoPayment")}
                    {isViaPartner && (
                      <>
                        {" "}
                        {t("notice.freeViaPartner")}{" "}
                        <span className="font-bold">
                          <Ltr>{formatServiceAmount(costUsdVal, costLbpVal)}</Ltr>
                        </span>
                      </>
                    )}
                  </ForPartnerNotice>
                ) : (
                  <div className="space-y-4">
                    {isViaPartner && (
                      <ForPartnerNotice
                        testId="custom-service-via-partner-notice"
                        tone="sky"
                      >
                        {t("notice.viaBefore")}{" "}
                        <span className="font-bold">
                          <Ltr>{formatServiceAmount(priceUsdVal, priceLbpVal)}</Ltr>
                        </span>{" "}
                        {t("notice.viaMiddle")}{" "}
                        <span className="font-bold">
                          <Ltr>{formatServiceAmount(costUsdVal, costLbpVal)}</Ltr>
                        </span>
                        {t("notice.viaAfter")}
                      </ForPartnerNotice>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                        {t("form.paymentMethod")}
                      </label>
                      {awaitingSellingPrice ? (
                        // Owner decision 2026-10-07: the payment form waits
                        // for the cashier's selling price — it is not
                        // mounted (nothing to collect, no seeded or
                        // auto-split lines) until one is entered.
                        <p
                          data-testid="custom-service-awaiting-price-notice"
                          className="text-sm text-slate-400 bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3"
                        >
                          {t("form.awaitingPrice")}
                        </p>
                      ) : (
                        <MultiPaymentInput
                          // Currency in the key: the seeded line currency is
                          // mount-only, so toggling USD/LBP must remount the widget.
                          key={`${paymentInputKey}-${currency}`}
                          // Single-currency model: the toggle clears the other
                          // currency's fields, so the owed total lives entirely in
                          // the active currency. Hardcoding the USD pair here made
                          // an LBP-priced service show a $0 payment total.
                          // The selling price only — never the cost.
                          totals={[
                            currency === "USD"
                              ? { amount: priceUsdVal, currency: "USD" }
                              : { amount: priceLbpVal, currency: "LBP" },
                          ]}
                          currency={currency}
                          totalAmountCurrency={currency}
                          onChange={setPaymentLines}
                          onReturnChange={setReturnLegs}
                          // LIRA-310 US5: the discount is booked — the page
                          // sends price − discount. Capped at the margin, so
                          // the built-in Waive (which adds the gap to this
                          // discount) never sells below cost.
                          onDiscountChange={setCsDiscount}
                          maxDiscount={maxCsDiscount}
                          // LIRA-319: "− Discount | + Extra" on the same line.
                          // The extra is sent as extra_usd/extra_lbp; the
                          // price stays the selling price.
                          {...(csExtraAllowed
                            ? {
                                onExtraChange: setCsExtra,
                                maxExtra: maxCsExtra,
                              }
                            : {})}
                          // The walk-in customer pays the shop: change they
                          // leave behind is shop profit (checked server-side
                          // by resolveKeptChange). Payout and FOR never render
                          // this widget.
                          payer="customer"
                          // Unwired in a session: the basket checkout owns
                          // kept change, so the item sheet offers none.
                          {...(activeSession
                            ? {}
                            : { onKeptChange: setKeptChange })}
                          requiresClientForDebt={true}
                          hasClient={!!clientId || !!clientName}
                          // Auto-debt needs a RESOLVED client here: the submit
                          // guard rejects debt legs without clientId (name-only
                          // would auto-split and then dead-end at that alert).
                          autoDebtRemainder={!!clientId}
                          // Change not handed back → store credit (OUT
                          // CUSTOMER_ACCOUNT leg). CustomServiceRepository
                          // needs a saved client_id and creates none, and
                          // "Save as client" may not run, so only a client
                          // already picked qualifies.
                          {...(clientId
                            ? {
                                unreturnedChangeTo: "CUSTOMER_ACCOUNT" as const,
                              }
                            : {})}
                          paymentMethods={methods}
                          currencies={[
                            { code: "USD", symbol: "$" },
                            { code: "LBP", symbol: "LBP" },
                          ]}
                          exchangeRate={exchangeRate}
                          onExchangeRateChange={setEffectiveRate}
                          clientId={clientId}
                          fetchClientVouchers={fetchClientVouchers}
                          {...(paymentInitialMethod
                            ? { initialMethod: paymentInitialMethod }
                            : {})}
                        />
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {category !== HOLD_MONEY_CATEGORY && (
            <>
              <TransactionTimeOverride
                value={transactionTime}
                onChange={setTransactionTime}
              />

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={
                  isSubmitting ||
                  awaitingSellingPrice ||
                  (isInsurance && !insuranceType) ||
                  (hasPartnerMode && !selectedPartnerId) ||
                  // LIRA-154: VIA additionally needs a real payment leg —
                  // the alert-based guard in handleSubmit is the source of
                  // truth (mirrors the cost/price and debt-client guards,
                  // which are alert-only too); disabling the button here
                  // is a pre-emptive UX nicety, not a second guard. A
                  // payout (OWNER_NOTES_REMAINING_BUILD.md #16) never needs
                  // one — it pays out, it doesn't collect.
                  (isViaPartner &&
                    !isPayout &&
                    !freeJob &&
                    paymentLines.length === 0) ||
                  (isPayout &&
                    !(
                      (priceUsdVal > 0 || priceLbpVal > 0) &&
                      (costUsdVal > 0 || costLbpVal > 0)
                    ))
                }
                className="w-full py-4 mt-6 rounded-xl font-bold text-lg bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />{" "}
                    {t("form.submitting")}
                  </>
                ) : (
                  <>
                    <Plus size={18} />{" "}
                    {isForPartner
                      ? t("form.submitToPartner")
                      : isPayout
                        ? t("form.submitPayout")
                        : t("form.submitService")}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* History Modal */}
      {showHistoryModal && (
        <HistoryModal
          history={history}
          loading={historyLoading}
          onClose={() => setShowHistoryModal(false)}
          onRefresh={reload}
          onVoid={handleVoid}
        />
      )}

      {/* Preset Manager Modal */}
      {showPresetManager && (
        <PresetManagerModal
          onClose={() => setShowPresetManager(false)}
          onPresetsChanged={loadPresets}
        />
      )}
    </div>
  );
}
