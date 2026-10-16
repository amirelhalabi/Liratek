import { useState, useEffect, useRef, useMemo } from "react";
import logger from "@/utils/logger";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import { printReceipt } from "@/shared/utils/printReceipt";
import { X, User, Printer, Inbox, Pencil, Minus } from "lucide-react";
import {
  canChargeToCustomerAccount,
  DecimalInput,
  DiscountLine,
  discountFieldClass,
  MultiPaymentInput,
  useApi,
  appEvents,
  type PaymentLine,
  type Money,
} from "@liratek/ui";
import { useSellRate } from "@/hooks/useSellRate";
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
import { DEFAULT_DRAWER_NAME as DRAWER_B } from "@/constants/checkout";
import {
  receiptNumberFor,
  serialLabelFor,
  type SaleProcessPayload,
  type SerialLabel,
} from "@liratek/core";
import {
  isPaymentComplete,
  convertLBPToUSD,
  toSnakeLegs,
} from "@/utils/paymentUtils";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { saleDrawerDestinations } from "@/features/sales/utils/saleDrawerDestinations";
import {
  ForPartnerToggle,
  ForPartnerNotice,
} from "@/features/partners/components/ForPartnerToggle";
import { useForPartnerOffInSession } from "@/features/partners/hooks/useForPartnerOffInSession";

export type PaymentData = Omit<SaleRequest, "items" | "status" | "id"> & {
  cart?: CartItem[];
} & Pick<SaleProcessPayload, "extra_usd" | "extra_lbp"> & {
    // LIRA-319: the extra-charge keys typed from the shared sale schema
    // (rule 21) — never a hand-written copy.
    clientId?: number | null;
    paidUSD?: number;
    paidLBP?: number;
    /**
     * Currency that `total_amount`/`discount`/`final_amount` are expressed in
     * (mirrors the `currency` prop, defaulted to "USD" via `totalCurrency`).
     * Always set by `getPaymentData` — see CheckoutModal.tsx.
     */
    currency: "USD" | "LBP";
  };

