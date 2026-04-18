import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import logger from "@/utils/logger";
import {
  Send,
  ArrowDownToLine,
  History,
  User,
  Hash,
  Phone,
  RefreshCw,
  AlertTriangle,
  X,
} from "lucide-react";
import { useSession } from "@/features/sessions/context/SessionContext";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { PageHeader, Select, useApi, appEvents } from "@liratek/ui";
import { DataTable } from "@liratek/ui";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { StatsCards } from "../../components/StatsCards";
import { getExchangeRates } from "@/utils/exchangeRates";

type Provider = "OMT" | "WHISH";
type ServiceType = "SEND" | "RECEIVE";
type OmtServiceType =
  | "INTRA"
  | "WESTERN_UNION"
  | "CASH_TO_BUSINESS"
  | "CASH_TO_GOV"
  | "OMT_WALLET"
  | "OMT_CARD"
  | "OGERO_MECANIQUE"
  | "ONLINE_BROKERAGE";

const OMT_SERVICE_OPTIONS: { value: OmtServiceType; label: string }[] = [
  { value: "INTRA", label: "Intra (10% of OMT fee)" },
  { value: "WESTERN_UNION", label: "Western Union (10% of OMT fee)" },
  { value: "CASH_TO_BUSINESS", label: "Cash to Business (25% of OMT fee)" },
  { value: "CASH_TO_GOV", label: "Cash to Gov (25% of OMT fee)" },
  { value: "OMT_WALLET", label: "OMT Wallet (No Fees)" },
  { value: "OMT_CARD", label: "OMT Card (10% of OMT fee)" },
  { value: "OGERO_MECANIQUE", label: "Ogero/Mecanique (25% of OMT fee)" },
  { value: "ONLINE_BROKERAGE", label: "Online Brokerage (% of amount)" },
];

// OMT commission rates (shop's % of OMT fee) — must match omtFees.ts
const OMT_COMMISSION_RATES: Record<string, number> = {
  INTRA: 0.1,
  WESTERN_UNION: 0.1,
  CASH_TO_BUSINESS: 0.25,
  CASH_TO_GOV: 0.25,
  OMT_CARD: 0.1,
  OGERO_MECANIQUE: 0.25,
};

// Fee tier lookup tables — must match omtFees.ts
const INTRA_FEE_TIERS: Array<{ maxAmount: number; fee: number }> = [
  { maxAmount: 100, fee: 1 },
  { maxAmount: 150, fee: 2 },
  { maxAmount: 200, fee: 3 },
  { maxAmount: 250, fee: 4 },
  { maxAmount: 300, fee: 5 },
  { maxAmount: 400, fee: 6 },
  { maxAmount: 500, fee: 7 },
  { maxAmount: 1000, fee: 8 },
  { maxAmount: 2000, fee: 12 },
  { maxAmount: 3000, fee: 18 },
  { maxAmount: 4000, fee: 25 },
  { maxAmount: 5000, fee: 35 },
];

const WESTERN_UNION_FEE_TIERS: Array<{ maxAmount: number; fee: number }> = [
  { maxAmount: 50, fee: 5 },
  { maxAmount: 200, fee: 10 },
  { maxAmount: 500, fee: 15 },
  { maxAmount: 1000, fee: 20 },
  { maxAmount: 2000, fee: 35 },
  { maxAmount: 3000, fee: 70 },
  { maxAmount: 7500, fee: 100 },
];

function lookupOmtFee(serviceType: OmtServiceType, amt: number): number | null {
  let tiers: Array<{ maxAmount: number; fee: number }> | null = null;
  if (serviceType === "INTRA") tiers = INTRA_FEE_TIERS;
  else if (serviceType === "WESTERN_UNION") tiers = WESTERN_UNION_FEE_TIERS;
  if (!tiers) return null;
  const tier = tiers.find((t) => amt <= t.maxAmount);
  return tier ? tier.fee : null;
}

// WHISH fee table — must match whishFees.ts
const WHISH_FEE_TIERS: Array<{ maxAmount: number; fee: number }> = [
  { maxAmount: 100, fee: 1 },
  { maxAmount: 200, fee: 2 },
  { maxAmount: 300, fee: 3 },
  { maxAmount: 1000, fee: 5 },
  { maxAmount: 2000, fee: 10 },
  { maxAmount: 3000, fee: 15 },
  { maxAmount: 4000, fee: 20 },
  { maxAmount: 5000, fee: 25 },
];
const WHISH_COMMISSION_RATE = 0.1; // 10% of WHISH fee

function lookupWhishFee(amt: number): number | null {
  const tier = WHISH_FEE_TIERS.find((t) => amt <= t.maxAmount);
  return tier ? tier.fee : null;
}

// Online Brokerage profit rate options
const ONLINE_BROKERAGE_RATES = [
  { value: 0.001, label: "0.1%" },
  { value: 0.0015, label: "0.15%" },
  { value: 0.002, label: "0.2%" },
  { value: 0.0025, label: "0.25% (Default)" },
  { value: 0.003, label: "0.3%" },
  { value: 0.0035, label: "0.35%" },
  { value: 0.004, label: "0.4%" },
];

const PM_FEE_DEFAULT_RATE = 0.01;

// CASH-equivalent method codes — these do NOT trigger PM fee
const CASH_EQUIVALENT_METHODS = new Set(["CASH", "DEBT"]);

/**
 * Returns true if the payment method code is a non-cash wallet method
 * that should trigger the payment method fee surcharge.
 */
function isNonCashMethod(methodCode: string): boolean {
  return !CASH_EQUIVALENT_METHODS.has(methodCode);
}

/**
 * Calculate max sendable amount when customer wants to pay a fixed total
 * (includingFees=true) with a non-cash payment method.
 *
 * totalBudget = sentAmount + providerFee(sentAmount) + sentAmount * pmFeeRate
 *
 * Since providerFee is tiered, we iterate fee tiers to find the max sentAmount.
 */
function calcMaxSentAmountWithPmFee(
  totalBudget: number,
  pmFeeRate: number,
  feeTiers: Array<{ maxAmount: number; fee: number }>,
): { sentAmount: number; providerFee: number; pmFee: number } | null {
  for (const tier of [...feeTiers].reverse()) {
    // For this tier: sentAmount + tier.fee + sentAmount * pmFeeRate <= totalBudget
    // sentAmount * (1 + pmFeeRate) <= totalBudget - tier.fee
    const maxSent = (totalBudget - tier.fee) / (1 + pmFeeRate);
    // sentAmount must be within the tier range
    const prevTierMax = feeTiers[feeTiers.indexOf(tier) - 1]?.maxAmount ?? 0;
    if (maxSent > prevTierMax && maxSent > 0) {
      const sentAmount = Math.floor(maxSent * 100) / 100; // floor to 2dp
      const pmFee = parseFloat((sentAmount * pmFeeRate).toFixed(2));
      return { sentAmount, providerFee: tier.fee, pmFee };
    }
  }
  return null;
}

