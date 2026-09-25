import { useState, useMemo, useEffect } from "react";
import {
  ShoppingCart,
  X,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Printer,
} from "lucide-react";
import logger from "@/utils/logger";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import {
  appEvents,
  canChargeToCustomerAccount,
  MultiPaymentInput,
  useApi,
  type PaymentLine,
} from "@liratek/ui";
import { useSession } from "../context/SessionContext";
import {
  binanceCashSide,
  netCashPayoutAgainstCharge,
  splitBasketCashSides,
} from "../utils/binanceCart";
import { useAuth } from "@/features/auth/context/AuthContext";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { useShopInfo } from "@/hooks/useShopName";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import { printReceipt } from "@/shared/utils/printReceipt";
import {
  buildSessionCheckoutReceiptText,
  type SessionReceiptItem,
  type SessionReceiptLeg,
} from "../utils/sessionReceipt";
import type { CartItem } from "../types/cart";

/** W1.b — snapshot taken BEFORE clearCart()/session-close so the Print
 *  button (rendered AFTER checkout, once activeSession has already gone
 *  null — checkout always closes the session) still has everything the
 *  receipt needs. See sessionReceipt.ts for why this can't reuse
 *  printServiceReceiptByTransaction. */
interface CheckoutSuccessState {
  itemCount: number;
  sessionId: number;
  customerName?: string | undefined;
  customerPhone?: string | undefined;
  items: SessionReceiptItem[];
  legs: SessionReceiptLeg[];
}

interface SessionCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Module label mapping for display */
const MODULE_LABELS: Record<string, string> = {
  pos: "POS Sale",
  recharge_mtc: "MTC Recharge",
  recharge_alfa: "Alfa Recharge",
  omt_app: "OMT App Transfer",
  whish_app: "Whish App Transfer",
  ipick: "iPick",
  katsh: "KATCH",
  binance_send: "Binance Send",
  binance_receive: "Binance Receive",
  omt_system: "OMT System",
  whish_system: "Whish System",
  loto_ticket: "Loto Ticket",
  loto_prize: "Loto Prize",
  custom_service: "Custom Service",
  maintenance: "Maintenance",
};

/**
 * Read a cart item's profit cap (in the item's own currency). The per-item
 * discount cannot exceed this. Returns 0 for items with no profit concept
 * (POS / loto / maintenance / custom_service), which hides the discount input.
 *
 *  - Batch items (FinancialForm / KatchForm): sum of each sub-item's commission.
 *  - Non-batch items (app transfer / recharge / crypto): top-level commission.
 */
function getItemProfitCap(item: CartItem): number {
  const fd = item.formData;

  if (fd._batch && Array.isArray(fd.items)) {
    return (fd.items as Array<Record<string, unknown>>).reduce((sum, sub) => {
      const c = sub.commission;
      return sum + (typeof c === "number" && c > 0 ? c : 0);
    }, 0);
  }

  const c = fd.commission;
  return typeof c === "number" && c > 0 ? c : 0;
}

/**
 * Apply a per-item discount to a cart item's formData (returns a new copy).
 * The discount reduces the recorded profit so the net commission is stamped on
 * the transaction. For batch items the discount is distributed proportionally
 * across sub-items by their commission.
 */
function applyItemDiscount(
  item: CartItem,
  discount: number,
): Record<string, unknown> {
  const fd = { ...item.formData };
  if (discount <= 0) return fd;

  if (fd._batch && Array.isArray(fd.items)) {
    const subs = fd.items as Array<Record<string, unknown>>;
    const totalCommission = subs.reduce((sum, sub) => {
      const c = sub.commission;
      return sum + (typeof c === "number" && c > 0 ? c : 0);
    }, 0);
    if (totalCommission <= 0) return fd;
    fd.items = subs.map((sub) => {
      const c = typeof sub.commission === "number" ? sub.commission : 0;
      const share = Math.round((discount * Math.max(0, c)) / totalCommission);
      return { ...sub, commission: Math.max(0, c - share) };
    });
    return fd;
  }

  const c = typeof fd.commission === "number" ? fd.commission : 0;
  fd.commission = Math.max(0, c - discount);
  return fd;
}

/**
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F — the `kind` discriminator on
 * an OUT leg: `"PAYOUT"` (the shop pays the customer — RECEIVE/loto-prize/
 * Binance cash-out) or `"CHANGE"` (change/return handed back from the pooled
 * payment). Never set on an IN leg. Typed locally: the core-side leg schema
 * (packages/core/src/validators/... — the parallel core lane) grows the
 * matching field; this file does not import from core.
 */
type SessionPaymentLegKind = "PAYOUT" | "CHANGE";

/**
 * One customer-facing payment leg sent to `api.session.checkout`. Named and
 * shared by BOTH the array annotation and the object literals that build it
 * (fix-round finding #1, 2026-09-24) so `legs.push({ ..., payoutOrigin })`
 * type-checks instead of tripping TS2353 against an inferred, narrower type.
 */
interface SessionCheckoutLeg {
  method: string;
  currency_code: string;
  amount: number;
  direction: "IN" | "OUT";
  voucher_code?: string;
  kind?: SessionPaymentLegKind;
  /** Owner decision #11-A — see SessionPaymentService's `payoutOrigin` doc. */
  payoutOrigin?: "SYSTEM" | "GENERAL";
}

/**
 * Payout methods the operator may route a basket's cash-out payout through,
 * in display order. CUSTOMER_ACCOUNT is filtered out by the caller when the
 * session has no chargeable client (see `hasClient` below).
 */
const PAYOUT_METHOD_ORDER = [
  "CASH",
  "OMT",
  "WHISH",
  "BINANCE",
  "CUSTOMER_ACCOUNT",
];

/** Modules where only cashout methods are valid (CASH, CUSTOMER_ACCOUNT, OMT, WHISH, BINANCE) */
const CASHOUT_ONLY_MODULES = new Set(["binance_receive"]);