interface CheckoutModalProps {
  items?: CartItem[];
  /** T3 keep-change opt-in: only flows whose backend accepts and checks
   *  kept_change_* (POS sales and Maintenance checkout, both via
   *  resolveKeptChange) may wire it — on others the fields would be
   *  stripped at validation and the change silently neither returned nor
   *  stamped. Default false. */
  allowKeepChange?: boolean;
  /** PFT-2b "For Partner" opt-in: only flows whose backend accepts
   *  partnerId/partnerMode (POS sales) may show the toggle — on others
   *  (Maintenance/Session share this modal) the fields would be stripped at
   *  validation and the remainder would silently fall through to the
   *  client-debt branch instead of the partner's ledger. Default false. */
  allowForPartner?: boolean;
  /** LIRA-318: true when completing this checkout adds it to an active
   *  session's basket instead of saving it (Maintenance in a customer
   *  session). The session checkout drops OUT legs (`deferPayment`), so the
   *  change box must not offer "put the change on the client's account" —
   *  that credit would never be booked. Default false. */
  addsToSessionBasket?: boolean;
  /** LIRA-319 (owner 2026-10-13): offer the "− Discount | + Extra" switch on
   *  the payment box's Discount line — the customer pays a little more than
   *  the price; the extra is sent as `extra_usd` / `extra_lbp`. Opt-in: only
   *  a host that forwards those fields to the server may turn it on (POS
   *  does; Maintenance builds its own payload). Never offered on a partner
   *  sale or when the job goes into a session basket. Default false. */
  allowExtraCharge?: boolean;
  totalAmount: number;
  /**
   * Currency the total/discount/net are expressed in. Defaults to "USD".
   * When "LBP", the modal treats `totalAmount` as an LBP amount and performs
   * all settlement (remaining/change/debt) in LBP. The USD path is unchanged
   * when this prop is omitted.
   */
  currency?: "USD" | "LBP";
  /**
   * Amounts owed in a currency OTHER than `currency`, merged into the
   * per-currency totals array passed to MultiPaymentInput — e.g. maintenance
   * parts (always USD, never converted) billed alongside LBP-priced labour.
   * Zero-amount entries are filtered out, so an empty/all-zero array is
   * indistinguishable from the prop being absent. This modal's `discount`
   * (and any `maxDiscount` cap passed to MultiPaymentInput) stays scoped to
   * `totalCurrency` and never applies here: a maintenance discount is a
   * labour discount, and letting it eat into parts would silently cut into
   * part margins. Optional — omitting it leaves every existing caller
   * byte-identical to today.
   */
  extraTotals?: Money[] | undefined;
  /**
   * LIRA-176 7b: caps the discount input to `totalCurrency` (never applies
   * to `extraTotals`) — e.g. maintenance passes the labour price so a
   * discount can never eat into the parts total merged into `totalAmount`.
   * Omitting it (every existing caller) leaves the discount input uncapped,
   * byte-identical to today.
   */
  maxDiscount?: number | undefined;
  onClose?: () => void;
  onComplete: (paymentData: PaymentData) => Promise<void>;
  onSaveDraft: (paymentData: PaymentData) => Promise<void>;
  onMinimize?: (checkoutData: CheckoutDraftData) => void;
  onEdit?: (checkoutData: CheckoutDraftData) => void;
  onCancel?: () => void;
  draftData?: CheckoutDraftData; // optional: only provided when restoring a draft
  /** The customer the host page already typed (Maintenance: the job's
   *  Client Name / Phone). Seeds the Customer fields ONCE, on mount, as
   *  typed text — never as a selected client, which would switch the first
   *  payment line to Customer Account. Rule 11. */
  initialCustomer?: { name: string; phone: string } | undefined;
  onRestoreDraftComplete?: () => void;
  isDraft?: boolean;
  /** LIRA-296: the sale's id when it already exists (a resumed draft) — the
   *  receipt then prints `RCP-<id>`, the same number a reprint prints. */
  saleId?: number | null | undefined;
  /** LIRA-296 P3: what a line's category calls its unit serial ("IMEI" or
   *  "Serial"), for the receipt. Omitted: the tracking flag decides. */
  serialLabelOf?: (
    category: string | null | undefined,
    tracksImeiUnits?: number | boolean | null,
  ) => SerialLabel;
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
  /** PFT-2b: preserves the "For Partner" toggle + selected partner across
   *  minimize/edit/resume so a restored draft doesn't silently fall back to
   *  a normal client sale. Optional — old persisted drafts without these
   *  fields still restore fine (falls back to a normal, non-partner sale). */
  forPartner?: boolean;
  selectedPartnerId?: number | null;
  /** LIRA-319: the extra charge on this checkout (in the total's currency).
   *  Optional — drafts saved before it restore with no extra. */
  extra?: number;
};

