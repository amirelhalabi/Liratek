import {
  PROVIDER_BRANDS,
  type ProviderBrandKey,
} from "@/shared/brand/providerBrands";
import { ProviderLogo } from "@/shared/components/ProviderLogo";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import {
  MultiPaymentInput,
  type Money,
  type MultiPaymentInputProps,
  type MultiPaymentPayer,
  type PaymentLine,
  type VoucherOption,
} from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";

interface PaymentMethod {
  code: string;
  label: string;
}

interface SummaryLine {
  label: string;
  value: string;
  color?: string;
}

/** One picked item shown at the top of the payment window (card grids). */
export interface PaymentSheetItem {
  key: string;
  name: string;
  /** Subcategory, or category when there is none. */
  group?: string | undefined;
  /** Card artwork URL; a placeholder shows when absent. */
  image?: string | undefined;
  quantity: number;
  /** Price of one unit, as charged (e.g. the Only Days price). */
  unitPrice: number;
  currency: string;
  /** Short extra detail, e.g. "Only days". */
  note?: string | undefined;
  /** The provider it comes from — a cart can mix providers (iPick + Katsh). */
  provider?: ProviderBrandKey | undefined;
}

/** Items grouped by provider, in first-seen order, with a subtotal per
 *  currency (a group can hold LBP items and a USD bill). Items with no
 *  provider form one group without a header. */
function groupItemsByProvider(items: PaymentSheetItem[]) {
  const groups: Array<{
    provider: ProviderBrandKey | undefined;
    items: PaymentSheetItem[];
    subtotals: Array<{ currency: string; amount: number }>;
  }> = [];
  for (const it of items) {
    let g = groups.find((x) => x.provider === it.provider);
    if (!g) {
      g = { provider: it.provider, items: [], subtotals: [] };
      groups.push(g);
    }
    g.items.push(it);
    const sub = g.subtotals.find((t) => t.currency === it.currency);
    const line = it.unitPrice * it.quantity;
    if (sub) sub.amount += line;
    else g.subtotals.push({ currency: it.currency, amount: line });
  }
  return groups;
}

