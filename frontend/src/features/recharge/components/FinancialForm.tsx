import { useState, useEffect } from "react";
import { ChevronDown, Phone, Search, X, Plus } from "lucide-react";
import {
  appEvents,
  useApi,
  ServiceTypeTabs,
  DecimalInput,
  hasNewClientInfo,
  type PaymentLine,
  Select,
} from "@liratek/ui";
import { PaymentSheet } from "./PaymentSheet";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useAutoPrintReceipt } from "@/shared/hooks/useAutoPrintReceipt";
import { ensureRechargeClient } from "../utils/ensureClient";
import type { ServiceItem, ProviderKey } from "../hooks/useMobileServiceItems";
import { formatCatalogItemName } from "../hooks/useMobileServiceItems";
import { getCategoryColor } from "../utils/categoryColors";
import type {
  FinancialTransaction,
  ServiceType,
  ProviderConfig,
  AnyProvider,
} from "../types";
import { HistoryModal } from "./HistoryModal";
import { useSellRate } from "@/hooks/useSellRate";
import logger from "@/utils/logger";
import { toCamelLegs } from "@/utils/paymentUtils";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import {
  ForPartnerToggle,
  ForPartnerNotice,
} from "@/features/partners/components/ForPartnerToggle";

interface CartLineItem {
  item: ServiceItem;
  quantity: number;
}