export default function CheckoutModal({
  items,
  allowKeepChange = false,
  allowForPartner = false,
  addsToSessionBasket = false,
  allowExtraCharge = false,
  totalAmount,
  currency,
  extraTotals,
  maxDiscount,
  onClose,
  onComplete,
  onSaveDraft,
  onMinimize,
  onEdit,
  onCancel,
  draftData,
  initialCustomer,
  onRestoreDraftComplete,
  isDraft,
  saleId,
  serialLabelOf = (_category, tracksImeiUnits) =>
    serialLabelFor({ tracks_imei_units: tracksImeiUnits ?? 1 }),
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
  // Rule 11: the host's typed customer seeds the fields once (mount only).
  // A name goes in the search field with the phone beside it; a phone alone
  // goes in the search field (it reads as a phone search).
  const seedName = initialCustomer?.name.trim() ?? "";
  const seedPhone = initialCustomer?.phone.trim() ?? "";
  const [clientSearch, setClientSearch] = useState(seedName || seedPhone);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);

  // PFT-2b: "For Partner" toggle — when true, the sale's unpaid remainder
  // routes to the selected partner's ledger (FOR_POS DEBIT) instead of a
  // client's debt_ledger. Gated behind allowForPartner (see prop above).
  const [forPartner, setForPartner] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(
    null,
  );
  // Owner rule 2026-10-16: a customer session never has partner sales —
  // For Partner is hidden in a session and turned off if it was on.
  useForPartnerOffInSession(!!activeSession, forPartner, () => {
    setForPartner(false);
    setSelectedPartnerId(null);
  });

  // Payment State
  const [discount, setDiscount] = useState(0);
  // LIRA-318: true while the typed discount was above `maxDiscount` and got
  // cut to it, so the line can say "Capped to max (…)" instead of clamping
  // silently. The stored `discount` is always the clamped value.
  const [discountCapped, setDiscountCapped] = useState(false);
  const handleDiscountChange = (v: number) => {
    const capped = maxDiscount != null ? Math.min(v, maxDiscount) : v;
    setDiscountCapped(capped < v);
    setDiscount(capped);
  };
  // LIRA-319 — the line's other side: an extra charge ADDED to the total.
  // A sale has a discount OR an extra, never both (the server refuses both):
  // switching sides clears the other amount.
  const [lineMode, setLineMode] = useState<"discount" | "extra">("discount");
  const [extra, setExtra] = useState(0);
  const [extraCapped, setExtraCapped] = useState(false);
  /** The extra may be taken here at all: the host opted in, and this is not
   *  a partner sale nor a session-basket job (the session checkout takes
   *  the extra there). */
  const canExtra = allowExtraCharge && !forPartner && !addsToSessionBasket;
  const isExtraMode = canExtra && lineMode === "extra";
  /** The extra that is actually charged and sent. */
  const appliedExtra = isExtraMode ? extra : 0;
  const handleExtraChange = (v: number) => {
    // Default cap (FR-006): never more than the sale itself (pre-extra).
    const capped = Math.min(Math.max(0, v), totalAmount);
    setExtraCapped(capped < v);
    setExtra(capped);
  };
  const handleLineModeChange = (m: "discount" | "extra") => {
    setLineMode(m);
    setDiscount(0);
    setDiscountCapped(false);
    setExtra(0);
    setExtraCapped(false);
  };
  // A partner sale never carries an extra: drop it when the toggle goes on.
  useEffect(() => {
    if (!forPartner) return;
    setLineMode("discount");
    setExtra(0);
    setExtraCapped(false);
  }, [forPartner]);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();

  const { allMethods: paymentMethodOptions } = usePaymentMethods();
  // FOR-partner sales never combine with CUSTOMER_ACCOUNT — routing is
  // mutually exclusive (mirrors SalesRepository's reject-CUSTOMER_ACCOUNT-leg
  // guard for a FOR-partner sale). Hide it from the picker while active.
  const effectivePaymentMethods = forPartner
    ? paymentMethodOptions.filter((pm) => pm.code !== "CUSTOMER_ACCOUNT")
    : paymentMethodOptions;
  const shopInfo = useShopInfo();

  // ── MultiPaymentInput state ──────────────────────────────────────────────
  // Vouchers, currency conversion, exchange-rate editing, and the CASH
  // return/change UI all live inside the shared component now (see
  // fetchClientVouchers/clientId/cashOnlyReturn props on the element below).
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [returnLines, setReturnLines] = useState<PaymentLine[]>([]);
  // T3 keep-change: per-currency change the operator chose to KEEP as profit
  // (null = returning change normally). Keeping is partial: returnLines
  // still holds whatever cash IS handed back (sent as change_given_*), and
  // the server checks IN − change − kept = total before stamping the kept
  // amount onto profit (resolveKeptChange, POSTING_MAP G42).
  const [keptChange, setKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  // Bumped whenever a draft is (re)restored so MultiPaymentInput remounts and
  // re-reads initialLines (its own contract: read once on mount).
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [draftInitialLines, setDraftInitialLines] = useState<
    Array<{ method?: string; currencyCode: string; amount: number }> | undefined
  >(() => {
    if (!draftData) return undefined;
    const lines: Array<{
      method?: string;
      currencyCode: string;
      amount: number;
    }> = [];
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

  // Payments convert LBP<->USD at the shop's BUY rate, like every other
  // MultiPaymentInput (owner decisions 2026-07-06 and 2026-10-07). POS and
  // Maintenance (which reuses this modal) used the SALE -> sell rate, so a
  // $10 item asked more LBP here than on any other screen.
  const { buyRate: exchangeRate } = useSellRate();

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

  // Receipt split: CUSTOMER_ACCOUNT legs are debt, not tender — the printed
  // receipt must never claim the on-account portion was paid in cash/wallet
  // (paidUSD/paidLBP above intentionally still include them: settlement
  // completeness counts covered-by-debt as covered).
  const isTenderLeg = (p: PaymentLine) => p.method !== "CUSTOMER_ACCOUNT";
  const tenderUSD = paymentLines
    .filter((p) => p.currencyCode === "USD" && isTenderLeg(p))
    .reduce((acc, p) => acc + (p.amount || 0), 0);
  const tenderLBP = paymentLines
    .filter((p) => p.currencyCode === "LBP" && isTenderLeg(p))
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
      // LIRA-319: a draft with an extra reopens on the Extra side.
      const draftExtra = draftData.extra ?? 0;
      setLineMode(draftExtra > 0 ? "extra" : "discount");
      setExtra(draftExtra);
      setExtraCapped(false);
      // PFT-2b: restore the "For Partner" toggle + selected partner so a
      // resumed for-partner order doesn't silently become a normal sale.
      setForPartner(draftData.forPartner ?? false);
      setSelectedPartnerId(draftData.selectedPartnerId ?? null);
      const lines: Array<{
        method?: string;
        currencyCode: string;
        amount: number;
      }> = [];
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
  const [secondaryInput, setSecondaryInput] = useState(
    seedName ? seedPhone : "",
  );

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
  // LIRA-319: what the customer is charged — the net price plus the extra.
  // `finalAmount` stays the item total (the payload's `final_amount`).
  const chargedAmount = finalAmount + appliedExtra;
  // LIRA-176 7a: amounts owed in a currency other than totalCurrency (e.g.
  // maintenance USD parts on an LBP-priced job), merged into the totals array
  // handed to MultiPaymentInput. Zero-amount entries filtered so an empty or
  // all-zero extraTotals is indistinguishable from the prop being absent —
  // allTotals then collapses to the single original entry and every existing
  // caller (which never passes extraTotals) is unaffected.
  const nonZeroExtraTotals: Money[] = (extraTotals ?? []).filter(
    (t) => t.amount !== 0,
  );
  const allTotals: Money[] = [
    { amount: chargedAmount, currency: totalCurrency },
    ...nonZeroExtraTotals,
  ];
  const hasMultipleCurrencyTotals = nonZeroExtraTotals.length > 0;
  // LIRA-318: the same totals BEFORE the discount — the payment box shows
  // them as "Total Amount" and `allTotals` (net) as "After Discount".
  const grossTotals: Money[] = [
    { amount: totalAmount, currency: totalCurrency },
    ...nonZeroExtraTotals,
  ];
  const discountCapNote =
    discountCapped && maxDiscount != null
      ? `Capped to max (${fmtTotal(maxDiscount)})`
      : undefined;
  const extraCapNote = extraCapped
    ? `Capped to max (${fmtTotal(totalAmount)})`
    : undefined;
  /** The discount field — rendered in the payment box (LIRA-318), or in the
   *  order summary for a partner sale, which has no payment box. */
  const discountField = (
    <div className="flex items-center gap-1">
      <span className="text-emerald-400 text-xs">
        {isLbpTotal ? "LBP" : "$"}
      </span>
      <DecimalInput
        data-testid="checkout-discount-input"
        value={discount}
        onChange={handleDiscountChange}
        className={discountFieldClass(discountCapped)}
        placeholder="0"
      />
    </div>
  );
  /** LIRA-319 — the same field on the Extra side of the line. */
  const extraField = (
    <div className="flex items-center gap-1">
      <span className="text-amber-400 text-xs">{isLbpTotal ? "LBP" : "$"}</span>
      <DecimalInput
        data-testid="checkout-discount-input"
        aria-label="Extra"
        value={extra}
        onChange={handleExtraChange}
        className={discountFieldClass(extraCapped)}
        placeholder="0"
      />
    </div>
  );
  /** Format an amount in an arbitrary currency (used only on the
   *  multi-currency summary branch below — fmtTotal above stays the
   *  single-currency formatter for the byte-identical original case). */
  const fmtMoneyFor = (v: number, curr: string) =>
    curr === "LBP"
      ? `${Math.round(v).toLocaleString()} LBP`
      : `$${v.toFixed(2)}`;
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
  //
  // Owner 2026-10-13: the change box can also put the change NOT handed
  // back on the client's account (`unreturnedChangeTo` below) — that part
  // arrives as one more CUSTOMER_ACCOUNT OUT leg, never as cash, so it is
  // split off here: cash goes on change_given_*, the account leg goes in
  // `payments` (sending a CASH OUT leg too would debit the drawer twice —
  // SalesRepository posts both).
  const cashReturnLines = returnLines.filter((l) => l.method === "CASH");
  const accountReturnLines = returnLines.filter(
    (l) => l.method === "CUSTOMER_ACCOUNT",
  );
  const cashReturnUSD = cashReturnLines
    .filter((l) => l.currencyCode === "USD")
    .reduce((sum, l) => sum + (l.amount || 0), 0);
  const cashReturnLBP = cashReturnLines
    .filter((l) => l.currencyCode === "LBP")
    .reduce((sum, l) => sum + (l.amount || 0), 0);

  // Escape closes only the TOPMOST panel (LIRA-245) — it must never empty
  // the cart, which stays an explicit action (the "Cancel Order" button).
  // The receipt preview renders as a sibling overlay, not a descendant of
  // this modal's own DOM node, so a document-level listener is required to
  // catch Escape while it's open; that submodal is checked FIRST so Escape
  // closes it alone and never falls through to closing the checkout itself
  // in the same keypress. With no submodal open, prefer onClose (a
  // non-destructive "return to cart" close) over onCancel (which clears the
  // cart/deletes the draft) — onCancel is only the fallback for a host that
  // wires no onClose at all.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showReceiptPreview) {
        setShowReceiptPreview(false);
        return;
      }
      const closeHandler = onClose ?? onCancel;
      closeHandler?.();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, onCancel, showReceiptPreview]);

  // Auto-select CUSTOMER_ACCOUNT as MultiPaymentInput's initialMethod once a
  // chargeable client is present. Gated on canCreateDebt so a phone-less
  // client never auto-selects CUSTOMER_ACCOUNT (fails server-side —
  // CUSTOMER_ACCOUNT needs name + phone).
  const paymentMethodCodesKey = paymentMethodOptions
    .map((pm) => pm.code)
    .join(",");
  const initialMethod = useMemo(() => {
    // PFT-2b: never auto-select CUSTOMER_ACCOUNT for a FOR-partner sale — the
    // remainder routes to the partner's ledger, not a client's debt.
    if (forPartner) return undefined;
    if (!selectedClient || !canCreateDebt) return undefined;
    const hasCA = paymentMethodOptions.some(
      (pm) => pm.code === "CUSTOMER_ACCOUNT",
    );
    return hasCA ? "CUSTOMER_ACCOUNT" : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient, canCreateDebt, paymentMethodCodesKey, forPartner]);

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
      // LIRA-319: the extra, in the sale's currency (owner: USD total →
      // extra_usd, LBP total → extra_lbp). Sent only when there is one, so
      // a sale without it is byte-identical to before; never with a
      // discount (switching sides clears the other) nor on a partner sale.
      ...(appliedExtra > 0
        ? isLbpTotal
          ? { extra_lbp: appliedExtra }
          : { extra_usd: appliedExtra }
        : {}),
      // PFT-R: a FOR-partner sale takes NO counter payment at all — the
      // payment/amount section isn't even rendered in that mode (see below),
      // so send zero/empty payment fields explicitly rather than whatever is
      // left over in paymentLines state from before the toggle was flipped.
      // The backend rejects a non-empty `payments` array in partner mode
      // outright, so this must actually be empty, not just zeroed totals.
      payment_usd: forPartner ? 0 : paidUSD,
      payment_lbp: forPartner ? 0 : paidLBP,
      // IN legs plus, at most, the change put on the client's account
      // (CUSTOMER_ACCOUNT OUT). Cash change never travels as a leg — see
      // change_given_* below. Both savers book the account leg as client
      // credit linked to the transaction: SalesRepository.processSale and
      // MaintenanceRepository.processPayments (Maintenance renders this
      // modal too).
      payments: forPartner ? [] : toSnakeLegs(paymentLines, accountReturnLines),
      change_given_usd: forPartner ? 0 : cashReturnUSD,
      change_given_lbp: forPartner ? 0 : cashReturnLBP,
      // T3 keep-change: what the cashier did NOT hand back. A partial keep
      // sends BOTH — the cash returned as change_given_* above and the rest
      // here. The server checks IN − change − kept = total
      // (resolveKeptChange, payer = customer) and stamps only the checked
      // amount onto profit. Never applicable in partner mode (no counter
      // cash to keep).
      ...(keptChange && !forPartner
        ? {
            kept_change_usd: keptChange.usd,
            kept_change_lbp: keptChange.lbp,
          }
        : {}),
      // PFT-R: routes the FULL sale amount to the selected partner's ledger
      // (FOR_POS DEBIT) instead of the client's debt_ledger — mutually
      // exclusive with CUSTOMER_ACCOUNT (see effectivePaymentMethods above).
      ...(forPartner && selectedPartnerId
        ? { partnerId: selectedPartnerId, partnerMode: "FOR" as const }
        : {}),
      exchange_rate: effectiveExchangeRate,
      drawer_name: DRAWER_B, // legacy field (kept for backward compatibility)
      ...(transactionTime ? { transaction_time: transactionTime } : {}),
    };
  };

  const handleComplete = async () => {
    // PFT-2b: a FOR-partner sale never creates a client debt — the remainder
    // routes to the partner's ledger instead — so the two client-debt guards
    // below don't apply to it.
    if (!forPartner) {
      // Block debt creation when DEBT payment method is disabled
      if (
        !isPaymentComplete(totalPaidInTotalCurrency, chargedAmount) &&
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
        !isPaymentComplete(totalPaidInTotalCurrency, chargedAmount) &&
        !canCreateDebt
      ) {
        appEvents.emit(
          "notification:show",
          "To create or leave a debt, please ensure the client has a phone number (existing client) or provide both name and phone (new client).",
          "warning",
        );
        return;
      }
    }

    if (forPartner && !selectedPartnerId) {
      appEvents.emit(
        "notification:show",
        "Select a partner for this sale.",
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
      // LIRA-247: onComplete's real callers (POS/Maintenance) catch and
      // surface their own errors internally and never re-throw, but a
      // thrown ApiError reaching THIS boundary (any other/future host of
      // this shared modal, or a bug in a caller's own catch) used to vanish
      // — nothing was shown here at all.
      appEvents.emit(
        "notification:show",
        getApiErrorMessage(error, "Failed to complete the sale."),
        "error",
      );
    } finally {
      // A refused sale ({success:false}) is handled by the caller, which
      // shows its own toast and returns normally with the modal still open —
      // resetting only in `catch` left the buttons stuck on "Processing...".
      setIsLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    setIsLoading(true);
    try {
      await onSaveDraft(getPaymentData());
    } catch (error) {
      logger.error("Operation failed", { error });
      // LIRA-247: same reasoning as handleComplete's catch above — a thrown
      // ApiError reaching this boundary used to show nothing.
      appEvents.emit(
        "notification:show",
        getApiErrorMessage(error, "Failed to save the draft."),
        "error",
      );
    } finally {
      setIsLoading(false);
    }
  };

  // LIRA-296: the ONE receipt number a sale carries is `RCP-<sale id>`
  // (core's receiptNumberFor). A resumed draft already has its id (it keeps
  // it when completed), so checkout prints the same number a reprint does.
  // A new sale has no id until it is saved, so no number is printed rather
  // than a made-up one that would never match the reprint.
  const receiptNumber = saleId != null ? receiptNumberFor(saleId) : "";

  const getReceiptData = (): ReceiptData => {
    return {
      // No fallback name: a receipt is a document a customer keeps, and
      // printing another shop's name on it is worse than printing none.
      shop_name: shopInfo.name,
      shop_phone: shopInfo.phone || "",
      shop_location: shopInfo.location || "",
      // LIRA-296: the saved header (SF-3) and the warranty terms.
      header_text: shopInfo.headerText ?? "",
      warranty_terms: shopInfo.warrantyTerms ?? "",
      receipt_number: receiptNumber,
      client_name:
        selectedClient?.full_name || clientSearch || "Walk-in Customer",
      client_phone: selectedClient?.phone_number || secondaryInput,
      items: (items || []).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.retail_price,
        subtotal: item.retail_price * item.quantity,
        imei: item.imei || null,
        // LIRA-296 P3 — "IMEI" or "Serial", as the category calls it.
        serial_label: item.imei
          ? serialLabelOf(item.category, item.tracks_imei_units)
          : null,
        // LIRA-143 phase 6a (owner decision #4) — the sale row doesn't
        // exist yet at print-preview time, so there's no stamped
        // warranty_until to read; the formatter computes it from
        // `warranty_months` + this receipt's own timestamp instead.
        warranty_months: item.warranty_months ?? null,
      })),
      subtotal: totalAmount,
      discount: discount,
      // LIRA-319: its own "Extra +$X" line; the total includes it.
      extra: appliedExtra,
      total: chargedAmount,
      payment_usd: tenderUSD,
      payment_lbp: tenderLBP,
      on_account_usd: paidUSD - tenderUSD,
      on_account_lbp: paidLBP - tenderLBP,
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

    await printReceipt({
      text: formatted,
      logo: shopInfo.logo,
      printer: targetPrinter,
    });
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

    await printReceipt({
      text: formatted,
      logo: shopInfo.logo,
      printer: targetPrinter,
    });
  };

  // Production test 2026-10-07: name the drawer(s) the money actually posts
  // to — each line's payment-method drawer, cash change out of General —
  // never the hard-coded legacy DRAWER_B label (see saleDrawerDestinations).
  const drawerDestinations = saleDrawerDestinations(
    paymentLines,
    paymentMethodOptions,
    cashReturnUSD > 0 || cashReturnLBP > 0,
  );

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
    appliedExtra,
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

              {/* PFT-2b: "For Partner" opt-in — routes the unpaid remainder
                  to a partner's ledger instead of a client's debt. Gated on
                  allowForPartner so other hosts of this modal are unaffected. */}
              {allowForPartner && !activeSession && (
                <div className="mb-2">
                  <ForPartnerToggle
                    testId="checkout-for-partner-toggle"
                    checked={forPartner}
                    onChange={setForPartner}
                    selectedPartnerId={selectedPartnerId}
                    onPartnerChange={setSelectedPartnerId}
                    activeClassName="bg-violet-600 text-white"
                  />
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
                          forPartner,
                          selectedPartnerId,
                          extra: appliedExtra,
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
                {/* LIRA-318: the discount lives in the payment box; a
                    partner sale has none, so its field stays here. */}
                {forPartner && (
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Discount</span>
                    <div className="flex items-center gap-2">
                      {discountCapNote && (
                        <span
                          data-testid="discount-cap-note"
                          className="text-[11px] text-red-400"
                        >
                          {discountCapNote}
                        </span>
                      )}
                      {discountField}
                    </div>
                  </div>
                )}
                {appliedExtra > 0 && (
                  <div
                    data-testid="checkout-summary-extra"
                    className="flex justify-between text-amber-400"
                  >
                    <span>Extra</span>
                    <span>+{fmtTotal(appliedExtra)}</span>
                  </div>
                )}
                {hasMultipleCurrencyTotals ? (
                  <div className="border-t border-slate-700 pt-3 space-y-2">
                    {allTotals.map((t) => (
                      <div
                        key={t.currency}
                        className="flex justify-between items-center"
                      >
                        <span className="text-lg font-bold text-white">
                          Net Total ({t.currency})
                        </span>
                        <span className="text-2xl font-bold text-violet-400">
                          {fmtMoneyFor(t.amount, t.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="border-t border-slate-700 pt-3 flex justify-between items-center">
                      <span className="text-lg font-bold text-white">
                        Net Total
                      </span>
                      <span className="text-2xl font-bold text-violet-400">
                        {fmtTotal(chargedAmount)}
                      </span>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      {isLbpTotal
                        ? `≈ $${(chargedAmount / effectiveExchangeRate).toFixed(2)} USD`
                        : `≈ ${(chargedAmount * effectiveExchangeRate).toLocaleString()} LBP`}
                    </div>
                  </>
                )}
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
                        forPartner,
                        selectedPartnerId,
                        extra: appliedExtra,
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
              {/* PFT-R: a FOR-partner sale takes NO counter payment — the
                  entire payment/amount section is hidden (no
                  MultiPaymentInput, no debt-disabled warning). The full
                  amount goes on the partner's tab, settled later on the
                  Partners page. */}
              {forPartner ? (
                <ForPartnerNotice
                  testId="checkout-partner-no-payment-notice"
                  tone="violet"
                >
                  Partner sale: nothing is collected now — the full{" "}
                  <span className="font-bold">{fmtTotal(finalAmount)}</span>{" "}
                  goes on the partner&apos;s account, settled on the Partners
                  page.
                </ForPartnerNotice>
              ) : (
                <>
                  <MultiPaymentInput
                    key={`payment-${paymentInputKey}`}
                    totals={allTotals}
                    currency={totalCurrency}
                    totalAmountCurrency={totalCurrency}
                    {...(draftInitialLines
                      ? { initialLines: draftInitialLines }
                      : {})}
                    onChange={setPaymentLines}
                    onReturnChange={setReturnLines}
                    // The customer pays the shop: kept change is shop
                    // profit (docs/FEATURE_GUIDE.md §4.1).
                    payer="customer"
                    // Kept change is not offered when the job goes into a
                    // session basket: that save ignores it (owner
                    // 2026-10-13) — the session checkout keeps change.
                    {...(allowKeepChange && !addsToSessionBasket
                      ? { onKeptChange: setKeptChange }
                      : {})}
                    requiresClientForDebt={true}
                    hasClient={canCreateDebt}
                    // Sale (charge flow): shortfall → client debt.
                    // canCreateDebt already enforces the name+phone /
                    // existing-client-with-phone rule.
                    autoDebtRemainder={canCreateDebt}
                    paymentMethods={effectivePaymentMethods}
                    currencies={[
                      { code: "USD", symbol: "$" },
                      { code: "LBP", symbol: "LBP" },
                    ]}
                    exchangeRate={exchangeRate}
                    onRateChange={handleRateChange}
                    showDiscount={false}
                    // LIRA-318: the one Discount line, under "Total Amount".
                    // `totals` stay net of it; the payment line follows it.
                    discountRow={
                      <DiscountLine
                        label="Discount"
                        testId="checkout-discount-line"
                        {...(isExtraMode
                          ? extraCapNote
                            ? { capNote: extraCapNote }
                            : {}
                          : discountCapNote
                            ? { capNote: discountCapNote }
                            : {})}
                        // LIRA-319: "− Discount | + Extra" (POS only).
                        {...(canExtra
                          ? {
                              allowExtra: true,
                              mode: lineMode,
                              onModeChange: handleLineModeChange,
                            }
                          : {})}
                      >
                        {isExtraMode ? extraField : discountField}
                      </DiscountLine>
                    }
                    totalBeforeDiscount={grossTotals}
                    smartSplitOverpay={!isLbpTotal}
                    cashOnlyReturn={true}
                    // Owner 2026-10-13: change not handed back goes on the
                    // client's account when one is picked (name + phone);
                    // otherwise it is kept as profit, as before. Never for
                    // a session basket (LIRA-318): its OUT legs are dropped.
                    {...(addsToSessionBasket
                      ? {}
                      : { unreturnedChangeTo: "CUSTOMER_ACCOUNT" as const })}
                    // LIRA-310: Waive adds the gap to this modal's discount,
                    // never past `maxDiscount` (Maintenance: labour); when the
                    // gap is bigger than the room left, Waive is hidden.
                    // LIRA-319: Waive is a discount — never on the Extra side.
                    waiveDisabled={isExtraMode}
                    onWaiveRemaining={(amt) => {
                      setDiscountCapped(false);
                      setDiscount((d) =>
                        Math.min((d ?? 0) + amt, maxDiscount ?? Infinity),
                      );
                    }}
                    {...(maxDiscount != null
                      ? {
                          waiveRemainingMax: Math.max(
                            0,
                            maxDiscount - (discount ?? 0),
                          ),
                        }
                      : {})}
                    label="Payment"
                    {...(initialMethod ? { initialMethod } : {})}
                    clientId={selectedClient?.id ?? null}
                    fetchClientVouchers={fetchClientVouchers}
                  />

                  {!debtPaymentEnabled &&
                    !isPaymentComplete(
                      totalPaidInTotalCurrency,
                      chargedAmount,
                    ) && (
                      <div className="text-xs text-orange-400 bg-orange-500/10 rounded px-3 py-2">
                        Debt is disabled. Full payment required to complete this
                        sale.
                      </div>
                    )}
                </>
              )}
            </div>

            {/* Drawer Info — no drawer moves on a FOR-partner sale (no
                counter cash is taken), so hide this entirely in that mode. */}
            {!forPartner && drawerDestinations.length > 0 && (
              <div
                data-testid="checkout-drawer-destination"
                className="py-3 bg-slate-800/50 border-t border-slate-700 rounded-lg flex items-center gap-2 text-sm px-4 mt-4"
              >
                <Inbox size={16} className="text-blue-400" />
                <span className="text-slate-300">
                  Money goes to:{" "}
                  <span className="font-bold text-blue-300">
                    {drawerDestinations.join(" · ")}
                  </span>
                </span>
              </div>
            )}

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