export interface PaymentSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
  /** Title shown in the sheet header */
  title?: string;
  /** Subtitle / description */
  subtitle?: string;
  /** Accent color for the confirm button */
  accentColor?: string;
  /** Custom confirm button text */
  confirmLabel?: string;
  /** Summary lines to display at the top */
  /** Items picked on a card grid, listed above the summary. */
  items?: PaymentSheetItem[];
  summary?: SummaryLine[];
  /** MultiPaymentInput props */
  totalAmount: number;
  /**
   * LIRA-326 — what is owed PER CURRENCY, when the sheet covers items in more
   * than one (a Mobile Recharge basket with LBP and USD lines). Forwarded to
   * MultiPaymentInput's `totals`; legs reconcile against each currency. When
   * absent, the sheet owes `[{ totalAmount, totalAmountCurrency }]`.
   */
  totals?: Array<{ amount: number; currency: string }>;
  totalAmountCurrency?: string;
  currency?: string;
  paymentMethods: PaymentMethod[];
  exchangeRate?: number;
  /** Fires with the rate MultiPaymentInput is ACTUALLY using for its
   *  conversions — the default (`exchangeRate` prop) on mount, or the
   *  operator's own edit of the sheet's "1 USD = X LBP" header field
   *  whenever they type one. Payment-Legs Integrity plan (false-reject
   *  fix): callers should capture this and send it as `tender_exchange_rate`
   *  on submit, instead of re-sending the static `exchangeRate` prop (which
   *  is wrong the moment the operator edits the field). */
  onExchangeRateChange?: (rate: number) => void;
  showDiscount?: boolean;
  maxDiscount?: number;
  showPmFee?: boolean;
  pmFeeRate?: number;
  requiresClientForDebt?: boolean;
  hasClient?: boolean;
  /** Opt-in auto CUSTOMER_ACCOUNT remainder on underpayment — pass the
   *  flow's validated charge predicate; never enable on payout/RECEIVE
   *  flows (see MultiPaymentInputProps.autoDebtRemainder). */
  autoDebtRemainder?: boolean;
  onPaymentChange: (lines: PaymentLine[]) => void;
  onReturnChange?: (returnLegs: PaymentLine[]) => void;
  /** T3 kept-change pass-through — only wire on flows whose backend
   *  accepts kept_change_* on the same payload. Wired, handing back less
   *  change than due keeps the rest as profit automatically (owner decision
   *  2026-10-06 — no "Keep change" button); unwired, an under-return stays
   *  the red "not covered" warning. */
  onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
  /** LIRA-334 payout round-up pass-through (MultiPaymentInput's
   *  `onRoundUpChange`) — only on a payout sheet whose backend accepts
   *  `rounding_given_*` on the same payload. */
  onRoundUpChange?: (roundUp: { usd: number; lbp: number } | null) => void;
  /** Pass-through to MultiPaymentInput's `direction`: "payout" when the
   *  lines are cash the shop hands OUT (Exchange) — keep-change then keeps
   *  a small SHORTFALL instead of an overpay. Default "payment". */
  direction?: "payment" | "payout";
  /** Pass-through to MultiPaymentInput's `payer` (who pays on this sheet:
   *  "customer" | "payout" | "shop" — see MultiPaymentPayer). Wins over
   *  `direction` when both are passed. */
  payer?: MultiPaymentPayer;
  /** Pass-through to MultiPaymentInput's `unreturnedChangeTo`: change the
   *  cashier does not hand back goes to the customer's account (one more
   *  OUT CUSTOMER_ACCOUNT leg, via `onReturnChange`). Active only with
   *  `hasClient` on a customer-pays sheet — pass it only where the save
   *  resolves a real client and books that leg as credit. Never on a
   *  payout / RECEIVE / buy-back sheet. */
  unreturnedChangeTo?: MultiPaymentInputProps["unreturnedChangeTo"];
  onDiscountChange?: (discount: number) => void;
  /** LIRA-319 — pass-through to MultiPaymentInput's extra mode: the
   *  "− Discount | + Extra" switch on the built-in line. Wire only on a
   *  customer-pays SALE whose save sends `extra_*` (never a payout, a
   *  buy-back, or an item going into a session basket). */
  onExtraChange?: MultiPaymentInputProps["onExtraChange"];
  /** LIRA-319 — pass-through cap on the extra (default: the sheet's total). */
  maxExtra?: MultiPaymentInputProps["maxExtra"];
  /** LIRA-310 — pass-through to MultiPaymentInput's Waive. Leave unset on
   *  the recharge forms: with `showDiscount` + `maxDiscount` +
   *  `onDiscountChange` they get the built-in waive into their own discount.
   *  `amount` is rounded to the total's currency; the second argument is the
   *  per-currency remainder. */
  onWaiveRemaining?: (amount: number, remainingByCurrency: Money[]) => void;
  /** Largest gap (in the total's currency) Waive may cover. Default is the
   *  shared $5 / 450,000 LBP limit. */
  waiveRemainingThreshold?: number;
  /** Room left in the page's own discount; Waive is hidden when the gap is
   *  larger. Only used with `onWaiveRemaining`. */
  waiveRemainingMax?: number;
  onPmFeesChange?: (fees: Record<string, number>) => void;
  /** Increment this to remount MultiPaymentInput (e.g. when client is selected) */
  paymentInputKey?: number;
  /** Initial payment method when MultiPaymentInput mounts */
  initialPaymentMethod?: string;
  /** Selected client (voucher owner) + fetcher — enables GIFT_CARD voucher payment. */
  clientId?: number | null;
  fetchClientVouchers?: (clientId: number) => Promise<VoucherOption[]>;
  /** Optional extra content between summary and payment input */
  children?: React.ReactNode;
  /**
   * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase D — pure pass-through to
   * MultiPaymentInput's own `counterFlow` prop (owned by packages/ui, not
   * this file). Renders a second, independent set of payment lines for
   * money moving the OPPOSITE direction from the main lines above (e.g. a
   * RECEIVE cashout's main lines are the shop's payout while the
   * counter-flow lines collect a fee the customer pays back). Default
   * (prop absent): renders exactly as today — zero impact on existing
   * consumers of this sheet.
   */
  // Derived from MultiPaymentInput's own prop so the two cannot drift
  // (LIRA-321 adds seedLines / lockCurrency / maxForgive / onStateChange).
  counterFlow?: NonNullable<MultiPaymentInputProps["counterFlow"]>;
  /** LIRA-321: disables Confirm (with `isSubmitting`). Pages set it from the
   *  "Customer pays" section's onStateChange; the server stays authoritative. */
  confirmDisabled?: boolean;
}

