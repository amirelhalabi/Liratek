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
import type { FulfillmentStatus } from "@liratek/core";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useSessionAutoFill } from "@/features/sessions/hooks/useSessionAutoFill";
import { useCustomServices } from "../../hooks/useCustomServices";
import logger from "@/utils/logger";
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
import {
  ForPartnerToggle,
  ForPartnerNotice,
} from "@/features/partners/components/ForPartnerToggle";

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

function formatCurrency(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (usd > 0) parts.push(`$${usd.toFixed(2)}`);
  if (lbp > 0) parts.push(`${lbp.toLocaleString()} LBP`);
  return parts.join(" + ") || "$0.00";
}

/** Category presets for quick selection */
const SERVICE_CATEGORIES = [
  { value: "", label: "All", icon: "briefcase" },
  { value: "digital_account", label: "Digital Account", icon: "monitor" },
  { value: "repair", label: "Repair", icon: "wrench" },
  { value: "activation", label: "Activation", icon: "zap" },
  { value: "other", label: "Other", icon: "tag" },
  // Special category — selecting it swaps the form for the Hold Money UI
  // (no presets / product search / cost-price; cash held in the General drawer).
  { value: "hold_money", label: "Hold Money", icon: "wallet" },
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
  { value: "insurance", label: "Insurance", icon: "shield" },
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

  // LIRA-081 (PFT-R) / LIRA-154: partner involvement is now a 3-way mode,
  // not a boolean —
  //   "none" — no partner, the ordinary walk-in flow.
  //   "FOR"  — no counter payment; the FULL price (per currency) books to
  //            the selected partner's tab instead (unchanged from PFT-R).
  //   "VIA"  — the MIRROR of FOR: the partner performs the service, the
  //            walk-in customer pays US now through the normal payment
  //            section, and we owe the partner the COST (not the price).
  // The mode control itself is built locally in this page (two independent
  // <ForPartnerToggle> instances below, driven off this single piece of
  // state so they're mutually exclusive) rather than teaching the shared
  // ForPartnerToggle component a 3rd state — that component is boolean-only
  // and shared by 7 call sites; widening its `checked`/`onChange` contract
  // to a mode enum would ripple into all of them for one caller's needs.
  const [partnerMode, setPartnerMode] = useState<"none" | "FOR" | "VIA">(
    "none",
  );
  const isForPartner = partnerMode === "FOR";
  const isViaPartner = partnerMode === "VIA";
  const hasPartnerMode = partnerMode !== "none";
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(
    null,
  );

  // ─── Item Selector ───
  const [selectedProduct, setSelectedProduct] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const productSearchRef = useRef<HTMLDivElement>(null);

  // ─── History Modal ───
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // ─── Preset Manager Modal ───
  const [showPresetManager, setShowPresetManager] = useState(false);

  // ─── DB-driven Presets ───
  const [presets, setPresets] = useState<ServicePreset[]>([]);

  const loadPresets = useCallback(async () => {
    // Service presets are IPC-only (no REST route yet) — skip in web mode
    if (!window.api?.servicePresets) return;
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

  // Payment-Legs Integrity plan pattern (mirrors FinancialForm/KatchForm/
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
  const profitUsd = priceUsdVal - costUsdVal;
  const profitLbp = priceLbpVal - costLbpVal;

  // ─── Submit ───
  const handleSubmit = async () => {
    if (
      costUsdVal <= 0 &&
      costLbpVal <= 0 &&
      priceUsdVal <= 0 &&
      priceLbpVal <= 0
    ) {
      alert("Please enter a cost or price.");
      return;
    }
    const hasDebtLine = paymentLines.some(
      (l) => l.method === "CUSTOMER_ACCOUNT",
    );
    // FOR takes no counter payment at all, so this guard never applies to
    // it. VIA is a normal walk-in payment (just with an extra partner-cost
    // ledger booking underneath) so it's treated exactly like "none" here.
    if (!isForPartner && hasDebtLine && !clientId) {
      alert("Please select a client for debt payment.");
      return;
    }
    if (hasPartnerMode && !selectedPartnerId) {
      alert("Select a partner for this service.");
      return;
    }
    // LIRA-154 VIA submit guard: a walk-in customer is actually paying, so
    // VIA (unlike FOR) additionally requires at least one payment leg —
    // a CUSTOMER_ACCOUNT (debt) leg counts too, it's still a paymentLines
    // entry, just settled later instead of collected now.
    if (isViaPartner && paymentLines.length === 0) {
      alert("Add at least one payment method for this service.");
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
        description: description.trim(),
        cost_usd: costUsdVal,
        cost_lbp: costLbpVal,
        price_usd: priceUsdVal,
        price_lbp: priceLbpVal,
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
        ...(!isForPartner && (paymentLines.length > 0 || returnLegs.length > 0)
          ? { payments: toSnakeLegs(paymentLines, returnLegs) }
          : {}),
        // Voucher code for the GIFT_CARD leg (custom services use one primary method)
        ...(() => {
          const voucherLeg = paymentLines.find(
            (p) => p.method === "GIFT_CARD" && p.voucherCode,
          );
          return !isForPartner && voucherLeg?.voucherCode
            ? { voucher_code: voucherLeg.voucherCode }
            : {};
        })(),
        // T3 keep-change: kept amounts join the service's profit stamp.
        // Applies to VIA too — profit is still price - cost regardless of
        // who performed the service.
        ...(!isForPartner &&
        keptChange &&
        (keptChange.usd > 0 || keptChange.lbp > 0)
          ? {
              kept_change_usd: keptChange.usd,
              kept_change_lbp: keptChange.lbp,
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

      // If session is active, add to cart instead of submitting — never for
      // a FOR-partner service (no walk-in customer, mirrors every other
      // FOR_% form: TelecomForm/KatchForm/etc. all bypass the session
      // entirely). LIRA-154: VIA is the one gate where this is INVERTED
      // relative to FOR — VIA has a real walk-in customer paying now, so
      // it goes THROUGH the session cart exactly like a plain service
      // (`!isForPartner` is true for VIA). Do not widen this to
      // `!hasPartnerMode` — that would wrongly bypass the session for VIA.
      if (activeSession && !isForPartner) {
        const amountLabel =
          priceUsdVal > 0
            ? `$${priceUsdVal.toFixed(2)}`
            : priceLbpVal > 0
              ? `${priceLbpVal.toLocaleString()} LBP`
              : `$${costUsdVal.toFixed(2)}`;
        const label = `Service: ${description.trim().substring(0, 40)} - ${amountLabel}`;

        addToSessionCart({
          module: "custom_service",
          label,
          // Single-currency model: pair amount with the active toggle currency
          // (an LBP service used to book amount 0 here — USD fields are
          // cleared when the toggle is on LBP).
          amount:
            currency === "USD"
              ? priceUsdVal || costUsdVal
              : priceLbpVal || costLbpVal,
          currency,
          // Must be the REAL handler channel — the session-checkout replayer
          // invokes it verbatim ("customService:create" was a dead channel
          // that failed every session checkout containing a service; lira-094).
          ipcChannel: "custom-services:add",
          formData: payload,
        });

        // Reset form
        setDescription("");
        setCostUsd("");
        setCostLbp("");
        setPriceUsd("");
        setPriceLbp("");
        setNote("");
        setCategory("");
        setPaymentLines([]);
        setReturnLegs([]);
        setKeptChange(null);
        // LIRA-154: unlike FOR (which never reaches this branch), a VIA
        // item CAN land here now that the session cart is open to it —
        // reset the partner mode so it doesn't silently carry over onto
        // the next, unrelated cart line.
        setPartnerMode("none");
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
          "Custom service recorded successfully",
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
        setCostUsd("");
        setCostLbp("");
        setPriceUsd("");
        setPriceLbp("");
        setNote("");
        setCategory("");
        setPaymentLines([]);
        setReturnLegs([]);
        setKeptChange(null);
        setTransactionTime(undefined);
        setPartnerMode("none");
        setSelectedPartnerId(null);
        clearProduct();
        clearClient();
        reload();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Custom service submit failed:", error);
      alert("Failed to record service.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Void ───
  const handleVoid = async (id: number) => {
    if (!confirm("Void this service? Payments will be reversed.")) return;
    try {
      const result = await api.deleteCustomService(id);
      if (result.success) {
        reload();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Void failed:", error);
      alert("Failed to void service.");
    }
  };

  // ─── Render ───
  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 pt-6 min-h-0 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      {/* Header with Stats and History */}
      <PageHeader
        title="Services"
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
              <span className="font-medium">Presets</span>
            </button>
            <button
              onClick={() => setShowHistoryModal(true)}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
            >
              <History size={16} />
              <span className="font-medium">History</span>
            </button>
          </div>
        }
      />

      {/* Main: Form */}
      <div className="flex-1 min-h-0 overflow-y-auto -mr-6 pr-6 pb-6">
        {/* New Service Form */}
        <div className="w-full bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-5 flex flex-col">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            {category === HOLD_MONEY_CATEGORY ? (
              <>
                <Wallet className="text-orange-400" size={20} />
                Hold Money
              </>
            ) : isInsurance ? (
              <>
                <Shield className="text-sky-400" size={20} />
                New Insurance
              </>
            ) : (
              <>
                <Plus className="text-teal-400" size={20} />
                New Service
              </>
            )}
          </h2>

          <div className="space-y-4">
            {/* Category Selector */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                <Tag size={12} className="inline mr-1" />
                Category
              </label>
              <div className="flex flex-wrap gap-2">
                {SERVICE_CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => {
                      setCategory(cat.value);
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
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Hold Money: special category — swap in its own UI */}
            {category === HOLD_MONEY_CATEGORY && <HoldMoneySection />}

            {/* Standard custom-service form (hidden for Hold Money) */}
            {category !== HOLD_MONEY_CATEGORY && (
              <>
                {/* Presets from DB — always visible under category */}
                {!description && !selectedProduct && (
                  <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 space-y-2">
                    <span className="block text-xs font-medium text-purple-400 uppercase tracking-wider">
                      Presets
                    </span>
                    {(() => {
                      const categoryPresets = presets.filter(
                        (p) => !category || p.category === category,
                      );
                      if (categoryPresets.length === 0) {
                        const label =
                          SERVICE_CATEGORIES.find((c) => c.value === category)
                            ?.label ?? "this category";
                        return (
                          <p className="text-xs text-slate-500">
                            No presets for {label}. Add presets via the Presets
                            manager.
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
                                Cost: ${preset.cost_usd.toFixed(2)} · Price: $
                                {preset.price_usd.toFixed(2)}
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
                    <Package size={12} className="inline mr-1" />
                    Search Item or Service
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
                        data-testid="custom-service-item-search"
                        placeholder="Search by name/barcode, or type your service description..."
                        onSearch={async (query) => {
                          const results =
                            await window.api.inventory.getProducts(query);
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
                        }}
                        onFreeText={(text) => {
                          setDescription(text);
                        }}
                        renderItem={(item) => (
                          <div className="flex items-center justify-between w-full">
                            <span className="font-medium">{item.name}</span>
                            <span className="text-slate-400 text-xs">
                              Cost: ${item.cost_price.toFixed(2)} | Price: $
                              {item.retail_price.toFixed(2)}
                            </span>
                          </div>
                        )}
                        getKey={(item) => item.id}
                        ringColor="ring-teal-500/50"
                        noResultsMessage="No items found. Press Enter to use as description."
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
                        placeholder="e.g., Phone screen repair, SIM activation"
                        maxLength={500}
                      />
                      <button
                        onClick={() => setDescription("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
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
                      Cost / Price
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
                        Cost {currency}
                      </label>
                      <div className="relative">
                        {currency === "USD" && (
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
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
                          className={`w-full bg-slate-900/80 border border-slate-700 rounded-lg ${currency === "USD" ? "pl-8" : "pl-3"} pr-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all`}
                          placeholder={currency === "USD" ? "0.00" : "0"}
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor="svc-price"
                        className="block text-[10px] text-slate-500 mb-1 uppercase"
                      >
                        Price {currency}
                      </label>
                      <div className="relative">
                        {currency === "USD" && (
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                            $
                          </span>
                        )}
                        <DecimalInput
                          id="svc-price"
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
                          className={`w-full bg-slate-900/80 border border-slate-700 rounded-lg ${currency === "USD" ? "pl-8" : "pl-3"} pr-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all`}
                          placeholder={currency === "USD" ? "0.00" : "0"}
                        />
                      </div>
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
                        Profit: {formatCurrency(profitUsd, profitLbp)}
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
                      <User size={12} /> Customer Name
                      {paymentLines.some(
                        (l) => l.method === "CUSTOMER_ACCOUNT",
                      ) && <span className="text-red-400 ml-1">*</span>}
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
                        placeholder="Search or type name..."
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
                      <Phone size={12} /> Phone
                    </label>
                    <input
                      id="svc-phone"
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-all"
                      placeholder="e.g., 03 123 456"
                      disabled={!!clientId}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="svc-note"
                      className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                    >
                      <Tag size={12} /> Note (optional)
                    </label>
                    <input
                      id="svc-note"
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-all"
                      placeholder="Additional details..."
                      maxLength={1000}
                    />
                  </div>
                </div>

                {/* LIRA-081 (PFT-R) / LIRA-154: two independent, mutually
                    exclusive toggles sharing one `partnerMode` state (each
                    setting it to its own value turning on, and back to
                    "none" turning off — so checking one implicitly
                    unchecks the other). Both reuse the shared, unmodified
                    ForPartnerToggle component as plain boolean widgets;
                    the mode concept lives entirely here, not in the
                    shared component (which stays untouched — it's boolean
                    -only and shared by 6 other call sites). */}
                <div className="flex flex-wrap items-start gap-6">
                  {/* "For Partner" — no counter payment; the FULL price (per
                      currency) books to the selected partner's tab instead.
                      Hides the Payment Method section below. Unchanged from
                      pre-LIRA-154 behavior. */}
                  <ForPartnerToggle
                    testId="custom-service-for-partner-toggle"
                    checked={isForPartner}
                    onChange={(next) => {
                      if (next) {
                        setPartnerMode("FOR");
                        // Clear any lingering payment state so a leftover
                        // leg from before toggling on is never submitted.
                        setPaymentLines([]);
                        setReturnLegs([]);
                        setKeptChange(null);
                      } else {
                        setPartnerMode("none");
                      }
                    }}
                    selectedPartnerId={selectedPartnerId}
                    onPartnerChange={setSelectedPartnerId}
                    checkboxClassName="w-4 h-4 rounded border-slate-600 bg-slate-900 text-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  {/* "Via Partner" (LIRA-154) — the mirror of "For Partner":
                      the partner performs the service, the walk-in customer
                      still pays US now via the normal Payment Method section
                      below (kept mounted — NOT cleared), and we owe the
                      partner the COST instead of the price. */}
                  <ForPartnerToggle
                    testId="custom-service-via-partner-toggle"
                    label="Via Partner"
                    checked={isViaPartner}
                    onChange={(next) => {
                      // Deliberately does NOT clear paymentLines/returnLegs/
                      // keptChange — unlike FOR, VIA keeps the payment
                      // section live and submitting, so clearing here would
                      // wipe an operator's in-progress payment lines.
                      setPartnerMode(next ? "VIA" : "none");
                    }}
                    selectedPartnerId={selectedPartnerId}
                    onPartnerChange={setSelectedPartnerId}
                    checkboxClassName="w-4 h-4 rounded border-slate-600 bg-slate-900 text-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
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
                    it. */}
                {isForPartner ? (
                  <ForPartnerNotice
                    testId="custom-service-partner-no-payment-notice"
                    className="text-sm text-teal-200 bg-teal-500/10 border border-teal-500/30 rounded-xl px-4 py-4"
                  >
                    No price is collected from a customer for a partner service.
                    The full{" "}
                    <span className="font-bold">
                      {formatCurrency(priceUsdVal, priceLbpVal)}
                    </span>{" "}
                    goes on the selected partner&apos;s account, settled later
                    on the Partners page.
                    {(costUsdVal > 0 || costLbpVal > 0) && (
                      <>
                        {" "}
                        The service&apos;s cost,{" "}
                        <span className="font-bold">
                          {formatCurrency(costUsdVal, costLbpVal)}
                        </span>
                        , affects profit only — it does not leave the General
                        drawer or any other drawer.
                      </>
                    )}
                  </ForPartnerNotice>
                ) : (
                  <div className="space-y-4">
                    {isViaPartner && (
                      <ForPartnerNotice
                        testId="custom-service-via-partner-notice"
                        className="text-sm text-sky-200 bg-sky-500/10 border border-sky-500/30 rounded-xl px-4 py-4"
                      >
                        The customer pays the full{" "}
                        <span className="font-bold">
                          {formatCurrency(priceUsdVal, priceLbpVal)}
                        </span>{" "}
                        now, through the payment method below. You will owe the
                        selected partner the cost,{" "}
                        <span className="font-bold">
                          {formatCurrency(costUsdVal, costLbpVal)}
                        </span>
                        , settled later on the Partners page.
                      </ForPartnerNotice>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                        Payment Method
                      </label>
                      <MultiPaymentInput
                        // Currency in the key: the seeded line currency is
                        // mount-only, so toggling USD/LBP must remount the widget.
                        key={`${paymentInputKey}-${currency}`}
                        // Single-currency model: the toggle clears the other
                        // currency's fields, so the owed total lives entirely in
                        // the active currency. Hardcoding the USD pair here made
                        // an LBP-priced service show a $0 payment total.
                        totals={[
                          currency === "USD"
                            ? {
                                amount: priceUsdVal || costUsdVal,
                                currency: "USD",
                              }
                            : {
                                amount: priceLbpVal || costLbpVal,
                                currency: "LBP",
                              },
                        ]}
                        currency={currency}
                        totalAmountCurrency={currency}
                        onChange={setPaymentLines}
                        onReturnChange={setReturnLegs}
                        onKeptChange={setKeptChange}
                        requiresClientForDebt={true}
                        hasClient={!!clientId || !!clientName}
                        // Auto-debt needs a RESOLVED client here: the submit
                        // guard rejects debt legs without clientId (name-only
                        // would auto-split and then dead-end at that alert).
                        autoDebtRemainder={!!clientId}
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
                  (hasPartnerMode && !selectedPartnerId) ||
                  // LIRA-154: VIA additionally needs a real payment leg —
                  // the alert-based guard in handleSubmit is the source of
                  // truth (mirrors the cost/price and debt-client guards,
                  // which are alert-only too); disabling the button here
                  // is a pre-emptive UX nicety, not a second guard.
                  (isViaPartner && paymentLines.length === 0)
                }
                className="w-full py-4 mt-6 rounded-xl font-bold text-lg bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />{" "}
                    Submitting...
                  </>
                ) : (
                  <>
                    <Plus size={18} />{" "}
                    {isForPartner ? "Submit to Partner" : "Submit Service"}
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