const PROVIDERS: Provider[] = ["OMT", "WHISH"];
const SERVICE_TYPES: ServiceType[] = ["SEND", "RECEIVE"];

const PROVIDER_DEFAULT_METHOD: Record<Provider, string> = {
  OMT: "CASH",
  WHISH: "CASH",
};

const PROVIDER_BADGE_COLORS: Record<Provider, string> = {
  OMT: "bg-[#ffde00]/10 text-[#ffde00]",
  WHISH: "bg-[#ff0a46]/10 text-[#ff0a46]",
};

const SERVICE_TYPE_ICONS: Record<ServiceType, typeof Send> = {
  SEND: Send, // Customer sends money out → shop processes a send transaction
  RECEIVE: ArrowDownToLine, // Customer receives/cashes out → money comes down to them
};

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  SEND: "Send",
  RECEIVE: "Receive",
};

const INPUT_CLASS =
  "w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors";

function formatAmount(amount: number, currency: string): string {
  if (currency === "USD") return `$${amount.toFixed(2)}`;
  if (currency === "LBP") return `${amount.toLocaleString()} LBP`;
  if (currency === "EUR") return `\u20ac${amount.toFixed(2)}`;
  return `${amount} ${currency}`;
}

interface Analytics {
  today: { commission: number; pending_commission: number; count: number };
  month: { commission: number; pending_commission: number; count: number };
  byProvider: {
    provider: string;
    commission: number;
    currency: string;
    count: number;
  }[];
}

interface Transaction {
  id: number;
  provider: Provider;
  service_type: ServiceType;
  amount: number;
  currency: string;
  commission: number;
  omt_fee?: number | null;
  whish_fee?: number | null;
  is_settled: number;
  settled_at?: string | null;
  client_name?: string;
  reference_number?: string;
  phone_number?: string;
  omt_service_type?: OmtServiceType;
  note?: string;
  created_at: string;
}

interface SupplierOwed {
  usd: number;
  lbp: number;
}

