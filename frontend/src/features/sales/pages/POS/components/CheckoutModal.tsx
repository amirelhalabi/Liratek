import { useState, useEffect, useRef, useMemo } from "react";
import logger from "../../../../../utils/logger";
import { X, User, Printer, Inbox } from "lucide-react";
import { DRAWER_B, roundLBPUp, useApi } from "@liratek/ui";
import { useDynamicExchangeRate } from "../../../../../hooks/useDynamicExchangeRate";
import { usePaymentMethods } from "../../../../../hooks/usePaymentMethods";
import { useShopInfo } from "../../../../../hooks/useShopName";
import {
  formatReceipt58mm,
  type ReceiptData,
} from "../../../utils/receiptFormatter";
import type { Client, CartItem, SaleRequest } from "@liratek/ui";
import { useSession } from "../../../../sessions/context/SessionContext";

export type PaymentData = Omit<SaleRequest, "items" | "status" | "id"> & {
  cart?: CartItem[];
} & { clientId?: number | null; paidUSD?: number; paidLBP?: number };

interface CheckoutModalProps {
  items?: CartItem[];
  totalAmount: number;
  onClose: () => void;
  onComplete: (paymentData: PaymentData) => Promise<void>;
  onSaveDraft: (paymentData: PaymentData) => Promise<void>;
  draftData?: CheckoutDraftData; // optional: only provided when restoring a draft
  onRestoreDraftComplete?: () => void;
}

export type CheckoutDraftData = {
  selectedClient: Client | null;
  clientSearchInput: string;
  clientSearchSecondary: string;
  discount: number;
  paidUSD: number;
  paidLBP: number;
  changeGivenUSD: number;
  changeGivenLBP: number;
  exchangeRate: number;
};

const generateReceiptNumber = () => `RCP-${Date.now()}`;

const receiptPrintCSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 72mm; margin: 0 auto; }
  pre { font-family: 'Courier New', monospace; font-size: 11px; font-weight: bold; white-space: pre-wrap; word-break: break-all; line-height: 1.4; }
  @media print {
    @page { size: 72mm auto; margin: 0; }
    html, body { width: 72mm; margin: 0; padding: 0; }
  }`;

const printReceiptContent = (content: string) => {
  const printWindow = window.open("", "", "width=400,height=600");
  if (printWindow) {
    printWindow.document.write(`<!DOCTYPE html>
<html>
<head><title>Receipt</title><style>\${receiptPrintCSS}</style></head>
<body><pre>\${content}</pre></body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  }
};