/** Check if a cart item is a RECEIVE/cashout transaction */
function isCashoutItem(item: CartItem): boolean {
  if (CASHOUT_ONLY_MODULES.has(item.module)) return true;
  // OMT/Whish system or app RECEIVE: amount is negative
  if (
    (item.module === "omt_system" ||
      item.module === "whish_system" ||
      item.module === "omt_app" ||
      item.module === "whish_app") &&
    item.amount < 0
  )
    return true;
  return false;
}

function formatAmount(amount: number, currency: string): string {
  if (currency === "LBP") {
    return `${Math.abs(amount).toLocaleString()} LBP`;
  }
  if (currency === "USDT") {
    return `${Math.abs(amount).toFixed(2)} USDT`;
  }
  return `$${Math.abs(amount).toFixed(2)}`;
}

/**
 * Determine the initial payment method for MultiPaymentInput.
 * Returns "CUSTOMER_ACCOUNT" when a client is in session and the method is available,
 * otherwise "CASH".
 */
function resolveInitialMethod(
  hasClient: boolean,
  methods: Array<{ code: string }>,
): string {
  if (hasClient && methods.some((m) => m.code === "CUSTOMER_ACCOUNT")) {
    return "CUSTOMER_ACCOUNT";
  }
  return "CASH";
}