interface NewItemForm {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: string;
  sell_lbp: string;
  sort_order: string;
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
  onRefreshItems?: () => Promise<void>;
  isAdmin?: boolean;
  /** Reports selected-item counts per provider tab (count pill on the tab). */
  onCartCountChange?: (counts: Record<string, number>) => void;
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
  onRefreshItems,
  isAdmin,
  onCartCountChange,
}: FinancialFormProps) {
  const api = useApi();
  const {
    activeSession,
    linkTransaction,
    addToCart: addToSessionCart,
  } = useSession();
  // LIRA-069 W1.d — auto-print on a successful STANDALONE submit (skipped
  // when a session is active; the session gets its own Print button at
  // checkout, W1.b). Never fires from handleForPartnerSubmit — a partner
  // order collects no cash from a walk-in customer, so there's no receipt.
  const autoPrintReceipt = useAutoPrintReceipt();
  const [cart, setCart] = useState<Map<string, CartLineItem>>(new Map());
  // Report selection counts to the provider tabs (quantities, keyed by each
  // cart item's own provider).
  useEffect(() => {
    if (!onCartCountChange) return;
    const counts: Record<string, number> = {};
    for (const line of cart.values()) {
      counts[line.item.provider] =
        (counts[line.item.provider] ?? 0) + line.quantity;
    }
    onCartCountChange(counts);
  }, [cart, onCartCountChange]);
  useEffect(() => {
    return () => onCartCountChange?.({});
  }, [onCartCountChange]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [paymentLines, setPaymentLines] = useState<any[]>([]);
  // S6: change/return legs (OUT) — this form never wired these, so
  // overpayment change was never recorded (lira-088 rule).
  const [returnLegs, setReturnLegs] = useState<PaymentLine[]>([]);
  // T3 keep-change: kept change → profit stamp on the legs-carrying txn.
  const [keptChange, setKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  // Payment-Legs Integrity plan (false-reject fix): the rate the
  // PaymentSheet is ACTUALLY using — the `exchangeRate` prop default, or the
  // operator's own edit of the sheet's header rate field. Sent as
  // tender_exchange_rate instead of re-sending the static prop, which is
  // wrong the moment the operator edits the field.
  const [effectiveRate, setEffectiveRate] = useState<number | undefined>();

  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const isSplitPayment = paymentLines.length > 1;
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const { buyRate, sellRate } = useSellRate();
  const [searchQuery, setSearchQuery] = useState("");
  const [discount, setDiscount] = useState(0);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();
  const [partnerId, setPartnerId] = useState<number | null>(null);
  // PFT-3b (Partner FOR-Transactions): a "for partner" order has NO walk-in
  // customer and collects NO counter cash — every cart unit is booked
  // straight to the selected partner's ledger (partnerMode: "FOR"), settled
  // later on the Partners page. Replaces the old always-on header
  // PartnerSelector (which implicitly meant partnerMode "THROUGH" and, with
  // exactly one partner in the system, mis-painted "Partner: <name>" on
  // every walk-in transaction — the reused `partnerId` state above is now
  // ONLY ever set while this checkbox is on).
  const [forPartner, setForPartner] = useState(false);
  const [isSubmittingPartner, setIsSubmittingPartner] = useState(false);
  const [partnerPaidFromMethod, setPartnerPaidFromMethod] = useState("CASH");
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientPhone, setClientPhone] = useState("");
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("CASH");
  const [newItemForm, setNewItemForm] = useState<NewItemForm | null>(null);
  const [addItemError, setAddItemError] = useState("");

  // Auto-promote CUSTOMER_ACCOUNT once both name+phone are filled for a brand-new client
  useEffect(() => {
    const newClientReady = hasNewClientInfo({
      clientId,
      name: clientName,
      phone: clientPhone,
    });
    if (newClientReady && initialPaymentMethod !== "CUSTOMER_ACCOUNT") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialPaymentMethod("CUSTOMER_ACCOUNT");

      setPaymentInputKey((k) => k + 1);
    }
  }, [clientId, clientName, clientPhone, initialPaymentMethod]);

  // Determine exchange rate based on transaction type
  //   - SEND = customer sends money (money IN) → sellRate (customer pays us more LBP)
  //   - RECEIVE = customer receives money (money OUT) → buyRate (we pay customer less LBP)
  const isMoneyIn = serviceType === "SEND";
  const exchangeRate = isMoneyIn ? sellRate : buyRate;

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

  const totalCost = Array.from(cart.values()).reduce((sum, line) => {
    const unitCost = line.item.catalogCost ?? 0;
    return sum + unitCost * line.quantity;
  }, 0);

  // Max discount = total commission (sell - cost), discount cannot exceed profit
  const maxDiscount = Math.max(0, totalPrice - totalCost);

  // A cost=0 unit (no catalog item currently seeds one — OMT_APP has no
  // items yet) is a straight system transfer, not a priced bill/card: on
  // SEND, the shop fronts the disbursement and partner mode needs a "Paid
  // from" drawer-method Select. On RECEIVE the backend credits the service
  // drawer itself (no OUT leg), so the Select never applies there.
  const hasTransferUnit =
    (serviceType || "SEND") === "SEND" &&
    Array.from(cart.values()).some(
      (line) => (line.item.catalogCost ?? 0) === 0,
    );

  const totalItems = Array.from(cart.values()).reduce(
    (sum, line) => sum + line.quantity,
    0,
  );

  const getCartCountForCategory = (category: string): number =>
    Array.from(cart.values())
      .filter(
        (line) =>
          line.item.category === category &&
          line.item.provider === activeProvider,
      )
      .reduce((sum, line) => sum + line.quantity, 0);

  const handleAddItem = async () => {
    if (!newItemForm) return;
    setAddItemError("");
    if (
      !newItemForm.label.trim() ||
      !newItemForm.cost_lbp ||
      !newItemForm.sell_lbp
    ) {
      setAddItemError("Label, cost, and sell are required");
      return;
    }
    const costLbp = parseInt(newItemForm.cost_lbp, 10);
    const sellLbp = parseInt(newItemForm.sell_lbp, 10);
    if (isNaN(costLbp) || isNaN(sellLbp)) {
      setAddItemError("Cost and sell must be valid numbers");
      return;
    }
    try {
      const res = await api.createMobileServiceItem({
        provider: newItemForm.provider,
        category: newItemForm.category,
        subcategory: newItemForm.subcategory,
        label: newItemForm.label.trim(),
        cost_lbp: costLbp,
        sell_lbp: sellLbp,
        sort_order: parseInt(newItemForm.sort_order, 10) || 0,
      });
      if (!res.success) {
        setAddItemError(res.error ?? "Failed to create item");
        return;
      }
      setNewItemForm(null);
      await onRefreshItems?.();
    } catch {
      setAddItemError("Create failed");
    }
  };

  const handleSubmit = async () => {
    if (cart.size === 0 || localSubmitting) return;

    const clientResult = await ensureRechargeClient({
      clientId,
      name: clientName,
      phone: clientPhone,
      paymentLines,
    });
    if (!clientResult.ok) {
      alert(clientResult.error);
      return;
    }
    const resolvedClientId = clientResult.id;
    if (resolvedClientId && resolvedClientId !== clientId) {
      setClientId(resolvedClientId);
    }

    // If session is active, add all cart items as one session cart entry.
    // The basket owns the payment, so the cart sub-items carry NO payment fields
    // (paidByMethod / payments) and no per-item discount — the Session Checkout
    // modal collects payment once for the whole basket and applies any discount
    // there (capped at each item's profit).
    if (activeSession) {
      const cartItems = Array.from(cart.values());
      const itemLabels = cartItems
        .map((line) => `${formatCatalogItemName(line.item)} x${line.quantity}`)
        .join(", ");
      const providerLabel =
        activeConfig?.label || activeProvider || "Financial";
      const label =
        itemLabels.length > 60
          ? `${providerLabel} (${cartItems.length} items) - ${totalPrice.toLocaleString()} LBP`
          : `${providerLabel}: ${itemLabels}`;

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
          clientId: resolvedClientId || undefined,
          clientName: clientName || undefined,
          itemKey: line.item.key,
          itemCategory: line.item.category,
          note: `${formatCatalogItemName(line.item)}`,
        }));
      });

      addToSessionCart({
        module: activeProvider === "WHISH_APP" ? "whish_app" : "omt_app",
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
      setKeptChange(null);
      setReturnLegs([]);
      setClientName("");
      setClientPhone("");
      setClientId(null);
      setExpandedKeys(new Set());
      setSearchQuery("");
      return;
    }

    setLocalSubmitting(true);

    const cartItems = Array.from(cart.values());
    const finalPaymentMethod = isSplitPayment ? "MULTI" : paymentMethod;
    // S1 — never gate legs on split (or voucher): forward the full leg set
    // (IN tender + OUT change) whenever ANY payment line exists. Gating on
    // isSplitPayment/hasVoucherLeg alone silently dropped a single-line
    // payment's tender amount + currency, and this form never forwarded
    // change/return legs at all (S6) — overpayment change was never
    // recorded (lira-088 rule).
    const paymentsPayload =
      paymentLines.length > 0 || returnLegs.length > 0
        ? toCamelLegs(paymentLines, returnLegs)
        : undefined;
    // checkoutTotal (Payment-Legs Integrity plan wave 8): the carrier's own
    // `amount` is just ONE unit's discounted price — the payment legs it
    // carries cover the WHOLE cart. Mirrors the header's own total math
    // (totalPrice, always LBP here) net of the same `discount` the per-unit
    // loop below already applies, so the repository can reconcile the legs
    // against the real customer-owed total for the checkout instead of one
    // item's price.
    const checkoutTotalLbp = Math.max(0, totalPrice - discount);
    const checkoutTotal = { usd: 0, lbp: checkoutTotalLbp };

    let allSucceeded = true;

    // Distribute discount proportionally across items based on sell price
    const totalSellPrice = cartItems.reduce((sum, line) => {
      return sum + (line.item.catalogSellPrice ?? 0) * line.quantity;
    }, 0);

    // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): stamp ONE shared uuid
    // across every unit of a multi-unit checkout so the void path can find
    // and guard the whole group — voiding a single unit alone would leave
    // the checkout's money non-zero (the carrier owns ALL the legs; siblings
    // only defer cost/commission). Only when there's an actual carrier
    // (paymentsPayload !== undefined) — a no-legs checkout (session-deferred
    // mode) never hits this asymmetry. Single-unit checkouts get no split
    // metadata (no noise).
    const totalCheckoutUnits = cartItems.reduce(
      (sum, line) => sum + line.quantity,
      0,
    );
    const useSplitGroup =
      totalCheckoutUnits > 1 && paymentsPayload !== undefined;
    const splitGroupId = useSplitGroup ? crypto.randomUUID() : undefined;

    // Kept change attaches to the FIRST transaction only (the lira-095
    // legs-carrying convention) — voiding that txn reverses it with the legs.
    let keptPending =
      keptChange && (keptChange.usd > 0 || keptChange.lbp > 0)
        ? { ...keptChange }
        : null;
    // Payment legs book against exactly ONE carrier transaction — the first
    // unit; every other unit submits deferPayment (cost + commission only).
    // Attaching the same legs to all N unit calls multiplies the drawer
    // inflow and any CUSTOMER_ACCOUNT debt N× (KatchForm's bills loop guards
    // this same trap). Single-payment submits (no legs array) keep the
    // per-unit price booking untouched.
    let legsCarried = false;
    // LIRA-069 W1.d — the carrier is the one transaction whose payment legs
    // (and therefore whose printed receipt) actually reflect what the
    // customer paid; siblings are deferPayment (cost/commission only, no
    // legs) so printing one of THOSE would show no payment lines at all.
    let carrierSourceId: number | undefined;
    for (const line of cartItems) {
      const sellPrice = line.item.catalogSellPrice ?? 0;
      const cost = line.item.catalogCost ?? 0;
      // Proportional discount per unit
      const unitDiscountShare =
        totalSellPrice > 0
          ? Math.round((discount * sellPrice) / totalSellPrice)
          : 0;
      const discountedSellPrice = sellPrice - unitDiscountShare;
      const commission = discountedSellPrice - cost;

      for (let i = 0; i < line.quantity; i++) {
        const isCarrier = paymentsPayload !== undefined && !legsCarried;
        if (isCarrier) legsCarried = true;
        try {
          const result = await api.addOMTTransaction({
            provider: activeProvider,
            serviceType: serviceType || "SEND",
            amount: discountedSellPrice,
            cost,
            currency: "LBP",
            commission: Math.max(0, commission),
            paidByMethod: finalPaymentMethod,
            payments: isCarrier ? paymentsPayload : undefined,
            checkoutTotal: isCarrier ? checkoutTotal : undefined,
            // Payment-Legs Integrity plan (Wave 9 + false-reject fix): the
            // rate this form's own PaymentSheet/MultiPaymentInput actually
            // converted tender at — captured live via onExchangeRateChange
            // (falls back to `exchangeRate` — `isMoneyIn ? sellRate :
            // buyRate` — if the sheet never fired, e.g. no legs). May differ
            // from the repository's stamped/live rate lookup, so
            // reconciliation must compare at the SAME rate the till used
            // (lira-095). Rides only the carrier call, same gating as
            // checkoutTotal.
            tender_exchange_rate: isCarrier
              ? (effectiveRate ?? exchangeRate)
              : undefined,
            ...(paymentsPayload !== undefined && !isCarrier
              ? { deferPayment: true }
              : {}),
            // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+) — see the top of
            // handleSubmit for the full rationale.
            ...(useSplitGroup
              ? {
                  split_group: splitGroupId,
                  split_role: isCarrier
                    ? ("carrier" as const)
                    : ("sibling" as const),
                  split_units: totalCheckoutUnits,
                }
              : {}),
            ...(keptPending
              ? (() => {
                  const k = keptPending;
                  keptPending = null;
                  return {
                    kept_change_usd: k.usd,
                    kept_change_lbp: k.lbp,
                  };
                })()
              : {}),
            clientId: resolvedClientId || undefined,
            clientName: clientName || undefined,
            itemKey: line.item.key,
            itemCategory: line.item.category,
            note: `${formatCatalogItemName(line.item)}`,
            partnerId: partnerId || undefined,
            transaction_time: transactionTime,
          });

          if (result?.success) {
            if (isCarrier) carrierSourceId = result.id;
            // Link to active customer session
            if (activeSession && result.id) {
              try {
                await linkTransaction({
                  transactionType: "financial_service",
                  transactionId: result.id,
                  amountUsd: 0,
                  amountLbp: discountedSellPrice,
                  profitLbp: Math.max(0, commission),
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
      appEvents.emit(
        "notification:show",
        "Transactions processed successfully",
        "success",
      );
      void autoPrintReceipt({
        type: "FINANCIAL_SERVICE",
        provider: activeProvider,
        itemKey: cartItems[0]?.item.key,
        sourceTable: "financial_services",
        sourceId: carrierSourceId,
        hasActiveSession: !!activeSession,
      });
      setCart(new Map());
      setKeptChange(null);
      setReturnLegs([]);
      setClientName("");
      setClientPhone("");
      setClientId(null);
      setExpandedKeys(new Set());
      setSearchQuery("");
      setTransactionTime(undefined);
      const hasDebtPayment =
        paymentMethod === "CUSTOMER_ACCOUNT" ||
        paymentLines.some((l: any) => l.method === "CUSTOMER_ACCOUNT");
      if (hasDebtPayment) {
        window.dispatchEvent(new CustomEvent("debt-ledger-changed"));
      }
    }
    loadFinancialData();
    setLocalSubmitting(false);
  };

  // PFT-3b: direct submission for a "for partner" order — bypasses
  // handleSubmit (walk-in path: client, discount, kept-change, session
  // basket), the active session's cart, and the PaymentSheet entirely,
  // calling addOMTTransaction straight from here per cart unit with
  // partnerId + partnerMode:"FOR" (mirrors TelecomForm's
  // handleForPartnerSubmit). A partner order never enters the session
  // basket even when one is active.
  //
  // Per unit, mirrors the backend's own dispatch
  // (FinancialServiceRepository: useCostPriceFlow = cost > 0):
  //   - cost > 0 (every real catalog item today — iPick/Katsh/Whish App
  //     bills): the cost/price arm books provider drawer −cost and the
  //     partner owes the selling price directly. payments: [] — no legs.
  //   - cost === 0 on a SEND (no catalog item seeds this today — OMT_APP has
  //     no items; only reachable if an admin adds a zero-cost "system
  //     transfer" item): the legacy/transfer arm needs the shop's
  //     disbursement as ONE OUT leg so the partner owes exactly that total.
  //     On RECEIVE the backend credits its own drawer — no leg needed.
  const handleForPartnerSubmit = async () => {
    if (cart.size === 0 || isSubmittingPartner) return;
    if (!partnerId) {
      alert("Select a partner for this order.");
      return;
    }

    setIsSubmittingPartner(true);
    const cartItems = Array.from(cart.values());
    const svcType = serviceType || "SEND";
    let allSucceeded = true;

    for (const line of cartItems) {
      const sellPrice = line.item.catalogSellPrice ?? 0;
      const cost = line.item.catalogCost ?? 0;
      const commission = cost > 0 ? Math.max(0, sellPrice - cost) : 0;
      const isTransferOutLeg = cost === 0 && svcType === "SEND";

      for (let i = 0; i < line.quantity; i++) {
        try {
          const result = await api.addOMTTransaction({
            provider: activeProvider,
            serviceType: svcType,
            amount: sellPrice,
            cost,
            currency: "LBP",
            commission,
            payments: isTransferOutLeg
              ? [
                  {
                    method: partnerPaidFromMethod,
                    currencyCode: "LBP",
                    amount: sellPrice,
                    direction: "OUT" as const,
                  },
                ]
              : [],
            itemKey: line.item.key,
            itemCategory: line.item.category,
            note: `${formatCatalogItemName(line.item)}`,
            partnerId,
            partnerMode: "FOR" as const,
            transaction_time: transactionTime,
          });

          if (!result?.success) {
            logger.error("Partner financial submit failed:", result?.error);
            alert(result?.error || "Failed to process item");
            allSucceeded = false;
            break;
          }
        } catch (err) {
          logger.error("Partner financial submit error:", err);
          alert("Failed to process item");
          allSucceeded = false;
          break;
        }
      }
      if (!allSucceeded) break;
    }

    if (allSucceeded) {
      appEvents.emit(
        "notification:show",
        "Partner transactions processed successfully",
        "success",
      );
      setCart(new Map());
      setExpandedKeys(new Set());
      setSearchQuery("");
      setTransactionTime(undefined);
    }
    loadFinancialData();
    setIsSubmittingPartner(false);
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
      <div className="flex flex-col gap-3">
        {/* Header with SEND/RECEIVE Tabs - hidden for Whish App and MTC */}
        {activeProvider !== "WHISH_APP" && activeProvider !== "MTC" && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <ServiceTypeTabs
                options={[
                  { id: "SEND", label: "Money In", iconKey: "Send" },
                  { id: "RECEIVE", label: "Money Out", iconKey: "Package" },
                ]}
                value={serviceType || "SEND"}
                onChange={(val) => setServiceType?.(val as ServiceType)}
                accentColor={
                  activeProvider === "iPick" || activeProvider === "Katsh"
                    ? "orange"
                    : "violet"
                }
                customColor={
                  activeProvider === "OMT_APP" ? "#ffde00" : undefined
                }
                customTextColor={
                  activeProvider === "OMT_APP" ? "black" : "white"
                }
                size="sm"
              />
            </div>
          </div>
        )}

        {/* Sticky top row: Search + Proceed to Pay — never scrolls away */}
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-1">
          {(activeProvider === "iPick" ||
            activeProvider === "Katsh" ||
            activeProvider === "WHISH_APP") && (
            <div className="relative flex-1">
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
          <div className="flex items-center gap-2 ml-auto shrink-0">
            {totalItems > 0 && (
              <div className="text-right leading-tight">
                <div className="text-xs text-white font-bold">
                  {totalItems} items
                </div>
                <div className="text-xs text-emerald-400 font-mono font-semibold">
                  {totalPrice.toLocaleString()} LBP
                </div>
                {exchangeRate > 0 && (
                  <div className="text-xs text-slate-400 font-mono">
                    ${(totalPrice / exchangeRate).toFixed(2)}
                  </div>
                )}
              </div>
            )}
            {/* "For Partner" opt-in — routes every cart unit to a selected
                partner's ledger instead of collecting counter cash. Hides
                the payment-method quick-select and skips the PaymentSheet
                entirely (see handleForPartnerSubmit). Renders for EVERY
                provider this form serves, unlike the old always-on header
                PartnerSelector it replaces. */}
            <ForPartnerToggle
              testId="financial-for-partner-toggle"
              checked={forPartner}
              onChange={setForPartner}
              selectedPartnerId={partnerId}
              onPartnerChange={setPartnerId}
              autoSelectSingle
              labelClassName="flex items-center gap-1.5 cursor-pointer select-none text-xs text-slate-400 shrink-0"
              checkboxClassName="w-3.5 h-3.5 rounded border-slate-600 bg-slate-900 text-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              textClassName=""
              selectorClassName=""
            />
            {/* Payment method quick-select — hidden in partner mode (no
                counter cash is collected from a customer). */}
            {!forPartner && (
              <Select
                value={initialPaymentMethod}
                onChange={(v) => {
                  setInitialPaymentMethod(v);
                  setPaymentInputKey((k) => k + 1);
                }}
                options={methods.map((m) => ({
                  value: m.code,
                  label: m.label,
                }))}
                buttonClassName="bg-slate-900 border border-slate-600 rounded-lg pl-3 pr-7 py-2 text-white text-xs font-medium focus:outline-none focus:border-violet-500 transition-all cursor-pointer"
              />
            )}
            <button
              type="button"
              onClick={() => {
                // Partner mode bypasses the PaymentSheet AND the session
                // basket entirely — a partner order has no walk-in customer,
                // so it never enters the active session's cart either.
                if (forPartner) {
                  handleForPartnerSubmit();
                  return;
                }
                // Session mode: add to cart directly (basket owns the payment),
                // skipping the PaymentSheet. Non-session: open the PaymentSheet.
                if (activeSession) {
                  handleSubmit();
                } else {
                  setShowPaymentSheet(true);
                }
              }}
              disabled={
                totalItems === 0 ||
                (forPartner && (isSubmittingPartner || !partnerId))
              }
              className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all whitespace-nowrap ${
                totalItems === 0 ||
                (forPartner && (isSubmittingPartner || !partnerId))
                  ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                  : activeProvider === "WHISH_APP"
                    ? "bg-[#ff0a46] hover:bg-[#ff0a46]/80 text-white shadow-lg shadow-[#ff0a46]/20"
                    : activeProvider === "OMT_APP"
                      ? "bg-[#ffde00] hover:bg-[#ffde00]/80 text-black shadow-lg shadow-[#ffde00]/20"
                      : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-500/20"
              }`}
            >
              {forPartner
                ? "Submit to Partner"
                : activeSession
                  ? "Add to Cart"
                  : "Proceed to Pay"}
            </button>
          </div>
        </div>

        {/* Partner-mode notice — replaces the payment UI entirely; no
            counter cash is collected. When the cart contains a cost=0
            transfer unit, also surface the "Paid from" drawer method used
            for the OUT-leg disbursement (see handleForPartnerSubmit). */}
        {forPartner && (
          <ForPartnerNotice
            testId="financial-partner-no-payment-notice"
            className="text-sm text-orange-200 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
          >
            <span>
              No payment is collected from a customer for a partner order. The
              full{" "}
              <span className="font-bold">
                {totalPrice.toLocaleString()} LBP
              </span>{" "}
              goes on the selected partner&apos;s account, settled later on the
              Partners page.
            </span>
            {hasTransferUnit && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-orange-300/80 uppercase tracking-wider">
                  Paid from
                </span>
                <Select
                  value={partnerPaidFromMethod}
                  onChange={setPartnerPaidFromMethod}
                  options={methods.map((m) => ({
                    value: m.code,
                    label: m.label,
                  }))}
                  buttonClassName="bg-slate-900 border border-slate-600 rounded-lg pl-3 pr-7 py-2 text-white text-xs font-medium focus:outline-none focus:border-orange-500 transition-all cursor-pointer"
                />
              </div>
            )}
          </ForPartnerNotice>
        )}

        {/* Card Grid - hidden for OMT_APP (no items) */}
        {activeProvider !== "OMT_APP" && (
          <div className="space-y-6 pb-2">
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
                      {getCartCountForCategory(category) > 0 && (
                        <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 text-[10px] font-bold rounded-full leading-none">
                          {getCartCountForCategory(category)}
                        </span>
                      )}
                    </h3>
                    <div className="flex items-center gap-1.5">
                      {isAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddItemError("");
                            setNewItemForm(
                              newItemForm?.category === category
                                ? null
                                : {
                                    provider: activeProvider as string,
                                    category,
                                    subcategory: "",
                                    label: "",
                                    cost_lbp: "",
                                    sell_lbp: "",
                                    sort_order: "0",
                                  },
                            );
                          }}
                          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                          type="button"
                          title="Add item"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 transition-transform ${
                          collapsedCategories.has(category) ? "-rotate-90" : ""
                        }`}
                      />
                    </div>
                  </div>
                  {newItemForm?.category === category && (
                    <div className="mt-3 border border-slate-600/40 rounded-lg p-3 bg-slate-900/50 space-y-2">
                      {addItemError && (
                        <p className="text-xs text-red-400">{addItemError}</p>
                      )}
                      <div className="flex items-end gap-2 flex-wrap">
                        <div className="flex-1 min-w-24">
                          <label className="text-slate-400 text-xs block mb-1">
                            Subcategory
                          </label>
                          <input
                            type="text"
                            value={newItemForm.subcategory}
                            onChange={(e) =>
                              setNewItemForm({
                                ...newItemForm,
                                subcategory: e.target.value,
                              })
                            }
                            placeholder="e.g. pubg"
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                          />
                        </div>
                        <div className="flex-1 min-w-24">
                          <label className="text-slate-400 text-xs block mb-1">
                            Label
                          </label>
                          <input
                            autoFocus
                            type="text"
                            value={newItemForm.label}
                            onChange={(e) =>
                              setNewItemForm({
                                ...newItemForm,
                                label: e.target.value,
                              })
                            }
                            placeholder="e.g. 60UC"
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                          />
                        </div>
                        <div className="w-28">
                          <label className="text-slate-400 text-xs block mb-1">
                            Cost
                          </label>
                          <DecimalInput
                            value={parseFloat(newItemForm.cost_lbp) || 0}
                            onChange={(n) =>
                              setNewItemForm({
                                ...newItemForm,
                                cost_lbp: n ? String(n) : "",
                              })
                            }
                            placeholder="LBP"
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                          />
                        </div>
                        <div className="w-28">
                          <label className="text-slate-400 text-xs block mb-1">
                            Sell
                          </label>
                          <DecimalInput
                            value={parseFloat(newItemForm.sell_lbp) || 0}
                            onChange={(n) =>
                              setNewItemForm({
                                ...newItemForm,
                                sell_lbp: n ? String(n) : "",
                              })
                            }
                            placeholder="LBP"
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                          />
                        </div>
                        <div className="w-16">
                          <label className="text-slate-400 text-xs block mb-1">
                            Order
                          </label>
                          <input
                            type="number"
                            value={newItemForm.sort_order}
                            onChange={(e) =>
                              setNewItemForm({
                                ...newItemForm,
                                sort_order: e.target.value,
                              })
                            }
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                          />
                        </div>
                        <button
                          onClick={handleAddItem}
                          className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-medium transition-colors"
                          type="button"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => {
                            setNewItemForm(null);
                            setAddItemError("");
                          }}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm transition-colors"
                          type="button"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
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

        <PaymentSheet
          open={showPaymentSheet}
          onClose={() => setShowPaymentSheet(false)}
          onConfirm={handleSubmit}
          isSubmitting={localSubmitting}
          title={activeSession ? "Add to Cart" : "Confirm Payment"}
          subtitle={`${totalItems} items — ${totalPrice.toLocaleString()} LBP`}
          accentColor={
            activeProvider === "WHISH_APP"
              ? "bg-[#ff0a46] hover:bg-[#ff0a46]/90 text-white"
              : activeProvider === "OMT_APP"
                ? "bg-[#ffde00] hover:bg-[#ffde00]/90 text-black"
                : "bg-violet-600 hover:bg-violet-500 text-white"
          }
          totalAmount={totalPrice}
          onKeptChange={setKeptChange}
          onReturnChange={setReturnLegs}
          totalAmountCurrency="LBP"
          currency="LBP"
          paymentMethods={methods}
          clientId={clientId}
          fetchClientVouchers={fetchClientVouchers}
          exchangeRate={exchangeRate}
          onExchangeRateChange={setEffectiveRate}
          requiresClientForDebt={true}
          hasClient={
            !!clientId ||
            !!activeSession?.customer_name ||
            (!!clientName.trim() && !!clientPhone.trim())
          }
          // Charge flow (catalog items / bills sold to a walk-in): a
          // shortfall becomes client debt — but only for a client the
          // backend can actually resolve (id, or name+phone to create).
          // Session-name-only is NOT enough for a debt row.
          autoDebtRemainder={
            !!clientId || (!!clientName.trim() && !!clientPhone.trim())
          }
          paymentInputKey={paymentInputKey}
          initialPaymentMethod={initialPaymentMethod}
          showDiscount={true}
          maxDiscount={maxDiscount}
          onDiscountChange={setDiscount}
          onPaymentChange={(lines) => {
            setPaymentLines(lines);
            if (lines.length === 1) {
              setPaymentMethod(lines[0].method);
            }
          }}
        >
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Client Name
            </label>
            <ClientAutocompleteInput
              type="text"
              value={clientName}
              onChange={(v) => {
                setClientName(v);
                if (!v) {
                  setClientId(null);
                  setClientPhone("");
                }
              }}
              onClientSelect={(c) => {
                setClientId(c.id);
                setClientPhone(c.phone_number || "");
                setInitialPaymentMethod("CUSTOMER_ACCOUNT");
                setPaymentInputKey((k) => k + 1);
              }}
              placeholder="Client name (optional)"
              className="w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
            />
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                <Phone size={14} />
              </div>
              <input
                type="tel"
                inputMode="numeric"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="Phone number (registers a new client)"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-violet-500"
              />
            </div>
            {clientName.trim() && clientPhone.trim() && !clientId && (
              <p className="text-xs text-violet-300/80 px-1">
                New client will be created on confirm.
              </p>
            )}
          </div>
          <TransactionTimeOverride
            value={transactionTime}
            onChange={setTransactionTime}
          />
        </PaymentSheet>
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
          sourceTable="financial_services"
          transactionType="FINANCIAL_SERVICE"
          onUpdateMetadata={async (id, data) => {
            const result = await window.api.financial.updateMetadata({
              id,
              ...(data.client_name !== undefined && {
                customer_name: data.client_name,
              }),
              ...(data.phone_number !== undefined && {
                phone_number: data.phone_number,
              }),
              ...(data.note !== undefined && { note: data.note }),
            });
            return result;
          }}
        />
      )}
    </>
  );
}