export default function CheckoutModal({
  items,
  totalAmount,
  onClose,
  onComplete,
  onSaveDraft,
  draftData,
  onRestoreDraftComplete,
}: CheckoutModalProps) {
  const api = useApi();
  const { activeSession } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);

  // Payment State
  const [discount, setDiscount] = useState(0);

  type PaymentCurrencyCode = "USD" | "LBP";
  type PaymentLine = {
    id: string;
    method: string;
    currency_code: PaymentCurrencyCode;
    amount: number;
  };

  const { allMethods: paymentMethodOptions } = usePaymentMethods();
  const shopInfo = useShopInfo();

  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([
    {
      id: crypto.randomUUID(),
      method: "CASH",
      currency_code: "USD",
      amount: 0,
    },
  ]);

  // Determine selected currency from payment lines
  const hasLBPPayment = paymentLines.some(
    (line) => line.currency_code === "LBP",
  );
  const selectedCurrency = hasLBPPayment ? "LBP" : "USD";

  // Dynamic exchange rate for SALE transaction (Money IN = We Sell USD rate)
  const {
    rate: exchangeRate,
    rateInfo: _rateInfo,
    isBaseCurrency: _isBaseCurrency,
  } = useDynamicExchangeRate({
    selectedCurrency,
    transactionType: "SALE",
  });

  // State for custom exchange rate (editable)
  const [customExchangeRate, setCustomExchangeRate] = useState<string>(
    exchangeRate.toString(),
  );

  // Update custom rate when auto rate changes
  useEffect(() => {
    setCustomExchangeRate(exchangeRate.toString());
  }, [exchangeRate]);

  const paidUSD = paymentLines
    .filter((p) => p.currency_code === "USD")
    .reduce((acc, p) => acc + (p.amount || 0), 0);

  const paidLBP = paymentLines
    .filter((p) => p.currency_code === "LBP")
    .reduce((acc, p) => acc + (p.amount || 0), 0);

  // Track if customer was auto-filled from session
  const [isAutoFilledFromSession, setIsAutoFilledFromSession] = useState(false);

  // Ref for customer search input — prevents focus loss during re-renders
  const customerSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Fetch clients for search
    const fetchClients = async () => {
      const data = await api.getClients("");
      setClients(data);
    };
    fetchClients();

    // Auto-fill customer from active session
    if (activeSession && !draftData) {
      setClientSearch(activeSession.customer_name || "");
      if (activeSession.customer_phone) {
        setSecondaryInput(activeSession.customer_phone);
      }
      setIsAutoFilledFromSession(true);
    }
  }, [activeSession, draftData]);

  // Restore draft data when it's provided
  useEffect(() => {
    if (draftData) {
      setSelectedClient(draftData.selectedClient);
      setClientSearch(draftData.clientSearchInput);
      setSecondaryInput(draftData.clientSearchSecondary);
      setDiscount(draftData.discount ?? 0);
      // Restore legacy paid totals into a default CASH split
      const restoredUSD = draftData.paidUSD ?? 0;
      const restoredLBP = draftData.paidLBP ?? 0;
      setPaymentLines([
        ...(restoredUSD
          ? [
              {
                id: crypto.randomUUID(),
                method: "CASH" as const,
                currency_code: "USD" as const,
                amount: restoredUSD,
              },
            ]
          : []),
        ...(restoredLBP
          ? [
              {
                id: crypto.randomUUID(),
                method: "CASH" as const,
                currency_code: "LBP" as const,
                amount: restoredLBP,
              },
            ]
          : []),
        ...(!restoredUSD && !restoredLBP
          ? [
              {
                id: crypto.randomUUID(),
                method: "CASH" as const,
                currency_code: "USD" as const,
                amount: 0,
              },
            ]
          : []),
      ]);
      setChangeGivenUSD(draftData.changeGivenUSD ?? 0);
      setChangeGivenLBP(draftData.changeGivenLBP ?? 0);
      onRestoreDraftComplete?.();
    }
  }, [draftData, onRestoreDraftComplete]);

  // Filter clients for dropdown
  const filteredClients = clients.filter(
    (c) =>
      c.full_name.toLowerCase().includes(clientSearch.toLowerCase()) ||
      (c.phone_number || "").includes(clientSearch),
  );

  // State for the secondary input (Name or Phone depending on search)
  const [secondaryInput, setSecondaryInput] = useState("");

  // Heuristic: Is the search mainly digits?
  const isSearchPhone =
    /^\+?[\d\s-]+$/.test(clientSearch) && clientSearch.length > 0;

  // Derived Label & Placeholder
  const secondaryLabel = isSearchPhone ? "Full Name" : "Phone Number";
  const secondaryPlaceholder = isSearchPhone
    ? "Enter Full Name..."
    : "Enter Phone Number...";

  // Change State
  const [changeGivenUSD, setChangeGivenUSD] = useState(0);
  const [changeGivenLBP, setChangeGivenLBP] = useState(0);

  // Validation for Debt: both primary (clientSearch) and secondary (secondaryInput) must be filled for new clients
  const isNewClientInfoComplete =
    clientSearch.trim().length > 0 && secondaryInput.trim().length > 0;

  // Check if DEBT payment method is enabled
  const debtPaymentEnabled = paymentMethodOptions.some(
    (pm) => pm.code === "DEBT",
  );

  // Determine whether creating a debt is allowed: existing client must have phone, new client must have both fields
  const canCreateDebt = selectedClient
    ? !!(
        selectedClient.phone_number &&
        selectedClient.phone_number.trim().length > 0
      )
    : isNewClientInfoComplete;

  const finalAmount = Math.max(0, totalAmount - discount);
  const effectiveExchangeRate = parseFloat(customExchangeRate) || exchangeRate;
  const totalPaidInUSD = paidUSD + paidLBP / effectiveExchangeRate;
  const remaining = finalAmount - totalPaidInUSD;
  const change = remaining < 0 ? Math.abs(remaining) : 0;

  const getPaymentData = () => {
    // Determine effective client details
    const finalClientId =
      selectedClient?.id && selectedClient.id > 0 ? selectedClient.id : null;
    let finalClientName: string | undefined;
    let finalClientPhone: string | undefined;

    if (selectedClient?.id === 0) {
      finalClientName = selectedClient.full_name;
      finalClientPhone = selectedClient.phone_number;
    } else if (!selectedClient && clientSearch.trim()) {
      if (isSearchPhone) {
        finalClientPhone = clientSearch.trim();
        finalClientName = secondaryInput.trim() || `Client \${finalClientPhone}`;
      } else {
        finalClientName = clientSearch.trim();
        finalClientPhone = secondaryInput.trim();
      }
    }

    return {
      client_id: finalClientId,
      ...(finalClientName ? { client_name: finalClientName } : {}),
      ...(finalClientPhone ? { client_phone: finalClientPhone } : {}),
      total_amount: totalAmount,
      discount: discount,
      final_amount: finalAmount,
      payment_usd: paidUSD,
      payment_lbp: paidLBP,
      payments: paymentLines.map(({ method, currency_code, amount }) => ({
        method,
        currency_code,
        amount,
      })),
      change_given_usd: changeGivenUSD,
      change_given_lbp: changeGivenLBP,
      exchange_rate: effectiveExchangeRate,
      drawer_name: DRAWER_B, // legacy field (kept for backward compatibility)
    };
  };

  const handleComplete = async () => {
    // Block debt creation when DEBT payment method is disabled
    if (remaining > 0.05 && !debtPaymentEnabled) {
      alert(
        "Debt payment method is disabled. The full amount must be paid before completing the sale.",
      );
      return;
    }

    // Validation: Debt requires a complete profile for new debts
    if (remaining > 0.05 && !canCreateDebt) {
      alert(
        "To create or leave a debt, please ensure the client has a phone number (existing client) or provide both name and phone (new client).",
      );
      return;
    }

    setIsLoading(true);
    try {
      await onComplete(getPaymentData());
    } catch (error) {
      logger.error("Operation failed", { error });
      setIsLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    setIsLoading(true);
    try {
      await onSaveDraft(getPaymentData());
    } catch (error) {
      logger.error("Operation failed", { error });
      setIsLoading(false);
    }
  };

  const [receiptNumber, setReceiptNumber] = useState<string>("");

  // Generate receipt number only once when modal is opened
  useEffect(() => {
    if (!receiptNumber) {
      setReceiptNumber(generateReceiptNumber());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getReceiptData = (): ReceiptData => {
    return {
      shop_name: shopInfo.name || "Corner Tech",
      shop_phone: shopInfo.phone || "",
      shop_location: shopInfo.location || "",
      receipt_number: receiptNumber || generateReceiptNumber(),
      client_name:
        selectedClient?.full_name || clientSearch || "Walk-in Customer",
      client_phone: selectedClient?.phone_number || secondaryInput,
      items: (items || []).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.retail_price,
        subtotal: item.retail_price * item.quantity,
        imei: item.imei || null,
      })),
      subtotal: totalAmount,
      discount: discount,
      total: finalAmount,
      payment_usd: paidUSD,
      payment_lbp: paidLBP,
      change_usd: changeGivenUSD,
      change_lbp: changeGivenLBP,
      exchange_rate: effectiveExchangeRate,
      timestamp: new Date().toISOString(),
      operator: "Staff",
    };
  };

  const handlePrintReceipt = () => {
    const receipt = getReceiptData();
    const formatted = formatReceipt58mm(receipt);
    printReceiptContent(formatted);
  };

  const handleDirectPrint = () => {
    const receipt = getReceiptData();
    const formatted = formatReceipt58mm(receipt);
    printReceiptContent(formatted);
  };

  const drawerNameDisplay = String(DRAWER_B).replace(/_/g, " ");

  // Memoize receipt content to ensure it updates when shopInfo or other data changes
  const receiptContent = useMemo(() => {
    if (!showReceiptPreview) return "";
    return formatReceipt58mm(getReceiptData());
  }, [showReceiptPreview, shopInfo, items, totalAmount, discount, paidUSD, paidLBP, changeGivenUSD, changeGivenLBP, effectiveExchangeRate, receiptNumber]);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div
          className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-7xl shadow-2xl flex overflow-hidden h-[85vh]"
          role="presentation"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Left: Summary & Client */}
          <div className="w-1/2 bg-slate-800 p-8 border-r border-slate-700 flex flex-col">
            <h2 className="text-2xl font-bold text-white mb-6">Checkout</h2>

            {/* ── Customer inputs (fixed height at top) ── */}
            <div className="shrink-0">
              <label
                htmlFor="checkout-customer"
                className="block text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider"
              >
                Customer
              </label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                {/* Primary Input (Search) */}
                <div className="relative">
                  <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 focus-within:ring-2 focus-within:ring-violet-600 transition-all h-[52px]">
                    <div className="p-3 bg-slate-800 rounded-lg text-slate-400 shrink-0">
                      <User size={20} />
                    </div>
                    <input
                      ref={customerSearchRef}
                      type="text"
                      value={clientSearch}
                      onChange={(e) => {
                        setClientSearch(e.target.value);
                        if (
                          selectedClient &&
                          e.target.value !== selectedClient.full_name
                        ) {
                          setSelectedClient(null);
                        }
                        if (secondaryInput) setSecondaryInput("");
                        if (isAutoFilledFromSession)
                          setIsAutoFilledFromSession(false);
                        requestAnimationFrame(() => {
                          customerSearchRef.current?.focus();
                        });
                      }}
                      className="bg-transparent border-none text-white w-full px-3 focus:outline-none"
                      placeholder="Search Name or Phone..."
                    />
                    {selectedClient && (
                      <button
                        onClick={() => {
                          setSelectedClient(null);
                          setClientSearch("");
                          setSecondaryInput("");
                        }}
                        className="p-2 text-slate-400 hover:text-white shrink-0"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {/* Dropdown Results */}
                  {clientSearch &&
                    !selectedClient &&
                    !isAutoFilledFromSession &&
                    filteredClients.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto">
                        {filteredClients.map((client) => (
                          <button
                            key={client.id}
                            onClick={() => {
                              setSelectedClient(client);
                              setClientSearch(client.full_name);
                              setSecondaryInput(client.phone_number || "");
                            }}
                            className="w-full text-left p-3 hover:bg-slate-700 text-slate-200 border-b border-slate-700/50 last:border-0"
                          >
                            <div className="font-medium">
                              {client.full_name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {client.phone_number}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                </div>

                {/* Secondary Input */}
                <div>
                  <div
                    className={`flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 focus-within:ring-2 focus-within:ring-violet-600 transition-all h-[52px] \${!clientSearch ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <input
                      type="text"
                      value={secondaryInput}
                      onChange={(e) => {
                        const input = e.target;
                        setSecondaryInput(e.target.value);
                        requestAnimationFrame(() => input.focus());
                      }}
                      className="bg-transparent border-none text-white w-full px-4 focus:outline-none"
                      placeholder={secondaryPlaceholder}
                      disabled={!clientSearch || !!selectedClient}
                    />
                  </div>
                </div>
              </div>

              {/* Helper Text */}
              {!selectedClient &&
                clientSearch.length > 0 &&
                filteredClients.length === 0 && (
                  <div className="mb-2">
                    <div className="text-xs text-slate-500 ml-1">
                      Creating new client.{" "}
                      <span className="text-violet-400">
                        Add {secondaryLabel.toLowerCase()} to enable debt.
                      </span>
                    </div>
                    {remaining > 0.05 && !canCreateDebt && (
                      <div className="text-sm text-red-400 mt-1 ml-1">
                        Debts require a valid client phone. Provide both name
                        and phone for new clients.
                      </div>
                    )}
                  </div>
                )}
            </div>

            {/* ── Cart Items List (fills available space, scrolls when needed) ── */}
            {items && items.length > 0 && (
              <div className="flex-1 min-h-0 my-4 bg-slate-900/50 rounded-xl border border-slate-700/50 overflow-hidden">
                <div className="h-full overflow-y-auto divide-y divide-slate-700/50">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-sm text-slate-200 truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.quantity} × \${item.retail_price.toFixed(2)}
                        </p>
                      </div>
                      <span className="text-sm font-mono text-slate-300 shrink-0">
                        \${(item.quantity * item.retail_price).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Order Summary (pinned to bottom) ── */}
            <div className="shrink-0 bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
              <div className="space-y-3">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal</span>
                  <span>\${totalAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Discount</span>
                  <div className="relative w-28">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                      $
                    </span>
                    <input
                      type="number"
                      value={discount || ""}
                      onChange={(e) =>
                        setDiscount(parseFloat(e.target.value) || 0)
                      }
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-7 pr-3 py-2 text-white font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 text-right"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="border-t border-slate-700 pt-3 flex justify-between items-center">
                  <span className="text-lg font-bold text-white">
                    Net Total
                  </span>
                  <span className="text-2xl font-bold text-violet-400">
                    \${finalAmount.toFixed(2)}
                  </span>
                </div>
                <div className="text-right text-xs text-slate-500">
                  ≈ {(finalAmount * effectiveExchangeRate).toLocaleString()} LBP
                </div>
              </div>
            </div>
          </div>

          {/* Right: Payment */}
          <div className="w-1/2 p-8 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-slate-300">
                Payment Details
              </h3>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">1 USD =</label>
                <input
                  type="number"
                  value={customExchangeRate}
                  onChange={(e) => setCustomExchangeRate(e.target.value)}
                  className="w-28 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1 text-white font-mono text-xs focus:outline-none focus:border-violet-500"
                  placeholder={exchangeRate.toString()}
                />
                <label className="text-xs text-slate-500">LBP</label>
              </div>
            </div>

            <div className="space-y-6 flex-1 overflow-y-auto">
              {/* ── Payment Input ─────────────────────────────────────────────────
                  Single PM: simple currency + amount fields (no method dropdown)
                  Multiple PMs: full payment-lines UI with + Add line              */}
              {paymentMethodOptions.length === 1 ? (
                /* ── Simple mode: two independent currency fields ─────────────── */
                (() => {
                  const singleMethod = paymentMethodOptions[0];
                  // Find or create persistent line IDs for USD and LBP
                  const usdLine = paymentLines.find(
                    (l) => l.currency_code === "USD",
                  );
                  const lbpLine = paymentLines.find(
                    (l) => l.currency_code === "LBP",
                  );
                  const updateSimpleLine = (
                    currency: "USD" | "LBP",
                    val: number,
                  ) => {
                    setPaymentLines((prev) => {
                      const existing = prev.find(
                        (l) => l.currency_code === currency,
                      );
                      const other = prev.filter(
                        (l) => l.currency_code !== currency,
                      );
                      const updated = {
                        id: existing?.id ?? crypto.randomUUID(),
                        method: singleMethod.code,
                        currency_code: currency,
                        amount: val,
                      };
                      // Keep both lines; filter out zero-amount lines only on submit
                      return [...other, updated];
                    });
                  };
                  return (
                    <div className="space-y-3">
                      <div className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                        {singleMethod.label}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {/* USD */}
                        <div>
                          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 focus-within:ring-2 focus-within:ring-violet-600 transition-all h-[52px]">
                            <span className="pl-3 text-slate-400 text-sm shrink-0">
                              $
                            </span>
                            <input
                              type="number"
                              value={usdLine?.amount || ""}
                              onChange={(e) =>
                                updateSimpleLine(
                                  "USD",
                                  parseFloat(e.target.value) || 0,
                                )
                              }
                              className="bg-transparent border-none text-white w-full px-3 focus:outline-none font-mono"
                              placeholder="0.00"
                              step="0.01"
                            />
                          </div>
                        </div>
                        {/* LBP */}
                        <div>
                          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 focus-within:ring-2 focus-within:ring-violet-600 transition-all h-[52px]">
                            <input
                              type="number"
                              value={lbpLine?.amount || ""}
                              onChange={(e) =>
                                updateSimpleLine(
                                  "LBP",
                                  parseFloat(e.target.value) || 0,
                                )
                              }
                              className="bg-transparent border-none text-white w-full px-4 focus:outline-none font-mono"
                              placeholder="0"
                            />
                            <span className="pr-3 text-slate-400 text-xs shrink-0">
                              LBP
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 text-right">
                        Paid:{" "}
                        <span className="font-mono text-slate-300">
                          \${paidUSD.toFixed(2)} USD
                          {paidLBP > 0 && ` + \${paidLBP.toLocaleString()} LBP`}
                        </span>
                      </div>
                    </div>
                  );
                })()
              ) : (
                /* ── Multi-line mode ──────────────────────────────────────────── */
                <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                      Payment Lines
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setPaymentLines((prev) => [
                          ...prev,
                          {
                            id: crypto.randomUUID(),
                            method: paymentMethodOptions[0]?.code ?? "CASH",
                            currency_code: "USD",
                            amount: 0,
                          },
                        ])
                      }
                      className="text-xs px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                    >
                      + Add line
                    </button>
                  </div>

                  <div className="space-y-2">
                    {paymentLines.map((line, idx) => (
                      <div
                        key={line.id}
                        className="grid grid-cols-12 gap-2 items-center"
                      >
                        <div className="col-span-4">
                          <select
                            value={line.method}
                            onChange={(e) =>
                              setPaymentLines((prev) =>
                                prev.map((p, i) =>
                                  i === idx
                                    ? { ...p, method: e.target.value }
                                    : p,
                                ),
                              )
                            }
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                          >
                            {paymentMethodOptions.map((pm) => (
                              <option key={pm.code} value={pm.code}>
                                {pm.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-3">
                          <select
                            value={line.currency_code}
                            onChange={(e) =>
                              setPaymentLines((prev) =>
                                prev.map((p, i) =>
                                  i === idx
                                    ? {
                                        ...p,
                                        currency_code: e.target
                                          .value as PaymentCurrencyCode,
                                      }
                                    : p,
                                ),
                              )
                            }
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                          >
                            <option value="USD">USD</option>
                            <option value="LBP">LBP</option>
                          </select>
                        </div>
                        <div className="col-span-4">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                              {line.currency_code === "USD" ? "$" : "LBP"}
                            </span>
                            <input
                              type="number"
                              value={line.amount || ""}
                              onChange={(e) =>
                                setPaymentLines((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? {
                                          ...p,
                                          amount:
                                            parseFloat(e.target.value) || 0,
                                        }
                                      : p,
                                  ),
                                )
                              }
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-10 pr-3 py-2 text-white text-sm font-mono"
                              placeholder="0"
                            />
                          </div>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <button
                            type="button"
                            disabled={paymentLines.length === 1}
                            onClick={() =>
                              setPaymentLines((prev) =>
                                prev.filter((_, i) => i !== idx),
                              )
                            }
                            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Remove line"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 text-xs text-slate-400">
                    Totals:{" "}
                    <span className="font-mono">\${paidUSD.toFixed(2)}</span> USD
                    +{" "}
                    <span className="font-mono">
                      {paidLBP.toLocaleString()}
                    </span>{" "}
                    LBP
                  </div>
                </div>
              )}
            </div>

            {/* ── Calculations (pinned to bottom, mirrors Order Summary) ── */}
            <div className="shrink-0 bg-slate-900/50 rounded-xl p-4 border border-slate-700/50 mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Total Paid (Converted)</span>
                <span className="text-white font-mono">
                  \${totalPaidInUSD.toFixed(2)}
                </span>
              </div>

              {remaining > 0.05 ? (
                <>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-700">
                    <span
                      className={`font-medium \${debtPaymentEnabled ? "text-red-400" : "text-orange-400"}`}
                    >
                      {debtPaymentEnabled
                        ? "Remaining (Debt)"
                        : "Remaining (Must Pay)"}
                    </span>
                    <div className="text-right">
                      <div
                        className={`font-bold text-xl \${debtPaymentEnabled ? "text-red-400" : "text-orange-400"}`}
                      >
                        \${remaining.toFixed(2)}
                      </div>
                      <div
                        className={`text-xs \${debtPaymentEnabled ? "text-red-500/70" : "text-orange-500/70"}`}
                      >
                        ≈ {(remaining * effectiveExchangeRate).toLocaleString()}{" "}
                        LBP
                      </div>
                    </div>
                  </div>
                  {!debtPaymentEnabled && (
                    <div className="mt-2 text-xs text-orange-400 bg-orange-500/10 rounded px-3 py-2">
                      Debt is disabled. Full payment required to complete this
                      sale.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-700">
                    <span className="text-emerald-400 font-medium">
                      Change Due
                    </span>
                    <div className="text-right">
                      <div className="text-emerald-400 font-bold text-xl">
                        \${change.toFixed(2)}
                      </div>
                      <div className="text-xs text-emerald-500/70">
                        ≈ {(change * effectiveExchangeRate).toLocaleString()}{" "}
                        LBP
                      </div>
                    </div>
                  </div>

                  {/* Change Given Inputs */}
                  {change > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-700/50 animate-in fade-in slide-in-from-top-2">
                      <span
                        id="checkout-change-given-label"
                        className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider"
                      >
                        Change Given
                      </span>
                      <div
                        className="flex gap-4 mb-2"
                        role="group"
                        aria-labelledby="checkout-change-given-label"
                      >
                        <div className="flex-1">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                              $
                            </span>
                            <input
                              type="number"
                              value={changeGivenUSD || ""}
                              onChange={(e) =>
                                setChangeGivenUSD(
                                  parseFloat(e.target.value) || 0,
                                )
                              }
                              className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-8 pr-3 py-2 text-white focus:outline-none focus:border-violet-500"
                              placeholder="USD"
                            />
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="relative">
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                              LBP
                            </span>
                            <input
                              type="number"
                              value={changeGivenLBP || ""}
                              onChange={(e) =>
                                setChangeGivenLBP(
                                  parseFloat(e.target.value) || 0,
                                )
                              }
                              className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-3 pr-10 py-2 text-white focus:outline-none focus:border-violet-500"
                              placeholder="LBP"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Smart Change Logic */}
                      {(() => {
                        const totalGiven =
                          changeGivenUSD +
                          changeGivenLBP / effectiveExchangeRate;
                        const diff = change - totalGiven;
                        const absDiff = Math.abs(diff);

                        // Smart Fix Handler - rounds to payable denominations
                        const handleSmartFix = () => {
                          const integerUSD = Math.floor(change);
                          const fractionUSD = change - integerUSD;
                          const rawLBP = fractionUSD * effectiveExchangeRate;

                          // Round LBP up to nearest 5,000 (smallest LBP bill)
                          const roundedLBP = roundLBPUp(rawLBP);

                          setChangeGivenUSD(integerUSD);
                          setChangeGivenLBP(roundedLBP);
                        };

                        if (diff > 0.05) {
                          // Underpaying change (Remaining to give)
                          return (
                            <div className="text-center text-xs text-red-400 font-medium bg-red-500/10 py-2 rounded flex items-center justify-center gap-2">
                              <span>
                                Remaining change to give: \${absDiff.toFixed(2)}{" "}
                                ≈{" "}
                                {(
                                  absDiff * effectiveExchangeRate
                                ).toLocaleString()}{" "}
                                LBP
                              </span>
                              <button
                                onClick={handleSmartFix}
                                className="px-2 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded text-[10px] uppercase font-bold tracking-wider transition-colors"
                              >
                                Fix
                              </button>
                            </div>
                          );
                        } else if (diff < -0.05) {
                          // Overpaying change (Caution)
                          return (
                            <div className="text-center text-xs text-amber-400 font-medium bg-amber-500/10 py-2 rounded flex items-center justify-center gap-2">
                              <span>
                                Caution: Returning excess change of $
                                {absDiff.toFixed(2)}
                              </span>
                              <button
                                onClick={handleSmartFix}
                                className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded text-[10px] uppercase font-bold tracking-wider transition-colors"
                              >
                                Fix
                              </button>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Drawer Info */}
            <div className="py-3 bg-slate-800/50 border-t border-slate-700 rounded-lg flex items-center gap-2 text-sm px-4 mt-4">
              <Inbox size={16} className="text-blue-400" />
              <span className="text-slate-300">
                This sale will be recorded in:{" "}
                <span className="font-bold text-blue-300">
                  {drawerNameDisplay}
                </span>
              </span>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={handleSaveDraft}
                disabled={isLoading}
                className="px-6 py-4 rounded-xl text-violet-300 hover:text-violet-100 hover:bg-violet-900/30 transition-colors font-medium border border-violet-500/30"
              >
                Save Draft
              </button>
              <button
                onClick={() => setShowReceiptPreview(true)}
                disabled={isLoading}
                className="px-4 py-4 rounded-xl text-blue-300 hover:text-blue-100 hover:bg-blue-900/30 transition-colors font-medium border border-blue-500/30 flex items-center gap-2"
              >
                <Printer size={18} />
                Preview
              </button>
              <button
                onClick={handleDirectPrint}
                disabled={isLoading}
                className="px-4 py-4 rounded-xl text-emerald-300 hover:text-emerald-100 hover:bg-emerald-900/30 transition-colors font-medium border border-emerald-500/30 flex items-center gap-2"
              >
                <Printer size={18} />
                Print
              </button>
              <button
                onClick={handleComplete}
                disabled={isLoading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-lg shadow-lg shadow-emerald-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? "Processing..." : "Complete Sale"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Receipt Preview Modal */}
      {showReceiptPreview && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowReceiptPreview(false);
            }
          }}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            role="presentation"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-700 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Printer size={24} className="text-blue-400" />
                Receipt Preview
              </h2>
              <button
                onClick={() => setShowReceiptPreview(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 flex justify-center bg-slate-950">
              <div className="bg-white p-8 shadow-2xl rounded-sm">
                <pre 
                  className="text-slate-900"
                  style={{ 
                    fontFamily: "'Courier New', monospace", 
                    fontSize: "13px", 
                    fontWeight: "bold", 
                    whiteSpace: "pre", // Use exact spacing, no wrapping
                    lineHeight: "1.4",
                    width: "auto",
                    minWidth: "38ch"
                  }}
                >
                  {receiptContent}
                </pre>
              </div>
            </div>

            <div className="p-6 border-t border-slate-700 flex gap-3">
              <button
                onClick={() => setShowReceiptPreview(false)}
                className="flex-1 px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg font-medium transition-colors"
              >
                Close
              </button>
              <button
                onClick={handlePrintReceipt}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Printer size={18} />
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
