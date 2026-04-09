import { useState, useEffect } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { MultiPaymentInput, useApi } from "@liratek/ui";
import { ServiceTypeTabs, type ServiceTypeOption } from "@liratek/ui";
import type { ServiceItem, ProviderKey } from "../hooks/useMobileServiceItems";
import type {
  FinancialTransaction,
  ServiceType,
  ProviderConfig,
  AnyProvider,
} from "../types";
import { HistoryModal } from "./HistoryModal";
import { getExchangeRates } from "@/utils/exchangeRates";

interface CartLineItem {
  item: ServiceItem;
  quantity: number;
}

interface FinancialFormProps {
  activeConfig: ProviderConfig | undefined;
  finTransactions: FinancialTransaction[];
  activeProvider: AnyProvider | null;
  serviceType: ServiceType;
  setServiceType: (type: ServiceType) => void;
  getCategoriesForProvider: (provider: ProviderKey) => string[];
  getServiceItems: (provider: ProviderKey, category: string) => ServiceItem[];
  methods: { code: string; label: string }[];
  clientName: string;
  setClientName: (val: string) => void;
  referenceNumber: string;
  setReferenceNumber: (val: string) => void;
  handleFinancialSubmit: () => void;
  isSubmitting: boolean;
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
  referenceNumber,
  setReferenceNumber,
  handleFinancialSubmit,
  isSubmitting,
  loadFinancialData,
  formatAmount,
  showHistory,
  setShowHistory,
}: FinancialFormProps) {
  const api = useApi();
  const [cart, setCart] = useState<Map<string, CartLineItem>>(new Map());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [useMultiPayment, setUseMultiPayment] = useState<boolean>(false);
  const [_paymentLines, setPaymentLines] = useState<any[]>([]); // Used by MultiPaymentInput onChange callback
  const [paymentMethod, setPaymentMethod] = useState("CASH");
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

  const totalCost = Array.from(cart.values()).reduce((sum, line) => {
    const unitCost = line.item.catalogCost ?? 0;
    return sum + unitCost * line.quantity;
  }, 0);

  const totalPrice = Array.from(cart.values()).reduce((sum, line) => {
    const unitPrice = line.item.catalogSellPrice ?? 0;
    return sum + unitPrice * line.quantity;
  }, 0);

  const totalProfit = totalPrice - totalCost;
  const totalItems = Array.from(cart.values()).reduce(
    (sum, line) => sum + line.quantity,
    0,
  );

  const handleSubmit = async () => {
    if (cart.size === 0) return;
    await handleFinancialSubmit();
    if (cart.size === 0) {
      setClientName("");
      setReferenceNumber("");
      setExpandedKeys(new Set());
      setSearchQuery("");
    }
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
      <div className="flex flex-col gap-5 h-full">
        {/* Header with Tabs and Top-Up Button */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <ServiceTypeTabs
              options={
                [
                  { id: "SEND", label: "Money In", iconKey: "Send" },
                  { id: "RECEIVE", label: "Money Out", iconKey: "Package" },
                ] as ServiceTypeOption[]
              }
              value={serviceType}
              onChange={(val) => setServiceType(val as ServiceType)}
              accentColor={
                activeProvider === "iPick" || activeProvider === "Katsh"
                  ? "orange"
                  : activeProvider === "WISH_APP"
                    ? "violet"
                    : "lime"
              }
            />
          </div>
        </div>

        {/* Search Bar - only for providers with items */}
        {(activeProvider === "iPick" ||
          activeProvider === "Katsh" ||
          activeProvider === "WISH_APP" ||
          activeProvider === "OMT_APP") && (
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeProvider === "iPick" ? "iPick" : activeProvider === "Katsh" ? "Katsh" : activeProvider === "WISH_APP" ? "Whish App" : "OMT App"} items...`}
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

        {/* Card Grid */}
        <div className="flex-1 min-h-0 overflow-auto space-y-6">
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
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
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
                                ? "border-violet-500/40 bg-violet-500/5"
                                : "border-slate-700 bg-slate-800 hover:border-slate-600"
                            } ${isExpanded ? "ring-2 ring-violet-500/50" : ""}`}
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
                                  {cost.toLocaleString()} L
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-400">
                                  Sell:
                                </span>
                                <span className="text-xs text-emerald-400 font-mono">
                                  {sellPrice.toLocaleString()} L
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

        {/* Sticky Bottom Bar */}
        <div className="sticky bottom-0 bg-slate-800 rounded-xl border border-slate-700/50 p-4 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-400">Payment Method</label>
                <button
                  type="button"
                  onClick={() => setUseMultiPayment(!useMultiPayment)}
                  className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                >
                  {useMultiPayment ? "Single Payment" : "Split Payment"}
                </button>
              </div>
              {useMultiPayment ? (
                <MultiPaymentInput
                  totalAmount={totalPrice}
                  currency="LBP"
                  onChange={setPaymentLines}
                  showPmFee={false}
                  paymentMethods={methods}
                  currencies={[
                    { code: "USD", symbol: "$" },
                    { code: "LBP", symbol: "L£" },
                  ]}
                  exchangeRate={exchangeRate}
                />
              ) : (
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                >
                  {methods.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="text-right">
              <div className="text-xs text-slate-400">
                Items:{" "}
                <span className="text-white font-bold">{totalItems}</span>
              </div>
              <div className="text-xs text-slate-400">
                Cost:{" "}
                <span className="text-white font-mono">
                  {totalCost.toLocaleString()} L
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Price:{" "}
                <span className="text-emerald-400 font-mono">
                  {totalPrice.toLocaleString()} L
                </span>
              </div>
              <div
                className={`text-xs font-bold ${totalProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                Profit: {totalProfit.toLocaleString()} L
              </div>
            </div>

            <div className="flex flex-col gap-2 min-w-[200px]">
              {activeProvider === "iPick" ||
              activeProvider === "Katsh" ||
              activeProvider === "WISH_APP" ||
              activeProvider === "OMT_APP" ? (
                <>
                  <input
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Client name (optional)"
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                  <input
                    type="text"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder="Ref # (optional)"
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                </>
              ) : null}
            </div>

            <button
              onClick={handleSubmit}
              disabled={isSubmitting || totalItems === 0}
              className={`px-6 py-3 rounded-lg font-bold text-white transition-all ${
                isSubmitting || totalItems === 0
                  ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                  : "bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-500/20"
              }`}
            >
              {isSubmitting ? "Processing..." : "Submit"}
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
        />
      )}
    </>
  );
}
