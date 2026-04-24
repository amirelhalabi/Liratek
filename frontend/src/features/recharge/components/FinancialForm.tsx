import { useState, useEffect } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { MultiPaymentInput, useApi, DoubleTab } from "@liratek/ui";
import { useSession } from "@/features/sessions/context/SessionContext";
import type { ServiceItem, ProviderKey } from "../hooks/useMobileServiceItems";
import { getCategoryColor } from "../utils/categoryColors";
import type {
  FinancialTransaction,
  ServiceType,
  ProviderConfig,
  AnyProvider,
} from "../types";
import { HistoryModal } from "./HistoryModal";
import { getExchangeRates } from "@/utils/exchangeRates";
import logger from "@/utils/logger";

interface CartLineItem {
  item: ServiceItem;
  quantity: number;
}

interface FinancialFormProps {
  activeConfig: ProviderConfig | undefined;
  finTransactions: FinancialTransaction[];
  activeProvider: AnyProvider | null;
  serviceType?: ServiceType;
  setServiceType?: (type: ServiceType) => void;
  getCategoriesForProvider: (provider: ProviderKey) => string[];
  getServiceItems: (provider: ProviderKey, category: string) => ServiceItem[];
  methods: { code: string; label: string }[];
  clientName: string;
  setClientName: (val: string) => void;
  loadFinancialData: () => void;
  formatAmount: (val: number, currency: string) => string;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
}

