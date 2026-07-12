import { useState, useEffect, useRef, useMemo } from "react";
import logger from "@/utils/logger";
import { X, User, Printer, Inbox, Pencil, Minus } from "lucide-react";
import {
  canChargeToCustomerAccount,
  DecimalInput,
  MultiPaymentInput,
  useApi,
  appEvents,
  type PaymentLine,
} from "@liratek/ui";
import { useDynamicExchangeRate } from "@/hooks/useDynamicExchangeRate";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useShopInfo } from "@/hooks/useShopName";
import {
  formatReceipt58mm,
  type ReceiptData,
} from "@/features/sales/utils/receiptFormatter";
import type { Client, CartItem, SaleRequest } from "@liratek/ui";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import {
  RECEIPT_NUMBER_PREFIX,
  DEFAULT_DRAWER_NAME as DRAWER_B,
} from "@/constants/checkout";
import {
  isPaymentComplete,
  convertLBPToUSD,
  toSnakeLegs,
} from "@/utils/paymentUtils";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";

export type PaymentData = Omit<SaleRequest, "items" | "status" | "id"> & {
  cart?: CartItem[];
} & { clientId?: number | null; paidUSD?: number; paidLBP?: number };

interface CheckoutModalProps {
  items?: CartItem[];
  totalAmount: number;
  /**
   * Currency the total/discount/net are expressed in. Defaults to "USD".
   * When "LBP", the modal treats `totalAmount` as an LBP amount and performs
   * all settlement (remaining/change/debt) in LBP. The USD path is unchanged
   * when this prop is omitted.
   */
  currency?: "USD" | "LBP";
  onClose?: () => void;
  onComplete: (paymentData: PaymentData) => Promise<void>;
  onSaveDraft: (paymentData: PaymentData) => Promise<void>;
  onMinimize?: (checkoutData: CheckoutDraftData) => void;
  onEdit?: (checkoutData: CheckoutDraftData) => void;
  onCancel?: () => void;
  draftData?: CheckoutDraftData; // optional: only provided when restoring a draft
  onRestoreDraftComplete?: () => void;
  isDraft?: boolean;
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

const generateReceiptNumber = () => `${RECEIPT_NUMBER_PREFIX}${Date.now()}`;

const receiptPrintCSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 80mm; margin: 0 auto; }
  pre { font-family: 'Courier New', monospace; font-size: 11px; font-weight: bold; white-space: pre-wrap; word-break: break-all; line-height: 1.4; }
  @media print {
    @page { size: 80mm auto; margin: 0; }
    html, body { width: 80mm; margin: 0; padding: 0; }
  }`;

const printReceiptContent = async (content: string, targetPrinter?: string) => {
  if (targetPrinter && window.api?.print?.silentPrint) {
    logger.info(`Sending receipt to silent printer: ${targetPrinter}`);
    const fullHtml = `<!DOCTYPE html>
<html>
<head><title>Receipt</title><style>${receiptPrintCSS}</style></head>
<body><pre>${content}</pre></body>
</html>`;
    const result = await window.api.print.silentPrint(fullHtml, targetPrinter);
    if (!result?.success) {
      logger.error(`Silent receipt print failed: ${result?.error}`);
      appEvents.emit(
        "notification:show",
        "Receipt printing failed: " + (result?.error || "Unknown error"),
        "error",
      );
    }
  } else {
    // Fallback if not configured or not running in electron
    const printWindow = window.open("", "", "width=400,height=600");
    if (printWindow) {
      printWindow.document.write(`<!DOCTYPE html>
  <html>
  <head><title>Receipt</title><style>${receiptPrintCSS}</style></head>
  <body><pre>${content}</pre></body>
  </html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      printWindow.close();
      // Windows focus fix
      setTimeout(() => {
        (window as any).api?.display?.fixFocus?.();
      }, 100);
    }
  }
};