export function PaymentSheet({
  open,
  onClose,
  onConfirm,
  isSubmitting = false,
  title,
  subtitle,
  accentColor = "bg-violet-600 hover:bg-violet-500",
  confirmLabel,
  summary = [],
  items = [],
  totalAmount,
  totals,
  totalAmountCurrency = "USD",
  currency = "USD",
  paymentMethods,
  exchangeRate,
  onExchangeRateChange,
  showDiscount = true,
  maxDiscount,
  showPmFee = false,
  pmFeeRate,
  requiresClientForDebt = true,
  hasClient = false,
  autoDebtRemainder = false,
  onPaymentChange,
  onReturnChange,
  onKeptChange,
  onRoundUpChange,
  direction,
  payer,
  unreturnedChangeTo,
  onDiscountChange,
  onExtraChange,
  maxExtra,
  onWaiveRemaining,
  waiveRemainingThreshold,
  waiveRemainingMax,
  onPmFeesChange,
  paymentInputKey,
  initialPaymentMethod,
  clientId,
  fetchClientVouchers,
  children,
  counterFlow,
  confirmDisabled = false,
}: PaymentSheetProps) {
  const { t } = useTranslation("rechargeFinancial");
  useModalFocusFix(open);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [latestLines, setLatestLines] = useState<PaymentLine[]>([]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      // Trigger animation on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!mounted) return null;

  const fmtMoney = (amount: number, currency: string) =>
    currency === "LBP"
      ? `${formatNumber(Math.round(amount))} LBP`
      : `$${amount.toFixed(2)}`;

  // Single payment line → display the user's chosen currency/amount.
  // Multi-line (split) → fall back to the transaction total.
  const singleLine = latestLines.length === 1 ? latestLines[0] : null;
  const displayAmount = singleLine ? singleLine.amount : totalAmount;
  const displayCurrency = singleLine
    ? singleLine.currencyCode
    : totalAmountCurrency;

  // Several currencies owed and no single tender line: name each one.
  const owedLabel =
    !singleLine && totals && totals.length > 1
      ? totals.map((tot) => fmtMoney(tot.amount, tot.currency)).join(" + ")
      : fmtMoney(displayAmount, displayCurrency);
  const defaultConfirmLabel =
    confirmLabel || t("sheet.pay", { amount: owedLabel });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/70 transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Sheet Panel */}
      <div
        className={`relative w-full max-w-lg bg-slate-900 border-s border-slate-700 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          visible ? "translate-x-0" : "translate-x-full rtl:-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
          <div>
            <h2 className="text-base font-bold text-white">
              {title ?? t("sheet.confirmPayment")}
            </h2>
            {subtitle && (
              <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("sheet.close")}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-5 py-4 gap-4 [&>*:not([data-shrinkable])]:shrink-0">
          {/* Picked items */}
          {items.length > 0 && (
            <div
              data-testid="payment-sheet-items"
              data-shrinkable
              // The ONE body section that may shrink: it gives up height so
              // Summary / Payment Method below always stay in view, and its
              // rows scroll inside it. Never below ~2 rows (min-h-36).
              className="min-h-36 flex flex-col rounded-xl bg-slate-800/60 border border-slate-700/40 p-4 gap-3"
            >
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {t("sheet.items", {
                  n: items.reduce((n, it) => n + it.quantity, 0),
                })}
              </h3>
              <div
                data-testid="payment-sheet-items-scroll"
                className="min-h-0 overflow-y-auto -me-2 pe-2 space-y-3"
              >
                {groupItemsByProvider(items).map((grp) => (
                  <div
                    key={grp.provider ?? "none"}
                    data-testid="payment-sheet-item-group"
                    className="space-y-2"
                  >
                    {grp.provider && (
                      <div className="flex items-center gap-2">
                        <ProviderLogo brand={grp.provider} size={16} />
                        <span className="flex-1 text-xs font-semibold text-slate-200">
                          {PROVIDER_BRANDS[grp.provider].name}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          {grp.subtotals
                            .map((tot) => fmtMoney(tot.amount, tot.currency))
                            .join(" + ")}
                        </span>
                      </div>
                    )}
                    <ul className={`space-y-2.5 ${grp.provider ? "ps-6" : ""}`}>
                      {grp.items.map((it) => {
                        const detail = [it.group, it.note]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <li key={it.key} className="flex items-center gap-3">
                            {it.image ? (
                              <img
                                src={it.image}
                                alt={it.name}
                                draggable={false}
                                className="w-14 aspect-[8/5] shrink-0 rounded object-cover"
                              />
                            ) : (
                              <div
                                aria-hidden="true"
                                className="w-14 aspect-[8/5] shrink-0 rounded bg-slate-700/60 flex items-center justify-center text-[10px] font-bold text-slate-400"
                              >
                                {it.name.slice(0, 3).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-white truncate">
                                {it.name}
                              </div>
                              {detail && (
                                <div className="text-[11px] text-slate-400 truncate">
                                  {detail}
                                </div>
                              )}
                            </div>
                            <div className="shrink-0 text-end">
                              {it.quantity > 1 && (
                                <div className="text-[11px] text-slate-400 font-mono">
                                  {`${it.quantity} × ${fmtMoney(it.unitPrice, it.currency)}`}
                                </div>
                              )}
                              <div className="text-sm font-mono font-semibold text-white">
                                {fmtMoney(
                                  it.unitPrice * it.quantity,
                                  it.currency,
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          {summary.length > 0 && (
            <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-4 space-y-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {t("sheet.summary")}
              </h3>
              {summary.map((line, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-slate-300">{line.label}</span>
                  <span
                    className={`font-mono font-semibold ${line.color || "text-white"}`}
                  >
                    {line.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Extra content */}
          {children}

          {/* Payment Method */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {t("sheet.paymentMethod")}
            </h3>
            <MultiPaymentInput
              key={paymentInputKey}
              totals={
                totals ?? [
                  { amount: totalAmount, currency: totalAmountCurrency },
                ]
              }
              totalAmountCurrency={totalAmountCurrency}
              currency={currency}
              onChange={(lines) => {
                setLatestLines(lines);
                onPaymentChange(lines);
              }}
              {...(onKeptChange ? { onKeptChange } : {})}
              {...(onRoundUpChange ? { onRoundUpChange } : {})}
              {...(direction ? { direction } : {})}
              {...(payer ? { payer } : {})}
              {...(unreturnedChangeTo ? { unreturnedChangeTo } : {})}
              requiresClientForDebt={requiresClientForDebt}
              hasClient={hasClient}
              autoDebtRemainder={autoDebtRemainder}
              {...(initialPaymentMethod !== undefined
                ? { initialMethod: initialPaymentMethod }
                : {})}
              showPmFee={showPmFee}
              {...(pmFeeRate !== undefined ? { pmFeeRate } : {})}
              {...(onPmFeesChange ? { onPmFeesChange } : {})}
              showDiscount={showDiscount}
              {...(maxDiscount !== undefined ? { maxDiscount } : {})}
              {...(onDiscountChange ? { onDiscountChange } : {})}
              {...(onExtraChange ? { onExtraChange } : {})}
              {...(maxExtra !== undefined ? { maxExtra } : {})}
              {...(onWaiveRemaining ? { onWaiveRemaining } : {})}
              {...(waiveRemainingThreshold !== undefined
                ? { waiveRemainingThreshold }
                : {})}
              {...(waiveRemainingMax !== undefined
                ? { waiveRemainingMax }
                : {})}
              paymentMethods={paymentMethods}
              currencies={[
                { code: "USD", symbol: "$" },
                { code: "LBP", symbol: "LBP" },
              ]}
              {...(exchangeRate !== undefined ? { exchangeRate } : {})}
              {...(onExchangeRateChange ? { onExchangeRateChange } : {})}
              {...(clientId != null ? { clientId } : {})}
              {...(fetchClientVouchers ? { fetchClientVouchers } : {})}
              {...(onReturnChange ? { onReturnChange } : {})}
              {...(counterFlow ? { counterFlow } : {})}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-700/50 bg-slate-800/50">
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={isSubmitting || confirmDisabled}
            className={`w-full py-3.5 rounded-xl font-bold text-base transition-all ${
              isSubmitting || confirmDisabled
                ? // Not bg-slate-600 + text-slate-400: index.css paints that
                  // pair the same colour in dark mode, so the label vanished.
                  "bg-slate-700 text-slate-300 cursor-not-allowed"
                : `${accentColor} shadow-lg`
            }`}
          >
            {isSubmitting ? t("sheet.processing") : defaultConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
