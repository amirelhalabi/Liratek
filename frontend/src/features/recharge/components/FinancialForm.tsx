import { useState, useEffect, useMemo } from "react";
import { ChevronDown, Phone, Search, X, Plus } from "lucide-react";
import {
  appEvents,
  useApi,
  ServiceTypeTabs,
  hasNewClientInfo,
  type PaymentLine,
  Select,
  ConfirmModal,
} from "@liratek/ui";
import { PaymentSheet, type PaymentSheetItem } from "./PaymentSheet";
import { PROVIDER_BRANDS } from "@/shared/brand/providerBrands";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useAutoPrintReceipt } from "@/shared/hooks/useAutoPrintReceipt";
import { ensureRechargeClient } from "../utils/ensureClient";
import type { ServiceItem, ProviderKey } from "../hooks/useMobileServiceItems";
import { NewServiceItemInlineForm } from "./NewServiceItemInlineForm";
import {
  buildNewServiceItemPayload,
  emptyNewServiceItemForm,
  type NewServiceItemForm,
} from "../utils/catalogNames";
import { formatCatalogItemName } from "../hooks/useMobileServiceItems";
import { getCategoryColor } from "../utils/categoryColors";
import { getCardImage } from "../utils/cardImages";
import { CardArtwork } from "./CardArtwork";
import { CardGroupTag } from "./CardGroupTag";
import { cardGroupLabel } from "../utils/cardGroupLabel";
import { Collapsible } from "@/shared/components/Collapsible";
import { WhishCurrencySwitch } from "./WhishCurrencySwitch";
import {
  isLbpSellable,
  isUsdSellable,
  type CatalogCurrency,
} from "@liratek/core";
import type {
  FinancialTransaction,
  ServiceType,
  ProviderConfig,
  AnyProvider,
} from "../types";
import { providerBrandOf } from "../types";
import { HistoryModal } from "./HistoryModal";
import { useSellRate } from "@/hooks/useSellRate";
import logger from "@/utils/logger";
import { toCamelLegs, derivePaidByMethod } from "@/utils/paymentUtils";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import {
  ForPartnerToggle,
  ForPartnerNotice,
} from "@/features/partners/components/ForPartnerToggle";
import {
  useBasketPartner,
  useWhishBasket,
} from "../context/RechargeBasketContext";
import {
  useRechargeBasketCheckout,
  useRechargePartnerOrder,
} from "../hooks/useRechargeBasketCheckout";
import { partnerConfirmMessage } from "../utils/partnerConfirm";
import {
  basketItemCount,
  basketProviders,
  basketSheetSummary,
  isBasketProvider,
  whishBatchSubItems,
  withClient,
} from "../utils/basketCheckout";
import type { PricedLine } from "../types/basket";

