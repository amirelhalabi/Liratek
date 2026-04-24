import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import AlfaLogo from "@/assets/logos/alfa.svg?react";
import MtcLogo from "@/assets/logos/mtc.svg?react";
import { MultiPaymentInput, type PaymentLine, useApi } from "@liratek/ui";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useSessionAutoFill } from "@/features/sessions/hooks/useSessionAutoFill";
import type { ProviderConfig, FinancialTransaction } from "../types";
import type { ServiceItem, ProviderKey } from "../hooks/useMobileServiceItems";
import { getCategoryColor } from "../utils/categoryColors";
import { HistoryModal } from "./HistoryModal";
import { getExchangeRates } from "@/utils/exchangeRates";
import logger from "@/utils/logger";

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
  loadFinancialData,
  formatAmount,
  alfaCreditSellRate,
  showHistory,
  setShowHistory,
}: KatchFormProps) {
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
  const [clientName, setClientName] = useState("");
  const [localSubmitting, setLocalSubmitting] = useState(false);

  // Autofill client name from active customer session, clear when session closes
  useSessionAutoFill([
    { select: (s) => s.customer_name, set: setClientName, clearValue: "" },
  ]);

  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const isSplitPayment = paymentLines.length > 1;
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
    if (cart.size === 0 || localSubmitting) return;

    // If session is active, add all cart items as one session cart entry
    if (activeSession) {
      const cartItems = Array.from(cart.values());
      const providerLabel = activeProvider === "Katsh" ? "Katsh" : "iPick";
      const itemLabels = cartItems
        .map((line) => `${line.item.label} x${line.quantity}`)
        .join(", ");
      const label =
        itemLabels.length > 60
          ? `${providerLabel} (${cartItems.length} items) - ${totalPrice.toLocaleString()} LBP`
          : `${providerLabel}: ${itemLabels}`;

      const finalPaymentMethod = isSplitPayment ? "MULTI" : paymentMethod;
      const paymentsPayload = isSplitPayment
        ? paymentLines.map((l) => ({
            method: l.method,
            currencyCode: l.currencyCode,
            amount: l.amount,
          }))
        : undefined;

      // Store each line item for replay at checkout
      const formDataItems = cartItems.flatMap((line) => {
        const sellPrice = calculatePrice(
          line.item,
          line.onlyDays,
          line.returnedCreditsUsd,
        );
        const cost = line.item.catalogCost ?? 0;
        const commission = sellPrice - cost;
        return Array.from({ length: line.quantity }, () => ({
          provider: activeProvider,
          serviceType: "SEND",
          amount: sellPrice,
          cost,
          currency: "LBP",
          commission: Math.max(0, commission),
          paidByMethod: finalPaymentMethod,
          payments: paymentsPayload,
          clientName: clientName || undefined,
          itemKey: line.item.key,
          itemCategory: line.item.category,
          note: `${line.item.label} (${line.item.subcategory})${line.onlyDays ? " [Only Days]" : ""}`,
        }));
      });

      addToSessionCart({
        module: activeProvider === "Katsh" ? "katsh" : "ipick",
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
      return;
    }

    setLocalSubmitting(true);

    const cartItems = Array.from(cart.values());
    const finalPaymentMethod = isSplitPayment ? "MULTI" : paymentMethod;
    const paymentsPayload = isSplitPayment
      ? paymentLines.map((l) => ({
          method: l.method,
          currencyCode: l.currencyCode,
          amount: l.amount,
        }))
      : undefined;

    let allSucceeded = true;

    for (const line of cartItems) {
      const sellPrice = calculatePrice(
        line.item,
        line.onlyDays,
        line.returnedCreditsUsd,
      );
      const cost = line.item.catalogCost ?? 0;
      const commission = sellPrice - cost;

      for (let i = 0; i < line.quantity; i++) {
        try {
          const result = await api.addOMTTransaction({
            provider: activeProvider,
            serviceType: "SEND",
            amount: sellPrice,
            cost,
            currency: "LBP",
            commission: Math.max(0, commission),
            paidByMethod: finalPaymentMethod,
            payments: paymentsPayload,
            clientName: clientName || undefined,
            itemKey: line.item.key,
            itemCategory: line.item.category,
            note: `${line.item.label} (${line.item.subcategory})${line.onlyDays ? " [Only Days]" : ""}`,
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
                logger.error("Failed to link Katch tx to session:", err);
              }
            }
          } else {
            logger.error("Katch submit failed:", result?.error);
            alert(result?.error || "Failed to process item");
            allSucceeded = false;
            break;
          }
        } catch (err) {
          logger.error("Katch submit error:", err);
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
    }
    loadFinancialData();
    setLocalSubmitting(false);
  };

  const filterProviderTransactions = (txs: FinancialTransaction[]) => {
    return txs.filter((tx) => tx.provider === activeProvider);
  };

  const providerTransactions = filterProviderTransactions(finTransactions);

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
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
      <div className="flex-1 min-h-0 overflow-auto space-y-6 pb-2">
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
                              ? "border-orange-500/40 ring-1 ring-orange-500/30"
                              : "border-white/10 hover:border-white/20"
                          } ${isExpanded ? "ring-2 ring-orange-500/50" : ""}`}
                          style={{
                            backgroundColor: `${getCategoryColor(item.category)}18`,
                          }}
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
            disabled={localSubmitting || totalItems === 0}
            className={`px-6 py-3 rounded-lg font-bold text-white transition-all ${
              localSubmitting || totalItems === 0
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : "bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-500/20"
            }`}
          >
            {localSubmitting ? "Processing..." : "Submit"}
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