export function SessionCheckoutModal({
  isOpen,
  onClose,
}: SessionCheckoutModalProps) {
  useModalFocusFix(isOpen);
  const api = useApi();
  const {
    activeSession,
    cartItems,
    clearCart,
    getCartTotals,
    refreshActiveSessions,
  } = useSession();
  const { user } = useAuth();
  const { allMethods } = usePaymentMethods();

  // Payments use the BUY rate (owner decision 2026-07-06): every
  // MultiPaymentInput converts LBP↔USD at buyRate. Seeded from the hook but kept
  // editable: the operator overrides it via the rate field inside
  // MultiPaymentInput (see onRateChange below), and the chosen rate is sent in
  // the checkout payload (and used for the USD↔LBP coverage math below).
  const { buyRate } = useSellRate();
  const [exchangeRate, setExchangeRate] = useState(buyRate);
  // Track whether the operator has manually edited the rate so the seeded value
  // doesn't clobber their override once the async rate resolves.
  const [rateEdited, setRateEdited] = useState(false);
  useEffect(() => {
    if (!rateEdited) setExchangeRate(buyRate);
  }, [buyRate, rateEdited]);

  // Mirror the rate edited inside either MultiPaymentInput up to the parent so
  // both instances stay in sync and the coverage math + payload use it.
  const handleRateChange = (rate: number) => {
    setRateEdited(true);
    setExchangeRate(rate);
  };

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shopInfo = useShopInfo();

  // W1.b — set once checkout succeeds; renders the Print + Close success view
  // INSTEAD OF the cart/payment form. Checkout always closes the session
  // (recordCheckoutClose sets is_active = 0), so `activeSession` goes null
  // almost immediately after — this snapshot is the only thing the Print
  // button can rely on.
  const [checkoutSuccess, setCheckoutSuccess] =
    useState<CheckoutSuccessState | null>(null);

  // Per-item discount (in the item's own currency), capped at each item's
  // profit. Keyed by cart item id. Items with no profit have no input.
  const [itemDiscounts, setItemDiscounts] = useState<Record<string, number>>(
    {},
  );

  // Reset per-item discounts AND the manual rate override whenever the modal
  // (re)opens with a fresh cart. The component stays mounted between checkouts
  // (it early-returns null when closed), so without clearing rateEdited a rate
  // typed in one checkout would stick for the component's lifetime and block the
  // re-seed effect above from picking up the current DB rate on the next one.
  useEffect(() => {
    if (isOpen) {
      setItemDiscounts({});
      setRateEdited(false);
      setKeptChange(null);
      setCheckoutSuccess(null);
      setPayoutMethodOverride({});
    }
  }, [isOpen]);

  // Resolve the session's client id from its phone so the basket GIFT_CARD leg
  // can offer that client's vouchers. The session object only carries the
  // customer name/phone, not a numeric client id.
  const [sessionClientId, setSessionClientId] = useState<number | null>(null);
  const sessionPhone = activeSession?.customer_phone?.trim() ?? "";
  useEffect(() => {
    if (!isOpen || !sessionPhone) {
      setSessionClientId(null);
      return;
    }
    let cancelled = false;
    // Dual-mode (IPC on desktop, REST in the browser) — matches the rest of
    // this component's `api` usage (rule 19).
    api
      .getClients(sessionPhone)
      .then((clients) => {
        if (cancelled) return;
        const match = clients.find(
          (c) => (c.phone_number ?? "").trim() === sessionPhone,
        );
        setSessionClientId(match?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setSessionClientId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionPhone]);

  // ── MultiPaymentInput state ──────────────────────────────────────────────
  // One pooled instance covers both currencies (any line, in either currency,
  // can cover any part of the combined total — matches how the backend already
  // treats payments[] as one flat pool per basket, see FEATURE_GUIDE §11).
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  // Return/change (OUT) legs emitted by MultiPaymentInput
  const [returnLines, setReturnLines] = useState<PaymentLine[]>([]);
  // T3 keep-change: kept change → standalone KEPT_CHANGE profit row.
  const [keptChange, setKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);

  // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F — operator override of the
  // per-currency payout method (undefined = "follow the derived default", see
  // `resolvedPayoutMethodUsd`/`resolvedPayoutMethodLbp` below). Reset whenever
  // the modal (re)opens, same as the other per-checkout state above.
  const [payoutMethodOverride, setPayoutMethodOverride] = useState<{
    USD?: string;
    LBP?: string;
  }>({});

  // Key used to force-remount MultiPaymentInput when client context changes
  const [paymentInputKey, setPaymentInputKey] = useState(0);

  // Whether the session can charge to the customer's account. CUSTOMER_ACCOUNT
  // needs BOTH a name and a phone — for a first-time walk-in the backend creates
  // the client on the fly from name+phone, so a name-only session has no account
  // to charge. Gating here stops the basket from auto-selecting CUSTOMER_ACCOUNT,
  // which otherwise fails server-side with
  // "Client is required for CUSTOMER_ACCOUNT cashout".
  const hasClient = canChargeToCustomerAccount({
    name: activeSession?.customer_name,
    phone: activeSession?.customer_phone,
  });

  // Initial method for MultiPaymentInput — recomputed when methods load or client changes
  const initialMethod = useMemo(
    () => resolveInitialMethod(hasClient, allMethods),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasClient, allMethods.map((m) => m.code).join(",")],
  );

  const totals = useMemo(() => getCartTotals(), [getCartTotals]);

  // Customer NET position per currency (+ pays / − is paid). Every part of
  // this modal — the Total row, the payment seeds, the required total, the
  // payout instruction, and the net OUT leg — must speak this ONE number:
  // a $50 purchase and a $50 cash-out cancel, so nothing is collected and
  // nothing is paid out. The usdt fold covers legacy carts saved while
  // Binance items still carried the old "USDT" bucket tag (their amount is
  // the cash side in USD).
  const netUsd = totals.usd + totals.usdt;
  const netLbp = totals.lbp;

  // GROSS split — charges (customer pays, +) and cash-out payouts (shop pays,
  // −) are tracked SEPARATELY per currency, never cancelled against each other.
  // The Debts page must list both in full: a $10 charge + a $20 cash-out books
  // a $10 debt AND a $20 credit (net −$10), not one collapsed −$10 line. The
  // charges seed the payment / debt; the payouts become the cash payout or the
  // account credit. (binanceCashSide folds a Binance item's USDT tag into its
  // USD cash side.)
  const {
    chargeUsd,
    chargeLbp,
    payoutUsd,
    payoutLbp,
    systemPayoutUsd,
    systemPayoutLbp,
    systemChargeUsd,
    systemChargeLbp,
  } = useMemo(() => splitBasketCashSides(cartItems), [cartItems]);

  // General-drawer-eligible payout (loto prize, wallet/Binance cash-out) —
  // excludes OMT/Whish SYSTEM payouts, which always keep their own box and
  // are never netted below (owner decision #11-A,
  // OWNER_NOTES_REMAINING_BUILD.md, 2026-09-24).
  const generalPayoutUsd = payoutUsd - systemPayoutUsd;
  const generalPayoutLbp = payoutLbp - systemPayoutLbp;

  // General-drawer-eligible NETTING BASE (fix-round finding #3, 2026-09-24):
  // excludes any OMT/Whish SYSTEM charge (a SEND item, or a SYSTEM RECEIVE's
  // fee-on-top) from what a General payout may net against. OMT_System /
  // Whish_System and General are physically different cash boxes — netting
  // a loto prize or a wallet/Binance cash-out against a SYSTEM charge would
  // silently move money between them (e.g. an OMT SEND $100 + a $20 phone
  // case paid from a Binance cash-out must book OMT_System +$100, General
  // -$20 exactly like a SYSTEM payout would, never a blended $80/$0 split).
  const generalChargeUsd = chargeUsd - systemChargeUsd;
  const generalChargeLbp = chargeLbp - systemChargeLbp;

  // Does the operator settle this basket on the customer's account BY
  // DEFAULT? Then the cash-out payouts (shop owes the customer, e.g. a
  // Binance/OMT/Whish cash-out) are booked as store CREDIT on their account —
  // reducing their balance and showing on the Debts Payments side — rather
  // than handed over as cash. Requires a chargeable client (name + phone). A
  // cash-paid or clientless basket keeps the cash payout (lira-098). This is
  // now only the DEFAULT the per-currency payout-method select below seeds —
  // the operator can override it to any method (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md
  // §4 Phase F), so an untouched basket behaves exactly as before.
  const payoutOnAccount =
    hasClient && paymentLines.some((l) => l.method === "CUSTOMER_ACCOUNT");
  const defaultPayoutMethod = payoutOnAccount ? "CUSTOMER_ACCOUNT" : "CASH";

  // Effective per-currency payout method: the operator's override if they
  // touched the select, else the pre-existing derived default above.
  // `payoutMethodChoices` (the select's options — needs `paymentMethodOptions`,
  // defined further below) computes the actual list.
  const resolvedPayoutMethodUsd =
    payoutMethodOverride.USD ?? defaultPayoutMethod;
  const resolvedPayoutMethodLbp =
    payoutMethodOverride.LBP ?? defaultPayoutMethod;

  // Remount MultiPaymentInput whenever initialMethod OR the resolved payout
  // method changes, so the pre-seeded first line always tracks the current
  // net charge. Fix-round finding #8 (2026-09-24): `paymentInitialLines`
  // below is only re-derived when `paymentInputKey` bumps, but `netChargeUsd`/
  // `netChargeLbp` also depend on the payout method (switching a General
  // payout off CASH, e.g. to WHISH wallet, un-nets the charge back to gross)
  // — without this, the seeded lines silently go stale after such a switch.
  // Deliberately NOT keyed on `netChargeUsd`/`netChargeLbp` themselves: those
  // also change on every live cart edit (a discount, a rate override), which
  // would wipe the operator's in-progress payment lines on every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPaymentInputKey((k) => k + 1);
  }, [initialMethod, resolvedPayoutMethodUsd, resolvedPayoutMethodLbp]);

  // Owner decision #11-A: only a CASH-routed General payout nets against the
  // charge — one settled to the customer's account or a wallet stays gross
  // ("Non-cash payouts ... stay gross"). The OMT/Whish SYSTEM portion is
  // excluded regardless of the chosen method — see generalPayoutUsd/Lbp above.
  const cashNetEligibleUsd =
    resolvedPayoutMethodUsd === "CASH" ? generalPayoutUsd : 0;
  const cashNetEligibleLbp =
    resolvedPayoutMethodLbp === "CASH" ? generalPayoutLbp : 0;

  // Net the eligible General-drawer cash payout against the charge (owner
  // decision #11-A): change is computed on the NET, and only the physical
  // difference is recorded — the 390,000 LBP drawer gap a GROSS payout leg
  // used to create. `excessPayoutUsd/Lbp` is what's left when the payout is
  // BIGGER than the charge — that portion still has to leave the drawer as
  // a real leg (see the `allPaymentLegs` construction below).
  // Net against the GENERAL-bound share of the charge only (fix-round finding
  // #3) — never the raw gross `chargeUsd`/`chargeLbp`, which would include a
  // SYSTEM charge from a different physical box. `netGeneralChargeUsd/Lbp`
  // below is therefore the General drawer's OWN remaining charge after
  // netting; the SYSTEM charge (if any) is added back on top, gross and
  // untouched, when building the combined MultiPaymentInput total.
  const {
    netChargeUsd: netGeneralChargeUsd,
    netChargeLbp: netGeneralChargeLbp,
    excessPayoutUsd,
    excessPayoutLbp,
  } = useMemo(
    () =>
      netCashPayoutAgainstCharge({
        chargeUsd: generalChargeUsd,
        chargeLbp: generalChargeLbp,
        cashPayoutUsd: cashNetEligibleUsd,
        cashPayoutLbp: cashNetEligibleLbp,
        rate: exchangeRate,
      }),
    [
      generalChargeUsd,
      generalChargeLbp,
      cashNetEligibleUsd,
      cashNetEligibleLbp,
      exchangeRate,
    ],
  );

  // Combined NET charge MultiPaymentInput must cover: the SYSTEM charge
  // (always gross — a different physical box, fix-round finding #3) plus the
  // General charge after netting against any General-drawer cash payout.
  const netChargeUsd = systemChargeUsd + netGeneralChargeUsd;
  const netChargeLbp = systemChargeLbp + netGeneralChargeLbp;

  // Group items by module for display
  const groupedItems = useMemo(() => {
    const groups = new Map<string, CartItem[]>();
    for (const item of cartItems) {
      const existing = groups.get(item.module) || [];
      existing.push(item);
      groups.set(item.module, existing);
    }
    return groups;
  }, [cartItems]);

  // Currency configs for MultiPaymentInput
  const currencies = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  // Payment methods typed as required by MultiPaymentInput. GIFT_CARD is offered
  // at the basket level — the customer can redeem a voucher against the whole
  // basket (its code + value flow through the GIFT_CARD payment leg).
  const paymentMethodOptions = allMethods.map((m) => ({
    code: m.code,
    label: m.label,
  }));

  // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F — method choices offered by
  // the per-currency payout select — CASH / OMT Wallet / Whish Wallet /
  // Binance always; Customer Account only when the session has a chargeable
  // client (matches the debt-leg gating everywhere else in this modal).
  // Labels come from the DB-backed payment methods list so a
  // relabeled/deactivated method stays in sync automatically.
  const payoutMethodChoices = useMemo(() => {
    const byCode = new Map(paymentMethodOptions.map((m) => [m.code, m]));
    return PAYOUT_METHOD_ORDER.filter(
      (code) => code !== "CUSTOMER_ACCOUNT" || hasClient,
    )
      .map((code) => byCode.get(code))
      .filter((m): m is { code: string; label: string } => !!m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethodOptions.map((m) => m.code).join(","), hasClient]);

  // Combined total the pooled MultiPaymentInput must cover — the NET charge
  // (owner decision #11-A: the General-drawer CASH payout is netted in
  // above; an OMT/Whish SYSTEM payout or a non-cash payout never reduces
  // this — see netChargeUsd/Lbp). LBP is converted to USD via the operator
  // rate.
  const combinedTotalUSD = useMemo(() => {
    return netChargeUsd + (exchangeRate > 0 ? netChargeLbp / exchangeRate : 0);
  }, [netChargeUsd, netChargeLbp, exchangeRate]);

  // Seed one line per currency that still has a NET charge due — this opens
  // MultiPaymentInput directly in split mode with both rows pre-filled instead
  // of showing two separate widget instances (initialLines is read once, on
  // mount/remount, per the component's own contract).
  const paymentInitialLines = useMemo(() => {
    const lines: Array<{ currencyCode: string; amount: number }> = [];
    if (netChargeUsd > 0)
      lines.push({ currencyCode: "USD", amount: netChargeUsd });
    if (netChargeLbp > 0)
      lines.push({ currencyCode: "LBP", amount: netChargeLbp });
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentInputKey]);

  // Derive combined payment legs from the pooled MultiPaymentInput. IN legs are
  // what the customer paid; OUT legs are change handed back OR the basket's
  // payout — `direction` is carried through so the checkout handler can
  // record the change (e.g. paid $100, returned 180,000 LBP) rather than just
  // the net, and `kind` (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F)
  // distinguishes the two OUT flavors for anything downstream that needs to
  // tell them apart (receipt printing, refund tooling). GIFT_CARD legs carry
  // their voucher_code so the basket recorder can redeem the voucher.
  const allPaymentLegs: SessionCheckoutLeg[] = useMemo(() => {
    const toLeg =
      (direction: "IN" | "OUT", kind?: SessionPaymentLegKind) =>
      (l: PaymentLine): SessionCheckoutLeg => ({
        method: l.method,
        currency_code: l.currencyCode,
        amount: l.amount,
        direction,
        ...(kind ? { kind } : {}),
        ...(l.method === "GIFT_CARD" && l.voucherCode
          ? { voucher_code: l.voucherCode }
          : {}),
      });
    // Annotated explicitly (rather than inferred from the two `.map()` spreads
    // above) — a bare `const legs = [...]` infers its element type from ONLY
    // those two arrays, which lack `payoutOrigin`; the `legs.push({...
    // payoutOrigin: "SYSTEM" })` calls below would then fail TypeScript's
    // excess-property check on an object literal argument (TS2353). Fix-round
    // finding #1 (2026-09-24) — this was a real compile break, never exercised
    // because only the core `tsc` was run at the time.
    const legs: SessionCheckoutLeg[] = [
      ...paymentLines.map(toLeg("IN")),
      // Change/return from the pooled payment — never a payout.
      ...returnLines.map(toLeg("OUT", "CHANGE")),
    ];
    // Cash-out payouts (loto cash prize, OMT/Whish RECEIVE, Binance cash out):
    // the shop owes the customer. Route to the operator-chosen method per
    // currency (`resolvedPayoutMethodUsd`/`resolvedPayoutMethodLbp` —
    // defaults to CUSTOMER_ACCOUNT when the basket is settled on account,
    // else CASH, lira-098; Phase F lets the operator pick any drawer-
    // affecting method too). Deferred cash-out items self-post nothing, so
    // these legs are the only place the payout is booked — recordBasketPayment
    // turns a CUSTOMER_ACCOUNT OUT leg into a session credit (Debts Payments
    // side).
    //
    // Owner decision #11-A (2026-09-24) splits this into TWO legs per
    // currency instead of one combined gross leg:
    //  - SYSTEM (OMT/Whish money-transfer box): ALWAYS its own GROSS leg,
    //    never netted — "keep the two boxes SEPARATE". `payoutOrigin:
    //    "SYSTEM"` forces the recorder to route it 100% to the primary cash
    //    drawer, bypassing the session's blended item-value-share ratio
    //    (which would otherwise mis-split it once the General portion below
    //    no longer equals the FULL gross payout total).
    //  - GENERAL (loto prize / wallet / Binance cash-out): gross when routed
    //    non-cash ("Non-cash payouts ... stay gross"), otherwise only the
    //    EXCESS left after netting against the charge above — the rest never
    //    physically left the drawer, so no leg is sent for it at all.
    //    `payoutOrigin: "GENERAL"` forces the recorder to route it 100% to
    //    General.
    if (systemPayoutUsd > 0) {
      legs.push({
        method: resolvedPayoutMethodUsd,
        currency_code: "USD",
        amount: systemPayoutUsd,
        direction: "OUT",
        kind: "PAYOUT",
        payoutOrigin: "SYSTEM",
      });
    }
    if (systemPayoutLbp > 0) {
      legs.push({
        method: resolvedPayoutMethodLbp,
        currency_code: "LBP",
        amount: systemPayoutLbp,
        direction: "OUT",
        kind: "PAYOUT",
        payoutOrigin: "SYSTEM",
      });
    }
    const generalPayoutLegUsd =
      resolvedPayoutMethodUsd === "CASH" ? excessPayoutUsd : generalPayoutUsd;
    const generalPayoutLegLbp =
      resolvedPayoutMethodLbp === "CASH" ? excessPayoutLbp : generalPayoutLbp;
    if (generalPayoutLegUsd > 0) {
      legs.push({
        method: resolvedPayoutMethodUsd,
        currency_code: "USD",
        amount: generalPayoutLegUsd,
        direction: "OUT",
        kind: "PAYOUT",
        payoutOrigin: "GENERAL",
      });
    }
    if (generalPayoutLegLbp > 0) {
      legs.push({
        method: resolvedPayoutMethodLbp,
        currency_code: "LBP",
        amount: generalPayoutLegLbp,
        direction: "OUT",
        kind: "PAYOUT",
        payoutOrigin: "GENERAL",
      });
    }
    return legs;
  }, [
    paymentLines,
    returnLines,
    systemPayoutUsd,
    systemPayoutLbp,
    generalPayoutUsd,
    generalPayoutLbp,
    excessPayoutUsd,
    excessPayoutLbp,
    resolvedPayoutMethodUsd,
    resolvedPayoutMethodLbp,
  ]);

  // Primary method is the first non-zero leg's method, or CASH as fallback
  const primaryMethod =
    allPaymentLegs.find((l) => l.amount > 0)?.method ?? "CASH";

  // A CUSTOMER_ACCOUNT (charge-to-account) leg — whether auto-selected or chosen
  // manually — requires a chargeable client (name + phone). Block checkout
  // otherwise so it fails fast in the UI instead of server-side mid-transaction
  // with "Client is required for CUSTOMER_ACCOUNT cashout".
  const usesCustomerAccount = allPaymentLegs.some(
    (l) => l.method === "CUSTOMER_ACCOUNT",
  );
  const customerAccountBlocked = usesCustomerAccount && !hasClient;

  // Validate the combined (USD-equivalent) total is covered. Any line, in
  // either currency, counts toward the whole pool — see combinedTotalUSD above.
  const usdPaymentTolerance = 0.01;
  const lbpPaymentTolerance = 100;
  const combinedTolerance =
    usdPaymentTolerance + lbpPaymentTolerance / (exchangeRate || 1);

  const paidUSD = useMemo(
    () =>
      paymentLines.reduce((sum, l) => {
        if (l.currencyCode === "USD") return sum + (l.amount || 0);
        if (l.currencyCode === "LBP")
          return sum + (exchangeRate > 0 ? (l.amount || 0) / exchangeRate : 0);
        return sum;
      }, 0),
    [paymentLines, exchangeRate],
  );

  // Payment is valid once the total is COVERED. Overpayment is allowed — the
  // operator hands back the difference as change (the Return/Change row), so we
  // must not require an exact match (that disabled Confirm whenever the customer
  // paid more than the total, e.g. $100 paid on a $98 total with $2 change).
  //
  // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F: a system RECEIVE's
  // fee-on-top (§1.5) flows into this check FOR FREE — it's added into
  // chargeUsd/chargeLbp by splitBasketCashSides (binanceCart.ts), which
  // combinedTotalUSD is derived from a few lines up, so no separate gate is
  // needed here. Deliberately NOT adding a "payout must be covered" gate: the
  // shop's primary cash drawer is allowed to go negative on a payout by
  // design (FEATURE_GUIDE §7) — there is no balance check anywhere for this
  // (PRIMARY_CASH_DRAWER_PLAN open item 6e, still open on purpose).
  const isPaymentValid =
    combinedTotalUSD <= 0 || paidUSD >= combinedTotalUSD - combinedTolerance;

  if (!isOpen) return null;
  // Checkout closes the session (is_active = 0), so activeSession goes null
  // right after a successful checkout — keep rendering the success view.
  if (!activeSession && !checkoutSuccess) return null;

  const handleCheckout = async () => {
    if (!activeSession) {
      setError("No active session");
      return;
    }

    if (!user) {
      setError("No authenticated user");
      return;
    }

    if (cartItems.length === 0) {
      setError("Cart is empty");
      return;
    }

    if (!isPaymentValid) {
      setError("Payment total does not match cart total");
      return;
    }

    if (customerAccountBlocked) {
      setError(
        "Customer Account requires both a customer name and phone number. Add a phone to this session or pick another payment method.",
      );
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Build cart items: apply the per-item discount (reduces recorded profit)
      // and, for cashout items, stamp the OPERATOR-CHOSEN payout method for
      // that item's own currency — never the basket's charge-collection
      // primaryMethod, which answers a different question (how the customer
      // paid IN, not how the shop pays OUT). Payment is collected once at the
      // basket level — the item formData carries no payment method of its
      // own otherwise.
      const updatedCartItems = cartItems.map((item) => {
        const discount = itemDiscounts[item.id] ?? 0;
        const updatedFormData = applyItemDiscount(item, discount);

        // For RECEIVE/cashout items, stamp the resolved payout method for
        // THIS item's currency (financial.ts's cashoutMethod enum — CASH /
        // CUSTOMER_ACCOUNT / OMT / WHISH / BINANCE — is shared across every
        // provider this repository handles, including app wallets/Binance).
        // A Binance item's cart `currency` is the mechanical "USDT" tag, not
        // USD/LBP — but its cash side is folded into the USD payout bucket
        // (`binanceCashSide`), so it correctly falls through to the USD
        // method below.
        if (isCashoutItem(item)) {
          updatedFormData.cashoutMethod =
            item.currency === "LBP"
              ? resolvedPayoutMethodLbp
              : resolvedPayoutMethodUsd;
        }

        return {
          id: item.id,
          module: item.module,
          label: item.label,
          amount: item.amount,
          currency: item.currency,
          formData: updatedFormData,
          ipcChannel: item.ipcChannel,
        };
      });

      const result = await api.session.checkout({
        sessionId: activeSession.id,
        cartItems: updatedCartItems,
        paidByMethod: primaryMethod,
        payments: allPaymentLegs,
        exchangeRate,
        // T3 keep-change: standalone profit-only row, not linked to any item.
        ...(keptChange && (keptChange.usd > 0 || keptChange.lbp > 0)
          ? {
              kept_change_usd: keptChange.usd,
              kept_change_lbp: keptChange.lbp,
            }
          : {}),
        userId: user.id,
      });

      if (result.success) {
        logger.info(`Session checkout completed: ${result.itemCount} items`);
        // W1.b — snapshot everything the receipt needs BEFORE clearCart()
        // wipes cartItems and the session closes (activeSession -> null).
        const itemCount = result.itemCount ?? cartItems.length;
        const receiptSnapshot: CheckoutSuccessState = {
          itemCount,
          sessionId: activeSession.id,
          customerName: activeSession.customer_name,
          customerPhone: activeSession.customer_phone,
          items: cartItems.map((item) => ({
            label: item.label,
            amount: item.amount,
            currency: item.currency,
            // POST-discount effective fee, in the item's own currency — what
            // was actually charged. getItemProfitCap returns 0 for item types
            // with no profit concept, which the receipt hides via its own
            // `> 0` check.
            fee: getItemProfitCap({
              ...item,
              formData: applyItemDiscount(item, itemDiscounts[item.id] ?? 0),
            }),
          })),
          legs: allPaymentLegs.map((l) => ({
            method: l.method,
            currency_code: l.currency_code,
            amount: l.amount,
            direction: l.direction,
            ...(l.kind ? { kind: l.kind } : {}),
          })),
        };
        clearCart();
        await refreshActiveSessions();
        appEvents.emit(
          "notification:show",
          `Checkout complete — ${result.itemCount} items processed`,
          "success",
        );
        // LIRA-212 Tier A: a checkout can book a 'Session Debt' row on the
        // client's account — let TopBar's session balance badge refresh live.
        appEvents.emit("debt:changed");
        // No auto-print (ticket: sessions skip the auto-dialog) — show the
        // Print + Close success view instead of closing immediately.
        setCheckoutSuccess(receiptSnapshot);
      } else {
        setError(result.error || "Checkout failed");
        logger.error(`Session checkout failed: ${result.error}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      setError(msg);
      logger.error(`Session checkout error: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  /** W1.b explicit Print button (no auto-print for sessions). Builds the
   *  receipt purely from the checkout snapshot — see sessionReceipt.ts for
   *  why this can't go through printServiceReceiptByTransaction. */
  const handlePrintReceipt = async () => {
    if (!checkoutSuccess) return;
    let printer = "";
    try {
      const settings = await api.getAllSettings();
      printer =
        (settings?.find(
          (s: { key_name: string; value: string }) =>
            s.key_name === "receipt_printer",
        )?.value as string) || "";
    } catch {
      // no configured printer — printReceipt falls back to a print window
    }
    const text = buildSessionCheckoutReceiptText({
      shop: shopInfo,
      sessionId: checkoutSuccess.sessionId,
      customerName: checkoutSuccess.customerName,
      customerPhone: checkoutSuccess.customerPhone,
      items: checkoutSuccess.items,
      legs: checkoutSuccess.legs,
    });
    await printReceipt({
      text,
      printer,
      ...(shopInfo.logo ? { logo: shopInfo.logo } : {}),
    });
  };

  const handleSuccessClose = () => {
    setCheckoutSuccess(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={checkoutSuccess ? handleSuccessClose : onClose}
      />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {checkoutSuccess ? (
          <>
            {/* Success header (W1.b) — activeSession is already null here
                (checkout closes the session), so everything renders from the
                snapshot captured right before clearCart(). */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-emerald-600/20 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Checkout Complete
                  </h2>
                  <p className="text-xs text-slate-400">
                    {checkoutSuccess.customerName || "Walk-in"} —{" "}
                    {checkoutSuccess.itemCount} item
                    {checkoutSuccess.itemCount !== 1 ? "s" : ""} processed
                  </p>
                </div>
              </div>
              <button
                onClick={handleSuccessClose}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Success body */}
            <div className="flex-1 overflow-y-auto px-5 py-10 flex flex-col items-center justify-center gap-3 text-center">
              <CheckCircle className="w-12 h-12 text-emerald-400" />
              <p className="text-sm text-slate-300">
                Payment recorded. Print a receipt for the customer, or close.
              </p>
            </div>

            {/* Success footer — explicit Print button only, no auto-print
                (the ticket: sessions skip the auto-dialog). */}
            <div className="px-5 py-4 border-t border-slate-700/50 flex gap-3">
              <button
                onClick={handlePrintReceipt}
                className="flex-1 py-2.5 rounded-lg font-medium text-sm text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Print Receipt
              </button>
              <button
                onClick={handleSuccessClose}
                className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          activeSession && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-emerald-600/20 rounded-lg flex items-center justify-center">
                    <ShoppingCart className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Session Checkout
                    </h2>
                    <p className="text-xs text-slate-400">
                      {activeSession.customer_name || "Walk-in"} —{" "}
                      {cartItems.length} item{cartItems.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  disabled={isProcessing}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body — scrollable */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Cart Items with Per-Item Payment Method */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-slate-300">
                    Cart Items
                  </h3>
                  {Array.from(groupedItems.entries()).map(([module, items]) => (
                    <div
                      key={module}
                      className="bg-slate-800/50 border border-slate-700/40 rounded-lg p-3"
                    >
                      <div className="text-xs font-medium text-slate-400 mb-2">
                        {MODULE_LABELS[module] || module}
                      </div>
                      <div className="space-y-2">
                        {items.map((item) => {
                          const profitCap = getItemProfitCap(item);
                          const discount = itemDiscounts[item.id] ?? 0;
                          return (
                            <div key={item.id} className="space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm text-slate-200 truncate flex-1 min-w-0">
                                  {item.label}
                                </span>
                                {/* Amount — customer perspective only. Binance
                              items show their CASH side in USD (the USDT is
                              the service, named in the label; the wallet
                              movement is shop bookkeeping). */}
                                <span
                                  className={`text-sm font-mono whitespace-nowrap min-w-[5rem] text-right shrink-0 ${
                                    item.amount < 0
                                      ? "text-red-400"
                                      : "text-emerald-400"
                                  }`}
                                >
                                  {item.amount < 0 ? "-" : "+"}
                                  {binanceCashSide(item)
                                    ? `$${Math.abs(item.amount).toFixed(2)}`
                                    : formatAmount(item.amount, item.currency)}
                                </span>
                              </div>

                              {/* Per-item discount — capped at the item's profit.
                            Hidden for items with no profit concept. */}
                              {profitCap > 0 && (
                                <div className="flex items-center justify-end gap-2 pl-1">
                                  <label className="text-[11px] text-slate-400 whitespace-nowrap">
                                    Discount (max{" "}
                                    {formatAmount(profitCap, item.currency)})
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    max={profitCap}
                                    step={item.currency === "LBP" ? 1000 : 0.01}
                                    value={discount || ""}
                                    onChange={(e) => {
                                      const raw =
                                        parseFloat(e.target.value) || 0;
                                      const clamped = Math.min(
                                        Math.max(0, raw),
                                        profitCap,
                                      );
                                      setItemDiscounts((prev) => ({
                                        ...prev,
                                        [item.id]: clamped,
                                      }));
                                    }}
                                    className="w-28 bg-slate-900 border border-slate-600 rounded-md px-2 py-1 text-xs text-white font-mono text-right focus:outline-none focus:border-orange-500"
                                    placeholder="0"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Basket total — combined USD/LBP breakdown, shown once before the
              payment section since the pooled MultiPaymentInput below only
              displays its running total in USD-equivalent. */}
                {(netUsd !== 0 || netLbp !== 0) && (
                  <div className="bg-slate-800/50 border border-slate-700/40 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-300">
                      Total
                    </span>
                    <span className="flex items-center gap-3 font-mono text-sm">
                      {netUsd !== 0 && (
                        <span
                          className={
                            netUsd < 0 ? "text-red-400" : "text-emerald-400"
                          }
                        >
                          {netUsd < 0 ? "-" : ""}
                          {formatAmount(netUsd, "USD")}
                        </span>
                      )}
                      {netLbp !== 0 && (
                        <span
                          className={
                            netLbp < 0 ? "text-red-400" : "text-emerald-400"
                          }
                        >
                          {netLbp < 0 ? "-" : ""}
                          {formatAmount(netLbp, "LBP")}
                        </span>
                      )}
                    </span>
                  </div>
                )}

                {/* MultiPaymentInput — one pooled section covering both currencies.
              Pre-seeded with one row per positive currency total, opening
              directly in split mode instead of two separate widgets.
              Gated on the NET charge (owner decision #11-A, 2026-09-24):
              netChargeUsd/Lbp already excludes any OMT/Whish SYSTEM payout
              (that box never reduces this — BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md
              §2 bug 2's exact scenario, a same-currency SYSTEM payout hiding
              the charge collection, still can't happen), so only a
              General-drawer CASH payout can bring this to 0 — correctly, by
              design: when it fully covers the charge there is nothing left
              to collect. */}
                {(netChargeUsd > 0 || netChargeLbp > 0) && (
                  <div className="space-y-1">
                    <MultiPaymentInput
                      key={`payment-${paymentInputKey}`}
                      // Per-currency totals (multi-currency engine): the NET
                      // charge (owner decision #11-A) keeps its native
                      // composition, so an LBP-only basket's prefill is
                      // rate-invariant — editing the modal rate no longer
                      // re-derives it through a USD scalar (the T2 bug,
                      // docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md MCP-4).
                      totals={[
                        ...(netChargeUsd > 0
                          ? [{ amount: netChargeUsd, currency: "USD" }]
                          : []),
                        ...(netChargeLbp > 0
                          ? [{ amount: netChargeLbp, currency: "LBP" }]
                          : []),
                      ]}
                      // Session payments convert at the BUY side (owner decision
                      // 2026-07-06), stated explicitly.
                      side="buy"
                      currency="USD"
                      totalAmountCurrency="USD"
                      initialLines={paymentInitialLines}
                      onChange={setPaymentLines}
                      onReturnChange={setReturnLines}
                      onKeptChange={setKeptChange}
                      requiresClientForDebt={true}
                      hasClient={hasClient}
                      paymentMethods={paymentMethodOptions}
                      currencies={currencies}
                      exchangeRate={exchangeRate}
                      onRateChange={handleRateChange}
                      showDiscount={false}
                      label="Payment"
                      initialMethod={initialMethod}
                      clientId={sessionClientId}
                      fetchClientVouchers={fetchClientVouchers}
                      // Owner decision #11-A: suggest whole USD notes + an
                      // LBP remainder for change (the dual-currency drawer
                      // convention) instead of one lump-sum USD figure, so
                      // the owner's "40$ + 10,000 LBP" example seeds itself.
                      smartSplitOverpay
                    />
                  </div>
                )}

                {/* Payout to customer (loto prize / RECEIVE / Binance cash out) —
              the GROSS cash-out per currency, shown here for full visibility
              regardless of what actually still needs a separate leg, with an
              operator-chosen METHOD per currency (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md
              §4 Phase F): CASH / OMT Wallet / Whish Wallet / Binance / Customer
              Account. Defaults to the pre-existing derivation (CUSTOMER_ACCOUNT
              when the basket's charge is already on account, else CASH —
              lira-098), so an untouched basket behaves exactly as before.
              Binance cash-outs live in the usdt bucket (their payout is
              self-posted at replay) but still route through this same
              selectable payout leg.
              Owner decision #11-A (2026-09-24): a CASH-routed payout that is
              NOT an OMT/Whish SYSTEM item (loto prize / wallet / Binance) is
              netted against the charge above (see the "Payment" total) —
              only the physical excess, if any, still posts as its own leg.
              An OMT/Whish SYSTEM payout, or any non-cash payout, always
              posts here in full, unaffected by that netting. */}
                {(payoutUsd > 0 || payoutLbp > 0) && (
                  <div className="bg-slate-800/50 border border-slate-700/40 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-medium text-slate-300">
                      Payout to customer
                    </div>
                    {(cashNetEligibleUsd > 0 || cashNetEligibleLbp > 0) && (
                      <p className="text-[11px] text-slate-400">
                        The General-drawer portion nets against the payment
                        below — only the physical difference is collected or
                        handed back as change.
                      </p>
                    )}
                    {payoutUsd > 0 && (
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-slate-400 shrink-0">USD</span>
                        <span
                          className={`font-mono ${
                            resolvedPayoutMethodUsd === "CUSTOMER_ACCOUNT"
                              ? "text-emerald-400"
                              : "text-amber-400"
                          }`}
                        >
                          {formatAmount(-payoutUsd, "USD")}
                        </span>
                        <select
                          data-testid="payout-method-select-USD"
                          value={resolvedPayoutMethodUsd}
                          onChange={(e) =>
                            setPayoutMethodOverride((prev) => ({
                              ...prev,
                              USD: e.target.value,
                            }))
                          }
                          className="bg-slate-900 border border-slate-600 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:border-orange-500"
                        >
                          {payoutMethodChoices.map((m) => (
                            <option key={m.code} value={m.code}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {payoutLbp > 0 && (
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-slate-400 shrink-0">LBP</span>
                        <span
                          className={`font-mono ${
                            resolvedPayoutMethodLbp === "CUSTOMER_ACCOUNT"
                              ? "text-emerald-400"
                              : "text-amber-400"
                          }`}
                        >
                          {formatAmount(-payoutLbp, "LBP")}
                        </span>
                        <select
                          data-testid="payout-method-select-LBP"
                          value={resolvedPayoutMethodLbp}
                          onChange={(e) =>
                            setPayoutMethodOverride((prev) => ({
                              ...prev,
                              LBP: e.target.value,
                            }))
                          }
                          className="bg-slate-900 border border-slate-600 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:border-orange-500"
                        >
                          {payoutMethodChoices.map((m) => (
                            <option key={m.code} value={m.code}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* Error Display */}
                {error && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-300">{error}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-slate-700/50 flex gap-3">
                <button
                  onClick={onClose}
                  disabled={isProcessing}
                  className="flex-1 py-2.5 rounded-lg font-medium text-sm text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCheckout}
                  disabled={
                    isProcessing ||
                    cartItems.length === 0 ||
                    !isPaymentValid ||
                    customerAccountBlocked
                  }
                  className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white bg-emerald-600 hover:bg-emerald-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Confirm Checkout
                    </>
                  )}
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
