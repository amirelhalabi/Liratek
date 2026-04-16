import { useState, useEffect, useCallback, useMemo } from "react";
import { useApi } from "@liratek/ui";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useAuth } from "@/features/auth/context/AuthContext";
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
  OmtWhishAppTransferForm,
} from "../../components";
import { TopUpModal, DoubleTab } from "@liratek/ui";
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
  const { getCategoriesForProvider, getItems: getServiceItems } =
    useMobileServiceItems();

  // MTC voucher items from DB (provider=VOUCHER, category=mtc, subcategory=voucher)
  const mtcVoucherItems = useMemo(() => {
    const items = getServiceItems("VOUCHER" as ProviderKey, "mtc");
    return items
      .filter((i) => i.subcategory === "voucher")
      .map((i) => ({
        label: i.label,
        cost_lbp: i.catalogCost ?? 0,
        sell_lbp: i.catalogSellPrice ?? 0,
      }));
  }, [getServiceItems]);

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
  const [rechargeHistory, setRechargeHistory] = useState<any[]>([]);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
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
  const [alfaCreditSellRate, setAlfaCreditSellRate] = useState(100);

  // Whish App mode: 'bills' (card grid) or 'transfer' (send/receive money)
  const [whishAppMode, setWhishAppMode] = useState<"bills" | "transfer">(
    "bills",
  );

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
        setAlfaCreditSellRate(rate / 1000);
      } catch (error) {
        console.error("Failed to load alfa credit sell rate:", error);
      }
    };
    loadRate();
  }, [api]);

  // Reset Whish App mode when provider changes
  useEffect(() => {
    if (activeProvider === "WISH_APP") {
      setWhishAppMode("bills");
    }
  }, [activeProvider]);

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

  const loadRechargeHistory = useCallback(async () => {
    if (!activeProvider || !["MTC", "Alfa"].includes(activeProvider)) return;
    try {
      const history = await window.api.recharge.getHistory(
        activeProvider as "MTC" | "Alfa",
      );
      setRechargeHistory(history ?? []);
    } catch (error) {
      console.error("Failed to load recharge history:", error);
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
      WISH_APP: {
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
      console.error("Failed to load drawer balances:", error);
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

      // Reload financial data to show updated balances
      if (activeConfig?.formMode === "financial") {
        loadFinancialData();
      }

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
    [topUpData, activeConfig, loadFinancialData],
  );

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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        {/* Left: Provider Tabs + Stats */}
        <div className="flex items-center gap-4">
          <ProviderTabs
            providers={PROVIDER_CONFIGS}
            activeProvider={activeProvider}
            onSelectProvider={setActiveProvider}
          />

          {activeConfig && (
            <CompactStats
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
              isAdmin={isAdmin}
            />
          )}
        </div>

        {/* Right: Action Buttons */}
        {activeConfig && (
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
                className="px-4 py-2 rounded-lg font-medium text-sm bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all"
              >
                History
              </button>
            )}

            {(activeConfig.key === "MTC" ||
              activeConfig.key === "Alfa" ||
              activeConfig.key === "OMT_APP" ||
              activeConfig.key === "WISH_APP" ||
              activeConfig.key === "iPick" ||
              activeConfig.key === "Katsh") && (
              <button
                onClick={handleTopUpClick}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all"
              >
                Top-Up
              </button>
            )}
          </div>
        )}
      </div>

      {activeConfig?.formMode === "telecom" && (
        <TelecomForm
          isMTC={isMTC}
          rechargeType={rechargeType}
          setRechargeType={setRechargeType}
          isSubmitting={isSubmitting}
          handleQuickAmount={handleQuickAmount}
          showHistory={showHistory}
          setShowHistory={setShowHistory}
          rechargeHistory={rechargeHistory}
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
          voucherItems={mtcVoucherItems}
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
          />
        ) : activeProvider === "WISH_APP" ? (
          // Whish App - Bills (cards) or Transfer (send/receive)
          <>
            {/* Mode Tabs - DoubleTab Component */}
            <DoubleTab
              leftOption={{ id: "bills", label: "Bills", iconKey: "FileText" }}
              rightOption={{
                id: "transfer",
                label: "Transfer",
                iconKey: "ArrowLeftRight",
              }}
              value={whishAppMode}
              onChange={(val) => setWhishAppMode(val as "bills" | "transfer")}
              accentColor="violet"
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
                referenceNumber={referenceNumber}
                setReferenceNumber={setReferenceNumber}
                handleFinancialSubmit={() => handleFinancialSubmit()}
                isSubmitting={isSubmitting}
                loadFinancialData={loadFinancialData}
                formatAmount={formatAmount}
                showHistory={showHistory}
                setShowHistory={setShowHistory}
              />
            ) : (
              <OmtWhishAppTransferForm
                activeProvider="WISH_APP"
                transactions={finTransactions}
                loadFinancialData={loadFinancialData}
                formatAmount={formatAmount}
              />
            )}
          </>
        ) : activeProvider === "Katsh" || activeProvider === "iPick" ? (
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
            alfaCreditSellRate={alfaCreditSellRate}
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

      {/* Top-Up Modal for OMT App and Whish App */}
      {topUpData && (
        <TopUpModal
          isOpen={showTopUpModal}
          onClose={() => {
            setShowTopUpModal(false);
            setTopUpData(null);
          }}
          onConfirm={handleTopUpConfirm}
          provider={topUpData.provider}
          allDrawers={topUpData.availableDrawers}
          destinationDrawer={topUpData.destinationDrawer}
          defaultSourceDrawer={topUpData.defaultSourceDrawer}
        />
      )}
    </div>
  );
}
