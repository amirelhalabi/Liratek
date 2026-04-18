import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import AlfaLogo from "@/assets/logos/alfa.svg?react";
import MtcLogo from "@/assets/logos/mtc.svg?react";
import { MultiPaymentInput, type PaymentLine, useApi } from "@liratek/ui";
import { useSession } from "@/features/sessions/context/SessionContext";
import type { ProviderConfig, FinancialTransaction } from "../types";
import type { ServiceItem, ProviderKey } from "../hooks/useMobileServiceItems";
import { HistoryModal } from "./HistoryModal";
import { getExchangeRates } from "@/utils/exchangeRates";

interface CartLineItem {
  item: ServiceItem;
  quantity: number;
  onlyDays: boolean;
  returnedCreditsUsd: number;
}

interface KatchFormProps {
  activeConfig: ProviderConfig | undefined;
  finTransactions: FinancialTransaction[];
  activeProvider: ProviderKey | null;
  getCategoriesForProvider: (provider: ProviderKey) => string[];
  getServiceItems: (provider: ProviderKey, category: string) => ServiceItem[];
  methods: { code: string; label: string }[];
  handleFinancialSubmit: (
    cart: CartLineItem[],
    paymentMethod: string,
    clientName: string,
    referenceNumber: string,
    paymentLines?: PaymentLine[],
  ) => Promise<void>;
  isSubmitting: boolean;
  loadFinancialData: () => void;
  formatAmount: (val: number, currency: string) => string;
  alfaCreditSellRate: number;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
}