export default function CheckoutModal({
  items,
  totalAmount,
  currency,
  onClose,
  onComplete,
  onSaveDraft,
  onMinimize,
  onEdit,
  onCancel,
  draftData,
  onRestoreDraftComplete,
  isDraft,
}: CheckoutModalProps) {
  useModalFocusFix(true);
  // Currency the total is expressed in ("USD" by default). When "LBP" the
  // settlement math runs in LBP; otherwise behaviour is identical to before.
  const totalCurrency = currency ?? "USD";
  const isLbpTotal = totalCurrency === "LBP";
  /** Format a value in the job currency. */
  const fmtTotal = (v: number) =>
    isLbpTotal ? `${Math.round(v).toLocaleString()} LBP` : `$${v.toFixed(2)}`;
  const api = useApi();
  const { activeSession } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);

  // Payment State
  const [discount, setDiscount] = useState(0);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();

  const { allMethods: paymentMethodOptions } = usePaymentMethods();
  const shopInfo = useShopInfo();

  // ── MultiPaymentInput state ──────────────────────────────────────────────
  // Vouchers, currency conversion, exchange-rate editing, and the CASH
  // return/change UI all live inside the shared component now (see
  // fetchClientVouchers/clientId/cashOnlyReturn props on the element below).
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [returnLines, setReturnLines] = useState<PaymentLine[]>([]);
  // Bumped whenever a draft is (re)restored so MultiPaymentInput remounts and
  // re-reads initialLines (its own contract: read once on mount).
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [draftInitialLines, setDraftInitialLines] = useState<
    Array<{ method?: string; currencyCode: string; amount: number }> | undefined
  >(() => {
    if (!draftData) return undefined;
    const lines: Array<{ method?: string; currencyCode: string; amount: number }> =
      [];
    if (draftData.paidUSD) {
      lines.push({
        method: "CASH",
        currencyCode: "USD",
        amount: draftData.paidUSD,
      });
    }
    if (draftData.paidLBP) {
      lines.push({
        method: "CASH",
        currencyCode: "LBP",
        amount: draftData.paidLBP,
      });
    }
    return lines.length > 0 ? lines : undefined;
  });

  // Determine selected currency from payment lines
  const hasLBPPayment = paymentLines.some(
    (line) => line.currencyCode === "LBP",
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

  // State for custom exchange rate (editable inside MultiPaymentInput now)
  const [customExchangeRate, setCustomExchangeRate] = useState<string>(
    exchangeRate.toString(),
  );

  // Update custom rate when auto rate changes
  useEffect(() => {
    setCustomExchangeRate(exchangeRate.toString());
  }, [exchangeRate]);

  // Bubble a rate edited inside MultiPaymentInput up — CheckoutModal's own
  // remaining/change/receipt math lives outside the shared component and
  // must use the operator's override, not the stale dynamic-rate seed.
  const handleRateChange = (rate: number) => {
    setCustomExchangeRate(rate.toString());
  };

  const paidUSD = paymentLines
    .filter((p) => p.currencyCode === "USD")
    .reduce((acc, p) => acc + (p.amount || 0), 0);

  const paidLBP = paymentLines
    .filter((p) => p.currencyCode === "LBP")
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

    // Auto-fill customer from active session ONLY if:
    // 1. No draft data exists, OR draft data has no customer
    // 2. AND no customer is currently set
    const draftHasCustomer =
      draftData?.clientSearchInput &&
      draftData.clientSearchInput.trim().length > 0;

    if (activeSession && !draftHasCustomer && !clientSearch) {
      setClientSearch(activeSession.customer_name || "");
      if (activeSession.customer_phone) {
        setSecondaryInput(activeSession.customer_phone);
      }
      setIsAutoFilledFromSession(true);
    } else if (!activeSession && isAutoFilledFromSession) {
      setClientSearch("");
      setSecondaryInput("");
      setIsAutoFilledFromSession(false);
    }
  }, [activeSession, draftData, clientSearch, isAutoFilledFromSession]);

  // Restore draft data when it's provided. Payment lines are restored via
  // MultiPaymentInput's own initialLines contract (read once on mount) — bump
  // paymentInputKey to force a remount so it re-reads the new seed. Change
  // given is NOT restored explicitly: MultiPaymentInput re-derives it from
  // (restored payment lines) vs. (finalAmount) on its own first render.
  useEffect(() => {
    if (draftData) {
      setSelectedClient(draftData.selectedClient);
      setClientSearch(draftData.clientSearchInput);
      setSecondaryInput(draftData.clientSearchSecondary);
      setDiscount(draftData.discount ?? 0);
      const lines: Array<{ method?: string; currencyCode: string; amount: number }> =
        [];
      if (draftData.paidUSD) {
        lines.push({
          method: "CASH",
          currencyCode: "USD",
          amount: draftData.paidUSD,
        });
      }
      if (draftData.paidLBP) {
        lines.push({
          method: "CASH",
          currencyCode: "LBP",
          amount: draftData.paidLBP,
        });
      }
      setDraftInitialLines(lines.length > 0 ? lines : undefined);
      setPaymentInputKey((k) => k + 1);
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

  // Validation for Debt: both primary (clientSearch) and secondary (secondaryInput) must be filled for new clients
  const isNewClientInfoComplete = canChargeToCustomerAccount({
    name: clientSearch,
    phone: secondaryInput,
  });

  const debtPaymentEnabled = paymentMethodOptions.some(
    (pm) => pm.code === "CUSTOMER_ACCOUNT",
  );

  // Determine whether creating a debt is allowed: existing client must have phone, new client must have both fields
  const canCreateDebt = selectedClient
    ? canChargeToCustomerAccount({
        name: selectedClient.full_name,
        phone: selectedClient.phone_number,
      })
    : isNewClientInfoComplete;

  const finalAmount = Math.max(0, totalAmount - (discount ?? 0));
  const effectiveExchangeRate = parseFloat(customExchangeRate) || exchangeRate;
  // Total paid, converted into the job's currency for settlement comparison.
  const totalPaidInTotalCurrency = isLbpTotal
    ? paidLBP + paidUSD * effectiveExchangeRate
    : paidUSD + convertLBPToUSD(paidLBP, effectiveExchangeRate);
  // Change/return legs from MultiPaymentInput. cashOnlyReturn={true} below
  // guarantees every leg here is CASH (see the prop on the element), so this
  // is the same value the old changeGivenUSD/LBP state used to hold — just
  // derived instead of tracked, since MultiPaymentInput owns the return UI
  // and re-derives it from (payment lines) vs. (finalAmount) on its own.
  const cashReturnUSD = returnLines
    .filter((l) => l.currencyCode === "USD")
    .reduce((sum, l) => sum + (l.amount || 0), 0);
  const cashReturnLBP = returnLines
    .filter((l) => l.currencyCode === "LBP")
    .reduce((sum, l) => sum + (l.amount || 0), 0);

  // Close on Escape key (prefer onClose, fall back to onCancel)
  useEffect(() => {
    const closeHandler = onClose ?? onCancel;
    if (!closeHandler) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeHandler();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, onCancel]);

  // Auto-select CUSTOMER_ACCOUNT as MultiPaymentInput's initialMethod once a
  // chargeable client is present. Gated on canCreateDebt so a phone-less
  // client never auto-selects CUSTOMER_ACCOUNT (fails server-side —
  // CUSTOMER_ACCOUNT needs name + phone).
  const paymentMethodCodesKey = paymentMethodOptions
    .map((pm) => pm.code)
    .join(",");
  const initialMethod = useMemo(() => {
    if (!selectedClient || !canCreateDebt) return undefined;
    const hasCA = paymentMethodOptions.some(
      (pm) => pm.code === "CUSTOMER_ACCOUNT",
    );
    return hasCA ? "CUSTOMER_ACCOUNT" : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient, canCreateDebt, paymentMethodCodesKey]);

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
        finalClientName = secondaryInput.trim() || `Client ${finalClientPhone}`;
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
      // Currency that total_amount/discount/final_amount are expressed in.
      currency: totalCurrency,
      payment_usd: paidUSD,
      payment_lbp: paidLBP,
      // IN legs only — cashOnlyReturn={true} on MultiPaymentInput means
      // change never needs an OUT leg here (see change_given_* below), and
      // saveMaintenanceJob (Maintenance also renders this modal) has no
      // OUT-leg handling, so this payload must stay IN-only for both.
      payments: toSnakeLegs(paymentLines),
      change_given_usd: cashReturnUSD,
      change_given_lbp: cashReturnLBP,
      exchange_rate: effectiveExchangeRate,
      drawer_name: DRAWER_B, // legacy field (kept for backward compatibility)
      ...(transactionTime ? { transaction_time: transactionTime } : {}),
    };
  };

  const handleComplete = async () => {
    // Block debt creation when DEBT payment method is disabled
    if (
      !isPaymentComplete(totalPaidInTotalCurrency, finalAmount) &&
      !debtPaymentEnabled
    ) {
      appEvents.emit(
        "notification:show",
        "Debt payment method is disabled. The full amount must be paid before completing the sale.",
        "warning",
      );
      return;
    }

    // Validation: Debt requires a complete profile for new debts
    if (
      !isPaymentComplete(totalPaidInTotalCurrency, finalAmount) &&
      !canCreateDebt
    ) {
      appEvents.emit(
        "notification:show",
        "To create or leave a debt, please ensure the client has a phone number (existing client) or provide both name and phone (new client).",
        "warning",
      );
      return;
    }

    setIsLoading(true);
    try {
      await onComplete(getPaymentData());
      setTransactionTime(undefined);
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
      change_usd: cashReturnUSD,
      change_lbp: cashReturnLBP,
      exchange_rate: effectiveExchangeRate,
      timestamp: new Date().toISOString(),
      operator: "Staff",
    };
  };

  const handlePrintReceipt = async () => {
    const receipt = getReceiptData();
    const formatted = formatReceipt58mm(receipt);

    let targetPrinter = "";
    try {
      const settings = await api.getAllSettings();
      const printerSetting = settings.find(
        (s: any) => s.key_name === "receipt_printer",
      );
      if (printerSetting && printerSetting.value) {
        targetPrinter = printerSetting.value;
      }
    } catch (e) {
      logger.warn("Failed to get printer setting", { error: e });
    }

    await printReceiptContent(formatted, targetPrinter);
  };

  const handleDirectPrint = async () => {
    const receipt = getReceiptData();
    const formatted = formatReceipt58mm(receipt);

    let targetPrinter = "";
    try {
      const settings = await api.getAllSettings();
      const printerSetting = settings.find(
        (s: any) => s.key_name === "receipt_printer",
      );
      if (printerSetting && printerSetting.value) {
        targetPrinter = printerSetting.value;
      }
    } catch (e) {
      logger.warn("Failed to get printer setting", { error: e });
    }

    await printReceiptContent(formatted, targetPrinter);
  };

  const drawerNameDisplay = String(DRAWER_B).replace(/_/g, " ");

  // Memoize receipt content to ensure it updates when shopInfo or other data changes
  const receiptContent = useMemo(() => {
    if (!showReceiptPreview) return "";
    return formatReceipt58mm(getReceiptData());
  }, [
    showReceiptPreview,
    shopInfo,
    items,
    totalAmount,
    discount,
    paidUSD,
    paidLBP,
    cashReturnUSD,
    cashReturnLBP,
    effectiveExchangeRate,
    receiptNumber,
  ]);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
        role="presentation"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            const closeHandler = onClose ?? onCancel;
            closeHandler?.();
          }
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && onClose) {
            onClose();
          }
        }}
      >
        <div
          data-testid="checkout-modal"
          className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-7xl shadow-2xl flex overflow-hidden h-[85vh]"
          role="presentation"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Left: Summary & Client */}
          <div className="w-1/2 bg-slate-800 p-8 border-r border-slate-700 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Checkout</h2>
              {onClose && (
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title="Close"
                >
                  <X size={20} />
                </button>
              )}
            </div>

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
                      data-testid="client-autocomplete-field"
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
                      <div
                        data-testid="client-dropdown"
                        className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto"
                      >
                        {filteredClients.map((client) => (
                          <button
                            key={client.id}
                            data-testid={`client-option-${client.id}`}
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
                    className={`flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 focus-within:ring-2 focus-within:ring-violet-600 transition-all h-[52px] ${!clientSearch ? "opacity-50 cursor-not-allowed" : ""}`}
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
                    {!isPaymentComplete(
                      totalPaidInTotalCurrency,
                      finalAmount,
                    ) &&
                      !canCreateDebt && (
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
              <div className="flex-1 min-h-0 my-4 bg-slate-900/50 rounded-xl border border-slate-700/50 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/50 bg-slate-800/30">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Items ({items.length})
                  </span>
                  {onEdit && (
                    <button
                      onClick={() =>
                        onEdit({
                          selectedClient,
                          clientSearchInput: clientSearch,
                          clientSearchSecondary: secondaryInput,
                          discount,
                          paidUSD,
                          paidLBP,
                          changeGivenUSD: cashReturnUSD,
                          changeGivenLBP: cashReturnLBP,
                          exchangeRate: effectiveExchangeRate,
                        })
                      }
                      className="p-1.5 text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors"
                      title="Edit Order"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
                <div className="flex-1 h-full overflow-y-auto divide-y divide-slate-700/50">
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
                          {item.quantity} × ${item.retail_price.toFixed(2)}
                        </p>
                      </div>
                      <span className="text-sm font-mono text-slate-300 shrink-0">
                        ${(item.quantity * item.retail_price).toFixed(2)}
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
                  <span>{fmtTotal(totalAmount)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Discount</span>
                  <div className="relative w-28">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                      {isLbpTotal ? "LBP" : "$"}
                    </span>
                    <DecimalInput
                      data-testid="checkout-discount-input"
                      value={discount}
                      onChange={(v) => setDiscount(v)}
                      className={`w-full bg-slate-800 border border-slate-700 rounded-xl ${isLbpTotal ? "pl-10" : "pl-7"} pr-3 py-2 text-white font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 text-right`}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="border-t border-slate-700 pt-3 flex justify-between items-center">
                  <span className="text-lg font-bold text-white">
                    Net Total
                  </span>
                  <span className="text-2xl font-bold text-violet-400">
                    {fmtTotal(finalAmount)}
                  </span>
                </div>
                <div className="text-right text-xs text-slate-500">
                  {isLbpTotal
                    ? `≈ $${(finalAmount / effectiveExchangeRate).toFixed(2)} USD`
                    : `≈ ${(finalAmount * effectiveExchangeRate).toLocaleString()} LBP`}
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
              <div className="flex items-center gap-1">
                {onMinimize && (
                  <button
                    onClick={() =>
                      onMinimize({
                        selectedClient,
                        clientSearchInput: clientSearch,
                        clientSearchSecondary: secondaryInput,
                        discount,
                        paidUSD,
                        paidLBP,
                        changeGivenUSD: cashReturnUSD,
                        changeGivenLBP: cashReturnLBP,
                        exchangeRate: effectiveExchangeRate,
                      })
                    }
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                    title="Minimize Order"
                  >
                    <Minus size={20} />
                  </button>
                )}
                {onCancel && (
                  <button
                    onClick={onCancel}
                    className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-colors"
                    title="Cancel Order"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-6 flex-1 overflow-y-auto">
              <MultiPaymentInput
                key={`payment-${paymentInputKey}`}
                totals={[{ amount: finalAmount, currency: totalCurrency }]}
                currency={totalCurrency}
                totalAmountCurrency={totalCurrency}
                {...(draftInitialLines
                  ? { initialLines: draftInitialLines }
                  : {})}
                onChange={setPaymentLines}
                onReturnChange={setReturnLines}
                requiresClientForDebt={true}
                hasClient={canCreateDebt}
                paymentMethods={paymentMethodOptions}
                currencies={[
                  { code: "USD", symbol: "$" },
                  { code: "LBP", symbol: "LBP" },
                ]}
                exchangeRate={exchangeRate}
                onRateChange={handleRateChange}
                showDiscount={false}
                smartSplitOverpay={!isLbpTotal}
                cashOnlyReturn={true}
                onWaiveRemaining={(amt) => setDiscount((d) => (d ?? 0) + amt)}
                label="Payment"
                {...(initialMethod ? { initialMethod } : {})}
                clientId={selectedClient?.id ?? null}
                fetchClientVouchers={fetchClientVouchers}
              />

              {!debtPaymentEnabled &&
                !isPaymentComplete(totalPaidInTotalCurrency, finalAmount) && (
                  <div className="text-xs text-orange-400 bg-orange-500/10 rounded px-3 py-2">
                    Debt is disabled. Full payment required to complete this
                    sale.
                  </div>
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

            <div className="mt-4">
              <TransactionTimeOverride
                value={transactionTime}
                onChange={setTransactionTime}
              />
            </div>
            <div className="mt-3 flex gap-3">
              {!isDraft && (
                <button
                  data-testid="checkout-save-draft-btn"
                  onClick={handleSaveDraft}
                  disabled={isLoading}
                  className="px-6 py-4 rounded-xl text-violet-300 hover:text-violet-100 hover:bg-violet-900/30 transition-colors font-medium border border-violet-500/30"
                >
                  Save Draft
                </button>
              )}
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
                data-testid="checkout-complete-btn"
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
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
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
                    minWidth: "38ch",
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