export default function Services() {
  const api = useApi();
  const { activeSession, linkTransaction } = useSession();
  const { drawerAffectingMethods } = usePaymentMethods();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    today: { commission: 0, pending_commission: 0, count: 0 },
    month: { commission: 0, pending_commission: 0, count: 0 },
    byProvider: [],
  });
  const [owedByProvider, setOwedByProvider] = useState<
    Record<string, SupplierOwed>
  >({});

  // Loading / error state
  const [_isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form State
  const [provider, setProvider] = useState<Provider>("OMT");
  const [paidByMethod, setPaidByMethod] = useState("CASH");
  const [serviceType, setServiceType] = useState<ServiceType>("SEND");
  const [amount, setAmount] = useState<string>("");
  // Sender/Receiver fields (Phase 2)
  const [senderName, setSenderName] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [omtServiceType, setOmtServiceType] = useState<OmtServiceType | null>(
    "INTRA", // Default to INTRA for OMT — most common service type
  );
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New fields for Phase 2
  const [omtFee, setOmtFee] = useState<string>("");
  const [whishFee, setWhishFee] = useState<string>("");
  const [profitRate, setProfitRate] = useState<number>(0.0025); // 0.25% default

  // BINANCE-specific fields
  const [payFee, setPayFee] = useState<boolean>(false); // Charge fee to customer
  const [binanceSupplier, setBinanceSupplier] = useState<string>(""); // Supplier account

  // Phase 3: Multi-payment support
  const [useMultiPayment, setUseMultiPayment] = useState<boolean>(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [includingFees, setIncludingFees] = useState<boolean>(false); // For SEND: amount includes fees

  // History modal
  const [showHistory, setShowHistory] = useState(false);

  // Exchange rate for multi-currency payments (loaded from database)
  const [exchangeRate, setExchangeRate] = useState(89500);

  useEffect(() => {
    const loadRate = async () => {
      try {
        const rates = await api.getRates();
        const { sellRate } = getExchangeRates(rates);
        setExchangeRate(sellRate);
      } catch (error) {
        logger.error("Failed to load exchange rate:", error);
      }
    };
    loadRate();
  }, [api]);

  // Payment method fee (PM fee) — surcharge for non-cash wallet payments
  // Stored as a USD amount string; auto-filled from amount * 1% default rate
  const [pmFeeAmount, setPmFeeAmount] = useState<string>("");

  // Multi-payment PM fees: map of paymentLine.id → pmFee amount (from MultiPaymentInput callback)
  const [multiPmFees, setMultiPmFees] = useState<Record<string, number>>({});

  // Derived: whether PM fee applies (SEND + non-cash + single payment)
  const pmFeeApplies =
    serviceType === "SEND" && !useMultiPayment && isNonCashMethod(paidByMethod);

  // For multi-payment: PM fee applies on SEND transactions
  const multiPmFeeApplies = serviceType === "SEND" && useMultiPayment;

  // Render-level provider fee — mirrors the logic in handleSubmit for display purposes
  const renderProviderFee = (() => {
    const amtVal = parseFloat(amount) || 0;
    if (!amtVal) return 0;
    if (provider === "OMT" && omtServiceType === "INTRA") {
      for (const tier of INTRA_FEE_TIERS) {
        if (amtVal <= tier.maxAmount) return tier.fee;
      }
    }
    if (provider === "OMT" && omtServiceType === "WESTERN_UNION") {
      for (const tier of WESTERN_UNION_FEE_TIERS) {
        if (amtVal <= tier.maxAmount) return tier.fee;
      }
    }
    if (provider === "WHISH") {
      for (const tier of WHISH_FEE_TIERS) {
        if (amtVal <= tier.maxAmount) return tier.fee;
      }
    }
    // Fallback to manually entered OMT fee
    if (omtFee && parseFloat(omtFee) > 0) return parseFloat(omtFee);
    return 0;
  })();

  // Auto-fill PM fee when amount or eligibility changes
  useEffect(() => {
    if (!pmFeeApplies) {
      setPmFeeAmount("");
      return;
    }
    const amtVal = parseFloat(amount) || 0;
    if (amtVal > 0) {
      setPmFeeAmount((amtVal * PM_FEE_DEFAULT_RATE).toFixed(2));
    } else {
      setPmFeeAmount("");
    }
  }, [amount, pmFeeApplies]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [history, stats, suppliers, balances] = await Promise.all([
        api.getOMTHistory(),
        api.getOMTAnalytics(),
        api.getSuppliers(),
        api.getSupplierBalances(),
      ]);
      setTransactions(
        history.map((h: Transaction) => ({
          ...h,
          provider: h.provider as Provider,
          service_type: h.service_type as ServiceType,
        })),
      );
      setAnalytics(stats);

      // Build owed map by provider
      const owed: Record<string, SupplierOwed> = {};
      for (const s of suppliers) {
        if (s.provider && (s.provider === "OMT" || s.provider === "WHISH")) {
          const bal = balances.find(
            (b: { supplier_id: number }) => b.supplier_id === s.id,
          );
          owed[s.provider] = {
            usd: Number(bal?.total_usd || 0),
            lbp: Number(bal?.total_lbp || 0),
          };
        }
      }
      setOwedByProvider(owed);
    } catch (error) {
      logger.error("Failed to load data:", error);
      setLoadError("Failed to load data. Tap refresh to retry.");
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadData();

    // Auto-fill sender/receiver from active session based on service type
    if (activeSession) {
      if (serviceType === "SEND") {
        // Session customer is the sender
        setSenderName(activeSession.customer_name || "");
        setSenderPhone(activeSession.customer_phone || "");
      } else {
        // Session customer is the receiver
        setReceiverName(activeSession.customer_name || "");
        setReceiverPhone(activeSession.customer_phone || "");
      }
    }
  }, [activeSession, serviceType, loadData]);

  // Ref to track if we should auto-submit after voice command
  const shouldAutoSubmitRef = useRef(false);

  // Auto-submit when form fields are populated by voice command
  useEffect(() => {
    if (
      shouldAutoSubmitRef.current &&
      amount &&
      (receiverPhone || senderPhone)
    ) {
      console.warn("[Services] ✅ Form fields populated, auto-submitting...");
      shouldAutoSubmitRef.current = false;

      // Small delay to ensure UI is updated
      setTimeout(() => {
        handleSubmit();
      }, 100);
    }
  }, [amount, receiverPhone, senderPhone]);

  // Handle voice/text commands from VoiceBot
  useEffect(() => {
    const handleVoiceCommand = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const { command, entities } = customEvent.detail;

      console.warn("🎤 [SERVICES] VOICE COMMAND RECEIVED!", {
        action: command.action,
        hasReceiverPhone: !!entities.receiverPhone,
        hasSenderPhone: !!entities.senderPhone,
      });

      // Only handle OMT/WHISH commands
      if (command.module !== "omt_whish") {
        console.warn(
          "[Services] Ignoring non-omt_whish module:",
          command.module,
        );
        return;
      }

      try {
        console.warn("[Services] Checking conditions:", {
          action: command.action,
          receiverPhone: entities.receiverPhone,
          hasReceiverPhone: !!entities.receiverPhone,
        });

        // For SEND: session customer is sender, voice provides receiver
        if (command.action === "send" && entities.receiverPhone) {
          console.warn("[Services] SEND condition met! Processing...");

          // Update form fields for visual feedback
          setAmount(entities.amount.toString());
          setReceiverName(entities.receiverName || "");
          setReceiverPhone(entities.receiverPhone);

          // Mark that we should auto-submit when fields are updated
          shouldAutoSubmitRef.current = true;

          // Session customer should already be auto-filled as sender from useEffect
          console.warn("[Services] Form fields updated:", {
            amount: entities.amount,
            receiverName: entities.receiverName,
            receiverPhone: entities.receiverPhone,
          });
        }

        // For RECEIVE: session customer is receiver, voice provides sender
        if (command.action === "receive" && entities.senderPhone) {
          console.warn("[Services] RECEIVE condition met! Processing...");

          // Update form fields for visual feedback
          setAmount(entities.amount.toString());
          setSenderName(entities.senderName || "");
          setSenderPhone(entities.senderPhone);

          // Mark that we should auto-submit when fields are updated
          shouldAutoSubmitRef.current = true;

          // Session customer should already be auto-filled as receiver from useEffect
          console.warn("[Services] Form fields updated:", {
            amount: entities.amount,
            senderName: entities.senderName,
            senderPhone: entities.senderPhone,
          });
        }
      } catch (err) {
        logger.error("[VoiceBot] Error handling command:", err);
        console.error("[Services] Voice command error:", err);
        appEvents.emit(
          "notification:show",
          err instanceof Error ? err.message : "Voice command failed",
          "error",
        );
      }
    };

    window.addEventListener("voicebot:command", handleVoiceCommand);
    return () => {
      window.removeEventListener("voicebot:command", handleVoiceCommand);
    };
  }, [provider, activeSession, api, loadData]);

  const handleSubmit = useCallback(async () => {
    // Validate: client name + phone required when debt is used (single or split)
    const hasDebtLeg =
      (!useMultiPayment && paidByMethod === "DEBT") ||
      (useMultiPayment && paymentLines.some((p) => p.method === "DEBT"));
    // For SEND: check sender; for RECEIVE: check receiver
    const primaryName = serviceType === "SEND" ? senderName : receiverName;
    const primaryPhone = serviceType === "SEND" ? senderPhone : receiverPhone;

    if (hasDebtLeg && !primaryName.trim()) {
      appEvents.emit(
        "notification:show",
        `${serviceType === "SEND" ? "Sender" : "Receiver"} name is required when paying by debt.`,
        "warning",
      );
      return;
    }
    if (hasDebtLeg && !primaryPhone.trim()) {
      appEvents.emit(
        "notification:show",
        `${serviceType === "SEND" ? "Sender" : "Receiver"} phone is required when paying by debt.`,
        "warning",
      );
      return;
    }
    if (!amount) {
      appEvents.emit("notification:show", "Please enter an amount.", "warning");
      return;
    }

    setIsSubmitting(true);
    try {
      const amtVal = parseFloat(amount) || 0;

      // Resolve the OMT fee: user-entered or auto-looked-up from the fee table
      let resolvedOmtFee: number | undefined;
      if (
        provider === "OMT" &&
        omtServiceType &&
        omtServiceType !== "OMT_WALLET" &&
        omtServiceType !== "ONLINE_BROKERAGE"
      ) {
        if (omtFee && parseFloat(omtFee) > 0) {
          resolvedOmtFee = parseFloat(omtFee);
        } else {
          resolvedOmtFee =
            lookupOmtFee(omtServiceType as OmtServiceType, amtVal) ?? undefined;
        }
      }

      // Resolve the WHISH fee: user-entered or auto-looked-up from the WHISH fee table
      let resolvedWhishFee: number | undefined;
      if (provider === "WHISH") {
        if (whishFee && parseFloat(whishFee) > 0) {
          resolvedWhishFee = parseFloat(whishFee);
        } else {
          resolvedWhishFee = lookupWhishFee(amtVal) ?? undefined;
        }
      }

      // Resolved fee for the active provider
      const resolvedFee =
        provider === "WHISH" ? resolvedWhishFee : resolvedOmtFee;

      // Determine PM fee for non-cash single payments on SEND
      const activePmFeeApplies =
        serviceType === "SEND" &&
        !useMultiPayment &&
        isNonCashMethod(paidByMethod);

      // PM fee: user-entered USD amount (auto-filled at 1% but fully editable)
      const resolvedPmFee = activePmFeeApplies
        ? parseFloat(pmFeeAmount) || 0
        : 0;
      // Derive rate for backend audit storage (pmFee / sentAmount)
      const resolvedPmFeeRate =
        resolvedPmFee > 0 && amtVal > 0
          ? resolvedPmFee / amtVal
          : PM_FEE_DEFAULT_RATE;

      // When includingFees=true: the customer's entered amount is their total budget.
      // We need to back-calculate the max sentAmount from that budget.
      // When includingFees=false: fee is charged on top, actual sent amount = amount.
      let sentAmount = amtVal;
      let finalPmFee = resolvedPmFee;

      if (
        serviceType === "SEND" &&
        includingFees &&
        resolvedFee !== undefined
      ) {
        if (activePmFeeApplies && resolvedPmFee > 0) {
          // Budget = sentAmount + providerFee(tiered) + pmFee
          // Since pmFee is now a user-entered fixed USD amount, subtract both directly:
          // sentAmount = totalBudget - providerFee - pmFee
          // But pmFee was auto-calculated on amtVal (the budget), so we need to iterate.
          // Use the stored pmFee as an approximation and subtract from budget:
          const feeTiers =
            provider === "OMT" && omtServiceType === "INTRA"
              ? INTRA_FEE_TIERS
              : provider === "OMT" && omtServiceType === "WESTERN_UNION"
                ? WESTERN_UNION_FEE_TIERS
                : provider === "WHISH"
                  ? WHISH_FEE_TIERS
                  : null;

          if (feeTiers) {
            // Use the pmFee rate derived from user input for the back-calculation
            const calc = calcMaxSentAmountWithPmFee(
              amtVal,
              resolvedPmFeeRate,
              feeTiers,
            );
            if (calc) {
              sentAmount = calc.sentAmount;
              finalPmFee = calc.pmFee;
            } else {
              sentAmount = amtVal - resolvedFee - resolvedPmFee;
            }
          } else {
            // No tiered table: straightforward subtraction
            sentAmount = amtVal - resolvedFee - resolvedPmFee;
            sentAmount = Math.max(0, Math.floor(sentAmount * 100) / 100);
          }
        } else {
          // Cash payment with includingFees: simple fee subtraction
          sentAmount = amtVal - resolvedFee;
        }
      }

      const result = await api.addOMTTransaction({
        provider,
        serviceType,
        amount: sentAmount,
        currency: "USD",
        // For backward compatibility: set primary client based on service type
        ...(serviceType === "SEND"
          ? { clientName: senderName, phoneNumber: senderPhone }
          : { clientName: receiverName, phoneNumber: receiverPhone }),
        ...(referenceNumber ? { referenceNumber } : {}),
        // New sender/receiver fields
        senderName,
        senderPhone,
        receiverName,
        receiverPhone,
        ...(provider === "OMT" && omtServiceType ? { omtServiceType } : {}),
        // Always pass the resolved fee so backend can record it correctly
        ...(resolvedOmtFee ? { omtFee: resolvedOmtFee } : {}),
        ...(resolvedWhishFee ? { whishFee: resolvedWhishFee } : {}),
        ...(omtServiceType === "ONLINE_BROKERAGE" ? { profitRate } : {}),
        ...(payFee ? { payFee: true } : {}),
        ...(binanceSupplier ? { itemKey: binanceSupplier } : {}),
        includingFees: serviceType === "SEND" ? includingFees : false,
        ...(useMultiPayment && paymentLines.length > 0
          ? {
              payments: paymentLines.map((p) => ({
                method: p.method,
                currencyCode: p.currencyCode,
                // For non-cash legs on SEND, bake in the PM fee so the backend
                // credits the correct (amount + pmFee) to the wallet drawer
                amount:
                  multiPmFeeApplies && multiPmFees[p.id]
                    ? p.amount + multiPmFees[p.id]
                    : p.amount,
              })),
            }
          : { paidByMethod }),
        // Payment method fee — single non-cash SEND: pass explicit fields
        // Multi-payment: total PM fee derived from per-leg fees above (baked into amounts)
        ...(finalPmFee > 0
          ? {
              paymentMethodFee: finalPmFee,
              paymentMethodFeeRate: resolvedPmFeeRate,
            }
          : multiPmFeeApplies && Object.keys(multiPmFees).length > 0
            ? {
                paymentMethodFee: Object.values(multiPmFees).reduce(
                  (s, f) => s + f,
                  0,
                ),
                paymentMethodFeeRate: PM_FEE_DEFAULT_RATE,
              }
            : {}),
        note: note || `${provider} - ${serviceType}`,
      });

      if (result.success) {
        // Link to active session if exists
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "financial_service",
              transactionId: result.id,
              amountUsd: parseFloat(amount),
              amountLbp: 0,
            });
          } catch (err) {
            logger.error("Failed to link service to session:", err);
            // Don't block the transaction completion
          }
        }

        appEvents.emit(
          "notification:show",
          `${provider} ${serviceType.toLowerCase()} recorded successfully`,
          "success",
        );

        // Reset form
        setAmount("");
        setSenderName("");
        setSenderPhone("");
        setReceiverName("");
        setReceiverPhone("");
        setReferenceNumber("");
        setOmtServiceType("INTRA" as OmtServiceType);
        setOmtFee("");
        setWhishFee("");
        setProfitRate(0.0025);
        setPayFee(false);
        setBinanceSupplier("");
        setUseMultiPayment(false);
        setPaymentLines([]);
        setIncludingFees(false);
        setPmFeeAmount("");
        setMultiPmFees({});
        setNote("");
        loadData();
      } else {
        appEvents.emit(
          "notification:show",
          result.error || "Transaction failed",
          "error",
        );
      }
    } catch (error) {
      logger.error("Operation failed", { error });
      const msg =
        error instanceof Error
          ? error.message
          : "Transaction failed. Please try again.";
      appEvents.emit("notification:show", msg, "error");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    amount,
    provider,
    serviceType,
    omtServiceType,
    omtFee,
    whishFee,
    profitRate,
    senderName,
    senderPhone,
    receiverName,
    receiverPhone,
    referenceNumber,
    paidByMethod,
    payFee,
    binanceSupplier,
    useMultiPayment,
    paymentLines,
    includingFees,
    pmFeeAmount,
    pmFeeApplies,
    multiPmFees,
    multiPmFeeApplies,
    note,
    api,
    activeSession,
    linkTransaction,
    loadData,
  ]);

  // Close history modal on Escape key
  useEffect(() => {
    if (!showHistory) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHistory(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showHistory]);

  // Derived accent colors based on active provider
  const providerAccent = useMemo(
    () =>
      provider === "OMT"
        ? { ring: "ring-[#ffde00]/30", glow: "shadow-[#ffde00]/10" }
        : { ring: "ring-[#ff0a46]/30", glow: "shadow-[#ff0a46]/10" },
    [provider],
  );

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 flex flex-col gap-4 overflow-hidden animate-in fade-in duration-300">
      {/* Header with Stats on Right */}
      <PageHeader
        icon={Send}
        title="OMT/Whish"
        actions={
          <div className="flex items-center gap-2">
            <StatsCards
              todayCommission={analytics.today.commission}
              monthCommission={analytics.month.commission}
              owedByProvider={owedByProvider}
            />
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className="px-4 py-2 rounded-lg font-medium text-sm bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all"
            >
              History
            </button>
          </div>
        }
      />

      {/* Loading / Error banner */}
      {loadError && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
          <span className="flex-1">{loadError}</span>
          <button
            onClick={loadData}
            className="text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="w-full flex flex-col gap-4 pb-1">
          {/* ── Form Card ── */}
          <div
            className={`w-full bg-slate-800/80 rounded-2xl border border-slate-700/60 shadow-xl ring-1 ${providerAccent.ring} flex flex-col overflow-hidden`}
          >
            {/* Provider + Service Type — single combined row */}
            <div className="flex border-b border-slate-700/60">
              {PROVIDERS.map((prov) => {
                return SERVICE_TYPES.map((type) => {
                  const Icon = SERVICE_TYPE_ICONS[type];
                  const isActive = provider === prov && serviceType === type;
                  const isOmt = prov === "OMT";
                  return (
                    <button
                      key={`${prov}-${type}`}
                      onClick={() => {
                        setProvider(prov);
                        setServiceType(type);
                        setPaidByMethod(
                          PROVIDER_DEFAULT_METHOD[prov] || "CASH",
                        );
                      }}
                      className={`flex-1 py-3 font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-1.5 border-r border-slate-700/40 last:border-r-0 ${
                        isActive
                          ? isOmt
                            ? "bg-[#ffde00] text-black"
                            : "bg-[#ff0a46] text-white"
                          : "bg-slate-900/60 text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <Icon size={14} />
                      <span>{prov}</span>
                      <span
                        className={`text-[11px] font-medium ${isActive ? "opacity-80" : "opacity-50"}`}
                      >
                        {type === "SEND" ? "↑" : "↓"}
                      </span>
                    </button>
                  );
                });
              })}
            </div>

            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto px-4 py-3">
              {/* OMT Service Type - Only shown for OMT provider */}
              {provider === "OMT" && (
                <div>
                  <label
                    htmlFor="service-omt-type"
                    className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                  >
                    OMT Service
                  </label>
                  <Select
                    value={omtServiceType ?? ""}
                    onChange={(v) =>
                      setOmtServiceType(v === "" ? null : (v as OmtServiceType))
                    }
                    options={[
                      { value: "", label: "— Select service —" },
                      ...OMT_SERVICE_OPTIONS,
                    ]}
                  />
                </div>
              )}

              {/* Amount Field */}
              <div>
                <label
                  htmlFor="service-amount"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                >
                  Amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                    $
                  </span>
                  <input
                    id="service-amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={INPUT_CLASS + " pl-8 pr-16"}
                    placeholder="0.00"
                    step="0.01"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-medium">
                    USD
                  </span>
                </div>
              </div>

              {/* Including Fees Checkbox (SEND only - for both OMT and WHISH) */}
              {serviceType === "SEND" &&
                (() => {
                  const amtVal = parseFloat(amount) || 0;
                  const autoFee =
                    provider === "OMT" &&
                    omtServiceType &&
                    omtServiceType !== "OMT_WALLET" &&
                    omtServiceType !== "ONLINE_BROKERAGE" &&
                    amtVal > 0
                      ? lookupOmtFee(omtServiceType as OmtServiceType, amtVal)
                      : provider === "WHISH" && amtVal > 0
                        ? lookupWhishFee(amtVal)
                        : null;
                  const feeLabel =
                    provider === "WHISH" ? "WHISH fee" : "OMT fee";
                  // For the breakdown display: prefer user-entered fee only if it's
                  // a valid positive number AND differs meaningfully from auto (i.e. user typed it).
                  // Always fall back to auto-looked-up fee from the table.
                  const userEnteredFee =
                    provider === "WHISH"
                      ? whishFee && parseFloat(whishFee) > 0
                        ? parseFloat(whishFee)
                        : null
                      : omtFee && parseFloat(omtFee) > 0
                        ? parseFloat(omtFee)
                        : null;
                  const feeVal = userEnteredFee ?? autoFee ?? 0;

                  // PM fee for breakdown display — use the live user-entered value
                  const showPmFee = pmFeeApplies;
                  const pmFeeDisplay = showPmFee
                    ? parseFloat(pmFeeAmount) || 0
                    : 0;
                  // Derived rate for includingFees back-calculation
                  const pmFeeRateForCalc =
                    pmFeeDisplay > 0 && amtVal > 0
                      ? pmFeeDisplay / amtVal
                      : PM_FEE_DEFAULT_RATE;

                  // includingFees + PM fee: back-calculate sentAmount
                  let breakdownSent = amtVal;
                  let breakdownPmFee = pmFeeDisplay;
                  if (
                    includingFees &&
                    feeVal > 0 &&
                    showPmFee &&
                    pmFeeDisplay > 0
                  ) {
                    const feeTiers =
                      provider === "OMT" && omtServiceType === "INTRA"
                        ? INTRA_FEE_TIERS
                        : provider === "OMT" &&
                            omtServiceType === "WESTERN_UNION"
                          ? WESTERN_UNION_FEE_TIERS
                          : provider === "WHISH"
                            ? WHISH_FEE_TIERS
                            : null;
                    if (feeTiers) {
                      const calc = calcMaxSentAmountWithPmFee(
                        amtVal,
                        pmFeeRateForCalc,
                        feeTiers,
                      );
                      if (calc) {
                        breakdownSent = calc.sentAmount;
                        breakdownPmFee = calc.pmFee;
                      } else {
                        breakdownSent = Math.max(
                          0,
                          amtVal - feeVal - pmFeeDisplay,
                        );
                      }
                    } else {
                      breakdownSent = Math.max(
                        0,
                        amtVal - feeVal - pmFeeDisplay,
                      );
                    }
                  } else if (includingFees && feeVal > 0) {
                    breakdownSent = amtVal - feeVal;
                    breakdownPmFee = 0;
                  }

                  return (
                    <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3 space-y-2">
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includingFees}
                          onChange={(e) => setIncludingFees(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium">
                          Fee included in amount
                        </span>
                      </label>
                      {amtVal > 0 && feeVal > 0 && (
                        <div className="text-xs space-y-0.5 pl-6 border-l border-slate-600 ml-2">
                          {includingFees ? (
                            <>
                              <p className="text-slate-400">
                                Customer paid:{" "}
                                <span className="text-white font-mono font-medium">
                                  ${amtVal.toFixed(2)}
                                </span>
                              </p>
                              <p className="text-slate-400">
                                {feeLabel}:{" "}
                                <span className="text-amber-400 font-mono font-medium">
                                  -${feeVal.toFixed(2)}
                                </span>
                              </p>
                              {showPmFee && breakdownPmFee > 0 && (
                                <p className="text-slate-400">
                                  PM fee:{" "}
                                  <span className="text-violet-400 font-mono font-medium">
                                    -${breakdownPmFee.toFixed(2)}
                                  </span>
                                </p>
                              )}
                              <p className="text-slate-400">
                                Sent to recipient:{" "}
                                <span className="text-emerald-400 font-mono font-medium">
                                  ${breakdownSent.toFixed(2)}
                                </span>
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-slate-400">
                                Sent amount:{" "}
                                <span className="text-white font-mono font-medium">
                                  ${amtVal.toFixed(2)}
                                </span>
                              </p>
                              <p className="text-slate-400">
                                {feeLabel} (extra):{" "}
                                <span className="text-amber-400 font-mono font-medium">
                                  +${feeVal.toFixed(2)}
                                </span>
                              </p>
                              {showPmFee && pmFeeDisplay > 0 && (
                                <p className="text-slate-400">
                                  PM fee:{" "}
                                  <span className="text-violet-400 font-mono font-medium">
                                    +${pmFeeDisplay.toFixed(2)}
                                  </span>
                                </p>
                              )}
                              <p className="text-slate-400">
                                Customer pays total:{" "}
                                <span className="text-emerald-400 font-mono font-medium">
                                  $
                                  {(
                                    amtVal +
                                    feeVal +
                                    (showPmFee ? pmFeeDisplay : 0)
                                  ).toFixed(2)}
                                </span>
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* OMT Fee Input — shown for all OMT SEND types except WALLET and ONLINE_BROKERAGE */}
              {provider === "OMT" &&
                serviceType === "SEND" &&
                omtServiceType &&
                omtServiceType !== "OMT_WALLET" &&
                omtServiceType !== "ONLINE_BROKERAGE" &&
                (() => {
                  const amtVal = parseFloat(amount) || 0;
                  const autoFee =
                    amtVal > 0 && omtServiceType
                      ? lookupOmtFee(omtServiceType as OmtServiceType, amtVal)
                      : null;
                  const feeVal = omtFee ? parseFloat(omtFee) : (autoFee ?? 0);
                  const rate = OMT_COMMISSION_RATES[omtServiceType] ?? 0;
                  const profit = feeVal * rate;
                  return (
                    <div>
                      <label
                        htmlFor="service-omt-fee"
                        className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                      >
                        OMT Fee (charged by OMT)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                          $
                        </span>
                        <input
                          id="service-omt-fee"
                          type="number"
                          value={omtFee}
                          onChange={(e) => setOmtFee(e.target.value)}
                          className={INPUT_CLASS + " pl-8"}
                          placeholder={
                            autoFee != null
                              ? autoFee.toFixed(2) + " (auto)"
                              : "0.00"
                          }
                          step="0.01"
                        />
                      </div>
                      {/* Auto-fee hint */}
                      {autoFee != null && !omtFee && (
                        <p className="text-xs text-slate-400 mt-1">
                          Auto-calculated fee:{" "}
                          <span className="text-white font-medium">
                            ${autoFee.toFixed(2)}
                          </span>{" "}
                          based on amount
                        </p>
                      )}
                      {/* Live profit preview */}
                      {feeVal > 0 && (
                        <p className="text-xs text-emerald-400 mt-1 font-medium">
                          Your profit:{" "}
                          <span className="font-mono">
                            ${profit.toFixed(4)}
                          </span>{" "}
                          ({(rate * 100).toFixed(0)}% of ${feeVal.toFixed(2)}{" "}
                          OMT fee)
                        </p>
                      )}
                    </div>
                  );
                })()}

              {/* WHISH Fee Input — shown for WHISH SEND */}
              {provider === "WHISH" &&
                serviceType === "SEND" &&
                (() => {
                  const amtVal = parseFloat(amount) || 0;
                  const autoFee = amtVal > 0 ? lookupWhishFee(amtVal) : null;
                  const feeVal = whishFee
                    ? parseFloat(whishFee)
                    : (autoFee ?? 0);
                  const profit = feeVal * WHISH_COMMISSION_RATE;
                  return (
                    <div>
                      <label
                        htmlFor="service-whish-fee"
                        className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                      >
                        WHISH Fee (charged by WHISH)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                          $
                        </span>
                        <input
                          id="service-whish-fee"
                          type="number"
                          value={whishFee}
                          onChange={(e) => setWhishFee(e.target.value)}
                          className={INPUT_CLASS + " pl-8"}
                          placeholder={
                            autoFee != null
                              ? autoFee.toFixed(2) + " (auto)"
                              : "0.00"
                          }
                          step="0.01"
                        />
                      </div>
                      {autoFee != null && !whishFee && (
                        <p className="text-xs text-slate-400 mt-1">
                          Auto-calculated fee:{" "}
                          <span className="text-white font-medium">
                            ${autoFee.toFixed(2)}
                          </span>{" "}
                          based on amount
                        </p>
                      )}
                      {feeVal > 0 && (
                        <p className="text-xs text-emerald-400 mt-1 font-medium">
                          Your profit:{" "}
                          <span className="font-mono">
                            ${profit.toFixed(4)}
                          </span>{" "}
                          (10% of ${feeVal.toFixed(2)} WHISH fee)
                        </p>
                      )}
                    </div>
                  );
                })()}

              {/* Online Brokerage Profit Rate Selector */}
              {provider === "OMT" && omtServiceType === "ONLINE_BROKERAGE" && (
                <div>
                  <label
                    htmlFor="service-profit-rate"
                    className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                  >
                    Profit Rate (% of Amount)
                  </label>
                  <Select
                    value={profitRate.toString()}
                    onChange={(v) => setProfitRate(parseFloat(v))}
                    options={ONLINE_BROKERAGE_RATES.map((r) => ({
                      value: r.value.toString(),
                      label: r.label,
                    }))}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Typical: 0.25% (UNICEF, etc.)
                  </p>
                  {amount && parseFloat(amount) > 0 && (
                    <p className="text-xs text-emerald-400 mt-1 font-medium">
                      Profit: ${(parseFloat(amount) * profitRate).toFixed(2)}
                    </p>
                  )}
                </div>
              )}

              {/* OMT Wallet Zero-Fee Alert */}
              {provider === "OMT" && omtServiceType === "OMT_WALLET" && (
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-semibold text-blue-400 mb-1">
                        OMT Wallet - No Fees
                      </h4>
                      <p className="text-xs text-blue-300/80">
                        Internal OMT transfers have zero fees. No commission
                        will be earned on this transaction.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Payment Method */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Payment Method
                  </label>
                  <button
                    type="button"
                    onClick={() => setUseMultiPayment(!useMultiPayment)}
                    className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                  >
                    {useMultiPayment ? "Single Payment" : "Split Payment"}
                  </button>
                </div>

                {!useMultiPayment ? (
                  <Select
                    value={paidByMethod}
                    onChange={setPaidByMethod}
                    options={[
                      ...drawerAffectingMethods.map((m) => ({
                        value: m.code,
                        label: m.label,
                      })),
                      // DEBT is not drawer-affecting but is a valid single payment method
                      { value: "DEBT", label: "Debt (Client owes)" },
                    ]}
                  />
                ) : (
                  <MultiPaymentInput
                    totalAmount={
                      // On SEND, the customer must pay amount + providerFee.
                      // The payment lines must sum to this full number.
                      serviceType === "SEND"
                        ? (parseFloat(amount) || 0) + renderProviderFee
                        : parseFloat(amount) || 0
                    }
                    currency="USD"
                    onChange={setPaymentLines}
                    requiresClientForDebt={true}
                    hasClient={
                      !!(serviceType === "SEND" ? senderName : receiverName) ||
                      !!(serviceType === "SEND" ? senderPhone : receiverPhone)
                    }
                    showPmFee={multiPmFeeApplies}
                    pmFeeRate={PM_FEE_DEFAULT_RATE}
                    onPmFeesChange={setMultiPmFees}
                    providerFee={serviceType === "SEND" ? renderProviderFee : 0}
                    paymentMethods={drawerAffectingMethods}
                    currencies={[
                      { code: "USD", symbol: "$" },
                      { code: "LBP", symbol: "LBP" },
                    ]}
                    exchangeRate={exchangeRate}
                  />
                )}
              </div>

              {/* PM Fee Amount Input — shown for SEND with non-cash single payment */}
              {pmFeeApplies && (
                <div className="rounded-lg bg-violet-900/20 border border-violet-500/30 p-3 space-y-2">
                  <label
                    htmlFor="service-pm-fee"
                    className="block text-xs font-medium text-violet-300 uppercase tracking-wider"
                  >
                    Payment Method Fee
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-400 font-bold">
                      $
                    </span>
                    <input
                      id="service-pm-fee"
                      type="number"
                      value={pmFeeAmount}
                      onChange={(e) => setPmFeeAmount(e.target.value)}
                      className={
                        INPUT_CLASS +
                        " pl-8 border-violet-500/40 focus:border-violet-400"
                      }
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                    />
                  </div>
                  {amount && parseFloat(amount) > 0 && (
                    <p className="text-xs text-violet-300">
                      Auto-filled at 1% of ${parseFloat(amount).toFixed(2)}.{" "}
                      <span className="font-medium">Edit to override.</span> —
                      stays in {paidByMethod} drawer immediately
                    </p>
                  )}
                </div>
              )}

              {/* Sender/Receiver Info - changes based on service type */}
              {serviceType === "SEND" ? (
                <>
                  {/* Sender Fields (auto-filled from session) */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor="service-sender-name"
                        className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                      >
                        <User size={12} /> Sender{" "}
                        {activeSession && "• From Session"}
                      </label>
                      <input
                        id="service-sender-name"
                        type="text"
                        value={senderName}
                        onChange={(e) => setSenderName(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder={
                          activeSession ? "From session" : "Sender name"
                        }
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="service-sender-phone"
                        className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                      >
                        <Phone size={12} /> Sender Phone
                      </label>
                      <input
                        id="service-sender-phone"
                        type="tel"
                        value={senderPhone}
                        onChange={(e) => setSenderPhone(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder={
                          activeSession ? "From session" : "Sender phone"
                        }
                      />
                    </div>
                  </div>
                  {/* Receiver Fields */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor="service-receiver-name"
                        className="block text-xs font-medium text-emerald-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                      >
                        <User size={12} /> Receiver
                      </label>
                      <input
                        id="service-receiver-name"
                        type="text"
                        value={receiverName}
                        onChange={(e) => setReceiverName(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder="Receiver name"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="service-receiver-phone"
                        className="block text-xs font-medium text-emerald-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                      >
                        <Phone size={12} /> Receiver Phone
                      </label>
                      <input
                        id="service-receiver-phone"
                        type="tel"
                        value={receiverPhone}
                        onChange={(e) => setReceiverPhone(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder="Receiver phone"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Sender Fields (for RECEIVE) */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor="service-sender-name-receive"
                        className="block text-xs font-medium text-emerald-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                      >
                        <User size={12} /> Sender
                      </label>
                      <input
                        id="service-sender-name-receive"
                        type="text"
                        value={senderName}
                        onChange={(e) => setSenderName(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder="Sender name"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="service-sender-phone-receive"
                        className="block text-xs font-medium text-emerald-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                      >
                        <Phone size={12} /> Sender Phone
                      </label>
                      <input
                        id="service-sender-phone-receive"
                        type="tel"
                        value={senderPhone}
                        onChange={(e) => setSenderPhone(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder="Sender phone"
                      />
                    </div>
                  </div>
                  {/* Receiver Fields (auto-filled from session) */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor="service-receiver-name-receive"
                        className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                      >
                        <User size={12} /> Receiver{" "}
                        {activeSession && "• From Session"}
                      </label>
                      <input
                        id="service-receiver-name-receive"
                        type="text"
                        value={receiverName}
                        onChange={(e) => setReceiverName(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder={
                          activeSession ? "From session" : "Receiver name"
                        }
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="service-receiver-phone-receive"
                        className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                      >
                        <Phone size={12} /> Receiver Phone
                      </label>
                      <input
                        id="service-receiver-phone-receive"
                        type="tel"
                        value={receiverPhone}
                        onChange={(e) => setReceiverPhone(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder={
                          activeSession ? "From session" : "Receiver phone"
                        }
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Reference Number */}
              <div>
                <label
                  htmlFor="service-reference"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                >
                  <Hash size={12} /> Reference #
                </label>
                <input
                  id="service-reference"
                  type="text"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="Optional"
                />
              </div>

              {/* BINANCE-specific fields */}
              {provider === "OMT" && omtServiceType === "ONLINE_BROKERAGE" && (
                <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30">
                  <label className="flex items-center gap-2 text-purple-300 cursor-pointer mb-3">
                    <input
                      type="checkbox"
                      checked={payFee}
                      onChange={(e) => setPayFee(e.target.checked)}
                      className="w-4 h-4 rounded border-purple-700 bg-slate-950 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm font-medium">
                      Charge BINANCE fee to customer
                    </span>
                  </label>
                  {payFee && (
                    <>
                      <div className="mb-3">
                        <label
                          htmlFor="binance-supplier"
                          className="block text-xs text-purple-300 mb-1.5 uppercase tracking-wider"
                        >
                          BINANCE Supplier Account
                        </label>
                        <input
                          id="binance-supplier"
                          type="text"
                          value={binanceSupplier}
                          onChange={(e) => setBinanceSupplier(e.target.value)}
                          className="w-full bg-slate-900 border border-purple-500/30 rounded-lg px-3 py-2 text-white"
                          placeholder="e.g., BINANCE-Main"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="binance-fee"
                          className="block text-xs text-purple-300 mb-1.5 uppercase tracking-wider"
                        >
                          BINANCE Fee (charged to customer)
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-300 font-bold">
                            $
                          </span>
                          <input
                            id="binance-fee"
                            type="number"
                            value={omtFee}
                            onChange={(e) => setOmtFee(e.target.value)}
                            className="w-full bg-slate-900 border border-purple-500/30 rounded-lg pl-8 pr-4 py-2 text-purple-300 font-mono focus:outline-none focus:border-purple-500"
                            placeholder="0.00"
                            step="0.01"
                          />
                        </div>
                        <p className="text-xs text-purple-300/70 mt-1">
                          This fee will be added to the transaction and tracked
                          in supplier ledger
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Footer: Submit */}
            <div className="p-3 border-t border-slate-700/40 bg-slate-900/20 mt-auto">
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className={`w-full py-3.5 rounded-xl font-bold text-base shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${
                  isSubmitting
                    ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                    : provider === "OMT"
                      ? "bg-[#ffde00] hover:bg-[#ffe933] text-black shadow-[#ffde00]/20"
                      : "bg-[#ff0a46] hover:bg-[#ff2d5e] text-white shadow-[#ff0a46]/20"
                }`}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Processing…
                  </>
                ) : (
                  <>
                    {(() => {
                      const Icon = SERVICE_TYPE_ICONS[serviceType];
                      return <Icon size={18} />;
                    })()}
                    Record {SERVICE_TYPE_LABELS[serviceType]}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* History Modal — full-screen overlay, checkout-modal style */}
      {showHistory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setShowHistory(false)}
        >
          <div
            className="relative w-full max-w-5xl max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <History className="text-slate-400" size={18} />
                Transaction History
                <span className="text-xs text-slate-500 font-normal ml-1">
                  ({transactions.length} records)
                </span>
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadData}
                  className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  title="Refresh"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={() => setShowHistory(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <DataTable<Transaction>
                columns={[
                  {
                    header: "Provider",
                    className: "px-6 py-3",
                    sortKey: "provider",
                  },
                  {
                    header: "Type",
                    className: "px-6 py-3",
                    sortKey: "service_type",
                  },
                  {
                    header: "Amount",
                    className: "px-6 py-3",
                    sortKey: "amount",
                  },
                  { header: "Fee", className: "px-6 py-3", sortKey: "omt_fee" },
                  {
                    header: "Profit",
                    className: "px-6 py-3",
                    sortKey: "commission",
                  },
                  {
                    header: "Status",
                    className: "px-6 py-3",
                    sortKey: "is_settled",
                  },
                  {
                    header: "Client / Phone",
                    className: "px-6 py-3",
                    sortKey: "client_name",
                  },
                  {
                    header: "Time",
                    className: "px-6 py-3",
                    sortKey: "created_at",
                  },
                ]}
                data={transactions}
                exportExcel
                exportPdf
                exportFilename="services-history"
                className="w-full"
                theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
                tbodyClassName="divide-y divide-slate-700/50"
                emptyMessage="No transactions yet today."
                renderRow={(tx) => {
                  const Icon = SERVICE_TYPE_ICONS[tx.service_type];
                  const omtLabel = tx.omt_service_type
                    ? OMT_SERVICE_OPTIONS.find(
                        (o) => o.value === tx.omt_service_type,
                      )?.label
                    : null;
                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-slate-700/20 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PROVIDER_BADGE_COLORS[tx.provider]}`}
                        >
                          {tx.provider}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-slate-300">
                          <Icon size={14} />
                          <span className="text-sm">
                            {SERVICE_TYPE_LABELS[tx.service_type]}
                          </span>
                        </div>
                        {omtLabel && (
                          <div className="text-xs text-slate-500 mt-0.5">
                            {omtLabel}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-white">
                        {formatAmount(tx.amount, tx.currency)}
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-amber-400">
                        {(() => {
                          const fee =
                            tx.provider === "WHISH" ? tx.whish_fee : tx.omt_fee;
                          return fee != null && fee > 0 ? (
                            `$${fee.toFixed(2)}`
                          ) : (
                            <span className="text-slate-600">—</span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-emerald-400 font-mono">
                        ${tx.commission.toFixed(4)}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {tx.service_type === "RECEIVE" && tx.commission > 0 ? (
                          tx.is_settled ? (
                            <span className="text-xs font-medium text-emerald-400">
                              Settled
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-amber-400">
                              Profit Pending
                            </span>
                          )
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-300">
                        {tx.client_name || "-"}
                        {tx.phone_number && (
                          <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                            <Phone size={10} />
                            {tx.phone_number}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-400">
                        {new Date(tx.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        <div className="text-xs text-slate-500">
                          {new Date(tx.created_at).toLocaleDateString()}
                        </div>
                      </td>
                    </tr>
                  );
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
