import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  startTransition,
} from "react";
import logger from "@/utils/logger";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { useApi } from "@liratek/ui";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useSessionAutoFill } from "@/features/sessions/hooks/useSessionAutoFill";
import { useSellRate } from "@/hooks/useSellRate";
import type { PaymentLine } from "@liratek/ui";
import { toCamelLegs } from "@/utils/paymentUtils";
import {
  useMobileServiceItems,
  type ProviderKey,
} from "../../hooks/useMobileServiceItems";
import { ensureRechargeClient } from "../../utils/ensureClient";
import {
  CompactStats,
  FinancialForm,
  KatchForm,
  TelecomForm,
  CryptoForm,
  ProviderTabs,
  OmtWhishAppTransferForm,
} from "../../components";
import { TopUpModal, ServiceTypeTabs } from "@liratek/ui";
import { PartnerSelector } from "@/features/partners/components/PartnerSelector";
import type {
  AnyProvider,
  ProviderConfig,
  FinancialTransaction,
  BinanceTransaction,
  RechargeType,
  ServiceType,
  ProviderAnalytics,
} from "../../types";
import { PROVIDER_CONFIGS } from "../../types";
export default function MobileRecharge() {
  const api = useApi();
  const { formatAmount } = useCurrencyContext();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { methods } = usePaymentMethods();
  const {
    activeSession,
    linkTransaction,
    addToCart: addToSessionCart,
  } = useSession();
  const {
    getCategoriesForProvider,
    getItems: getServiceItems,
    refresh: refreshItems,
  } = useMobileServiceItems();

  const [activeProvider, setActiveProvider] = useState<AnyProvider>(
    PROVIDER_CONFIGS[0].key,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Selected-item counts per provider, reported by the mounted cart form and
  // rendered as a count pill on the provider tabs.
  const [tabCartCounts, setTabCartCounts] = useState<Record<string, number>>(
    {},
  );

  const [finTransactions, setFinTransactions] = useState<
    FinancialTransaction[]
  >([]);
  const [binanceTransactions, setBinanceTransactions] = useState<
    BinanceTransaction[]
  >([]);
  const [finAnalytics, setFinAnalytics] = useState<ProviderAnalytics>({
    today: { commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  });
  const [binanceStats, setBinanceStats] = useState({
    totalSent: 0,
    totalReceived: 0,
    count: 0,
  });

  const [serviceType, setServiceType] = useState<ServiceType>("SEND");
  const [clientName, setClientName] = useState("");

  const [rechargeType, setRechargeType] =
    useState<RechargeType>("CREDIT_TRANSFER");
  const [telecomAmount, setTelecomAmount] = useState("");
  const [telecomPrice, setTelecomPrice] = useState("");
  const [telecomDaysCostUsd, setTelecomDaysCostUsd] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [paidBy, setPaidBy] = useState("CASH");
  const [showClientSearch, setShowClientSearch] = useState(false);
  const [telecomClientId, setTelecomClientId] = useState<number | null>(null);
  const [telecomClientName, setTelecomClientName] = useState("");
  const [telecomClientPhone, setTelecomClientPhone] = useState("");
  const [clientSearchResults, setClientSearchResults] = useState<any[]>([]);
  const [telecomTransactionTime, setTelecomTransactionTime] = useState<
    string | undefined
  >();
  const [giftTierKey, setGiftTierKey] = useState<
    keyof typeof import("../../types").ALFA_GIFT_TIERS | ""
  >("");
  const [giftAmountUsd, setGiftAmountUsd] = useState("");
  const [giftPriceLbp, setGiftPriceLbp] = useState("");
  const [giftCostLbp, setGiftCostLbp] = useState("");
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [returnLegs, setReturnLegs] = useState<PaymentLine[]>([]);
  // T3 keep-change (telecom flow): kept change → recharge profit stamp.
  const [keptChange, setKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);

  const [cryptoType, setCryptoType] = useState<"SEND" | "RECEIVE">("SEND");
  const [cryptoFeeIncluded, setCryptoFeeIncluded] = useState(false);
  const [cryptoAmount, setCryptoAmount] = useState("");
  const [cryptoClientName, setCryptoClientName] = useState("");
  const [cryptoClientPhone, setCryptoClientPhone] = useState("");
  const [cryptoClientId, setCryptoClientId] = useState<number | null>(null);
  const [cryptoDescription, setCryptoDescription] = useState("");
  const [cryptoFee, setCryptoFee] = useState("");
  const [cryptoPaymentLines, setCryptoPaymentLines] = useState<PaymentLine[]>(
    [],
  );
  const [cryptoReturnLegs, setCryptoReturnLegs] = useState<PaymentLine[]>([]);
  // T3 keep-change (crypto flow): kept change → profit stamp.
  const [cryptoKeptChange, setCryptoKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  const [cryptoPaidBy, setCryptoPaidBy] = useState("CASH");
  const [cryptoTransactionTime, setCryptoTransactionTime] = useState<
    string | undefined
  >();

  const [showHistory, setShowHistory] = useState(false);
  const [rechargeHistory, setRechargeHistory] = useState<
    FinancialTransaction[]
  >([]);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpPartnerId, setTopUpPartnerId] = useState<number | null>(null);
  const [drawerBalances, setDrawerBalances] = useState<
    Array<{
      name: string;
      usdBalance: number;
      lbpBalance: number;
      usdtBalance: number;
    }>
  >([]);
  const [topUpData, setTopUpData] = useState<{
    provider: "MTC" | "Alfa" | "OMT_APP" | "WHISH_APP" | "iPick" | "Katsh";
    destinationDrawer: string;
    defaultSourceDrawer: string;
    availableDrawers: Array<{
      name: string;
      usdBalance: number;
      lbpBalance: number;
    }>;
  } | null>(null);

  // Alfa credit sell rate for "Only Days" returned credits calculation
  const [alfaCreditSellRate, setAlfaCreditSellRate] = useState(100000);
  const [alfaCreditCostRate, setAlfaCreditCostRate] = useState(85000);
  const [marginAlertThreshold, setMarginAlertThreshold] = useState(100000);
  // Payments use the BUY rate (owner decision 2026-07-06) for MultiPaymentInput
  // / cart conversions — also forwarded to KatchForm (Katsh/iPick).
  const { buyRate: exchangeRate } = useSellRate();

  // Whish App mode: 'bills' (card grid) or 'transfer' (send/receive money)
  const [whishAppMode, setWhishAppMode] = useState<"bills" | "transfer">(
    "transfer",
  );

  // Autofill client name from active customer session, clear when session closes
  useSessionAutoFill([
    { select: (s) => s.customer_name, set: setClientName, clearValue: "" },
    {
      select: (s) => s.customer_name,
      set: setTelecomClientName,
      clearValue: "",
    },
    {
      select: (s) => s.customer_phone,
      set: setTelecomClientPhone,
      clearValue: "",
    },
    {
      select: (s) => s.customer_name,
      set: setCryptoClientName,
      clearValue: "",
    },
    { select: () => undefined, set: setTelecomClientId, clearValue: null },
  ]);

  useEffect(() => {
    const loadRate = async () => {
      try {
        const settings = await api.getAllSettings();
        const settingsMap = new Map(
          settings.map((s: { key_name: string; value: string }) => [
            s.key_name,
            s.value,
          ]),
        );
        const rate =
          Number(settingsMap.get("alfa_credit_sell_rate_lbp")) || 100000;
        setAlfaCreditSellRate(rate);
        const costRate =
          Number(settingsMap.get("alfa_credit_cost_rate_lbp")) || 85000;
        setAlfaCreditCostRate(costRate);

        const threshold =
          Number(settingsMap.get("recharge_margin_alert_threshold")) || 100000;
        setMarginAlertThreshold(threshold);
      } catch (error) {
        logger.error("Failed to load alfa credit sell rate:", error);
      }
    };
    loadRate();
  }, [api]);

  // Reset form state when provider changes
  useEffect(() => {
    // Always reset to "transfer" so returning to WHISH_APP renders the correct
    // form on the first paint (prevents FinancialForm mount→unmount flash).
    setWhishAppMode("transfer");
    setRechargeType("CREDIT_TRANSFER");
    setTelecomDaysCostUsd("");
    setFinAnalytics({
      today: { commission: 0, count: 0, byCurrency: [] },
      byProvider: [],
    });
    setFinTransactions([]);
  }, [activeProvider]);

  const activeConfig = useMemo(
    () =>
      PROVIDER_CONFIGS.find((p: ProviderConfig) => p.key === activeProvider),
    [activeProvider],
  );

  const loadFinancialData = useCallback(async () => {
    if (!activeProvider) return;
    try {
      const [transactions, analytics] = await Promise.all([
        api.getOMTHistory(activeProvider),
        api.getOMTAnalytics([activeProvider]),
      ]);
      setFinTransactions(transactions ?? []);
      setFinAnalytics(
        analytics ?? {
          today: { commission: 0, count: 0, byCurrency: [] },
          byProvider: [],
        },
      );
    } catch (err) {
      logger.error("Failed to load financial data:", err);
    }
  }, [activeProvider, api]);

  const loadBinanceData = useCallback(async () => {
    try {
      const history = await api.getOMTHistory("BINANCE");
      setBinanceTransactions(
        (history ?? []).map((tx: any) => ({
          id: tx.id,
          type: tx.service_type as "SEND" | "RECEIVE",
          amount: tx.amount,
          currency_code: tx.currency,
          description: tx.note || null,
          client_name: tx.client_name || null,
          commission: tx.commission ?? 0,
          paid_by: tx.paid_by || null,
          created_at: tx.created_at,
        })),
      );

      const today = new Date().toDateString();
      const todayTx = (history ?? []).filter(
        (tx: any) => parseDbDate(tx.created_at).toDateString() === today,
      );
      setBinanceStats({
        totalSent: todayTx
          .filter((tx: any) => tx.service_type === "SEND")
          .reduce((sum: number, tx: any) => sum + tx.amount, 0),
        totalReceived: todayTx
          .filter((tx: any) => tx.service_type === "RECEIVE")
          .reduce((sum: number, tx: any) => sum + tx.amount, 0),
        count: todayTx.length,
      });
    } catch (err) {
      logger.error("Failed to load binance data:", err);
    }
  }, [api]);

  const loadDrawerBalances = useCallback(async () => {
    // Drawer balances are IPC-only (no REST route yet) — skip in web mode
    if (!window.api?.recharge) return;
    try {
      const drawers = await window.api.recharge.getDrawerBalances();
      setDrawerBalances(drawers ?? []);
    } catch (error) {
      logger.error("Failed to load drawer balances:", error);
    }
  }, []);

  const activeDrawerBalance = useMemo(() => {
    if (!activeConfig) return undefined;
    const drawer = drawerBalances.find((d) => d.name === activeConfig.drawer);
    return drawer
      ? {
          usdBalance: drawer.usdBalance,
          lbpBalance: drawer.lbpBalance,
          usdtBalance: drawer.usdtBalance,
        }
      : undefined;
  }, [activeConfig, drawerBalances]);

  useEffect(() => {
    if (activeProvider) {
      const config = PROVIDER_CONFIGS.find(
        (p: ProviderConfig) => p.key === activeProvider,
      );
      if (config?.formMode === "crypto") {
        loadBinanceData();
      } else if (config?.formMode === "financial") {
        loadFinancialData();
      }
    }
  }, [activeProvider, loadFinancialData, loadBinanceData]);

  // Load drawer balances on mount and when provider changes
  useEffect(() => {
    loadDrawerBalances();
  }, [activeProvider, loadDrawerBalances]);

  const searchClients = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        setClientSearchResults([]);
        return;
      }
      try {
        const results = await api.getClients(query);
        setClientSearchResults(results ?? []);
      } catch (err) {
        logger.error("Failed to search clients:", err);
      }
    },
    [api],
  );

  const selectClient = useCallback((client: any) => {
    setTelecomClientId(client.id);
    setTelecomClientName(client.full_name || client.name || "");
    setTelecomClientPhone(client.phone_number || "");
    setClientSearchResults([]);
    setShowClientSearch(false);
  }, []);

  const handleTelecomSubmit = useCallback(async () => {
    if (!activeProvider || !telecomAmount) return;
    if (
      rechargeType === "DAYS" &&
      (!(parseFloat(telecomDaysCostUsd) > 0) || !telecomPrice)
    )
      return;

    const amount = parseFloat(telecomAmount);
    const price =
      rechargeType === "DAYS"
        ? parseFloat(telecomPrice) || 0
        : parseFloat(telecomPrice) || amount * alfaCreditSellRate;
    const cost =
      rechargeType === "DAYS"
        ? parseFloat(telecomDaysCostUsd) * (alfaCreditCostRate || 85000)
        : amount * (alfaCreditCostRate || 85000);
    const defaultPriceToClient = amount * alfaCreditSellRate;

    const clientResult = await ensureRechargeClient({
      clientId: telecomClientId,
      name: telecomClientName,
      phone: telecomClientPhone,
      paymentLines,
    });
    if (!clientResult.ok) {
      alert(clientResult.error);
      return;
    }
    const resolvedClientId = clientResult.id;
    if (resolvedClientId && resolvedClientId !== telecomClientId) {
      setTelecomClientId(resolvedClientId);
    }

    // If session is active, add to cart instead of submitting
    if (activeSession) {
      const providerLabel = activeProvider === "MTC" ? "MTC" : "Alfa";
      const typeLabel =
        rechargeType === "CREDIT_TRANSFER"
          ? "Recharge"
          : rechargeType.replace(/_/g, " ");
      const label = phoneNumber
        ? `${providerLabel} ${typeLabel} - ${phoneNumber} - ${price.toLocaleString()} LBP`
        : `${providerLabel} ${typeLabel} - ${price.toLocaleString()} LBP`;

      // Session mode: the basket owns the payment, so the cart item carries NO
      // payment fields (paid_by_method / payments). The Session Checkout modal
      // collects payment once for the whole basket.
      addToSessionCart({
        module: activeProvider === "MTC" ? "recharge_mtc" : "recharge_alfa",
        label,
        amount: price,
        currency: "LBP",
        ipcChannel: "recharge:process",
        formData: {
          provider: activeProvider,
          type: rechargeType,
          phoneNumber:
            rechargeType === "CREDIT_TRANSFER" ? phoneNumber : undefined,
          amount,
          cost,
          price,
          default_price_to_client: defaultPriceToClient,
          currency: "LBP",
          clientId: resolvedClientId || undefined,
          clientName: telecomClientName || undefined,
        },
      });

      // Reset form
      setTelecomAmount("");
      setTelecomPrice("");
      setTelecomDaysCostUsd("");
      setPhoneNumber("");
      setTelecomClientPhone("");
      setReturnLegs([]);
      setKeptChange(null);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.processRecharge({
        provider: activeProvider,
        type: rechargeType,
        phoneNumber:
          rechargeType === "CREDIT_TRANSFER" ? phoneNumber : undefined,
        amount,
        cost,
        price,
        default_price_to_client: defaultPriceToClient,
        currency: "LBP",
        paid_by_method: paidBy,
        payments:
          paymentLines.length > 0
            ? toCamelLegs(paymentLines, returnLegs)
            : undefined,
        clientId: resolvedClientId || undefined,
        clientName: telecomClientName || undefined,
        // T3 keep-change: kept amounts join the recharge profit stamp.
        ...(keptChange && (keptChange.usd > 0 || keptChange.lbp > 0)
          ? {
              kept_change_usd: keptChange.usd,
              kept_change_lbp: keptChange.lbp,
            }
          : {}),
        transaction_time: telecomTransactionTime,
      });
      if (result && !result.success) {
        alert(result.error || "Failed to process recharge");
        return;
      }

      // Link to active customer session
      if (activeSession && result?.id) {
        try {
          await linkTransaction({
            transactionType: "recharge",
            transactionId: result.id,
            amountUsd: 0,
            amountLbp: price,
            profitLbp: price - cost,
          });
        } catch (err) {
          logger.error("Failed to link recharge to session:", err);
        }
      }

      setTelecomAmount("");
      setTelecomPrice("");
      setTelecomDaysCostUsd("");
      setPhoneNumber("");
      setTelecomClientPhone("");
      setReturnLegs([]);
      setKeptChange(null);
      setTelecomTransactionTime(undefined);
      loadFinancialData();
      loadDrawerBalances();
    } catch (err) {
      logger.error("Failed to submit telecom recharge:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    activeProvider,
    telecomAmount,
    telecomPrice,
    telecomDaysCostUsd,
    rechargeType,
    phoneNumber,
    paidBy,
    paymentLines,
    returnLegs,
    telecomClientId,
    telecomClientName,
    telecomClientPhone,
    alfaCreditSellRate,
    alfaCreditCostRate,
    api,
    loadFinancialData,
    activeSession,
    linkTransaction,
    loadDrawerBalances,
    telecomTransactionTime,
  ]);

  const loadRechargeHistory = useCallback(async () => {
    if (!activeProvider || !["MTC", "Alfa"].includes(activeProvider)) return;
    try {
      const history = await window.api.recharge.getHistory(
        activeProvider as "MTC" | "Alfa",
      );
      setRechargeHistory(
        (history ?? []).map(
          (r: any): FinancialTransaction => ({
            id: r.id,
            provider: r.carrier,
            service_type: "SEND",
            amount: r.amount,
            currency: r.currency_code || "USD",
            cost: r.cost,
            commission: r.price - r.cost,
            client_name: r.client_name,
            phone_number: r.phone_number ?? null,
            note: r.note ?? undefined,
            edited_by: r.edited_by ?? null,
            edited_at: r.edited_at ?? null,
            default_price_to_client: r.default_price_to_client ?? null,
            paid_by: r.paid_by ?? undefined,
            reference_number: r.phone_number || undefined,
            created_at: r.created_at,
          }),
        ),
      );
    } catch (error) {
      logger.error("Failed to load recharge history:", error);
      setRechargeHistory([]);
    }
  }, [activeProvider]);

  const handleTopUpClick = useCallback(async () => {
    if (!activeProvider) return;

    // Provider configuration mapping
    const providerConfig: Record<
      string,
      {
        drawer: string;
        defaultSource: string;
        type: "MTC" | "Alfa" | "OMT_APP" | "WHISH_APP" | "iPick" | "Katsh";
      }
    > = {
      MTC: { drawer: "MTC", defaultSource: "General", type: "MTC" },
      Alfa: { drawer: "Alfa", defaultSource: "General", type: "Alfa" },
      OMT_APP: {
        drawer: "OMT_App",
        defaultSource: "OMT_System",
        type: "OMT_APP",
      },
      WHISH_APP: {
        drawer: "Whish_App",
        defaultSource: "General",
        type: "WHISH_APP",
      },
      iPick: { drawer: "iPick", defaultSource: "General", type: "iPick" },
      Katsh: { drawer: "Katsh", defaultSource: "General", type: "Katsh" },
    };

    const config = providerConfig[activeProvider];
    if (!config) return;

    const {
      drawer: destinationDrawer,
      defaultSource: defaultSourceDrawer,
      type: provider,
    } = config;

    try {
      const drawers = await window.api.recharge.getDrawerBalances();
      const availableDrawers = drawers.filter(
        (d) => d.name !== destinationDrawer,
      );

      setTopUpData({
        provider,
        destinationDrawer,
        defaultSourceDrawer,
        availableDrawers,
      });
      setShowTopUpModal(true);
    } catch (error) {
      logger.error("Failed to load drawer balances:", error);
      alert("Failed to load drawer balances");
    }
  }, [activeProvider]);

  const handleTopUpConfirm = useCallback(
    async (data: {
      amount: number;
      currency: "USD" | "LBP";
      sourceDrawer: string;
    }) => {
      if (!topUpData) return;

      const result = await window.api.recharge.topUpApp({
        provider: topUpData.provider,
        amount: data.amount,
        currency: data.currency,
        sourceDrawer: data.sourceDrawer,
      });

      if (!result.success) {
        throw new Error(result.error || "Top-up failed");
      }

      if (activeConfig?.formMode === "financial") {
        loadFinancialData();
      }
      loadDrawerBalances();

      const providerLabels: Record<string, string> = {
        MTC: "MTC",
        Alfa: "Alfa",
        OMT_APP: "OMT App",
        WHISH_APP: "Whish App",
        iPick: "iPick",
        Katsh: "Katsh",
      };

      alert(
        `Successfully topped up ${providerLabels[topUpData.provider] || topUpData.provider} drawer with ${data.amount} ${data.currency}`,
      );
    },
    [topUpData, activeConfig, loadFinancialData, loadDrawerBalances],
  );

  // MTC/Alfa: buy credits from a customer (credits in, cash out of General)
  const handleTopUpConfirmCustomer = useCallback(
    async (data: {
      creditsAmount: number;
      cashPaid: number;
      cashPaidCurrency: "USD" | "LBP";
    }) => {
      if (
        !topUpData ||
        (topUpData.provider !== "MTC" && topUpData.provider !== "Alfa")
      )
        return;

      const result = await window.api.recharge.topUpFromCustomer({
        provider: topUpData.provider,
        creditsAmount: data.creditsAmount,
        cashPaid: data.cashPaid,
        cashPaidCurrency: data.cashPaidCurrency,
      });

      if (!result.success) {
        throw new Error(result.error || "Top-up failed");
      }

      loadDrawerBalances();

      const cashDisplay =
        data.cashPaidCurrency === "LBP"
          ? `${data.cashPaid.toLocaleString()} LBP`
          : `$${data.cashPaid.toFixed(2)}`;
      alert(
        `Successfully topped up ${topUpData.provider} drawer with ${data.creditsAmount} USD credits (paid ${cashDisplay} cash)`,
      );
    },
    [topUpData, loadDrawerBalances],
  );

  // Katsh/iPick: supplier extends credit — no cash leaves any drawer
  const handleTopUpConfirmSupplier = useCallback(
    async (data: { amount: number; currency: "USD" | "LBP" }) => {
      if (
        !topUpData ||
        (topUpData.provider !== "iPick" && topUpData.provider !== "Katsh")
      )
        return;

      const result = await window.api.recharge.topUpFromSupplier({
        provider: topUpData.provider as "iPick" | "Katsh",
        amount: data.amount,
        currency: data.currency,
      });

      if (!result.success) {
        throw new Error(result.error || "Top-up failed");
      }

      loadFinancialData();
      loadDrawerBalances();

      alert(
        `Successfully topped up ${topUpData.provider} via supplier credit: ${data.amount} ${data.currency}`,
      );
    },
    [topUpData, loadFinancialData, loadDrawerBalances],
  );

  // Whish App: top up from a partner's credit line
  const handleTopUpConfirmPartner = useCallback(
    async (data: {
      partnerId: number;
      amount: number;
      currency: "USD" | "LBP";
    }) => {
      const result = await window.api.recharge.topUpFromPartner({
        provider: "WHISH_APP",
        partnerId: data.partnerId,
        amount: data.amount,
        currency: data.currency,
      });
      if (!result.success) {
        throw new Error(result.error || "Top-up failed");
      }
      loadFinancialData();
      loadDrawerBalances();
      alert(`Whish App topped up via partner: ${data.amount} ${data.currency}`);
    },
    [loadFinancialData, loadDrawerBalances],
  );

  // Whish App: buy credits from a client (client transfers credits, shop pays cash)
  const handleTopUpConfirmClient = useCallback(
    async (data: {
      amount: number;
      cashPaid: number;
      currency: "USD" | "LBP";
      clientName?: string;
    }) => {
      const result = await window.api.recharge.topUpFromClient(data);
      if (!result.success) {
        throw new Error(result.error || "Top-up failed");
      }
      loadFinancialData();
      loadDrawerBalances();
      alert(
        `Whish App topped up from client: +${data.amount} ${data.currency}`,
      );
    },
    [loadFinancialData, loadDrawerBalances],
  );

  const resetGiftForm = useCallback(() => {
    setGiftTierKey("");
    setGiftAmountUsd("");
    setGiftPriceLbp("");
    setGiftCostLbp("");
    setTelecomClientName("");
    setTelecomClientPhone("");
    setTelecomClientId(null);
    setPaymentLines([]);
    setReturnLegs([]);
    setTelecomTransactionTime(undefined);
  }, []);

  const handleAlfaGiftSubmit = useCallback(async () => {
    if (!giftTierKey) return;

    // amount = USD face value of the tier; price/cost are in LBP. These mirror
    // the RechargeData shape (type/amount/cost/price) the `recharge:process`
    // handler validates — the previous payload (rechargeType/giftTier/amountUsd/
    // priceLbp) silently failed Zod validation, so no gift sale was ever
    // recorded. Cost is propagated from the selected card so the recorded margin
    // matches what the operator saw.
    const amount = parseFloat(giftAmountUsd);
    const price = parseFloat(giftPriceLbp);
    const cost = parseFloat(giftCostLbp);

    const clientResult = await ensureRechargeClient({
      clientId: telecomClientId,
      name: telecomClientName,
      phone: telecomClientPhone,
      paymentLines,
    });
    if (!clientResult.ok) {
      alert(clientResult.error);
      return;
    }
    const resolvedClientId = clientResult.id;
    if (resolvedClientId && resolvedClientId !== telecomClientId) {
      setTelecomClientId(resolvedClientId);
    }

    // If a customer session is active, defer into the session basket instead of
    // submitting directly (the basket owns the single payment at checkout, so no
    // payment fields are attached here).
    if (activeSession) {
      addToSessionCart({
        module: "recharge_alfa",
        label: `Alfa Gift ${giftTierKey} - ${price.toLocaleString()} LBP`,
        amount: price,
        currency: "LBP",
        ipcChannel: "recharge:process",
        formData: {
          provider: "Alfa",
          type: "ALFA_GIFT",
          amount,
          cost,
          price,
          currency: "LBP",
          clientId: resolvedClientId || undefined,
          clientName: telecomClientName || undefined,
        },
      });
      resetGiftForm();
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.processRecharge({
        provider: "Alfa",
        type: "ALFA_GIFT",
        amount,
        cost,
        price,
        currency: "LBP",
        paid_by_method: paidBy,
        payments:
          paymentLines.length > 0
            ? toCamelLegs(paymentLines, returnLegs)
            : undefined,
        clientId: resolvedClientId || undefined,
        clientName: telecomClientName || undefined,
        transaction_time: telecomTransactionTime,
      });
      if (result && !result.success) {
        alert(result.error || "Failed to process Alfa gift");
        return;
      }
      resetGiftForm();
      loadFinancialData();
      loadDrawerBalances();
    } catch (err) {
      logger.error("Failed to submit alfa gift:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    giftTierKey,
    giftAmountUsd,
    giftPriceLbp,
    giftCostLbp,
    activeSession,
    addToSessionCart,
    paidBy,
    paymentLines,
    returnLegs,
    telecomClientId,
    telecomClientName,
    telecomClientPhone,
    api,
    loadFinancialData,
    loadDrawerBalances,
    telecomTransactionTime,
    resetGiftForm,
  ]);

  const handleCryptoSubmit = useCallback(async () => {
    const fee = parseFloat(cryptoFee) || 0;
    const rawAmount = parseFloat(cryptoAmount);
    // fee included → the entered amount already contains the fee
    // SEND:    feeIncluded → USDT sent = amount - fee;  !feeIncluded → USDT sent = amount
    // RECEIVE: feeIncluded → USDT received = amount;    !feeIncluded → USDT received = amount + fee
    let amount: number;
    if (cryptoType === "SEND" && cryptoFeeIncluded) {
      amount = rawAmount - fee;
    } else if (cryptoType === "RECEIVE" && !cryptoFeeIncluded) {
      amount = rawAmount + fee;
    } else {
      amount = rawAmount;
    }
    const isSplitPayment = cryptoPaymentLines.length > 1;
    const paidByMethod =
      cryptoPaymentLines.length === 1
        ? cryptoPaymentLines[0].method
        : cryptoPaidBy;

    // Send the structured legs whenever the payment is split OR the customer got
    // change back (a return/OUT leg). Gating on isSplitPayment alone silently
    // dropped the OUT leg for a single payment + change, so the returned cash
    // never reached the ledger (e.g. Binance SEND: paid $100, got 180,000 LBP).
    const useCryptoStructuredPayments =
      isSplitPayment || cryptoReturnLegs.length > 0;

    // Derive cashout method from payment lines: if DEBT is used, it means Customer Account
    const derivedCashoutMethod =
      paidByMethod === "CUSTOMER_ACCOUNT" ? "CUSTOMER_ACCOUNT" : "CASH";

    const clientResult = await ensureRechargeClient({
      clientId: cryptoClientId,
      name: cryptoClientName,
      phone: cryptoClientPhone,
      paymentLines: cryptoPaymentLines,
    });
    if (!clientResult.ok) {
      alert(clientResult.error);
      return;
    }
    const resolvedCryptoClientId = clientResult.id;
    if (resolvedCryptoClientId && resolvedCryptoClientId !== cryptoClientId) {
      setCryptoClientId(resolvedCryptoClientId);
    }

    // If session is active, add to cart instead of submitting
    if (activeSession) {
      const isSend = cryptoType === "SEND";
      const label = `Binance ${isSend ? "Send" : "Cash Out"} - ${amount} USDT${cryptoClientName ? ` - ${cryptoClientName}` : ""}`;

      // Session mode: the basket owns the payment, so the cart item carries NO
      // payment fields (paidByMethod / payments / cashoutMethod). The Session
      // Checkout modal collects payment once for the whole basket and derives
      // the cashout method from the chosen basket payment method.
      //
      // The cart amount is the customer's CASH side in USD (SEND: what they
      // pay; RECEIVE: −what they're paid) so it joins the pooled USD bucket —
      // it NETS against purchases and, when the basket nets negative, the
      // checkout emits the net cash-OUT leg (loto-prize pattern). The USDT is
      // the service (label + formData); the wallet movement books at replay.
      addToSessionCart({
        module: isSend ? "binance_send" : "binance_receive",
        label,
        amount: isSend ? amount + fee : -(amount - fee),
        currency: "USD",
        ipcChannel: "financial:create",
        formData: {
          provider: "BINANCE",
          serviceType: cryptoType,
          amount,
          currency: "USDT",
          clientId: resolvedCryptoClientId || undefined,
          clientName: cryptoClientName,
          referenceNumber: cryptoDescription,
          commission: fee,
        },
      });

      // Reset form
      setCryptoAmount("");
      setCryptoClientName("");
      setCryptoClientPhone("");
      setCryptoClientId(null);
      setCryptoDescription("");
      setCryptoFee("");
      setCryptoFeeIncluded(false);
      setCryptoPaymentLines([]);
      setCryptoReturnLegs([]);
      setCryptoKeptChange(null);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.addOMTTransaction({
        provider: "BINANCE",
        serviceType: cryptoType,
        amount: parseFloat(cryptoAmount),
        currency: "USDT",
        clientId: resolvedCryptoClientId || undefined,
        clientName: cryptoClientName,
        referenceNumber: cryptoDescription,
        commission: fee,
        paidByMethod: isSplitPayment ? "MULTI" : paidByMethod,
        payments: useCryptoStructuredPayments
          ? toCamelLegs(cryptoPaymentLines, cryptoReturnLegs)
          : undefined,
        ...(cryptoType === "RECEIVE" && derivedCashoutMethod !== "CASH"
          ? { cashoutMethod: derivedCashoutMethod }
          : {}),
        // T3 keep-change: kept amounts join the profit stamp.
        ...(cryptoKeptChange &&
        (cryptoKeptChange.usd > 0 || cryptoKeptChange.lbp > 0)
          ? {
              kept_change_usd: cryptoKeptChange.usd,
              kept_change_lbp: cryptoKeptChange.lbp,
            }
          : {}),
        transaction_time: cryptoTransactionTime,
      });

      // Link to active customer session
      if (activeSession && result?.id) {
        try {
          await linkTransaction({
            transactionType: "financial_service",
            transactionId: result.id,
            amountUsd:
              cryptoType === "SEND"
                ? (parseFloat(cryptoAmount) || 0) + fee
                : (parseFloat(cryptoAmount) || 0) - fee,
            amountLbp: 0,
            profitUsd: fee,
          });
        } catch (err) {
          logger.error("Failed to link crypto transaction to session:", err);
        }
      }

      setCryptoAmount("");
      setCryptoClientName("");
      setCryptoClientPhone("");
      setCryptoClientId(null);
      setCryptoDescription("");
      setCryptoFee("");
      setCryptoFeeIncluded(false);
      setCryptoPaymentLines([]);
      setCryptoReturnLegs([]);
      setCryptoKeptChange(null);
      setCryptoTransactionTime(undefined);
      loadBinanceData();
      loadDrawerBalances();
    } catch (err) {
      logger.error("Failed to submit crypto transaction:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    cryptoType,
    cryptoAmount,
    cryptoFeeIncluded,
    cryptoClientName,
    cryptoClientPhone,
    cryptoClientId,
    cryptoDescription,
    cryptoFee,
    cryptoPaymentLines,
    cryptoReturnLegs,
    cryptoPaidBy,
    cryptoTransactionTime,
    api,
    loadBinanceData,
    activeSession,
    linkTransaction,
    addToSessionCart,
    loadDrawerBalances,
  ]);

  const handleQuickAmount = useCallback(
    (val: number) => {
      setTelecomAmount(val.toString());
      if (rechargeType === "DAYS") {
        setTelecomDaysCostUsd(((val / 10) * 0.3).toFixed(2));
      } else {
        setTelecomPrice((val * alfaCreditSellRate).toString());
      }
    },
    [alfaCreditSellRate, rechargeType],
  );

  // Typing in the Amount field should re-derive the suggested client price the
  // same way Quick Amount does, so the two stay in sync. The price field stays
  // editable afterwards for custom overrides.
  const handleTelecomAmountChange = useCallback(
    (val: string) => {
      setTelecomAmount(val);
      if (rechargeType === "DAYS") {
        const days = parseFloat(val);
        setTelecomDaysCostUsd(days > 0 ? ((days / 10) * 0.3).toFixed(2) : "");
      } else {
        const num = parseFloat(val);
        setTelecomPrice(num > 0 ? (num * alfaCreditSellRate).toString() : "");
      }
    },
    [alfaCreditSellRate, rechargeType],
  );

  const isMTC = activeProvider === "MTC";

  const getTelecomStats = useCallback(() => {
    const providerTx = finTransactions.filter(
      (tx) => tx.provider === activeProvider,
    );
    const today = new Date().toDateString();
    const todayTx = providerTx.filter(
      (tx) => parseDbDate(tx.created_at).toDateString() === today,
    );
    // Group commissions by currency
    const currencyMap = new Map<string, number>();
    for (const tx of todayTx) {
      const currency = tx.currency ?? "USD";
      currencyMap.set(
        currency,
        (currencyMap.get(currency) ?? 0) + tx.commission,
      );
    }
    const byCurrency = Array.from(currencyMap.entries()).map(
      ([currency, commission]) => ({
        currency,
        commission,
        count: todayTx.filter((tx) => (tx.currency ?? "USD") === currency)
          .length,
      }),
    );
    return {
      commission: todayTx.reduce((sum, tx) => sum + tx.commission, 0),
      count: todayTx.length,
      byCurrency,
    };
  }, [finTransactions, activeProvider]);

  const telecomStats = getTelecomStats();

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 flex flex-col overflow-hidden animate-in fade-in duration-500">
      {/* Header — two zones: provider controls (left) vs. read-only metrics + actions (right) */}
      <div className="flex items-start justify-between gap-4 mb-3">
        {/* Left zone: provider selection (the controls) */}
        <ProviderTabs
          providers={PROVIDER_CONFIGS}
          activeProvider={activeProvider}
          onSelectProvider={(p) => {
            startTransition(() => setActiveProvider(p));
          }}
          cartCounts={tabCartCounts}
        />

        {/* Right zone: today's metrics, then a divider, then actions */}
        {activeConfig && (
          <div className="flex shrink-0 items-center gap-3">
            <CompactStats
              activeConfig={activeConfig}
              todayCommission={telecomStats.commission}
              todayCount={telecomStats.count}
              todayByCurrency={telecomStats.byCurrency}
              allProvidersCommission={
                activeConfig.formMode !== "crypto"
                  ? finAnalytics.today.commission
                  : undefined
              }
              allProvidersByCurrency={
                activeConfig.formMode !== "crypto"
                  ? finAnalytics.today.byCurrency
                  : undefined
              }
              cryptoOutToday={binanceStats.totalSent}
              cryptoInToday={binanceStats.totalReceived}
              showCryptoStats={activeConfig.formMode === "crypto"}
              isAdmin={isAdmin}
              drawerBalance={activeDrawerBalance}
            />

            <div className="h-9 w-px bg-slate-700/60" />

            <div className="flex items-center gap-2">
              {(activeConfig.formMode === "financial" ||
                activeConfig.formMode === "crypto" ||
                activeConfig.formMode === "telecom") && (
                <button
                  onClick={async () => {
                    if (activeConfig?.formMode === "telecom") {
                      await loadRechargeHistory();
                    }
                    setShowHistory(true);
                  }}
                  className="h-11 px-4 inline-flex items-center rounded-lg font-medium text-sm bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all"
                >
                  History
                </button>
              )}

              {(activeConfig.key === "MTC" ||
                activeConfig.key === "Alfa" ||
                activeConfig.key === "OMT_APP" ||
                activeConfig.key === "WHISH_APP" ||
                activeConfig.key === "iPick" ||
                activeConfig.key === "Katsh") && (
                <button
                  onClick={handleTopUpClick}
                  className="h-11 px-4 inline-flex items-center rounded-lg font-medium text-sm bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all"
                >
                  Top-Up
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Scrollable content area — pt/px give the sticky search bar's focus
          ring room to render; flush against the clip edge otherwise cuts
          off its top/left border. */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-1 px-1">
        {activeConfig?.formMode === "telecom" && (
          <TelecomForm
            isMTC={isMTC}
            rechargeType={rechargeType}
            setRechargeType={(type) => {
              setRechargeType(type);
              setTelecomPrice("");
              setTelecomAmount("");
              setTelecomDaysCostUsd("");
            }}
            isSubmitting={isSubmitting}
            handleQuickAmount={handleQuickAmount}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
            rechargeHistory={rechargeHistory}
            marginAlertThreshold={marginAlertThreshold}
            telecomAmount={telecomAmount}
            setTelecomAmount={setTelecomAmount}
            onTelecomAmountChange={handleTelecomAmountChange}
            telecomPrice={telecomPrice}
            setTelecomPrice={setTelecomPrice}
            phoneNumber={phoneNumber}
            setPhoneNumber={setPhoneNumber}
            paidBy={paidBy}
            setPaidBy={setPaidBy}
            methods={methods}
            showClientSearch={showClientSearch}
            setShowClientSearch={setShowClientSearch}
            telecomClientId={telecomClientId}
            setTelecomClientId={setTelecomClientId}
            telecomClientName={telecomClientName}
            setTelecomClientName={setTelecomClientName}
            telecomClientPhone={telecomClientPhone}
            setTelecomClientPhone={setTelecomClientPhone}
            searchClients={searchClients}
            clientSearchResults={clientSearchResults}
            selectClient={selectClient}
            activeProvider={activeProvider}
            activeConfig={activeConfig}
            handleTelecomSubmit={handleTelecomSubmit}
            onKeptChange={setKeptChange}
            giftTierKey={giftTierKey}
            setGiftTierKey={setGiftTierKey}
            giftAmountUsd={giftAmountUsd}
            setGiftAmountUsd={setGiftAmountUsd}
            giftPriceLbp={giftPriceLbp}
            setGiftPriceLbp={setGiftPriceLbp}
            giftCostLbp={giftCostLbp}
            setGiftCostLbp={setGiftCostLbp}
            handleAlfaGiftSubmit={handleAlfaGiftSubmit}
            paymentLines={paymentLines}
            setPaymentLines={setPaymentLines}
            clientName={clientName}
            setClientName={setClientName}
            alfaCreditCostRate={alfaCreditCostRate}
            telecomDaysCostUsd={telecomDaysCostUsd}
            setTelecomDaysCostUsd={setTelecomDaysCostUsd}
            isAdmin={isAdmin}
            onReturnChange={setReturnLegs}
            onRefreshHistory={loadRechargeHistory}
            onRefreshBalances={loadDrawerBalances}
            onTransactionTimeChange={setTelecomTransactionTime}
          />
        )}

        {activeConfig?.formMode === "financial" &&
          (activeProvider === "OMT_APP" ? (
            // OMT App - Transfer only (no cards)
            <OmtWhishAppTransferForm
              activeProvider="OMT_APP"
              transactions={finTransactions}
              loadFinancialData={loadFinancialData}
              formatAmount={formatAmount}
              customerName={activeSession?.customer_name}
              customerPhone={activeSession?.customer_phone}
              showHistory={showHistory}
              onCloseHistory={() => setShowHistory(false)}
            />
          ) : activeProvider === "WHISH_APP" ? (
            // Whish App - Bills (cards) or Transfer (send/receive)
            <>
              {/* Mode Tabs - Transfer / Bills */}
              <ServiceTypeTabs
                options={[
                  {
                    id: "transfer",
                    label: "Transfer",
                    iconKey: "ArrowLeftRight",
                  },
                  { id: "bills", label: "Bills", iconKey: "FileText" },
                ]}
                value={whishAppMode}
                onChange={(val) => setWhishAppMode(val as "bills" | "transfer")}
                accentColor="red"
                customColor="#ff0a46"
                size="sm"
                className="mb-4"
              />

              {whishAppMode === "bills" ? (
                <FinancialForm
                  activeConfig={activeConfig}
                  finTransactions={finTransactions}
                  activeProvider={activeProvider}
                  serviceType={serviceType}
                  setServiceType={setServiceType}
                  getCategoriesForProvider={getCategoriesForProvider}
                  getServiceItems={getServiceItems}
                  methods={methods}
                  clientName={clientName}
                  setClientName={setClientName}
                  loadFinancialData={loadFinancialData}
                  formatAmount={formatAmount}
                  showHistory={showHistory}
                  setShowHistory={setShowHistory}
                  onRefreshItems={refreshItems}
                  isAdmin={isAdmin}
                  onCartCountChange={setTabCartCounts}
                />
              ) : (
                <OmtWhishAppTransferForm
                  activeProvider="WHISH_APP"
                  transactions={finTransactions}
                  loadFinancialData={loadFinancialData}
                  formatAmount={formatAmount}
                  customerName={activeSession?.customer_name}
                  customerPhone={activeSession?.customer_phone}
                  showHistory={showHistory}
                  onCloseHistory={() => setShowHistory(false)}
                />
              )}
            </>
          ) : activeProvider === "Katsh" || activeProvider === "iPick" ? (
            <KatchForm
              activeConfig={activeConfig}
              activeProvider={activeProvider as ProviderKey}
              getCategoriesForProvider={getCategoriesForProvider}
              getServiceItems={getServiceItems}
              methods={methods}
              loadFinancialData={loadFinancialData}
              formatAmount={formatAmount}
              alfaCreditSellRate={alfaCreditSellRate}
              alfaCreditCostRate={alfaCreditCostRate}
              exchangeRate={exchangeRate}
              showHistory={showHistory}
              setShowHistory={setShowHistory}
              onRefreshItems={refreshItems}
              isAdmin={isAdmin}
              onCartCountChange={setTabCartCounts}
            />
          ) : (
            <FinancialForm
              activeConfig={activeConfig}
              finTransactions={finTransactions}
              activeProvider={activeProvider}
              serviceType={serviceType}
              setServiceType={setServiceType}
              getCategoriesForProvider={getCategoriesForProvider}
              getServiceItems={getServiceItems}
              methods={methods}
              clientName={clientName}
              setClientName={setClientName}
              loadFinancialData={loadFinancialData}
              formatAmount={formatAmount}
              showHistory={showHistory}
              setShowHistory={setShowHistory}
              onRefreshItems={refreshItems}
              isAdmin={isAdmin}
              onCartCountChange={setTabCartCounts}
            />
          ))}

        {activeConfig?.formMode === "crypto" && (
          <CryptoForm
            activeConfig={activeConfig}
            cryptoType={cryptoType}
            setCryptoType={setCryptoType}
            cryptoAmount={cryptoAmount}
            setCryptoAmount={setCryptoAmount}
            cryptoClientName={cryptoClientName}
            setCryptoClientName={setCryptoClientName}
            cryptoClientPhone={cryptoClientPhone}
            setCryptoClientPhone={setCryptoClientPhone}
            cryptoClientId={cryptoClientId}
            setCryptoClientId={setCryptoClientId}
            cryptoDescription={cryptoDescription}
            setCryptoDescription={setCryptoDescription}
            cryptoFee={cryptoFee}
            setCryptoFee={setCryptoFee}
            feeIncluded={cryptoFeeIncluded}
            setFeeIncluded={setCryptoFeeIncluded}
            handleCryptoSubmit={handleCryptoSubmit}
            onKeptChange={setCryptoKeptChange}
            isSubmitting={isSubmitting}
            binanceTransactions={binanceTransactions}
            loadCryptoData={loadBinanceData}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
            paymentMethods={
              cryptoType === "RECEIVE"
                ? methods.filter(
                    (pm) =>
                      pm.code === "CASH" || pm.code === "CUSTOMER_ACCOUNT",
                  )
                : methods
            }
            onPaymentLinesChange={(lines) => {
              setCryptoPaymentLines(lines);
              if (lines.length === 1) {
                setCryptoPaidBy(lines[0].method);
              }
            }}
            onReturnChange={setCryptoReturnLegs}
            exchangeRate={exchangeRate}
            onTransactionTimeChange={setCryptoTransactionTime}
          />
        )}
      </div>

      {/* Top-Up Modal for OMT App and Whish App */}
      {topUpData && (
        <TopUpModal
          isOpen={showTopUpModal}
          onClose={() => {
            setShowTopUpModal(false);
            setTopUpData(null);
            setTopUpPartnerId(null);
          }}
          onConfirm={handleTopUpConfirm}
          onConfirmCustomer={handleTopUpConfirmCustomer}
          onConfirmSupplier={handleTopUpConfirmSupplier}
          {...(topUpData.provider === "WHISH_APP"
            ? {
                onConfirmPartner: handleTopUpConfirmPartner,
                onConfirmClient: handleTopUpConfirmClient,
                selectedPartnerId: topUpPartnerId,
                partnerSelector: (
                  <PartnerSelector
                    selectedPartnerId={topUpPartnerId}
                    onSelect={setTopUpPartnerId}
                    autoSelectSingle
                  />
                ),
              }
            : {})}
          provider={topUpData.provider}
          allDrawers={topUpData.availableDrawers}
          destinationDrawer={topUpData.destinationDrawer}
          defaultSourceDrawer={topUpData.defaultSourceDrawer}
        />
      )}
    </div>
  );
}
