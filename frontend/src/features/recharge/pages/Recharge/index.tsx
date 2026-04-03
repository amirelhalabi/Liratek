import { useState, useEffect, useCallback } from "react";
import { useApi } from "@liratek/ui";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import type { PaymentLine } from "@liratek/ui";
import {
  useMobileServiceItems,
  type ProviderKey,
} from "../../hooks/useMobileServiceItems";
import {
  CompactStats,
  FinancialForm,
  KatchForm,
  TelecomForm,
  CryptoForm,
  ProviderTabs,
} from "../../components";
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
  const { methods } = usePaymentMethods();
  const { getCategoriesForProvider, getItems: getServiceItems } =
    useMobileServiceItems();

  const [activeProvider, setActiveProvider] = useState<AnyProvider | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [finTransactions, setFinTransactions] = useState<
    FinancialTransaction[]
  >([]);
  const [binanceTransactions, setBinanceTransactions] = useState<
    BinanceTransaction[]
  >([]);
  const [finAnalytics, setFinAnalytics] = useState<ProviderAnalytics>({
    today: { commission: 0, count: 0 },
    byProvider: [],
  });
  const [binanceStats, setBinanceStats] = useState({
    totalSent: 0,
    totalReceived: 0,
    count: 0,
  });

  const [serviceType, setServiceType] = useState<ServiceType>("SEND");
  const [clientName, setClientName] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");

  const [rechargeType, setRechargeType] =
    useState<RechargeType>("CREDIT_TRANSFER");
  const [topUpAmount, setTopUpAmount] = useState("");
  const [telecomAmount, setTelecomAmount] = useState("");
  const [telecomPrice, setTelecomPrice] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [paidBy, setPaidBy] = useState("CASH");
  const [showClientSearch, setShowClientSearch] = useState(false);
  const [telecomClientId, setTelecomClientId] = useState<number | null>(null);
  const [telecomClientName, setTelecomClientName] = useState("");
  const [clientSearchResults, setClientSearchResults] = useState<any[]>([]);
  const [giftTierKey, setGiftTierKey] = useState<
    keyof typeof import("../../types").ALFA_GIFT_TIERS | ""
  >("");
  const [giftAmountUsd, setGiftAmountUsd] = useState("");
  const [giftPriceLbp, setGiftPriceLbp] = useState("");
  const [useMultiPayment, setUseMultiPayment] = useState<boolean>(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);

  const [cryptoType, setCryptoType] = useState<"SEND" | "RECEIVE">("SEND");
  const [cryptoAmount, setCryptoAmount] = useState("");
  const [cryptoClientName, setCryptoClientName] = useState("");
  const [cryptoDescription, setCryptoDescription] = useState("");

  const [showHistory, setShowHistory] = useState(false);

  const activeConfig = PROVIDER_CONFIGS.find(
    (p: ProviderConfig) => p.key === activeProvider,
  );

  const loadFinancialData = useCallback(async () => {
    if (!activeProvider) return;
    try {
      const [transactions, analytics] = await Promise.all([
        api.getOMTHistory(activeProvider),
        api.getOMTAnalytics(),
      ]);
      setFinTransactions(transactions ?? []);

      setFinAnalytics(
        analytics ?? { today: { commission: 0, count: 0 }, byProvider: [] },
      );
    } catch (err) {
      console.error("Failed to load financial data:", err);
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
          created_at: tx.created_at,
        })),
      );

      const today = new Date().toDateString();
      const todayTx = (history ?? []).filter(
        (tx: any) => new Date(tx.created_at).toDateString() === today,
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
      console.error("Failed to load binance data:", err);
    }
  }, [api]);

  useEffect(() => {
    if (!activeProvider && PROVIDER_CONFIGS.length > 0) {
      setActiveProvider(PROVIDER_CONFIGS[0].key);
    }
  }, []);

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
        console.error("Failed to search clients:", err);
      }
    },
    [api],
  );

  const selectClient = useCallback((client: any) => {
    setTelecomClientId(client.id);
    setTelecomClientName(client.name);
    setClientSearchResults([]);
    setShowClientSearch(false);
  }, []);

  const handleFinancialSubmit = useCallback(async () => {
    if (!activeProvider) return;
    setIsSubmitting(true);
    try {
      loadFinancialData();
    } catch (err) {
      console.error("Failed to submit financial transaction:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeProvider, loadFinancialData]);

  const handleTelecomSubmit = useCallback(async () => {
    if (!activeProvider || !telecomAmount) return;
    setIsSubmitting(true);
    try {
      await api.processRecharge({
        provider: activeProvider,
        rechargeType,
        phoneNumber:
          rechargeType === "CREDIT_TRANSFER" ? phoneNumber : undefined,
        amount: parseFloat(telecomAmount),
        price: parseFloat(telecomPrice) || undefined,
        paidBy,
        clientId: telecomClientId,
      });
      setTelecomAmount("");
      setTelecomPrice("");
      setPhoneNumber("");
      loadFinancialData();
    } catch (err) {
      console.error("Failed to submit telecom recharge:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    activeProvider,
    telecomAmount,
    telecomPrice,
    rechargeType,
    phoneNumber,
    paidBy,
    telecomClientId,
    api,
    loadFinancialData,
  ]);

  const handleTopUp = useCallback(async () => {
    if (!activeProvider || !topUpAmount) return;
    setIsSubmitting(true);
    try {
      await api.topUpRecharge({
        provider: activeProvider as "MTC" | "Alfa",
        amount: parseFloat(topUpAmount),
      });
      setTopUpAmount("");
    } catch (err) {
      console.error("Failed to submit top up:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeProvider, topUpAmount, api]);

  const handleAlfaGiftSubmit = useCallback(async () => {
    if (!giftTierKey) return;
    setIsSubmitting(true);
    try {
      await api.processRecharge({
        provider: "Alfa",
        rechargeType: "ALFA_GIFT",
        giftTier: giftTierKey,
        amountUsd: parseFloat(giftAmountUsd),
        priceLbp: parseFloat(giftPriceLbp),
      });
      setGiftTierKey("");
      setGiftAmountUsd("");
      setGiftPriceLbp("");
    } catch (err) {
      console.error("Failed to submit alfa gift:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [giftTierKey, giftAmountUsd, giftPriceLbp, api]);

  const handleCryptoSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await api.addOMTTransaction({
        provider: "BINANCE",
        serviceType: cryptoType,
        amount: parseFloat(cryptoAmount),
        currency: "USDT",
        clientName: cryptoClientName,
        referenceNumber: cryptoDescription,
      });
      setCryptoAmount("");
      setCryptoClientName("");
      setCryptoDescription("");
      loadBinanceData();
    } catch (err) {
      console.error("Failed to submit crypto transaction:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    cryptoType,
    cryptoAmount,
    cryptoClientName,
    cryptoDescription,
    api,
    loadBinanceData,
  ]);

  const handleQuickAmount = useCallback((val: number) => {
    setTelecomAmount(val.toString());
  }, []);

  const resolveVoucherImage = useCallback(
    (provider: string, amount: number) => {
      const items = getServiceItems(provider as ProviderKey);
      const item = items.find(
        (i) =>
          i.subcategory?.toLowerCase().includes("voucher") &&
          i.catalogCost === amount,
      );
      return item?.imageData || null;
    },
    [getServiceItems],
  );

  const isMTC = activeProvider === "MTC";

  const getTelecomStats = useCallback(() => {
    const providerTx = finTransactions.filter(
      (tx) => tx.provider === activeProvider,
    );
    const today = new Date().toDateString();
    const todayTx = providerTx.filter(
      (tx) => new Date(tx.created_at).toDateString() === today,
    );
    return {
      commission: todayTx.reduce((sum, tx) => sum + tx.commission, 0),
      count: todayTx.length,
    };
  }, [finTransactions, activeProvider]);

  const telecomStats = getTelecomStats();

  if (!activeProvider) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        Select a provider to get started
      </div>
    );
  }

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 flex flex-col overflow-hidden animate-in fade-in duration-500">
      {/* Header: Provider Tabs (left) + Stats (right) */}
      <div className="flex items-center justify-between mb-6">
        <ProviderTabs
          providers={PROVIDER_CONFIGS}
          activeProvider={activeProvider}
          onSelectProvider={setActiveProvider}
        />

        {/* Compact Stats - changes based on active provider */}
        {activeConfig && (
          <CompactStats
            providerLabel={activeConfig.label}
            activeConfig={activeConfig}
            todayCommission={telecomStats.commission}
            todayCount={telecomStats.count}
            allProvidersCommission={
              activeConfig.formMode !== "crypto"
                ? finAnalytics.today.commission
                : undefined
            }
            cryptoOutToday={binanceStats.totalSent}
            cryptoInToday={binanceStats.totalReceived}
            showCryptoStats={activeConfig.formMode === "crypto"}
            showHistoryButton={
              activeConfig.formMode === "financial" ||
              activeConfig.formMode === "crypto"
            }
            onShowHistory={() => setShowHistory(true)}
          />
        )}
      </div>

      {activeConfig?.formMode === "telecom" && (
        <TelecomForm
          isMTC={isMTC}
          rechargeType={rechargeType}
          setRechargeType={setRechargeType}
          topUpAmount={topUpAmount}
          setTopUpAmount={setTopUpAmount}
          handleTopUp={handleTopUp}
          isSubmitting={isSubmitting}
          handleQuickAmount={handleQuickAmount}
          telecomAmount={telecomAmount}
          setTelecomAmount={setTelecomAmount}
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
          searchClients={searchClients}
          clientSearchResults={clientSearchResults}
          selectClient={selectClient}
          resolveVoucherImage={resolveVoucherImage}
          activeProvider={activeProvider}
          activeConfig={activeConfig}
          handleTelecomSubmit={handleTelecomSubmit}
          giftTierKey={giftTierKey}
          setGiftTierKey={setGiftTierKey}
          giftAmountUsd={giftAmountUsd}
          setGiftAmountUsd={setGiftAmountUsd}
          giftPriceLbp={giftPriceLbp}
          setGiftPriceLbp={setGiftPriceLbp}
          handleAlfaGiftSubmit={handleAlfaGiftSubmit}
          useMultiPayment={useMultiPayment}
          setUseMultiPayment={setUseMultiPayment}
          paymentLines={paymentLines}
          setPaymentLines={setPaymentLines}
          clientName={clientName}
          setClientName={setClientName}
          referenceNumber={referenceNumber}
          setReferenceNumber={setReferenceNumber}
        />
      )}

      {activeConfig?.formMode === "financial" &&
        (activeProvider === "KATCH" || activeProvider === "IPEC" ? (
          <KatchForm
            activeConfig={activeConfig}
            finTransactions={finTransactions}
            activeProvider={activeProvider as ProviderKey}
            getCategoriesForProvider={getCategoriesForProvider}
            getServiceItems={getServiceItems}
            methods={methods}
            handleFinancialSubmit={handleFinancialSubmit}
            isSubmitting={isSubmitting}
            loadFinancialData={loadFinancialData}
            formatAmount={formatAmount}
            alfaCreditSellRate={
              Number(
                localStorage.getItem("alfa_credit_sell_rate_lbp") || "100000",
              ) / 1000
            }
            showHistory={showHistory}
            setShowHistory={setShowHistory}
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
            referenceNumber={referenceNumber}
            setReferenceNumber={setReferenceNumber}
            handleFinancialSubmit={() => handleFinancialSubmit()}
            isSubmitting={isSubmitting}
            loadFinancialData={loadFinancialData}
            formatAmount={formatAmount}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
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
          cryptoDescription={cryptoDescription}
          setCryptoDescription={setCryptoDescription}
          handleCryptoSubmit={handleCryptoSubmit}
          isSubmitting={isSubmitting}
          binanceTransactions={binanceTransactions}
          loadCryptoData={loadBinanceData}
          showHistory={showHistory}
          setShowHistory={setShowHistory}
        />
      )}
    </div>
  );
}