export function FinancialForm({
  activeConfig,
  finTransactions,
  activeProvider,
  serviceType,
  setServiceType,
  getCategoriesForProvider,
  getServiceItems,
  methods,
  clientName,
  setClientName,
  loadFinancialData,
  formatAmount,
  showHistory,
  setShowHistory,
}: FinancialFormProps) {
  const api = useApi();
  const {
    activeSession,
    linkTransaction,
    addToCart: addToSessionCart,
  } = useSession();
  const [cart, setCart] = useState<Map<string, CartLineItem>>(new Map());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [paymentLines, setPaymentLines] = useState<any[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const isSplitPayment = paymentLines.length > 1;
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [rates, setRates] = useState({ buyRate: 89000, sellRate: 89500 });
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch exchange rates on mount
  useEffect(() => {
    const loadRates = async () => {
      try {
        const list = await api.getRates();
        const { buyRate, sellRate } = getExchangeRates(list);
        setRates({ buyRate, sellRate });
      } catch (error) {
        console.error("Failed to load exchange rates:", error);
      }
    };
    loadRates();
  }, [api]);

  // Determine exchange rate based on transaction type
  //   - SEND = customer sends money (money IN) → sellRate (customer pays us more LBP)
  //   - RECEIVE = customer receives money (money OUT) → buyRate (we pay customer less LBP)
  const isMoneyIn = serviceType === "SEND";
  const exchangeRate = isMoneyIn ? rates.sellRate : rates.buyRate;

  if (!activeConfig || !activeProvider) return null;
  const meta = activeConfig;

  const providerTx = finTransactions.filter(
    (tx) => tx.provider === activeProvider,
  );

  const categories = getCategoriesForProvider(activeProvider as ProviderKey);

  const handleCardClick = (item: ServiceItem) => {
    const itemKey = item.key;
    setExpandedKeys((prev) => {
      const newSet = new Set(prev);
      newSet.add(itemKey);
      return newSet;
    });
    if (!cart.has(itemKey)) {
      updateCart(item, 1);
    }
  };

  const toggleCategoryCollapse = (category: string) => {
    setCollapsedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  const updateCart = (item: ServiceItem, quantity: number) => {
    setCart((prev) => {
      const newCart = new Map(prev);
      if (quantity <= 0) {
        newCart.delete(item.key);
        setExpandedKeys((prevKeys) => {
          const newKeys = new Set(prevKeys);
          newKeys.delete(item.key);
          return newKeys;
        });
      } else {
        newCart.set(item.key, { item, quantity });
      }
      return newCart;
    });
  };

  const handleQuantityChange = (item: ServiceItem, delta: number) => {
    const existing = cart.get(item.key);
    const newQty = (existing?.quantity ?? 0) + delta;
    if (existing || delta > 0) {
      updateCart(item, newQty);
    }
  };

  const totalPrice = Array.from(cart.values()).reduce((sum, line) => {
    const unitPrice = line.item.catalogSellPrice ?? 0;
    return sum + unitPrice * line.quantity;
  }, 0);

  const totalItems = Array.from(cart.values()).reduce(
    (sum, line) => sum + line.quantity,
    0,
  );

  const handleSubmit = async () => {
    if (cart.size === 0 || localSubmitting) return;

    // If session is active, add all cart items as one session cart entry
    if (activeSession) {
      const cartItems = Array.from(cart.values());
      const itemLabels = cartItems
        .map((line) => `${line.item.label} x${line.quantity}`)
        .join(", ");
      const providerLabel =
        activeConfig?.label || activeProvider || "Financial";
      const label =
        itemLabels.length > 60
          ? `${providerLabel} (${cartItems.length} items) - ${totalPrice.toLocaleString()} LBP`
          : `${providerLabel}: ${itemLabels}`;

      const finalPaymentMethod = isSplitPayment ? "MULTI" : paymentMethod;
      const paymentsPayload = isSplitPayment
        ? paymentLines.map((l: any) => ({
            method: l.method,
            currencyCode: l.currencyCode,
            amount: l.amount,
          }))
        : undefined;

      // Store each line item for replay at checkout
      const formDataItems = cartItems.flatMap((line) => {
        const sellPrice = line.item.catalogSellPrice ?? 0;
        const cost = line.item.catalogCost ?? 0;
        const commission = sellPrice - cost;
        return Array.from({ length: line.quantity }, () => ({
          provider: activeProvider,
          serviceType: serviceType || "SEND",
          amount: sellPrice,
          cost,
          currency: "LBP",
          commission: Math.max(0, commission),
          paidByMethod: finalPaymentMethod,
          payments: paymentsPayload,
          clientName: clientName || undefined,
          itemKey: line.item.key,
          itemCategory: line.item.category,
          note: `${line.item.label} (${line.item.subcategory})`,
        }));
      });

      addToSessionCart({
        module: activeProvider === "WISH_APP" ? "whish_app" : "omt_app",
        label,
        amount: totalPrice,
        currency: "LBP",
        ipcChannel: "financial:create",
        formData: {
          _batch: true,
          items: formDataItems,
        },
      });

      // Reset form
      setCart(new Map());
      setClientName("");
      setExpandedKeys(new Set());
      setSearchQuery("");
      return;
    }

    setLocalSubmitting(true);

    const cartItems = Array.from(cart.values());
    const finalPaymentMethod = isSplitPayment ? "MULTI" : paymentMethod;
    const paymentsPayload = isSplitPayment
      ? paymentLines.map((l: any) => ({
          method: l.method,
          currencyCode: l.currencyCode,
          amount: l.amount,
        }))
      : undefined;

    let allSucceeded = true;

    for (const line of cartItems) {
      const sellPrice = line.item.catalogSellPrice ?? 0;
      const cost = line.item.catalogCost ?? 0;
      const commission = sellPrice - cost;

      for (let i = 0; i < line.quantity; i++) {
        try {
          const result = await api.addOMTTransaction({
            provider: activeProvider,
            serviceType: serviceType || "SEND",
            amount: sellPrice,
            cost,
            currency: "LBP",
            commission: Math.max(0, commission),
            paidByMethod: finalPaymentMethod,
            payments: paymentsPayload,
            clientName: clientName || undefined,
            itemKey: line.item.key,
            itemCategory: line.item.category,
            note: `${line.item.label} (${line.item.subcategory})`,
          });

          if (result?.success) {
            // Link to active customer session
            if (activeSession && result.id) {
              try {
                await linkTransaction({
                  transactionType: "financial_service",
                  transactionId: result.id,
                  amountUsd: 0,
                  amountLbp: sellPrice,
                });
              } catch (err) {
                logger.error("Failed to link financial tx to session:", err);
              }
            }
          } else {
            logger.error("Financial submit failed:", result?.error);
            alert(result?.error || "Failed to process item");
            allSucceeded = false;
            break;
          }
        } catch (err) {
          logger.error("Financial submit error:", err);
          alert("Failed to process item");
          allSucceeded = false;
          break;
        }
      }
      if (!allSucceeded) break;
    }

    if (allSucceeded) {
      setCart(new Map());
      setClientName("");
      setExpandedKeys(new Set());
      setSearchQuery("");
    }
    loadFinancialData();
    setLocalSubmitting(false);
  };

  // Filter items by search query
  const filterItemsBySearch = (items: ServiceItem[]): ServiceItem[] => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.subcategory.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query),
    );
  };

  return (
    <>
      <div className="flex flex-col gap-5 flex-1 min-h-0">
        {/* Header with SEND/RECEIVE Tabs - hidden for Whish App and MTC */}
        {activeProvider !== "WISH_APP" && activeProvider !== "MTC" && (
          <div className="flex-1">
            <DoubleTab
              leftOption={{ id: "SEND", label: "Money In", iconKey: "Send" }}
              rightOption={{
                id: "RECEIVE",
                label: "Money Out",
                iconKey: "Package",
              }}
              value={serviceType || "SEND"}
              onChange={(val) => setServiceType?.(val as ServiceType)}
              accentColor={
                activeProvider === "iPick" || activeProvider === "Katsh"
                  ? "orange"
                  : "violet"
              }
              customColor={activeProvider === "OMT_APP" ? "#ffde00" : undefined}
              customTextColor={activeProvider === "OMT_APP" ? "black" : "white"}
            />
          </div>
        )}

        {/* Search Bar - only for providers with items */}
        {(activeProvider === "iPick" ||
          activeProvider === "Katsh" ||
          activeProvider === "WISH_APP") && (
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeProvider === "iPick" ? "iPick" : activeProvider === "Katsh" ? "Katsh" : "Whish App"} items...`}
              className="w-full px-4 py-2.5 pl-10 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-all"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                aria-label="Clear search"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Card Grid - hidden for OMT_APP (no items) */}
        {activeProvider !== "OMT_APP" && (
          <div className="flex-1 min-h-0 overflow-auto space-y-6 pb-2">
            {categories.map((category) => {
              const categoryItems = getServiceItems(
                activeProvider as ProviderKey,
                category,
              );
              const filteredItems = filterItemsBySearch(categoryItems);
              if (filteredItems.length === 0) return null;

              return (
                <div
                  key={category}
                  className="bg-slate-800 rounded-xl border border-slate-700/50 p-4"
                >
                  <div
                    onClick={() => toggleCategoryCollapse(category)}
                    className="flex items-center justify-between cursor-pointer select-none"
                  >
                    <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: getCategoryColor(category) }}
                      />
                      {category}
                    </h3>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform ${
                        collapsedCategories.has(category) ? "-rotate-90" : ""
                      }`}
                    />
                  </div>
                  {!collapsedCategories.has(category) && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-3">
                      {filteredItems.map((item) => {
                        const inCart = cart.get(item.key);
                        const qty = inCart?.quantity ?? 0;
                        const isExpanded = expandedKeys.has(item.key);
                        const cost = item.catalogCost ?? 0;
                        const sellPrice = item.catalogSellPrice ?? 0;

                        return (
                          <div key={item.key} className="relative">
                            <div
                              className={`w-full p-3 rounded-lg border transition-all ${
                                qty > 0
                                  ? "border-violet-500/40 ring-1 ring-violet-500/30"
                                  : "border-white/10 hover:border-white/20"
                              } ${isExpanded ? "ring-2 ring-violet-500/50" : ""}`}
                              style={{
                                backgroundColor: `${getCategoryColor(item.category)}18`,
                              }}
                            >
                              <div
                                onClick={() => handleCardClick(item)}
                                className="cursor-pointer"
                              >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <div className="text-white font-medium text-sm truncate">
                                    {item.label}
                                  </div>
                                  {qty > 0 && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleQuantityChange(item, -1);
                                        }}
                                        className="w-5 h-5 rounded-full bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                                        type="button"
                                      >
                                        −
                                      </button>
                                      <span className="w-4 text-center text-xs font-bold text-violet-400">
                                        {qty}
                                      </span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleQuantityChange(item, 1);
                                        }}
                                        className="w-5 h-5 rounded-full bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                                        type="button"
                                      >
                                        +
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <div className="h-4 flex items-center justify-center">
                                  <span className="text-slate-500 text-xs truncate">
                                    {item.subcategory}
                                  </span>
                                </div>
                                <div className="mt-2 flex items-center justify-between">
                                  <span className="text-xs text-slate-400">
                                    Cost:
                                  </span>
                                  <span className="text-xs text-white font-mono">
                                    {cost.toLocaleString()} LBP
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-slate-400">
                                    Sell:
                                  </span>
                                  <span className="text-xs text-emerald-400 font-mono">
                                    {sellPrice.toLocaleString()} LBP
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state for OMT_APP */}
        {activeProvider === "OMT_APP" && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-slate-500">
              <p className="text-sm">OMT App money transfer coming soon</p>
            </div>
          </div>
        )}

        {/* Bottom Bar */}
        <div className="shrink-0 bg-slate-800 rounded-xl border border-slate-700/50 p-4 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <MultiPaymentInput
                totalAmount={totalPrice}
                totalAmountCurrency="LBP"
                currency="LBP"
                onChange={(lines) => {
                  setPaymentLines(lines);
                  if (lines.length === 1) {
                    setPaymentMethod(lines[0].method);
                  }
                }}
                showPmFee={false}
                paymentMethods={methods}
                currencies={[
                  { code: "USD", symbol: "$" },
                  { code: "LBP", symbol: "LBP" },
                ]}
                exchangeRate={exchangeRate}
              />
            </div>

            <div className="text-right">
              <div className="text-xs text-slate-400">
                Items:{" "}
                <span className="text-white font-bold">{totalItems}</span>
              </div>
              <div className="text-xs text-slate-400">
                Price:{" "}
                <span className="text-emerald-400 font-mono">
                  {totalPrice.toLocaleString()} LBP
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 min-w-[200px]">
              {activeProvider === "iPick" ||
              activeProvider === "Katsh" ||
              activeProvider === "WISH_APP" ? (
                <>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Client name (optional)"
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                </>
              ) : null}
            </div>

            <button
              onClick={handleSubmit}
              disabled={localSubmitting || totalItems === 0}
              className={`px-6 py-3 rounded-lg font-bold transition-all ${
                localSubmitting || totalItems === 0
                  ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                  : activeProvider === "WISH_APP"
                    ? "bg-[#ff0a46] hover:bg-[#ff0a46]/80 text-white shadow-lg shadow-[#ff0a46]/20"
                    : activeProvider === "OMT_APP"
                      ? "bg-[#ffde00] hover:bg-[#ffde00]/80 text-black shadow-lg shadow-[#ffde00]/20"
                      : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-500/20"
              }`}
            >
              {localSubmitting ? "Processing..." : "Submit"}
            </button>
          </div>
        </div>
      </div>

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={providerTx}
          provider={meta.label}
          onClose={() => setShowHistory(false)}
          onRefresh={loadFinancialData}
          formatAmount={formatAmount}
          showFeeAndProfit
        />
      )}
    </>
  );
}