interface FinancialFormProps {
  activeConfig: ProviderConfig | undefined;
  finTransactions: FinancialTransaction[];
  activeProvider: AnyProvider | null;
  serviceType?: ServiceType;
  setServiceType?: (type: ServiceType) => void;
  getCategoriesForProvider: (provider: ProviderKey) => string[];
  getServiceItems: (provider: ProviderKey, category: string) => ServiceItem[];
  methods: { code: string; label: string }[];
  /** Drawer-affecting subset of `methods` (`affects_drawer === 1`) — used
   *  ONLY for the For-Partner "Paid from" picker below (FinancialForm.tsx
   *  ~:868). See FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §4 defect #5. */
  drawerAffectingMethods: { code: string; label: string }[];
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
  /**
   * LIRA-324: the currency the catalog sells in (Whish App → Bills switch).
   * USD swaps each item's prices for its USD pair, hides items with no USD
   * price (and MTC / Alfa Prepaid cards) and books the sale in USD.
   * Defaults to LBP — every other caller is unchanged.
   */
  currency?: CatalogCurrency;
  /**
   * LIRA-324: when set, the LBP | USD switch shows just left of "Proceed to
   * Pay". The page owns the currency (and remembers it per device); the form
   * owns the basket, so it asks before a switch drops selected items.
   */
  onCurrencyChange?: (next: CatalogCurrency) => void;
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
  drawerAffectingMethods,
  clientName,
  setClientName,
  loadFinancialData,
  formatAmount,
  showHistory,
  setShowHistory,
  onRefreshItems,
  isAdmin,
  onCartCountChange,
  currency = "LBP",
  onCurrencyChange,
}: FinancialFormProps) {
  const api = useApi();
  const isUsd = currency === "USD";
  // The active provider's brand colours the selected card, its −/+ buttons
  // and the input focus (shared/brand/providerBrands.ts).
  const brand = PROVIDER_BRANDS[activeConfig?.brand ?? "WHISH"];
  /** Money as the active currency shows it: "$10.00" or "897,000 LBP". */
  const money = (n: number) =>
    isUsd
      ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${n.toLocaleString()} LBP`;
  /**
   * The item as the active currency sells it, or null when it does not sell
   * in that currency (LIRA-324; rule lives in @liratek/core, rule 14). In USD
   * the item's price fields carry its USD pair, so every price computation
   * below is currency-agnostic.
   */
  const inCurrency = (item: ServiceItem): ServiceItem | null => {
    const prices = {
      category: item.category,
      subcategory: item.subcategory,
      cost_lbp: item.catalogCost ?? 0,
      sell_lbp: item.catalogSellPrice ?? 0,
      cost_usd: item.catalogCostUsd ?? null,
      sell_usd: item.catalogSellPriceUsd ?? null,
    };
    if (!isUsd) return isLbpSellable(prices) ? item : null;
    if (!isUsdSellable(prices)) return null;
    // isUsdSellable guarantees both USD prices are set and above zero.
    return {
      ...item,
      catalogCost: item.catalogCostUsd ?? 0,
      catalogSellPrice: item.catalogSellPriceUsd ?? 0,
    };
  };
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
  // LIRA-326: on the Whish App tab the cart lives in the Mobile Recharge
  // basket (app shell), so picks survive switching tabs and leaving the page;
  // `others` = the iPick / Katsh group's priced lines. Any other provider this
  // form serves keeps a cart of its own.
  const isWhishApp = activeProvider === "WHISH_APP";
  const {
    cart,
    setCart,
    setPriced,
    others,
    clearAll: clearBasket,
    shared: basketShared,
  } = useWhishBasket(isWhishApp);
  const checkoutBasket = useRechargeBasketCheckout();
  const submitPartnerOrder = useRechargePartnerOrder();
  // Report selection counts to the provider tabs (quantities, keyed by each
  // cart item's own provider). With the shared basket the page counts the
  // picks itself, for every tab.
  useEffect(() => {
    if (!onCartCountChange) return;
    if (basketShared) return;
    const counts: Record<string, number> = {};
    for (const line of cart.values()) {
      counts[line.item.provider] =
        (counts[line.item.provider] ?? 0) + line.quantity;
    }
    onCartCountChange(counts);
  }, [cart, onCartCountChange, basketShared]);
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
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const { buyRate, sellRate } = useSellRate();
  const [searchQuery, setSearchQuery] = useState("");
  const [discount, setDiscount] = useState(0);
  // LIRA-319 — the extra from the payment box's "+ Extra" side (in the
  // sheet's total currency). Sent on its own field with the checkout's
  // carrier only — never folded into a unit's price — and never in a
  // session (the session checkout takes it) or for a partner (no sheet).
  const [extraCharge, setExtraCharge] = useState(0);
  // LIRA-324: a switch waiting for "Clear and switch" (items were selected).
  const [pendingCurrency, setPendingCurrency] =
    useState<CatalogCurrency | null>(null);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();
  // LIRA-327: on the Whish App tab, For Partner is the basket's (on in one
  // basket tab = on in all); every other provider keeps its own.
  // PFT-3b (Partner FOR-Transactions): a "for partner" order has NO walk-in
  // customer and collects NO counter cash — every cart unit is booked
  // straight to the selected partner's ledger (partnerMode: "FOR"), settled
  // later on the Partners page. Replaces the old always-on header
  // PartnerSelector (which implicitly meant partnerMode "THROUGH" and, with
  // exactly one partner in the system, mis-painted "Partner: <name>" on
  // every walk-in transaction — the reused `partnerId` state above is now
  // ONLY ever set while this checkbox is on).
  const {
    forPartner,
    setForPartner,
    partnerId,
    setPartnerId,
    shared: partnerShared,
  } = useBasketPartner(
    isWhishApp,
    // Owner rule 2026-10-16: no partner sales in a customer session — the
    // basket (or this form's own) For Partner is turned off while one is open.
    !!activeSession,
  );
  const [isSubmittingPartner, setIsSubmittingPartner] = useState(false);
  const [partnerPaidFromMethod, setPartnerPaidFromMethod] = useState("CASH");
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientPhone, setClientPhone] = useState("");
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("CASH");
  const [newItemForm, setNewItemForm] = useState<NewServiceItemForm | null>(
    null,
  );
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

  // LIRA-326: this cart, PRICED (items are already in the active currency),
  // published to the basket so another tab can list and pay it. Memoised on
  // exactly what pricing reads (rule 25: a fresh array per render would
  // re-publish forever).
  const pricedLines = useMemo<PricedLine[]>(
    () =>
      Array.from(cart.values()).flatMap((line): PricedLine[] => {
        const provider = line.item.provider;
        if (!isBasketProvider(provider)) return [];
        const subItems = whishBatchSubItems(
          line,
          serviceType || "SEND",
          currency,
        );
        const unitPrice = line.item.catalogSellPrice ?? 0;
        return [
          {
            key: line.item.key,
            provider,
            label: `${formatCatalogItemName(line.item)} x${line.quantity}`,
            sheetItem: {
              key: line.item.key,
              name: line.item.label,
              group: cardGroupLabel(line.item),
              image: getCardImage(line.item),
              quantity: line.quantity,
              unitPrice,
              currency,
              provider: providerBrandOf(line.item.provider),
            },
            currency,
            amount: unitPrice * line.quantity,
            cost: (line.item.catalogCost ?? 0) * line.quantity,
            commission: subItems.reduce((s, x) => s + x.commission, 0),
            subItems,
          },
        ];
      }),
    [cart, currency, serviceType],
  );
  useEffect(() => {
    setPriced(pricedLines);
  }, [pricedLines, setPriced]);

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

  // The cart lines as the payment window lists them. Cart items are already
  // priced in the active currency (inCurrency, LIRA-324), so each unit price
  // here is the one totalPrice sums: Σ unitPrice × quantity === totalPrice.
  // Plain derivation like totalPrice — a hook cannot sit after the early
  // return above.
  const sheetItems: PaymentSheetItem[] = isWhishApp
    ? pricedLines.map((l) => l.sheetItem)
    : Array.from(cart.values()).map((line) => ({
        key: line.item.key,
        name: line.item.label,
        group: cardGroupLabel(line.item),
        image: getCardImage(line.item),
        quantity: line.quantity,
        unitPrice: line.item.catalogSellPrice ?? 0,
        currency,
        provider: providerBrandOf(line.item.provider),
      }));

  // LIRA-326 — Whish App picks plus iPick / Katsh picks from the other tab:
  // ONE payment for the whole basket (the server books one sale per
  // provider). A Whish-only basket stays today's single sale.
  // `others` carries the staged iPick / Katsh bills too (LIRA-327).
  const basketLines = [...pricedLines, ...others];
  const isMixedBasket =
    isWhishApp &&
    !activeSession &&
    !forPartner &&
    basketProviders(basketLines).size > 1;
  const basketSheet = basketSheetSummary(basketLines);
  // LIRA-327 — what a basket-wide partner order submits (every tab).
  const basketCount = partnerShared
    ? basketItemCount(basketLines)
    : Array.from(cart.values()).reduce((n, l) => n + l.quantity, 0);

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
    const provider = newItemForm.provider as ProviderKey;
    const built = buildNewServiceItemPayload(
      newItemForm,
      categories,
      (category) =>
        getServiceItems(provider, category).map((i) => i.subcategory),
    );
    if (!built.ok) {
      setAddItemError(built.error);
      return;
    }
    try {
      const res = await api.createMobileServiceItem(built.payload);
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
  const cancelNewItem = () => {
    setNewItemForm(null);
    setAddItemError("");
  };

  const handleSubmit = async () => {
    if (cart.size === 0 || localSubmitting) return;

    const clientResult = await ensureRechargeClient({
      clientId,
      inSession: !!activeSession,
      name: clientName,
      phone: clientPhone,
      // An OUT CUSTOMER_ACCOUNT (change to account) leg needs a client too.
      paymentLines: [...paymentLines, ...returnLegs],
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
          ? `${providerLabel} (${cartItems.length} items) - ${money(totalPrice)}`
          : `${providerLabel}: ${itemLabels}`;

      // Store each line item for replay at checkout
      // One shared builder (rule 14) — each unit under its own provider.
      const formDataItems = withClient(
        cartItems.flatMap((line) =>
          whishBatchSubItems(line, serviceType || "SEND", currency),
        ),
        {
          clientId: resolvedClientId,
          ...(clientName ? { clientName } : {}),
          // Bug #4: the time picked on the form, as on a walk-in sale.
          transactionTime,
        },
      );

      addToSessionCart({
        module: activeProvider === "WHISH_APP" ? "whish_app" : "omt_app",
        label,
        amount: totalPrice,
        currency,
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

    // LIRA-326 — items from two or more providers: ONE payment for the whole
    // basket, recorded by the server as a walk-in customer session with one
    // sale per provider.
    if (isMixedBasket) {
      setLocalSubmitting(true);
      const result = await checkoutBasket({
        lines: basketLines,
        discount: basketSheet.singleCurrency ? discount : 0,
        payments: paymentLines,
        returnLegs,
        paidByMethod: derivePaidByMethod(paymentLines, paymentMethod),
        exchangeRate: effectiveRate ?? exchangeRate,
        keptChange,
        extra:
          basketSheet.currency === "USD"
            ? { usd: extraCharge, lbp: 0 }
            : { usd: 0, lbp: extraCharge },
        client: { clientId: resolvedClientId, clientName, clientPhone },
      });
      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Basket paid successfully",
          "success",
        );
        clearBasket();
        setKeptChange(null);
        setExtraCharge(0);
        setReturnLegs([]);
        setClientName("");
        setClientPhone("");
        setClientId(null);
        setExpandedKeys(new Set());
        setSearchQuery("");
        setTransactionTime(undefined);
        if (
          paymentMethod === "CUSTOMER_ACCOUNT" ||
          paymentLines.some((l) => l.method === "CUSTOMER_ACCOUNT") ||
          returnLegs.some((l) => l.method === "CUSTOMER_ACCOUNT")
        ) {
          window.dispatchEvent(new CustomEvent("debt-ledger-changed"));
        }
        // Booked as a session checkout: an on-account part is a Session
        // Debt row — let the TopBar's session balance badge refresh.
        appEvents.emit("debt:changed");
      } else {
        // The basket stays as it was — nothing was booked.
        alert(result.error);
      }
      loadFinancialData();
      setLocalSubmitting(false);
      return;
    }

    setLocalSubmitting(true);

    const cartItems = Array.from(cart.values());
    // CARRIER_LINES_VALIDITY_PLAN.md Phase 7: derive straight from the pay
    // sheet's CURRENT legs, not the `paymentMethod` state alone — that state
    // is only ever written from `onPaymentChange`'s `lines.length === 1`
    // self-heal, so deriving here (rather than trusting the state to have
    // tracked every change) matches the sheet on every render.
    const finalPaymentMethod = derivePaidByMethod(paymentLines, paymentMethod);
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
    // (totalPrice, in the catalog currency) net of the same `discount` the per-unit
    // loop below already applies, so the repository can reconcile the legs
    // against the real customer-owed total for the checkout instead of one
    // item's price.
    const checkoutTotalAmount = Math.max(0, totalPrice - discount);
    // LIRA-324: the total sits on the side of the catalog's currency.
    const checkoutTotal = isUsd
      ? { usd: checkoutTotalAmount, lbp: 0 }
      : { usd: 0, lbp: checkoutTotalAmount };

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
    // LIRA-319 — the extra rides the FIRST transaction too (the legs-
    // carrying carrier; `checkoutTotal` stays pre-extra, the repository
    // adds it). Siblings are deferPayment and may not carry one.
    let extraPending =
      (serviceType || "SEND") === "SEND" && extraCharge > 0 ? extraCharge : 0;
    // Payment legs book against exactly ONE carrier transaction — the first
    // unit; every other unit submits deferPayment (cost + commission only).
    // Attaching the same legs to all N unit calls multiplies the drawer
    // inflow and any CUSTOMER_ACCOUNT debt N× (KatshForm's bills loop guards
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
            currency,
            commission: Math.max(0, commission),
            // LIRA-329: this unit's share of the discount the cashier typed.
            ...(unitDiscountShare > 0
              ? { typedDiscount: { amount: unitDiscountShare, currency } }
              : {}),
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
            ...(extraPending > 0
              ? (() => {
                  const e = extraPending;
                  extraPending = 0;
                  return isUsd ? { extra_usd: e } : { extra_lbp: e };
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
      setExtraCharge(0);
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
    if (partnerShared) {
      await handleBasketPartnerSubmit();
      return;
    }
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
            currency,
            commission,
            payments: isTransferOutLeg
              ? [
                  {
                    method: partnerPaidFromMethod,
                    currencyCode: currency,
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

  // LIRA-327 — the Whish App tab inside the Mobile Recharge basket: ONE
  // submit books every provider's partner sales (this tab's units, the iPick
  // / Katsh cards and the staged bills), exactly as each tab's own submit
  // wrote them, all or nothing (core RechargePartnerOrderService).
  const handleBasketPartnerSubmit = async () => {
    if (basketLines.length === 0 || isSubmittingPartner) return;
    if (!partnerId) {
      alert("Select a partner for this order.");
      return;
    }
    setIsSubmittingPartner(true);
    const result = await submitPartnerOrder({
      lines: basketLines,
      partnerId,
      transactionTime,
      paidFromMethod: partnerPaidFromMethod,
    });
    if (result.success) {
      appEvents.emit(
        "notification:show",
        "Partner order submitted successfully",
        "success",
      );
      // Everything was booked: empty the whole basket (For Partner off).
      clearBasket();
      setExpandedKeys(new Set());
      setSearchQuery("");
      setTransactionTime(undefined);
    } else {
      // Nothing was booked — the basket stays as it was.
      logger.error("Partner order submit failed:", result.error);
      alert(result.error);
    }
    loadFinancialData();
    setIsSubmittingPartner(false);
  };

  // LIRA-327 — turning For Partner on while the basket already holds items
  // makes ALL of them a partner order: ask first.
  const handleForPartnerChange = (next: boolean) => {
    if (
      next &&
      partnerShared &&
      basketCount > 0 &&
      !window.confirm(partnerConfirmMessage(basketCount))
    ) {
      return;
    }
    setForPartner(next);
  };

  // A basket-wide partner order can go even when this tab's grid is empty.
  const proceedDisabled = forPartner
    ? basketCount === 0 || isSubmittingPartner || !partnerId
    : totalItems === 0;

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
                accentColor="violet"
                customColor={
                  activeProvider === "OMT_APP"
                    ? PROVIDER_BRANDS.OMT.hex
                    : activeProvider === "iPick"
                      ? PROVIDER_BRANDS.IPICK.hex
                      : activeProvider === "Katsh"
                        ? PROVIDER_BRANDS.KATSH.hex
                        : undefined
                }
                customTextColor={
                  activeProvider === "OMT_APP"
                    ? "black"
                    : activeProvider === "Katsh"
                      ? PROVIDER_BRANDS.KATSH.onHex
                      : "white"
                }
                size="sm"
              />
            </div>
          </div>
        )}

        {/* Sticky top row: Search + Proceed to Pay — never scrolls away */}
        <div className="sticky -top-1 z-10 flex items-center gap-3 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-1">
          {(activeProvider === "iPick" ||
            activeProvider === "Katsh" ||
            activeProvider === "WHISH_APP") && (
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${activeProvider === "iPick" ? "iPick" : activeProvider === "Katsh" ? "Katsh" : "Whish App"} items...`}
                className={`w-full px-4 py-2.5 pl-10 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none ${brand.searchFocus} transition-all`}
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
                  {money(totalPrice)}
                </div>
                {exchangeRate > 0 && (
                  <div className="text-xs text-slate-400 font-mono">
                    {isUsd
                      ? `${Math.round(totalPrice * exchangeRate).toLocaleString()} LBP`
                      : `$${(totalPrice / exchangeRate).toFixed(2)}`}
                  </div>
                )}
              </div>
            )}
            {/* "For Partner" opt-in — routes every cart unit to a selected
                partner's ledger instead of collecting counter cash. Skips
                the PaymentSheet entirely (see handleForPartnerSubmit).
                Renders for EVERY provider this form serves, unlike the old
                always-on header PartnerSelector it replaces. */}
            {!activeSession && (
              <ForPartnerToggle
                testId="financial-for-partner-toggle"
                checked={forPartner}
                onChange={handleForPartnerChange}
                selectedPartnerId={partnerId}
                onPartnerChange={setPartnerId}
                autoSelectSingle
                activeClassName={
                  activeConfig?.brand
                    ? PROVIDER_BRANDS[activeConfig.brand].solid
                    : undefined
                }
                selectorClassName=""
              />
            )}
            {onCurrencyChange && (
              <WhishCurrencySwitch
                value={currency}
                onChange={(next) => {
                  if (cart.size > 0) setPendingCurrency(next);
                  else onCurrencyChange(next);
                }}
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
              data-testid="financial-proceed"
              disabled={proceedDisabled}
              className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all whitespace-nowrap ${
                proceedDisabled
                  ? "bg-slate-700 text-slate-300 cursor-not-allowed"
                  : activeProvider === "WHISH_APP"
                    ? PROVIDER_BRANDS.WHISH.button
                    : activeProvider === "OMT_APP"
                      ? PROVIDER_BRANDS.OMT.button
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
            contentClassName="flex items-center justify-between gap-3 flex-wrap"
          >
            {partnerShared ? (
              <span>
                Partner order: nothing is collected now — everything in the
                basket, on every tab, goes on the partner&apos;s account at full
                price, settled on the Partners page.
              </span>
            ) : (
              <span>
                Partner order: nothing is collected now — the full{" "}
                <span className="font-bold">{money(totalPrice)}</span> goes on
                the partner&apos;s account, settled on the Partners page.
              </span>
            )}
            {hasTransferUnit && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-orange-700 dark:text-orange-300/80 uppercase tracking-wider">
                  Paid from
                </span>
                <Select
                  value={partnerPaidFromMethod}
                  onChange={setPartnerPaidFromMethod}
                  // Drawer-affecting methods ONLY (not the unfiltered
                  // `methods`) — FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §4
                  // defect #5. The chosen value becomes an OUT payment leg
                  // below (handleForPartnerSubmit), and the backend's
                  // assertNoCustomerAccountLeg hard-rejects a CUSTOMER_ACCOUNT
                  // OUT leg, so offering it here always failed the submit.
                  options={drawerAffectingMethods.map((m) => ({
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
              ).flatMap((i) => {
                const priced = inCurrency(i);
                return priced ? [priced] : [];
              });
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
                              newItemForm?.category === category &&
                                !newItemForm.isNewCategory
                                ? null
                                : emptyNewServiceItemForm(
                                    activeProvider as string,
                                    category,
                                  ),
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
                  {newItemForm?.category === category &&
                    !newItemForm.isNewCategory && (
                      <NewServiceItemInlineForm
                        form={newItemForm}
                        error={addItemError}
                        onChange={setNewItemForm}
                        onSubmit={handleAddItem}
                        onCancel={cancelNewItem}
                      />
                    )}
                  <Collapsible open={!collapsedCategories.has(category)}>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-3">
                      {filteredItems.map((item) => {
                        const inCart = cart.get(item.key);
                        const qty = inCart?.quantity ?? 0;
                        const isExpanded = expandedKeys.has(item.key);
                        const cost = item.catalogCost ?? 0;
                        const sellPrice = item.catalogSellPrice ?? 0;
                        const cardImage = getCardImage(item);

                        return (
                          <div
                            key={item.key}
                            className="relative flex flex-col"
                          >
                            <div
                              className={`flex-1 flex flex-col w-full p-3 rounded-lg border transition-all ${
                                qty > 0
                                  ? brand.selected
                                  : "border-white/10 hover:border-white/20"
                              } ${isExpanded ? brand.selectedStrong : ""}`}
                              style={{
                                backgroundColor: `${getCategoryColor(item.category)}18`,
                              }}
                            >
                              <div
                                onClick={() => handleCardClick(item)}
                                className="flex-1 flex flex-col cursor-pointer"
                              >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                    <div className="text-white font-medium text-sm truncate">
                                      {item.label}
                                    </div>
                                    {cardImage && <CardGroupTag item={item} />}
                                  </div>
                                  {qty > 0 && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleQuantityChange(item, -1);
                                        }}
                                        className={`w-5 h-5 rounded-full ${brand.stepper} flex items-center justify-center transition-colors cursor-pointer text-xs font-bold`}
                                        type="button"
                                      >
                                        −
                                      </button>
                                      <span
                                        className={`w-4 text-center text-xs font-bold ${brand.text}`}
                                      >
                                        {qty}
                                      </span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleQuantityChange(item, 1);
                                        }}
                                        className={`w-5 h-5 rounded-full ${brand.stepper} flex items-center justify-center transition-colors cursor-pointer text-xs font-bold`}
                                        type="button"
                                      >
                                        +
                                      </button>
                                    </div>
                                  )}
                                </div>
                                {cardImage ? (
                                  <CardArtwork
                                    src={cardImage}
                                    alt={`${item.category} ${item.label}`}
                                  />
                                ) : (
                                  // flex-1: in a row where another card has
                                  // artwork, this grows to the artwork's
                                  // height so Cost / Sell line up below it.
                                  <div className="min-h-4 flex-1 flex items-center justify-center">
                                    <span className="text-slate-500 text-xs truncate">
                                      {item.subcategory}
                                    </span>
                                  </div>
                                )}
                                <div className="mt-2 flex items-center justify-between">
                                  <span className="text-xs text-slate-400">
                                    Cost:
                                  </span>
                                  <span className="text-xs text-white font-mono">
                                    {money(cost)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-slate-400">
                                    Sell:
                                  </span>
                                  <span className="text-xs text-emerald-400 font-mono">
                                    {money(sellPrice)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Collapsible>
                </div>
              );
            })}
            {isAdmin &&
              (newItemForm?.isNewCategory ? (
                <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                    New category
                  </h3>
                  <NewServiceItemInlineForm
                    form={newItemForm}
                    error={addItemError}
                    onChange={setNewItemForm}
                    onSubmit={handleAddItem}
                    onCancel={cancelNewItem}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAddItemError("");
                    setNewItemForm(
                      emptyNewServiceItemForm(
                        activeProvider as string,
                        "",
                        true,
                      ),
                    );
                  }}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
                  title="New category"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New category
                </button>
              ))}
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
          accentColor={
            activeProvider === "WHISH_APP"
              ? PROVIDER_BRANDS.WHISH.button
              : activeProvider === "OMT_APP"
                ? PROVIDER_BRANDS.OMT.button
                : "bg-violet-600 hover:bg-violet-500 text-white"
          }
          {...(isMixedBasket
            ? {
                // LIRA-326 — every provider's picks, paid once. A discount
                // only on a one-currency basket (never converted), capped at
                // the basket's profit and spread over the sales by profit.
                subtitle: `${basketSheet.count} items — ${basketSheet.totals
                  .map((t) =>
                    t.currency === "LBP"
                      ? `${Math.round(t.amount).toLocaleString()} LBP`
                      : `$${t.amount.toFixed(2)}`,
                  )
                  .join(" + ")}`,
                items: basketSheet.items,
                totals: basketSheet.totals,
                totalAmount: basketSheet.totalAmount,
                totalAmountCurrency: basketSheet.currency,
                currency: basketSheet.currency,
                showDiscount: basketSheet.singleCurrency,
                maxDiscount: basketSheet.maxDiscount,
              }
            : {
                subtitle: `${totalItems} items — ${money(totalPrice)}`,
                items: sheetItems,
                totalAmount: totalPrice,
                totalAmountCurrency: currency,
                currency,
                showDiscount: true,
                maxDiscount,
              })}
          onKeptChange={setKeptChange}
          onReturnChange={setReturnLegs}
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
          // Change not handed back → store credit (OUT CUSTOMER_ACCOUNT leg,
          // forwarded in `payments`). Same client rule as auto-debt; never in a
          // session, where the basket checkout owns the change.
          {...(!activeSession &&
          (!!clientId || (!!clientName.trim() && !!clientPhone.trim()))
            ? { unreturnedChangeTo: "CUSTOMER_ACCOUNT" as const }
            : {})}
          paymentInputKey={paymentInputKey}
          initialPaymentMethod={initialPaymentMethod}
          onDiscountChange={setDiscount}
          // LIRA-319: "− Discount | + Extra" on a walk-in sale only (a
          // session or a partner order never opens this sheet; a RECEIVE is
          // the shop paying out, never an extra).
          {...(!activeSession &&
          !forPartner &&
          (serviceType || "SEND") === "SEND"
            ? { onExtraChange: setExtraCharge }
            : {})}
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
              className={`w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none ${brand.focusBorder}`}
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
                className={`w-full bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-3 py-2 text-sm text-white font-mono focus:outline-none ${brand.focusBorder}`}
              />
            </div>
            {clientName.trim() && clientPhone.trim() && !clientId && (
              <p className="text-xs text-violet-300/80 px-1">
                New client will be created on confirm.
              </p>
            )}
          </div>
          {/* LIRA-326: a combined basket is booked "now" — the basket
              checkout takes no backdated time, so the field is not offered. */}
          {!isMixedBasket && (
            <TransactionTimeOverride
              value={transactionTime}
              onChange={setTransactionTime}
            />
          )}
        </PaymentSheet>
      </div>

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={providerTx}
          loadAll={async () =>
            (
              (await api.getOMTHistory(activeProvider ?? undefined, {
                all: true,
              })) as FinancialTransaction[]
            ).filter((tx) => tx.provider === activeProvider)
          }
          provider={meta.label}
          onClose={() => setShowHistory(false)}
          onRefresh={loadFinancialData}
          formatAmount={formatAmount}
          showFeeAndProfit
          sourceTable="financial_services"
          transactionType="FINANCIAL_SERVICE"
          onUpdateMetadata={async (id, data) => {
            // Migrated off raw window.api (rule 19) onto the shared
            // updateFinancialMetadata adapter fn, which also has a REST
            // twin. NOTE: the field is `client_name` (matching the adapter
            // contract and the underlying service), not `customer_name` —
            // the old raw call sent `customer_name`, a key the IPC handler
            // never reads, so this edit's name field was a silent no-op.
            const result = await api.updateFinancialMetadata({
              id,
              ...(data.client_name !== undefined && {
                client_name: data.client_name,
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
      <ConfirmModal
        isOpen={pendingCurrency !== null}
        title={`Switch to ${pendingCurrency ?? ""}?`}
        message={`Your selected items are priced in ${currency}. Switching to ${pendingCurrency ?? ""} clears them.`}
        confirmLabel="Clear and switch"
        variant="warning"
        onCancel={() => setPendingCurrency(null)}
        onConfirm={() => {
          const next = pendingCurrency;
          setPendingCurrency(null);
          if (!next) return;
          // Every amount below is in the old currency — drop them all.
          setCart(new Map());
          setKeptChange(null);
          setExtraCharge(0);
          setReturnLegs([]);
          setPaymentLines([]);
          onCurrencyChange?.(next);
        }}
      />
    </>
  );
}