export function KatchForm({
  activeConfig,
  finTransactions,
  activeProvider,
  getCategoriesForProvider,
  getServiceItems,
  methods,
  handleFinancialSubmit,
  isSubmitting,
  loadFinancialData,
  formatAmount,
  alfaCreditSellRate,
  showHistory,
  setShowHistory,
}: KatchFormProps) {
  const api = useApi();
  const [cart, setCart] = useState<Map<string, CartLineItem>>(new Map());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [clientName, setClientName] = useState("");
  const { activeSession } = useSession();

  // Autofill client name from active customer session
  useEffect(() => {
    if (activeSession?.customer_name) {
      setClientName(activeSession.customer_name);
    }
  }, [activeSession]);

  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [useMultiPayment, setUseMultiPayment] = useState<boolean>(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [rates, setRates] = useState({ buyRate: 89000, sellRate: 89500 });

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

  // Katsh/iPick transactions - customer always pays us (money IN)
  // Use Customer Pays rate (higher - benefits shop)
  const exchangeRate = rates.sellRate;

  if (!activeConfig || !activeProvider) return null;

  const categories = getCategoriesForProvider(activeProvider);

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

  const isTelecomVoucher = (item: ServiceItem) => {
    return (
      item.category === "alfa" ||
      item.category === "mtc" ||
      item.subcategory === "alfa" ||
      item.subcategory === "mtc"
    );
  };

  const calculateReturnedCredits = (denomination: number): number => {
    return Math.floor(denomination / 0.5) * 0.5;
  };

  const calculatePrice = (
    item: ServiceItem,
    onlyDays: boolean,
    returnedCredits: number,
  ): number => {
    const sellPrice = item.catalogSellPrice ?? 0;
    if (!onlyDays) {
      return sellPrice;
    }
    return sellPrice - returnedCredits * alfaCreditSellRate;
  };

  const updateCart = (
    item: ServiceItem,
    quantity: number,
    onlyDays?: boolean,
    returnedCreditsUsd?: number,
  ) => {
    setCart((prev) => {
      const newCart = new Map(prev);
      const existing = newCart.get(item.key);

      if (quantity <= 0) {
        newCart.delete(item.key);
        setExpandedKeys((prevKeys) => {
          const newKeys = new Set(prevKeys);
          newKeys.delete(item.key);
          return newKeys;
        });
      } else {
        const newOnlyDays = onlyDays ?? existing?.onlyDays ?? false;
        const newReturnedCredits =
          returnedCreditsUsd ?? existing?.returnedCreditsUsd ?? 0;

        newCart.set(item.key, {
          item,
          quantity,
          onlyDays: newOnlyDays,
          returnedCreditsUsd: newReturnedCredits,
        });
      }
      return newCart;
    });
  };

  const handleCardClick = (item: ServiceItem) => {
    const itemKey = item.key;
    // Only expand accordion for telecom vouchers (they have the "Only Days" option)
    if (isTelecomVoucher(item)) {
      setExpandedKeys((prev) => {
        const newSet = new Set(prev);
        newSet.add(itemKey);
        return newSet;
      });
    }
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

  const handleQuantityChange = (item: ServiceItem, delta: number) => {
    const existing = cart.get(item.key);
    const newQty = (existing?.quantity ?? 0) + delta;

    if (existing || delta > 0) {
      updateCart(
        item,
        newQty,
        existing?.onlyDays,
        existing?.returnedCreditsUsd,
      );
    }
  };

  const handleOnlyDaysChange = (item: ServiceItem, checked: boolean) => {
    const existing = cart.get(item.key);
    if (!existing) return;

    let returnedCredits = 0;
    if (checked) {
      const denomination = parseFloat(item.label);
      if (!isNaN(denomination)) {
        returnedCredits = calculateReturnedCredits(denomination);
      }
    }

    updateCart(item, existing.quantity, checked, returnedCredits);
  };

  const handleReturnedCreditsChange = (item: ServiceItem, value: number) => {
    const existing = cart.get(item.key);
    if (!existing) return;
    updateCart(item, existing.quantity, existing.onlyDays, value);
  };

  const totalPrice = Array.from(cart.values()).reduce((sum, line) => {
    const unitPrice = calculatePrice(line.item, line.onlyDays, exchangeRate);
    return sum + unitPrice * line.quantity;
  }, 0);

  const totalItems = Array.from(cart.values()).reduce(
    (sum, line) => sum + line.quantity,
    0,
  );

  const handleSubmit = async () => {
    if (cart.size === 0) return;
    await handleFinancialSubmit(
      Array.from(cart.values()),
      paymentMethod,
      clientName,
      "",
      useMultiPayment ? paymentLines : undefined,
    );
    if (cart.size === 0) {
      setClientName("");
      setExpandedKeys(new Set());
    }
  };

  const filterProviderTransactions = (txs: FinancialTransaction[]) => {
    return txs.filter((tx) => tx.provider === activeProvider);
  };

  const providerTransactions = filterProviderTransactions(finTransactions);

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`Search ${activeProvider} items...`}
          className="w-full px-4 py-2.5 pl-10 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Clear search"
            type="button"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Card Grid */}
      <div className="flex-1 min-h-0 overflow-auto space-y-6">
        {categories.map((category) => {
          const allCategoryItems = getServiceItems(activeProvider, category);
          const categoryItems = filterItemsBySearch(allCategoryItems);

          // Skip category if no items match search
          if (categoryItems.length === 0) return null;

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
                  {categoryItems.map((item) => {
                    const inCart = cart.get(item.key);
                    const qty = inCart?.quantity ?? 0;
                    const isExpanded = expandedKeys.has(item.key);
                    const isTelecom = isTelecomVoucher(item);
                    const cost = item.catalogCost ?? 0;
                    const sellPrice = item.catalogSellPrice ?? 0;

                    return (
                      <div key={item.key} className="relative">
                        <div
                          className={`w-full p-3 rounded-lg border transition-all ${
                            qty > 0
                              ? "border-orange-500/40 bg-orange-500/5"
                              : "border-slate-700 bg-slate-800 hover:border-slate-600"
                          } ${isExpanded ? "ring-2 ring-orange-500/50" : ""}`}
                        >
                          {/* Card Header - clickable area */}
                          <div
                            onClick={() => handleCardClick(item)}
                            className="cursor-pointer"
                          >
                            {/* Label row with optional stepper */}
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
                                    className="w-5 h-5 rounded-full bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                                    type="button"
                                  >
                                    −
                                  </button>
                                  <span className="w-4 text-center text-xs font-bold text-orange-400">
                                    {qty}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleQuantityChange(item, 1);
                                    }}
                                    className="w-5 h-5 rounded-full bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                                    type="button"
                                  >
                                    +
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="h-4 flex items-center justify-center">
                              {item.subcategory === "alfa" ? (
                                <AlfaLogo className="h-4 w-auto" />
                              ) : item.subcategory === "mtc" ? (
                                <MtcLogo className="h-4 w-auto" />
                              ) : (
                                <span className="text-slate-500 text-xs truncate">
                                  {item.subcategory}
                                </span>
                              )}
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

                        {/* Accordion Detail */}
                        {isExpanded && (
                          <div className="mt-2 p-3 bg-slate-900 rounded-lg border border-slate-700">
                            {isTelecom && (
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <input
                                    type="checkbox"
                                    id={`onlydays-${item.key}`}
                                    checked={inCart?.onlyDays ?? false}
                                    onChange={(e) =>
                                      handleOnlyDaysChange(
                                        item,
                                        e.target.checked,
                                      )
                                    }
                                    className="w-4 h-4 rounded border-slate-600 text-orange-500 focus:ring-orange-500 cursor-pointer"
                                  />
                                  <label
                                    htmlFor={`onlydays-${item.key}`}
                                    className="text-xs text-slate-300 cursor-pointer select-none whitespace-nowrap"
                                  >
                                    Only Days
                                  </label>
                                </div>
                                {(inCart?.onlyDays ?? false) && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-xs text-slate-400 whitespace-nowrap">
                                      Credits
                                    </span>
                                    <input
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      max={parseFloat(item.label) || 0}
                                      value={inCart?.returnedCreditsUsd ?? 0}
                                      onChange={(e) =>
                                        handleReturnedCreditsChange(
                                          item,
                                          parseFloat(e.target.value) || 0,
                                        )
                                      }
                                      className="w-14 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-orange-500"
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
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
                totalAmountCurrency="LBP"
                currency="LBP"
                onChange={setPaymentLines}
                showPmFee={false}
                paymentMethods={methods}
                currencies={[
                  { code: "USD", symbol: "$" },
                  { code: "LBP", symbol: "LBP" },
                ]}
                exchangeRate={exchangeRate}
              />
            ) : (
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
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
              Items: <span className="text-white font-bold">{totalItems}</span>
            </div>
            <div className="text-xs text-slate-400">
              Price:{" "}
              <span className="text-emerald-400 font-mono">
                {totalPrice.toLocaleString()} LBP
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 min-w-[200px]">
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Client name (optional)"
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting || totalItems === 0}
            className={`px-6 py-3 rounded-lg font-bold text-white transition-all ${
              isSubmitting || totalItems === 0
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : "bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-500/20"
            }`}
          >
            {isSubmitting ? "Processing..." : "Submit"}
          </button>
        </div>
      </div>

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={providerTransactions}
          provider={activeProvider as string}
          onClose={() => setShowHistory(false)}
          onRefresh={loadFinancialData}
          formatAmount={formatAmount}
        />
      )}
    </div>
  );
}
