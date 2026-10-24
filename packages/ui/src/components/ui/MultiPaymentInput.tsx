import { useState, useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { formatNumber } from "../../i18n/format";
import { normalizeDigits } from "../../i18n/digits";
import { Ltr } from "./Ltr";
import { DecimalInput } from "./DecimalInput";
import { DiscountLine, discountFieldClass } from "./DiscountLine";
import { SplitToggle } from "./SplitToggle";
import { useLinesSection, type LinesSectionState } from "./useLinesSection";
import { matchToleranceFor, suggestRoundUpExtra } from "./roundUpExtra";
import { formatWithCommas } from "../../utils/number";
import { roundLBPUp } from "../../config/denominations";
import {
  allocatePayments,
  convert as convertMoney,
  roundForCurrency,
  type Money,
  type RateSide,
  type RateTable,
} from "../../money";
import {
  TENDER_RATE_BAND_PCT,
  tenderRateDeviationPct,
  isWithinShortfallMax,
} from "@liratek/core";

/**
 * Past this deviation, the warning switches to stronger "check for a typo"
 * wording (LIRA-240, owner example: ">50%"). UI-only wording tier — never
 * gates anything server-side, so it stays local to this component rather
 * than living in the shared core constant (which IS reused, rule 14: this
 * threshold and `TENDER_RATE_BAND_PCT` are used exactly once each, here).
 */
const TENDER_RATE_TYPO_PCT = 0.5;

export type PaymentLine = {
  id: string;
  method: string;
  currencyCode: string;
  amount: number;
  /** Set when method === 'GIFT_CARD' — the voucher code being redeemed. */
  voucherCode?: string;
  /** IN (customer pays the shop, default) or OUT (shop returns change). */
  direction?: "IN" | "OUT";
};

/** A redeemable voucher belonging to the selected client. */
export interface VoucherOption {
  code: string;
  /** Face value in USD (deposited to the account on redemption). */
  amount: number;
  expiryDate?: string | null;
}

export interface PaymentMethod {
  code: string;
  label: string;
}

export interface Currency {
  code: string;
  symbol: string;
}

export type TransactionType =
  | "SEND"
  | "RECEIVE"
  | "SERVICE_PAYMENT"
  | "DEBT_PAYMENT"
  | "CUSTOM_SERVICE";

/**
 * Who pays whom on this sheet — the ONE declaration that decides how kept
 * change works (owner decisions 2026-10-07; docs/FEATURE_GUIDE.md "Kept
 * change"). The server half is `resolveKeptChange` in
 * packages/core/src/repositories/keptChange.ts, which takes the same three
 * kinds.
 *
 * - "customer" (default): the customer pays the shop (POS, recharge sale,
 *   OMT SEND, debts, …). An overpay shows the change fields; change handed
 *   back emits OUT legs; change NOT handed back is shop profit.
 * - "payout": the shop hands money to a customer (OMT/Whish RECEIVE,
 *   Binance cash-out, credit buy-back, Debts credit cash-out, Exchange). No
 *   change fields and never an OUT leg; a small shortfall (under
 *   `PAYOUT_KEEP_CHANGE_MAX`, total's currency) is shop profit.
 * - "shop": the shop pays an outsider (Expenses). An overpay shows the
 *   change fields; the change the outsider hands BACK is emitted as OUT
 *   legs (opposite direction to the main lines — cash coming INTO the
 *   drawer); change NOT handed back is ADDED TO THE COST, never profit.
 */
export type MultiPaymentPayer = "customer" | "payout" | "shop";

export interface MultiPaymentInputProps {
  currency: string;
  /** The currency the summary/aggregate surfaces (total row, return-field
   *  seeding, tolerances) are expressed in. Defaults to "USD".
   *  e.g. Whish/iPick/KATCH pass "LBP", POS sale passes "USD". */
  totalAmountCurrency?: string;
  /** Per-currency totals — the multi-currency engine contract
   *  (docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md). Each entry is what is owed
   *  in that currency NATIVELY; a rate is only ever consulted when a payment
   *  crosses currencies, so e.g. an LBP debt paid in LBP is rate-invariant.
   *  Defaults to [] (nothing owed). */
  totals?: Money[];
  /** LIRA-322 (OMT Settle Account, owner 2026-10-15) — OPT-IN. Each line
   *  counts ONLY toward its own currency's entry in `totals`; currencies are
   *  never converted or netted against each other (OMT settles each currency
   *  on its own). The existing summary rows show each currency in its own
   *  currency, joined " · ": "Total Amount $497.00 · 900,000 LBP", "Paid
   *  $300.00 · 900,000 LBP", and "Remaining to pay" lists only the short
   *  currencies ("$197.00"). Overpay is per currency (paid − total, never
   *  offset by another currency's shortfall); the existing change box shows
   *  the SUM of every overpaid currency converted to the box's display, and
   *  seeds each return field with its own currency's extra. A new line fills
   *  to its own currency's remaining only. Discount/Waive are not supported
   *  in this mode (callers pass `showDiscount={false}` / `waiveDisabled`).
   *  Off/absent: unchanged behaviour. */
  perCurrencyTotals?: boolean;
  /** Rate table for cross-currency math. Defaults to a USD-based table whose
   *  LBP pair tracks the header rate field (which also overrides the LBP pair
   *  of a provided table — the operator sets today's counter rate). */
  rateTable?: RateTable;
  /** Quote side used for EVERY conversion (business decision per flow, e.g.
   *  debt repayments use "buy"). Default "buy". */
  side?: RateSide;
  onChange: (payments: PaymentLine[]) => void;
  /** Emitted when the customer overpays — array of shop→customer change legs
   *  (direction "OUT"), empty when balanced/underpaid.
   *  Consumers append these to the `payments` array sent to the backend. */
  onReturnChange?: (returnLegs: PaymentLine[]) => void;
  /** T3 "keep change" (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md). Kept
   *  change is AUTOMATIC (owner decision 2026-10-06 — the "Keep change"
   *  button is gone): when the CASH change handed back (the two return
   *  fields → onReturnChange's OUT legs) is LESS than the change due, this
   *  fires with the per-currency amount the shop KEEPS ({usd, lbp}); null
   *  when the return matches (or exceeds) the change due, or nothing is
   *  overpaid. The caller sends the kept amounts as `kept_change_*` on the
   *  SAME payload so the server books them as profit.
   *
   *  OPT-IN by wiring: pass it ONLY when the consumer's backend accepts
   *  kept change. Without it an under-return stays the red "not covered"
   *  warning (the server's leg reconciliation would reject it anyway). */
  onKeptChange?: (
    kept: {
      usd: number;
      lbp: number;
      /** Unrounded excess `allocatePayments` actually computed (rate
       *  0.056179775280899236, not the $0.06 `usd` above rounds to). A
       *  consumer that does further cross-currency ARITHMETIC with the
       *  kept amount — e.g. debt-reduction netting — MUST use this, not
       *  the currency-rounded `usd`/`lbp` display figures: rounding kept
       *  change to USD cents before converting the LBP remainder at the
       *  day's rate manufactures a several-hundred-LBP residual (owner
       *  note #8, 2026-09-23). A consumer that only DISPLAYS or forwards
       *  the kept amount to the backend as a profit stamp should keep
       *  using `usd`/`lbp` — that rounding is correct there. */
      exactUsd: number;
      exactLbp: number;
    } | null,
  ) => void;
  requiresClientForDebt?: boolean;
  hasClient?: boolean;
  onExchangeRateChange?: (rate: number) => void;
  showPmFee?: boolean;
  pmFeeRate?: number;
  onPmFeesChange?: (fees: Record<string, number>) => void;
  /** Provider fee (e.g. OMT INTRA $1) charged on top of the send amount.
   *  Shown in the summary so the grand total = totalPaid + providerFee + totalPmFees. */
  providerFee?: number;
  /** Pre-seed the payment lines (e.g. one line per currency for a
   *  mixed-currency debt position). Read ONCE on mount; more than one line
   *  opens the form in split mode. This is the supported way to prefill —
   *  parent-held line state is never displayed by this component. */
  initialLines?: Array<{
    method?: string;
    currencyCode: string;
    amount: number;
  }>;
  /** LIRA-308 (owner decisions 2026-10-11) — what the amount FILLS to,
   *  per currency, when it differs from what is owed (`totals`). The Debts
   *  repayment sheet passes the ticked items' sum here while `totals` stays
   *  the whole debt, so an amount between the two is a normal (bigger)
   *  payment and only an amount above `totals` is an overpay. Taken as-is
   *  (the caller nets any discount of its own). Default: `totals`. */
  fillTotals?: Money[];
  /** LIRA-308 decision 2 — changing this value re-fills the amount to
   *  `fillTotals`, even after the operator typed an amount (a tick change
   *  always resets the amount). Owner answer 3 (2026-10-11): the operator's
   *  payment lines are KEPT — only the total changes, and the LAST line
   *  absorbs the difference; a last line that would drop to zero or below
   *  is removed and the one before it absorbs the rest (never below zero);
   *  with no line left, one line (the first line's method and currency)
   *  is created. Ignored on mount. */
  fillKey?: string | number;
  /** The change-return method selected when an overpay first appears
   *  (default "CASH"). LIRA-308 decision 6: the Debts repayment sheet
   *  passes "CUSTOMER_ACCOUNT" so an amount above the whole debt becomes
   *  account credit unless the cashier picks cash change. */
  defaultReturnMethod?: string;
  /** LIRA-308 decision 9 — when every payment line is in ONE currency, a
   *  non-cash change (e.g. account credit) is expressed in that currency
   *  instead of `totalAmountCurrency`: an LBP overpay on an LBP debt
   *  becomes LBP credit, not a converted USD figure. Re-applied whenever the
   *  lines' currencies change; the cashier can still pick another. */
  returnCurrencyFollowsTender?: boolean;
  /** LIRA-308 owner answer 1 (2026-10-11): "if the customer pays 85, and we
   *  didn't set $1 in the returned amount, then $1 is account credit". When
   *  set, the CASH return fields start EMPTY (the cashier types what is
   *  actually handed back) and whatever change is NOT entered there becomes
   *  one more change leg with this method (in the tender's currency under
   *  `returnCurrencyFollowsTender`). Nothing is kept as profit
   *  (`onKeptChange` never reports a keep), and an under-return is not a
   *  mismatch. Customer payer only; requires `hasClient`.
   *
   *  LIRA-313 (owner decisions 2026-10-12) — the return fields now start
   *  FULL ("Return change" is the default); a "Return change" / "To
   *  account" toggle in the change box clears or refills them, and
   *  whatever is not entered still goes to the account. The second value
   *  serves counterparty pages (Suppliers, Partners):
   *  - "CUSTOMER_ACCOUNT": the unreturned change is emitted as one more
   *    OUT leg with that method — the server books it as client credit.
   *  - "ACCOUNT_BALANCE": NO leg is emitted — the server books the net
   *    (paid − change handed back), so change not handed back simply stays
   *    on the counterparty's balance. Works for the customer AND shop
   *    payer, and needs no `hasClient`. */
  unreturnedChangeTo?: "CUSTOMER_ACCOUNT" | "ACCOUNT_BALANCE";
  /** LIRA-313 — whose account the unreturned change lands on, for the
   *  change-box copy (e.g. "the supplier's account"). Default "the
   *  customer's account". */
  accountLabel?: string;
  /** LIRA-313 — limit the CASH return fields to these currencies (e.g. a
   *  partner settlement whose legs must all be in the settlement currency).
   *  Default: both USD and LBP. */
  returnCurrencies?: string[];
  /** LIRA-313 (owner decision 2026-10-12) — payout mode only: paying out
   *  MORE than the total is not a mistake but becomes the other side's
   *  debt (Debts → Cash Out above the credit). The Paid figure is not
   *  flagged red, and a note says how much the other side will owe. */
  payoutExcessToAccount?: boolean;
  /** LIRA-334 — payout only, OPT-IN by wiring: paying out a little MORE
   *  than the total (up to and including the shared core cap,
   *  `isWithinShortfallMax` — $5 / 450,000 LBP, in the total's currency) is
   *  accepted as a round-up the shop books as a change-rounding expense.
   *  The Paid figure is not flagged red, an emerald note says so, and this
   *  fires with the round-up `{usd, lbp}` (rounded: USD cents, LBP whole
   *  pounds, in the total's currency only) — null whenever there is none,
   *  including when the payer is not payout. The caller sends it as
   *  `rounding_given_*` on the SAME payload as the legs. Ignored when
   *  `payoutExcessToAccount` is set (the excess is the other side's debt). */
  onRoundUpChange?: (roundUp: { usd: number; lbp: number } | null) => void;
  /** LIRA-336 — payout only, with `counterFlow.allowAddedChange`: the change
   *  the customer adds on top of what they owe (owner example: $197 owed,
   *  the customer gives $3, the shop hands out $200), converted into the
   *  total's currency and rounded (USD cents, LBP whole pounds), reported in
   *  that currency only. It already raised the payout target, so round-up
   *  and kept change are measured above it. null whenever there is none:
   *  not a payout, the optional section closed, nothing added, or over the
   *  $5 / 450,000 LBP cap (`isWithinShortfallMax`, in the total's currency
   *  — the section then shows as overpaid). The caller sends it as
   *  `added_change_*` on the SAME payload as the legs. */
  onAddedChange?: (added: { usd: number; lbp: number } | null) => void;
  /** Payment methods to display in dropdown */
  paymentMethods: PaymentMethod[];
  /** Available currencies */
  currencies: Currency[];
  /** Current exchange rate (1 USD = X LBP). Defaults to 89000 if not provided */
  exchangeRate?: number;
  /** Callback when exchange rate changes */
  onRateChange?: (rate: number) => void;
  /** Show an optional discount field that reduces the amount the customer pays.
   *  Discount is subtracted from the totals before payment matching.
   *  On a payout (`payer="payout"`, LIRA-269) the discount is the shop giving
   *  up part of its fee, so the customer receives MORE — by an amount only the
   *  caller's fee model knows. There the field only REPORTS the discount
   *  (`onDiscountChange`) and never touches the totals: the caller folds it
   *  into the total it passes. With no `onDiscountChange` a payout hides the
   *  field, since a discount nobody books would only move the target. */
  showDiscount?: boolean;
  /** Maximum allowed discount (in totalAmountCurrency). Cannot exceed cost. */
  maxDiscount?: number;
  /** Callback when discount changes. Receives discount normalized to totalAmountCurrency. */
  onDiscountChange?: (discount: number) => void;
  /** LIRA-319 (owner 2026-10-13) — enables extra mode on the built-in
   *  Discount line: a "− Discount | + Extra" switch (or, with
   *  `showDiscount={false}`, an extra-only line). In extra mode the amount
   *  ADDS to what is owed, the row below reads "After Extra" and the payment
   *  line follows the new total. Reports the extra normalized to
   *  `totalAmountCurrency` (0 in discount mode; the discount reports 0 in
   *  extra mode — a payment has one or the other). Never on a payout, and
   *  not with `discountRow` (those pages own their line). */
  onExtraChange?: (extra: number) => void;
  /** LIRA-319 — cap on the extra, in totalAmountCurrency. Default: the
   *  total before the extra. */
  maxExtra?: number;
  /** LIRA-318 (owner 2026-10-13) — a page that keeps its OWN discount
   *  (POS / Maintenance checkout, Debts and Partners settle) renders its
   *  line here, built with `DiscountLine`, so every page shows one
   *  Discount / Forgive line in the same place: under "Total Amount". The
   *  page still owns the value, the cap and the payload, and passes `totals`
   *  already net of it. Use with `showDiscount={false}`. */
  discountRow?: ReactNode;
  /** With `discountRow`: the total BEFORE the page's discount, per currency.
   *  "Total Amount" shows it, and an "After …" row shows `totals` when they
   *  differ. */
  totalBeforeDiscount?: Money[];
  /** Label of the after-discount row. Default "After Discount". */
  afterDiscountLabel?: string;
  /** LIRA-318 — false: a discount never moves the payment line (owner
   *  decision for Debts and Partners: typing a forgive amount must not change
   *  what the cashier entered as paid). The line auto-fills to the total
   *  BEFORE the discount (`totalBeforeDiscount`), and `fillTotals`, when
   *  given, must be gross too. Default true (the line follows the total). */
  discountMovesPayment?: boolean;
  /** LIRA-318 — label for what is still owed after this payment, e.g.
   *  "Client will owe". Replaces "Remaining (Debt)" and also shows at 0
   *  (not when overpaid — the change box covers that). Customer payer only. */
  owedLabel?: string;
  /** Custom label for the header (defaults to "Payment") */
  label?: string;
  /** Label of the summary's total-of-lines figure (defaults to "Paid").
   *  A refund passes "Hand back" — there the lines are money the shop
   *  returns, not money the customer paid. */
  paidLabel?: string;
  /** Initial payment method for the first line (used on mount/remount). */
  initialMethod?: string;
  /** Selected client (voucher owner). Required to offer GIFT_CARD vouchers. */
  clientId?: number | null;
  /** Fetch the client's redeemable vouchers. When provided, GIFT_CARD lines show
   *  a dropdown of that client's vouchers (auto-selected when only one exists)
   *  instead of a manual code field. The selected voucher's value is deposited to
   *  the account on redemption; the leg amount stays the charged portion. */
  fetchClientVouchers?: (clientId: number) => Promise<VoucherOption[]>;
  /** LIRA-310 — the Waive button. It lives in the Remaining row, so it only
   *  ever shows when Remaining does (owner: "Waive follows Remaining"), never
   *  on a payout, and only for a shortfall up to and including the
   *  threshold. When provided, clicking calls back with the shortfall
   *  ROUNDED to totalAmountCurrency's precision, plus the per-currency
   *  remainder (for pages whose discount is kept per currency, e.g. Debts) —
   *  this component has no opinion on what "waiving" means upstream (a
   *  discount, a lower bill, a waived amount sent to the server). When NOT
   *  provided, the built-in Waive adds the gap to this component's own
   *  discount — only when that discount is shown, lowers the total, is
   *  booked by the page (`onDiscountChange`) and stays within `maxDiscount`. */
  onWaiveRemaining?: (amount: number, remainingByCurrency: Money[]) => void;
  /** Largest shortfall Waive closes, in totalAmountCurrency, inclusive.
   *  Default: the shared cap `SHORTFALL_MAX` ($5 / 450,000 LBP); a total in
   *  any other currency gets no Waive. */
  waiveRemainingThreshold?: number;
  /** Room left in the page's own discount (totalAmountCurrency) for the
   *  external Waive: hidden when the shortfall would not fit, so a waive can
   *  never push a discount past its ceiling (owner decision 3). */
  waiveRemainingMax?: number;
  /** Never show Waive on this sheet, built-in or external (owner decision
   *  2026-10-12: no Waive anywhere on the Suppliers page — the owner types
   *  a discount by hand instead). The Discount field itself is unaffected. */
  waiveDisabled?: boolean;
  /** Owner decision 2026-10-12 (LIRA-310 follow-up) — what Waive measures
   *  its gap against, per currency, when that is NOT the whole amount owed.
   *  The Debts repayment sheet passes the TICKED items' sum net of its own
   *  discount (the same figure as its `fillTotals`), so Waive only ever
   *  forgives the ticked items. The gap is shown on its own "Remaining on
   *  ticked" line with Waive inside it; the Remaining row keeps the
   *  whole-debt figure without a Waive. When the two gaps are the same
   *  (everything ticked) there is one row, with Waive, as before. Same cap,
   *  never on a payout, honours `waiveDisabled`. Taken as-is (the caller
   *  nets any discount of its own). Default: the effective totals. */
  waiveTotals?: Money[];
  /** When true and totalAmountCurrency is "USD", auto-seed the CASH return
   *  fields as integer USD notes + LBP remainder (the dual-currency
   *  cash-drawer convention) instead of a single lump sum in one currency.
   *  Default false — existing single-currency behavior, unaffected for
   *  consumers that don't pass this. */
  smartSplitOverpay?: boolean;
  /** When true, always treat change/return as CASH — hides the return-method
   *  picker and forces the dual USD/LBP cash fields regardless of what
   *  forward payment methods are offered. Use when the consumer's backend
   *  repository has no OUT-leg handling for non-CASH returns (it would
   *  otherwise silently book a non-cash return leg as an ordinary inbound
   *  payment). Default false — return method follows the forward methods,
   *  as today. */
  cashOnlyReturn?: boolean;
  /** OPT-IN: when true and the single payment line underpays the total, a
   *  live CUSTOMER_ACCOUNT remainder leg is auto-added so the shortfall books
   *  as client debt instead of being silently dropped (the lira-122 incident:
   *  in single mode only the method + FULL total ever reached the backend).
   *
   *  Default false — the consumer must opt in, passing its OWN validated
   *  charge-eligibility predicate (canChargeToCustomerAccount-grade: existing
   *  client or name+phone), NOT the loosely-defined hasClient. Never enable
   *  on money-OUT flows (RECEIVE cashouts, payouts): there CUSTOMER_ACCOUNT
   *  means "credit the customer's account" and an auto IN-direction debt leg
   *  inverts the sign of the unpaid remainder. */
  autoDebtRemainder?: boolean;
  /** OPT-IN counter-flow section (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md, owner
   *  decision #2: ONE payment form, a direction per line, never a second
   *  form). Renders a second, independent set of payment lines BELOW the
   *  main lines, in the SAME card, for money moving the OPPOSITE direction —
   *  e.g. a RECEIVE cashout's main lines are the shop's payout ("You pay")
   *  while the counter-flow lines collect a fee the customer pays back
   *  ("Customer pays"). Seeded with ONE CASH line at the full `totalAmount`
   *  in `currency`. Lines are emitted ONLY through `counterFlow.onChange` —
   *  never mixed into the main `onChange`/`onReturnChange` outputs, and
   *  never read by the main section's totalPaid/hasDebt/PM-fee derivations.
   *  Default (prop absent): renders exactly as today — no chips, no
   *  section, zero impact on existing consumers. */
  counterFlow?:
    | {
        /** Section heading, e.g. "Customer pays — OMT fee". */
        label: string;
        /** Full amount to seed the single line with, in `currency`. */
        totalAmount: number;
        currency: string;
        onChange: (lines: PaymentLine[]) => void;
        /** Defaults to the main `paymentMethods` prop when omitted. */
        paymentMethods?: PaymentMethod[];
        /** When true and `hasClient` is false, CUSTOMER_ACCOUNT is removed
         *  from this section's method list (mirrors
         *  canChargeToCustomerAccount-grade gating elsewhere — the caller
         *  supplies its own validated predicate). */
        requiresClient?: boolean;
        hasClient?: boolean;
        // ── LIRA-321 (contracts/payment-box.md) ──
        /** Pre-filled lines; default = one CASH line at totalAmount.
         *  2+ lines ⇒ the section opens in split mode. */
        seedLines?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
        }>;
        /** Locks every line to `currency` (select disabled) and, on payout
         *  screens, titles the section "Customer pays — <CUR>". */
        lockCurrency?: boolean;
        /** Largest shortfall the cashier may forgive (Forgive control). */
        maxForgive?: number;
        /** The section's balance, reported whenever it changes. Pages gate
         *  Confirm on `overpaid || needsClient || !balanced`. */
        onStateChange?: (state: LinesSectionState) => void;
        /** The currencies this section's lines may use. Defaults to the
         *  sheet's `currencies`. Binance cash-out adds USDT here only, so
         *  the shop's payout lines stay USD/LBP. */
        currencies?: Currency[];
        // ── LIRA-336 (contracts/added-change.md) ──
        /** Payout only (`payer="payout"`, no `perCurrencyTotals`, a
         *  USD/LBP/USDT section): cash/wallet money ABOVE this section's
         *  `totalAmount` is change the customer adds — it raises what
         *  "Shop pays" must pay out by the same value (see
         *  `onAddedChange`). Never the account or a forgiven amount. Over
         *  the cap the section is overpaid. */
        allowAddedChange?: boolean;
        /** Hidden behind "+ Customer gives change" until the cashier opens
         *  it; an × closes it again, clearing its lines (onChange([])).
         *  Closed, the box looks exactly as with no counterFlow. Used with
         *  `totalAmount: 0` on payouts that have no customer section. */
        optional?: boolean;
      }
    | undefined;
  /** When false, hides the Split toggle entirely — the form can never enter
   *  split mode via the UI (it already can't programmatically either, since
   *  `initialLines` is read once on mount and callers choosing this prop
   *  pass none). Default true — every existing consumer is unaffected.
   *
   *  Added for LIRA-185: this component's split math assumes an
   *  independently-known "total owed" (`totals`/`totalAmountCurrency`) that
   *  each line pays DOWN — true for a sale or a debt, but not for an
   *  expense, where there is no total besides whatever the operator types
   *  across lines. Expenses fed it `totals=[line1]` as a stand-in, which
   *  made every line past the first look like an overpayment (the summary
   *  showed only line 1 as "Total Amount" and offered change back) while
   *  `handleAddExpense` still summed every line into the submitted amount
   *  and used ONLY line 1's method — silently booking a second line's own
   *  payment method (e.g. a Whish leg) against the cash drawer instead.
   *  Hiding Split removes the only way to reach that mismatch, rather than
   *  teaching the expense schema/repository to post one leg per line
   *  (a bigger, cross-layer change). */
  allowSplit?: boolean;
  /** "payment" (default — every existing consumer, unchanged): the lines are
   *  money the customer PAYS the shop. "payout": the lines are cash the shop
   *  HANDS OUT (the Exchange payout sheet). In payout mode "keep change"
   *  flips direction (owner decision 2026-10-06, D9 refined): when the lines
   *  are SHORT of the total by a small leftover (up to
   *  `PAYOUT_KEEP_CHANGE_MAX` in the total's currency — $5 / 450,000 LBP,
   *  inclusive),
   *  the leftover is kept AUTOMATICALLY (no button — owner decision
   *  2026-10-06) and `onKeptChange` reports it (e.g. $101.12 owed, $101
   *  handed over → kept $0.12). Over the cap it stays "Remaining to pay
   *  out". The overpay Return/Change block never renders in payout mode —
   *  paying out more than owed is a mistake to fix, never change to return
   *  or profit to keep — and no OUT legs are ever emitted. Still OPT-IN via
   *  `onKeptChange`.
   *
   *  @deprecated Alias of `payer`: "payout" ≡ `payer="payout"`, "payment" ≡
   *  `payer="customer"`. Kept so existing call sites compile unchanged;
   *  `payer` wins when both are passed. */
  direction?: "payment" | "payout";
  /** Who pays on this sheet — see {@link MultiPaymentPayer}. Decides
   *  whether the change fields show, the kept-change math, the note copy
   *  and what `onKeptChange` reports. Kept change stays OPT-IN via
   *  `onKeptChange` in every mode. Default: derived from `direction`
   *  ("customer" unless `direction="payout"`). */
  payer?: MultiPaymentPayer;
}

/** Delay before the auto-added debt remainder visually flips the sheet into
 *  split mode. Cosmetic only — the onChange payload is correct immediately;
 *  this just keeps the layout from jumping mid-keystroke. Mirrored by the
 *  e2e wait in lira-122-auto-debt-split.spec.ts. */
export const AUTO_SPLIT_REVEAL_MS = 500;

const CASH_EQUIVALENT_METHODS = new Set(["CASH", "CUSTOMER_ACCOUNT"]);

/** Format a number with commas (e.g. 3600000 → "3,600,000", 150.50 → "150.50") */
function fmtNum(value: number | string): string {
  if (value === "" || value === 0) return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "";
  const parts = num.toString().split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

/** Strip commas and parse to number */
function parseNum(formatted: string): number {
  return parseFloat(formatted.replace(/,/g, "")) || 0;
}

/** `<Trans>` slot for `<ltr>…</ltr>` in the payment catalog: keeps an amount
 *  left-to-right inside an Arabic sentence (Trans supplies the children). */
const LTR_SLOT = { ltr: <Ltr>{null}</Ltr> };

/** Symbols drawn inside the amount field (others show only in the picker). */
const INLINE_SYMBOLS = ["$", "€", "£"];

interface PaymentLineRowProps {
  /** "payment" for the main lines, "counter-flow" for the opposite-direction
   *  section — the data-testid prefix each control already had. */
  testIdPrefix: "payment" | "counter-flow";
  lineId: string;
  method: string;
  currencyCode: string;
  amount: number;
  methods: PaymentMethod[];
  currencies: Currency[];
  /** The currency's display symbol (from the `currencies` prop). */
  symbol: string;
  /** "large" = the single-line form; "compact" = split and counter-flow. */
  size: "large" | "compact";
  accent: "violet" | "emerald";
  onMethodChange: (method: string) => void;
  onCurrencyChange: (currencyCode: string) => void;
  onAmountChange: (amount: number) => void;
  /** Shows the remove (X) button when given. */
  onRemove?: () => void;
  removeDisabled?: boolean;
  /** data-testid for the row itself (the counter-flow lines carry one). */
  rowTestId?: string;
  /** LIRA-321: the currency select is disabled (lockCurrency). */
  currencyLocked?: boolean;
}

/**
 * One method + currency + amount (+ remove) row. The single line, every
 * split line and every counter-flow line render through this, so the three
 * cannot drift apart. Display only: every change goes straight to the
 * caller's handler.
 */
function PaymentLineRow({
  testIdPrefix,
  lineId,
  method,
  currencyCode,
  amount,
  methods,
  currencies,
  symbol,
  size,
  accent,
  onMethodChange,
  onCurrencyChange,
  onAmountChange,
  onRemove,
  removeDisabled = false,
  rowTestId,
  currencyLocked = false,
}: PaymentLineRowProps) {
  const large = size === "large";
  const bg = large ? "bg-slate-800/80" : "bg-slate-900";
  const py = large ? "py-2.5" : "py-2";
  const focus =
    accent === "emerald"
      ? "focus:border-emerald-500"
      : "focus:border-violet-500";
  const showSymbol = INLINE_SYMBOLS.includes(symbol);
  const { t } = useTranslation("payment");

  return (
    <div
      {...(rowTestId ? { "data-testid": rowTestId } : {})}
      className="flex items-center gap-2"
    >
      {/* Payment Method */}
      <select
        data-testid={`${testIdPrefix}-method-${lineId}`}
        value={method}
        onChange={(e) => onMethodChange(e.target.value)}
        className={`flex-1 min-w-0 ${bg} border border-slate-600 rounded-lg px-3 ${py} text-white text-sm focus:outline-none ${focus} transition-colors`}
      >
        {methods.map((pm) => (
          <option key={pm.code} value={pm.code}>
            {pm.label}
          </option>
        ))}
      </select>

      {/* Currency — LIRA-321: a locked currency is not a choice, so it is a
          read-only field with a small lock, never a <select>. The app
          stylesheet paints a dropdown caret on EVERY select and reserves
          2.5rem for it, which cut "LBP" down to "LE" at this width. */}
      <div className="relative w-20 shrink-0">
        {currencyLocked ? (
          <>
            <svg
              data-testid={`${testIdPrefix}-lock-${lineId}`}
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-slate-400"
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <input
              type="text"
              data-testid={`${testIdPrefix}-currency-${lineId}`}
              aria-label={t("row.currency")}
              value={currencyCode}
              readOnly
              disabled
              title={t("row.currencyLocked")}
              className={`w-full ${bg} border border-slate-600 rounded-lg ps-6 pe-1 ${py} text-white text-sm cursor-not-allowed`}
            />
          </>
        ) : (
          <select
            data-testid={`${testIdPrefix}-currency-${lineId}`}
            value={currencyCode}
            onChange={(e) => onCurrencyChange(e.target.value)}
            className={`w-full ${bg} border border-slate-600 rounded-lg px-2 ${py} text-white text-sm focus:outline-none ${focus} transition-colors`}
          >
            {currencies.map((curr) => (
              <option key={curr.code} value={curr.code}>
                {curr.code}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Amount — DecimalInput keeps the raw text while focused so decimal
          points survive typing (a controlled fmtNum/parseNum round-trip ate
          the "." on every keystroke). */}
      <div className={`relative ${large ? "w-36" : "w-28"}`}>
        {showSymbol && (
          <span
            className={`absolute start-3 top-1/2 -translate-y-1/2 text-slate-500 ${large ? "text-sm" : "text-xs"}`}
          >
            {symbol}
          </span>
        )}
        <DecimalInput
          data-testid={`${testIdPrefix}-amount-${lineId}`}
          value={amount}
          decimals={currencyCode === "LBP" ? 0 : 2}
          onChange={onAmountChange}
          className={`w-full ${bg} border border-slate-600 rounded-lg pe-3 ${py} text-white text-sm font-mono focus:outline-none ${focus} transition-colors ${
            showSymbol ? "ps-7" : "ps-3"
          }`}
          placeholder="0"
        />
      </div>

      {/* Remove */}
      {onRemove && (
        <button
          type="button"
          disabled={removeDisabled}
          onClick={onRemove}
          className="flex-shrink-0 px-0.5 py-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-500 transition-all"
          title={t("row.remove")}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export default function MultiPaymentInput({
  currency,
  totalAmountCurrency = "USD",
  totals: totalsProp,
  perCurrencyTotals = false,
  rateTable: rateTableProp,
  side = "buy",
  onChange,
  onReturnChange,
  onKeptChange,
  requiresClientForDebt = true,
  hasClient = false,
  onExchangeRateChange,
  showPmFee = false,
  pmFeeRate = 0.01,
  onPmFeesChange,
  providerFee = 0,
  paymentMethods = [],
  currencies = [],
  exchangeRate,
  onRateChange,
  showDiscount = true,
  maxDiscount,
  onDiscountChange,
  onExtraChange,
  maxExtra,
  label,
  paidLabel: paidLabelProp,
  initialMethod,
  initialLines,
  fillTotals,
  fillKey,
  defaultReturnMethod,
  returnCurrencyFollowsTender = false,
  unreturnedChangeTo,
  accountLabel,
  returnCurrencies,
  payoutExcessToAccount = false,
  onRoundUpChange,
  onAddedChange,
  clientId,
  fetchClientVouchers,
  onWaiveRemaining,
  waiveRemainingThreshold,
  waiveRemainingMax,
  waiveDisabled = false,
  waiveTotals,
  discountRow,
  totalBeforeDiscount,
  afterDiscountLabel: afterDiscountLabelProp,
  discountMovesPayment = true,
  owedLabel,
  smartSplitOverpay = false,
  cashOnlyReturn = false,
  autoDebtRemainder = false,
  counterFlow,
  allowSplit = true,
  direction = "payment",
  payer: payerProp,
}: MultiPaymentInputProps) {
  const { t } = useTranslation("payment");
  const { t: tUi } = useTranslation("ui");
  const paidLabel = paidLabelProp ?? t("summary.paid");
  const afterDiscountLabel =
    afterDiscountLabelProp ?? t("summary.afterDiscount");
  const payer: MultiPaymentPayer =
    payerProp ?? (direction === "payout" ? "payout" : "customer");
  const isPayout = payer === "payout";
  // Shop pays an outsider: change not returned is a COST, never profit.
  const isShopPayer = payer === "shop";
  // Seeded lines are captured once — the prop is read at mount only.
  const seededLinesRef = useRef<PaymentLine[] | null>(
    initialLines && initialLines.length > 0
      ? initialLines.map((l) => ({
          id: crypto.randomUUID(),
          method: l.method || initialMethod || "CASH",
          currencyCode: l.currencyCode,
          amount: l.amount,
        }))
      : null,
  );
  const [isSplitMode, setIsSplitMode] = useState(
    (seededLinesRef.current?.length ?? 0) > 1,
  );
  // Redeemable vouchers for the selected client (for GIFT_CARD lines)
  const [clientVouchers, setClientVouchers] = useState<VoucherOption[]>([]);
  const [discountRaw, setDiscountRaw] = useState<string>("");
  const [discountCurrency, setDiscountCurrency] = useState<string>(currency);
  // LIRA-319 — which side of the built-in line is active (see onExtraChange).
  const [lineMode, setLineMode] = useState<"discount" | "extra">("discount");
  // LIRA-334 — the built-in Extra was filled in automatically from a small
  // overpay (round-up autofill below); drives the "clear it to give change"
  // hint and lets the autofill update or withdraw its own value.
  const [extraAutofilled, setExtraAutofilled] = useState(false);
  // LIRA-334 — the cashier switched the line or typed in it: no autofill
  // until the payment lines change again.
  const roundUpDismissedRef = useRef<boolean>(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>(
    seededLinesRef.current ?? [
      {
        id: crypto.randomUUID(),
        method: initialMethod || "CASH",
        currencyCode: currency,
        // The mount run of the single-mode auto-sync effect fills this from
        // the per-currency totals.
        amount: 0,
      },
    ],
  );

  // Multi-line seeds open in split mode, which the single-mode auto-sync
  // effect (the usual mount emitter) skips — emit them to the parent here so
  // its line state matches what is on screen from the first render.
  useEffect(() => {
    if (seededLinesRef.current && seededLinesRef.current.length > 1) {
      onChange(seededLinesRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pmFeeOverrides, setPmFeeOverrides] = useState<Record<string, string>>(
    {},
  );

  // --- Return / change (shop → customer) state ---
  const [returnMethod, setReturnMethod] = useState<string>(
    defaultReturnMethod ?? "CASH",
  );
  // For non-CASH returns: which currency to express the amount in.
  const [returnCurrency, setReturnCurrency] =
    useState<string>(totalAmountCurrency);
  // For CASH returns: editable USD and LBP amounts (mirrors POS "Change Given").
  const [returnAmountUSD, setReturnAmountUSD] = useState<string>("");
  const [returnAmountLBP, setReturnAmountLBP] = useState<string>("");
  // LIRA-313 — the "To account" choice in the change box: the return
  // fields are cleared and the whole change goes to the account. Off by
  // default (owner decision 2026-10-12: "Return change" is the default).
  const [changeToAccount, setChangeToAccount] = useState(false);
  /** Owner 2026-10-24 — on an account page that also wires `onKeptChange`,
   *  the change box offers "Keep" beside "Account": change not handed back
   *  is kept as profit instead of credited. */
  const [keepUnreturned, setKeepUnreturned] = useState(false);
  // Stable id prefix for return legs (consumers don't use the id).
  const returnLegIdRef = useRef<string>(crypto.randomUUID());
  // Tracks whether the user manually edited the single-mode amount, so a
  // deliberate overpayment isn't clobbered by the auto-sync-to-total effect.
  const singleAmountTouchedRef = useRef<boolean>(false);
  // Tracks whether the operator manually edited the exchange-rate field, so a
  // late-resolving async rate-fetch prop (callers commonly seed `exchangeRate`
  // from a hook like useSellRate that starts at a fallback and overwrites
  // itself once its fetch resolves) can't silently clobber the operator's
  // typed rate. Mirrors singleAmountTouchedRef's pattern for the amount field.
  const rateTouchedRef = useRef<boolean>(false);

  // Auto-debt remainder line id (or null). In single-payment mode, a typed
  // amount below the total used to be cosmetic — only the method + the FULL
  // total were ever submitted, silently discarding the shortfall (real
  // incident: "$300 cash + $15 debt" typed, $315 charged entirely to
  // CUSTOMER_ACCOUNT because single mode never sent a partial amount).
  // `autoDebtLineIdRef` tracks the id of the live-managed CUSTOMER_ACCOUNT
  // remainder line while it is auto-managed. The moment the operator edits
  // that line directly it DETACHES (ref nulled) and becomes an ordinary
  // manual line the effect never touches again — including never deleting
  // it when the primary line later covers the total.
  const autoDebtLineIdRef = useRef<string | null>(null);
  // Explicit removal of the auto-added line means "not this time" — without
  // this, the creation effect (which only sees "1 line, still short") would
  // resurrect it on the very next render. Cleared the moment the operator
  // edits the primary line again — a fresh action re-opens the possibility.
  const autoDebtDismissedRef = useRef<boolean>(false);
  // True while split mode was entered by the auto-reveal (not the operator's
  // Split toggle) — lets the withdraw path fold the sheet back to single
  // mode instead of leaving a stuck one-line "Split" UI.
  const autoRevealedRef = useRef<boolean>(false);

  const safeExchangeRate =
    exchangeRate || rateTableProp?.rates["LBP"]?.[side] || 89000;
  const [customExchangeRate, setCustomExchangeRate] = useState<string>(
    safeExchangeRate.toString(),
  );

  const effectiveRate = parseFloat(customExchangeRate) || safeExchangeRate;

  // ── Tender-rate sanity warning (LIRA-240, owner decision 2026-09-28) ──
  // `safeExchangeRate` is the shop/server reference rate (the `exchangeRate`
  // prop, falling back to the rate-table LBP pair, then a last-resort
  // default) — it does NOT change when the operator edits the field below,
  // so it stays a stable anchor to compare the typed rate against.
  // NON-BLOCKING: this never disables Confirm/Pay or any input — it is a
  // warning line only. The server-side ±15% band that used to REFUSE a
  // payment over this same threshold was removed for the same reason
  // (moneyPosting.ts, `TENDER_RATE_BAND_PCT`'s doc) — this is now the ONLY
  // place the band has any effect at all.
  const tenderRateDeviation = tenderRateDeviationPct(
    effectiveRate,
    safeExchangeRate,
  );
  const tenderRateWarning =
    tenderRateDeviation > TENDER_RATE_BAND_PCT
      ? {
          isTypoLevel: tenderRateDeviation > TENDER_RATE_TYPO_PCT,
          pct: Math.round(tenderRateDeviation * 100),
          rate: fmtNum(Math.round(safeExchangeRate)),
        }
      : null;

  // ── Multi-currency engine model (docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md) ──
  // Every conversion in this component goes through this table. The header
  // rate field ("1 USD = X LBP") overrides the USD↔LBP pair — other pairs of
  // a provided table (e.g. EUR) pass through untouched.
  const internalRates: RateTable = {
    base: rateTableProp?.base ?? "USD",
    rates: {
      ...rateTableProp?.rates,
      LBP: { buy: effectiveRate, sell: effectiveRate },
    },
  };

  /** Convert an amount between currencies at the effective table. Unknown
   *  pairs fall back to the amount unchanged — the legacy behavior of
   *  normalizeToTarget's "no cross-rate support" branch. */
  const convertSafe = (amount: number, from: string, to: string): number => {
    if (from === to) return amount;
    try {
      return convertMoney({ amount, currency: from }, to, internalRates, side)
        .amount;
    } catch {
      return amount;
    }
  };

  // ── Counter-flow (opposite-direction) lines ────────────────────────────────
  // Called here, unconditionally (stable hook order), because LIRA-336's
  // added change feeds `effectiveTotals` below.
  //
  // Entirely independent of the main payment-lines state above: never read
  // by totalPaid/hasDebt/PM-fee. LIRA-321: single/split, leftover line,
  // Forgive and the balance report live in useLinesSection (research R1).
  //
  // CUSTOMER_ACCOUNT is removed from the counter-flow method list when the
  // caller's own validated charge predicate says no (requiresClient && no
  // client) — mirrors canChargeToCustomerAccount-grade gating used elsewhere.
  const counterFlowCallerMethods =
    counterFlow?.paymentMethods ?? paymentMethods;
  // Could picking a client offer the account at all? False when the caller
  // never lists CUSTOMER_ACCOUNT (e.g. Exchange paid in EUR, owner decision
  // 2026-10-14) — the hint must not then say "pick a client".
  const counterFlowAccountPossible = counterFlowCallerMethods.some(
    (pm) => pm.code === "CUSTOMER_ACCOUNT",
  );
  const counterFlowMethods = counterFlowCallerMethods.filter(
    (pm) =>
      pm.code !== "CUSTOMER_ACCOUNT" ||
      !(counterFlow?.requiresClient && !counterFlow?.hasClient),
  );
  // LIRA-336 — the optional section is closed until the cashier opens it.
  const [cfOpen, setCfOpen] = useState(false);
  const cfOptional = !!counterFlow?.optional;
  // A page that drops counterFlow (e.g. RECEIVE → SEND → RECEIVE) gets the
  // optional section back closed, behind its link (boolean dep: rule 25).
  const hasCounterFlow = !!counterFlow;
  useEffect(() => {
    if (!hasCounterFlow) setCfOpen(false);
  }, [hasCounterFlow]);
  /** The counter-flow section is on screen and counted. */
  const cfActive = !!counterFlow && (!cfOptional || cfOpen);
  const cfCurrency = counterFlow?.currency ?? currency;
  /** LIRA-336 — the section may take change the customer adds. */
  const addedChangeEligible =
    isPayout &&
    !!counterFlow?.allowAddedChange &&
    !perCurrencyTotals &&
    ["USD", "LBP", "USDT"].includes(cfCurrency);
  const cf = useLinesSection({
    enabled: cfActive,
    totalAmount: counterFlow?.totalAmount ?? 0,
    currency: counterFlow?.currency ?? currency,
    ...(counterFlow?.seedLines ? { seedLines: counterFlow.seedLines } : {}),
    methods: counterFlowMethods,
    hasClient: !!counterFlow?.hasClient,
    ...(counterFlow?.maxForgive !== undefined
      ? { maxForgive: counterFlow.maxForgive }
      : {}),
    convert: convertSafe,
    round: (amount, curr) =>
      roundForCurrency({ amount, currency: curr }).amount,
    ...(counterFlow ? { onChange: counterFlow.onChange } : {}),
    ...(counterFlow?.onStateChange
      ? { onStateChange: counterFlow.onStateChange }
      : {}),
    ...(addedChangeEligible
      ? {
          allowAddedChange: true,
          // The same cap the server enforces, in the total's currency.
          isAddedChangeAllowed: (a: number) =>
            isWithinShortfallMax(
              convertSafe(a, cfCurrency, totalAmountCurrency),
              totalAmountCurrency,
            ),
        }
      : {}),
  });
  /** LIRA-336 — the customer's added change in the total's currency
   *  (rounded): it raises the payout target (`effectiveTotals`). */
  const addedTargetRaw =
    addedChangeEligible && cfActive
      ? convertSafe(cf.state.addedChange ?? 0, cfCurrency, totalAmountCurrency)
      : 0;
  const addedTarget =
    totalAmountCurrency === "LBP"
      ? Math.round(addedTargetRaw)
      : Math.round(addedTargetRaw * 100) / 100;

  // --- Discount logic ---
  const discountAmount = parseNum(discountRaw);

  /** Normalize discount from discountCurrency to totalAmountCurrency */
  const discountNormalized = convertSafe(
    discountAmount,
    discountCurrency,
    totalAmountCurrency,
  );
  // LIRA-319 — extra mode on the built-in line: never on a payout, never
  // when the page owns its line (`discountRow`). With the discount hidden
  // the line is extra-only.
  const extraAllowed = !!onExtraChange && !isPayout && !discountRow;
  const isExtraMode = extraAllowed && (!showDiscount || lineMode === "extra");
  const clampedDiscount = isExtraMode
    ? 0
    : maxDiscount !== undefined
      ? Math.min(discountNormalized, maxDiscount)
      : discountNormalized;
  // LIRA-269: on a payout the caller folds the discount into the total (see
  // the `showDiscount` prop doc), so it is never subtracted here — and the
  // field is only offered when the caller books it.
  const discountVisible = showDiscount && (!isPayout || !!onDiscountChange);
  const discountLowersTotal = !isPayout;
  /** The built-in line is drawn: as a discount, or (LIRA-319) as an extra. */
  const lineVisible = discountVisible || extraAllowed;

  // What is owed, per currency — the native composition callers provide.
  // Discount (normalized to totalAmountCurrency) is taken out of the buckets
  // largest-first.
  const baseTotals: Money[] = totalsProp ?? [];
  // LIRA-319 — the extra, capped to `maxExtra` (default: the total before
  // it), in totalAmountCurrency.
  const extraCap =
    maxExtra ??
    baseTotals.reduce(
      (sum, t) => sum + convertSafe(t.amount, t.currency, totalAmountCurrency),
      0,
    );
  const clampedExtra = isExtraMode
    ? Math.max(0, Math.min(discountNormalized, extraCap))
    : 0;
  // LIRA-336 — on a payout the customer's added change raises the target
  // the same way an extra does (the two never meet: extra is never on a
  // payout). Round-up, kept change, the remaining row and the prefill then
  // measure against the raised target by construction (FR-003).
  const totalsBump = clampedExtra + addedTarget;
  const effectiveTotals: Money[] = (() => {
    if (totalsBump > 0) {
      // The bump is added in totalAmountCurrency's own bucket.
      const hasBucket = baseTotals.some(
        (t) => t.currency === totalAmountCurrency,
      );
      return hasBucket
        ? baseTotals.map((t) =>
            t.currency === totalAmountCurrency
              ? { ...t, amount: t.amount + totalsBump }
              : t,
          )
        : [
            ...baseTotals,
            { amount: totalsBump, currency: totalAmountCurrency },
          ];
    }
    if (clampedDiscount <= 0 || !discountLowersTotal) return baseTotals;
    let discountLeft = clampedDiscount;
    return [...baseTotals]
      .sort(
        (a, b) =>
          convertSafe(b.amount, b.currency, totalAmountCurrency) -
          convertSafe(a.amount, a.currency, totalAmountCurrency),
      )
      .map((t) => {
        if (discountLeft <= 0) return t;
        const discountHere = Math.min(
          convertSafe(discountLeft, totalAmountCurrency, t.currency),
          t.amount,
        );
        discountLeft -= convertSafe(
          discountHere,
          t.currency,
          totalAmountCurrency,
        );
        return { ...t, amount: t.amount - discountHere };
      });
  })();

  // Scalar bridges: totals expressed in totalAmountCurrency — they feed the
  // single-number UI surfaces (summary rows, return-field seeding, waive
  // threshold). Pre-discount and post-discount variants.
  const sumInTarget = (items: Money[]): number =>
    items.reduce(
      (sum, t) => sum + convertSafe(t.amount, t.currency, totalAmountCurrency),
      0,
    );
  const totalInTarget = sumInTarget(baseTotals);
  const effectiveTotalInTarget = sumInTarget(effectiveTotals);

  /** What one line should auto-fill to, in its own currency: the NATIVE
   *  remaining in that currency plus the other currencies' remaining
   *  converted at the effective rate (rounded — a converted figure is an
   *  exchange, so currency precision applies; the native part passes through
   *  raw, exactly like the legacy same-currency branch). This is the
   *  currency-boundary rule that makes an LBP debt paid in LBP rate-proof. */
  const prefillAmountFor = (
    lineCurrency: string,
    excludeLineId?: string,
    /** The lines to count instead of the current ones (LIRA-308 answer 3). */
    linesOverride?: PaymentLine[],
  ): number => {
    // LIRA-322 — perCurrencyTotals: only this currency's own remaining; the
    // other currencies are never converted into it.
    if (perCurrencyTotals) {
      const owed = (fillTotals ?? baseTotals)
        .filter((t) => t.currency === lineCurrency)
        .reduce((s, t) => s + t.amount, 0);
      const others = (linesOverride ?? paymentLines)
        .filter(
          (l) => l.id !== excludeLineId && l.currencyCode === lineCurrency,
        )
        .reduce((s, l) => s + Math.max(0, l.amount || 0), 0);
      return Math.max(0, owed - others);
    }
    const otherPayments: Money[] = (linesOverride ?? paymentLines)
      .filter((l) => l.id !== excludeLineId)
      .map((l) => ({
        amount: Math.max(0, l.amount || 0),
        currency: l.currencyCode,
      }));
    const { remaining } = allocatePayments(
      {
        // LIRA-308: fill to `fillTotals` when the caller gives one.
        // LIRA-318: a discount that must not move the payment fills to the
        // total before it.
        totals:
          fillTotals ??
          (!discountMovesPayment && totalBeforeDiscount
            ? totalBeforeDiscount
            : effectiveTotals),
        payments: otherPayments,
        rates: internalRates,
        side,
      },
      { round: false },
    );
    const native =
      remaining.find((m) => m.currency === lineCurrency)?.amount ?? 0;
    const cross = remaining
      .filter((m) => m.currency !== lineCurrency)
      .reduce((s, m) => s + convertSafe(m.amount, m.currency, lineCurrency), 0);
    return cross > 0
      ? native +
          roundForCurrency({ amount: cross, currency: lineCurrency }).amount
      : native;
  };

  // Auto-sync discount currency with single payment line currency
  useEffect(() => {
    if (!isSplitMode && paymentLines.length === 1) {
      setDiscountCurrency(paymentLines[0].currencyCode);
    }
  }, [isSplitMode, paymentLines]);

  // Emit discount to parent
  useEffect(() => {
    onDiscountChange?.(clampedDiscount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedDiscount]);

  // LIRA-319 — emit the extra to the parent (0 in discount mode).
  useEffect(() => {
    onExtraChange?.(clampedExtra);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedExtra]);

  /** LIRA-319 — the switch: the amount typed for the other side is cleared,
   *  so a payment never carries a discount and an extra together. */
  const handleLineModeChange = (m: "discount" | "extra") => {
    setLineMode(m);
    setDiscountRaw("");
    // LIRA-334 — the cashier's choice: do not autofill over it.
    roundUpDismissedRef.current = true;
    setExtraAutofilled(false);
  };

  // Update custom rate when exchange rate prop changes. Skipped once the
  // operator manually edits the rate field, so a deliberate typed rate isn't
  // reset when the caller's exchangeRate prop later changes (e.g. an async
  // rate-fetch hook resolving after the edit) — mirrors the amount field's
  // singleAmountTouchedRef guard above.
  useEffect(() => {
    if (rateTouchedRef.current) return;
    setCustomExchangeRate(safeExchangeRate.toString());
    onExchangeRateChange?.(safeExchangeRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeExchangeRate]);

  // Track single-mode line currency for auto-sync dependency
  const singleLineCurrency =
    !isSplitMode && paymentLines.length === 1
      ? paymentLines[0].currencyCode
      : null;

  // Re-run the single-mode auto-sync when a caller-provided per-currency
  // total changes (stable key — the prop is a fresh array each render).
  const totalsKey = totalsProp
    ? totalsProp.map((t) => `${t.currency}:${t.amount}`).join("|")
    : null;
  const fillTotalsKey = fillTotals
    ? fillTotals.map((t) => `${t.currency}:${t.amount}`).join("|")
    : null;
  const grossTotalsKey = totalBeforeDiscount
    ? totalBeforeDiscount.map((t) => `${t.currency}:${t.amount}`).join("|")
    : null;

  // In single mode, auto-sync the line amount with the effective totals
  // (currency-aware). Skipped once the user manually edits the amount, so a
  // deliberate overpayment (customer hands more than the total) is preserved
  // instead of being reset.
  useEffect(() => {
    if (singleAmountTouchedRef.current) return;
    if (!isSplitMode && paymentLines.length === 1) {
      const line = paymentLines[0];
      // Native remaining passes through raw; only the cross-currency part is
      // an exchange and gets rounded to the line currency's precision (LBP
      // whole, USD 2 dp) so a rate round-trip can't leak FP noise into the
      // amount that is both displayed and submitted.
      const converted = prefillAmountFor(line.currencyCode, line.id);
      const updated = [{ ...line, amount: converted }];
      if (line.amount !== converted) {
        setPaymentLines(updated);
      }
      // Always notify the parent — even on first render when the amount
      // matches the initial state, so the parent's cashflowLines gets
      // populated with the pre-filled amount instead of staying empty.
      onChange(updated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    totalsKey,
    fillTotalsKey,
    grossTotalsKey,
    isSplitMode,
    effectiveRate,
    singleLineCurrency,
    clampedDiscount,
    clampedExtra,
    addedTarget,
  ]);

  // LIRA-308 decision 9 — non-cash change follows a single-currency tender.
  const tenderCurrencyKey = [
    ...new Set(paymentLines.map((l) => l.currencyCode)),
  ].join("|");
  useEffect(() => {
    if (!returnCurrencyFollowsTender) return;
    const ccys = tenderCurrencyKey.split("|").filter(Boolean);
    if (ccys.length === 1) setReturnCurrency(ccys[0]);
  }, [returnCurrencyFollowsTender, tenderCurrencyKey]);

  // LIRA-308 decision 2 — a new `fillKey` re-fills the amount to
  // `fillTotals`, overriding a typed amount. Owner answer 3 (2026-10-11):
  // the lines the cashier set up are kept; the LAST line absorbs the
  // difference (its remainder against the others, the same currency-aware
  // prefill rule as a single line). A last line left with nothing is
  // removed and the one before it absorbs the rest — never below zero.
  // A single line then stays in sync through the auto-sync effect above.
  const prevFillKeyRef = useRef(fillKey);
  useEffect(() => {
    if (prevFillKeyRef.current === fillKey) return;
    prevFillKeyRef.current = fillKey;
    if (!fillTotals) return;
    singleAmountTouchedRef.current = false;
    let work = [...paymentLines];
    while (work.length > 0) {
      const tail = work[work.length - 1];
      const amount = prefillAmountFor(tail.currencyCode, tail.id, work);
      if (amount > 1e-9) {
        work = [...work.slice(0, -1), { ...tail, amount }];
        break;
      }
      work = work.slice(0, -1);
    }
    if (work.length === 0) {
      const first = paymentLines[0];
      const currencyCode = first?.currencyCode ?? currency;
      work = [
        {
          id: first?.id ?? crypto.randomUUID(),
          method: first?.method ?? initialMethod ?? "CASH",
          currencyCode,
          amount: Math.max(0, prefillAmountFor(currencyCode, undefined, [])),
        },
      ];
    }
    setIsSplitMode(work.length > 1);
    setPaymentLines(work);
    onChange(work);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillKey]);

  // Sync the first line's method with initialMethod and notify the parent.
  // Fires:
  //   - on mount (so the parent learns the initial method even when it matches
  //     the useState init — e.g. after a key-based remount with CUSTOMER_ACCOUNT)
  //   - whenever initialMethod changes without a remount
  useEffect(() => {
    if (!initialMethod) return;
    setPaymentLines((prev) => {
      const updated =
        prev[0]?.method === initialMethod
          ? prev
          : prev.map((line, i) =>
              i === 0 ? { ...line, method: initialMethod } : line,
            );
      onChange(updated);
      return updated;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMethod]);

  const handleLinesChange = (newLines: PaymentLine[]) => {
    setPaymentLines(newLines);
    onChange(newLines);
  };

  // Load the selected client's redeemable vouchers (for GIFT_CARD lines)
  useEffect(() => {
    let cancelled = false;
    if (clientId && fetchClientVouchers) {
      fetchClientVouchers(clientId)
        .then((vs) => {
          if (!cancelled) setClientVouchers(vs);
        })
        .catch(() => {
          if (!cancelled) setClientVouchers([]);
        });
    } else {
      setClientVouchers([]);
    }
    return () => {
      cancelled = true;
    };
  }, [clientId, fetchClientVouchers]);

  /** Return a line with voucherCode set, or the key omitted when no code. */
  const withVoucher = (
    line: PaymentLine,
    code: string | undefined,
  ): PaymentLine => {
    if (code) return { ...line, voucherCode: code };
    if (line.voucherCode === undefined) return line;
    const next = { ...line };
    delete next.voucherCode;
    return next;
  };

  // Keep each GIFT_CARD line bound to a valid, unique voucher: default to the
  // first still-available one, drop selections that are gone or taken elsewhere.
  const giftCardSelectionKey = paymentLines
    .map((l) => `${l.id}:${l.method}:${l.voucherCode ?? ""}`)
    .join("|");
  useEffect(() => {
    const used = new Set<string>();
    let changed = false;
    const next = paymentLines.map((line) => {
      // Clear a stale voucher code left over from a previous method.
      if (line.method !== "GIFT_CARD") {
        if (line.voucherCode === undefined) return line;
        changed = true;
        return withVoucher(line, undefined);
      }
      const available = clientVouchers.filter((v) => !used.has(v.code));
      let code = line.voucherCode;
      if (!code || !available.some((v) => v.code === code)) {
        code = available[0]?.code;
      }
      if (code) used.add(code);
      if (code === line.voucherCode) return line;
      changed = true;
      return withVoucher(line, code);
    });
    if (changed) handleLinesChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientVouchers, giftCardSelectionKey]);

  const addPaymentLine = () => {
    // Auto-fill the new line with what's still outstanding, in its own
    // currency: native remaining raw + cross-currency remainder converted.
    const newCurrency = currency;
    handleLinesChange([
      ...paymentLines,
      {
        id: crypto.randomUUID(),
        method: "CASH",
        currencyCode: newCurrency,
        amount: prefillAmountFor(newCurrency),
      },
    ]);
  };

  const removePaymentLine = (id: string) => {
    if (paymentLines.length > 1) {
      if (id === autoDebtLineIdRef.current) {
        autoDebtLineIdRef.current = null;
        autoDebtDismissedRef.current = true;
      }
      handleLinesChange(paymentLines.filter((line) => line.id !== id));
    }
  };

  const updatePaymentLine = (
    id: string,
    field: keyof PaymentLine,
    value: string | number,
  ) => {
    // A manual amount edit in single mode opts out of auto-sync-to-total, so a
    // deliberate overpayment is preserved.
    if (field === "amount" && !isSplitMode) {
      singleAmountTouchedRef.current = true;
    }
    // ANY direct edit to the auto-managed debt remainder DETACHES it — from
    // here on it is the operator's ordinary manual line: never resized,
    // never auto-deleted (even when the primary line later covers the total).
    if (id === autoDebtLineIdRef.current) {
      autoDebtLineIdRef.current = null;
    } else {
      // Editing the primary line is a fresh action — re-open the
      // possibility of auto-splitting even after an earlier dismissal.
      // (In genuine 2+ line manual splits this is inert: the auto-debt
      // effect bails on any shape other than one primary line.)
      autoDebtDismissedRef.current = false;
    }
    const updatedLines = paymentLines.map((line) => {
      if (line.id !== id) return line;
      const updated = { ...line, [field]: value };

      // Convert amount when currency changes — an actual exchange, so the
      // result is rounded to the new currency's precision (LBP whole, USD 2dp).
      if (field === "currencyCode" && value !== line.currencyCode) {
        const newCurr = value as string;
        updated.amount = roundForCurrency({
          amount: convertSafe(line.amount, line.currencyCode, newCurr),
          currency: newCurr,
        }).amount;
      }

      return updated;
    });

    // Handle PM fee clearing when method changes to/from CASH
    if (field === "method") {
      const newMethod = value as string;

      if (CASH_EQUIVALENT_METHODS.has(newMethod)) {
        // Clearing PM fee for CASH/DEBT methods
        const newOverrides = { ...pmFeeOverrides };
        delete newOverrides[id];
        setPmFeeOverrides(newOverrides);
      }
    }

    handleLinesChange(updatedLines);
  };

  /** Vouchers selected on OTHER GIFT_CARD lines (so each voucher is used once). */
  const voucherCodesUsedByOthers = (lineId: string): Set<string> =>
    new Set(
      paymentLines
        .filter(
          (l) => l.id !== lineId && l.method === "GIFT_CARD" && l.voucherCode,
        )
        .map((l) => l.voucherCode as string),
    );

  /** Vouchers this line may pick: its own current one + any not used elsewhere. */
  const voucherOptionsForLine = (line: PaymentLine): VoucherOption[] => {
    const used = voucherCodesUsedByOthers(line.id);
    return clientVouchers.filter(
      (v) => v.code === line.voucherCode || !used.has(v.code),
    );
  };

  const selectVoucher = (id: string, code: string) => {
    handleLinesChange(
      paymentLines.map((line) =>
        line.id === id ? withVoucher(line, code || undefined) : line,
      ),
    );
  };

  /** Voucher picker shown under a GIFT_CARD line — driven by the client's vouchers. */
  const renderVoucherSelector = (line: PaymentLine) => {
    if (line.method !== "GIFT_CARD") return null;
    // No client: the shared "client needed" box at the bottom says so.
    if (!clientId) return null;
    if (clientVouchers.length === 0) {
      return (
        <p className="mt-1 text-[11px] text-amber-400">
          {t("voucher.noneForClient")}
        </p>
      );
    }
    const options = voucherOptionsForLine(line);
    if (options.length === 0) {
      return (
        <p className="mt-1 text-[11px] text-amber-400">
          {t("voucher.noneLeft")}
        </p>
      );
    }
    const value = line.voucherCode ?? options[0]?.code ?? "";
    const selected = options.find((v) => v.code === value);
    return (
      <div>
        {options.length === 1 ? (
          <input
            type="text"
            value={value}
            disabled
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-xs font-mono tracking-wider disabled:opacity-70"
          />
        ) : (
          <select
            value={value}
            onChange={(e) => selectVoucher(line.id, e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-orange-500"
          >
            {options.map((v) => (
              <option key={v.code} value={v.code}>
                {v.code} — ${v.amount.toFixed(2)}
              </option>
            ))}
          </select>
        )}
        {selected && (
          <p className="mt-1 text-[11px] text-emerald-400">
            <Trans
              t={t}
              i18nKey="voucher.creditOnRedemption"
              values={{ amount: `$${selected.amount.toFixed(2)}` }}
              components={LTR_SLOT}
            />
          </p>
        )}
      </div>
    );
  };

  const calculatePmFee = (lineId: string, lineAmount: number): number => {
    const override = pmFeeOverrides[lineId];
    if (override !== undefined) {
      return parseFloat(override) || 0;
    }
    return lineAmount * pmFeeRate;
  };

  // Compute the PM fees map — pure derivation, no new object stored in state
  const pmFeesMap: Record<string, number> = {};
  if (showPmFee) {
    paymentLines.forEach((line) => {
      if (!CASH_EQUIVALENT_METHODS.has(line.method)) {
        pmFeesMap[line.id] = calculatePmFee(line.id, line.amount);
      }
    });
  }
  const totalPmFees = Object.values(pmFeesMap).reduce(
    (sum, fee) => sum + fee,
    0,
  );

  // Emit PM fees to parent — depend on a stable serialised key so we only fire
  // when the actual fee VALUES change, not on every render (avoids infinite loop
  // caused by pmFeesMap being a new object reference each render).
  const pmFeesKey = JSON.stringify(pmFeesMap);
  useEffect(() => {
    if (onPmFeesChange) {
      onPmFeesChange(JSON.parse(pmFeesKey) as Record<string, number>);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pmFeesKey]);

  /** Convert a payment line amount into the totalAmountCurrency (unknown
   *  pairs pass through as-is via convertSafe's legacy fallback). */
  const normalizeToTarget = (amount: number, lineCurrency: string): number =>
    convertSafe(amount, lineCurrency, totalAmountCurrency);

  // Calculate total paid normalized to the totalAmountCurrency
  const totalPaid = paymentLines.reduce((sum, line) => {
    return sum + normalizeToTarget(line.amount || 0, line.currencyCode);
  }, 0);

  // Tolerance for matching: LBP amounts are large so use higher tolerance
  const matchTolerance = matchToleranceFor(totalAmountCurrency);

  // ── LIRA-322 — perCurrencyTotals: each currency settles on its own ──
  // What is owed, paid, short and extra PER CURRENCY, in that currency
  // (never converted). Tolerance per currency, the same figures as
  // `matchTolerance` (100 LBP / 0.01 otherwise). Empty when the prop is off.
  const pcRows: Array<{
    currency: string;
    total: number;
    paid: number;
    short: number;
    extra: number;
  }> = perCurrencyTotals
    ? [
        ...new Set([
          ...baseTotals.map((t) => t.currency),
          ...paymentLines
            .filter((l) => (l.amount || 0) > 0)
            .map((l) => l.currencyCode),
        ]),
      ].map((c) => {
        const total = baseTotals
          .filter((t) => t.currency === c)
          .reduce((s, t) => s + t.amount, 0);
        const paid = paymentLines
          .filter((l) => l.currencyCode === c)
          .reduce((s, l) => s + (l.amount || 0), 0);
        const tol = c === "LBP" ? 100 : 0.01;
        return {
          currency: c,
          total,
          paid,
          short: total - paid > tol ? total - paid : 0,
          extra: paid - total > tol ? paid - total : 0,
        };
      })
    : [];
  const pcAnyShort = pcRows.some((r) => r.short > 0);
  const pcAnyExtra = pcRows.some((r) => r.extra > 0);
  /** Re-seeds the change fields when the per-currency split of the overpay
   *  changes (constant "" when the prop is off). */
  const pcExtraKey = pcRows.map((r) => `${r.currency}:${r.extra}`).join("|");

  const hasDebt = paymentLines.some(
    (line) => line.method === "CUSTOMER_ACCOUNT",
  );

  // Materialize the CUSTOMER_ACCOUNT remainder leg the instant a shortfall
  // exists — a PLAIN effect (no timer), so onChange is up to date before any
  // confirm click. Scope is deliberately narrow: only the single-line shape
  // the incident targets (the operator's one line, optionally plus our
  // tracked remainder). A genuine manual split (2+ lines) is never touched.
  // Fires ONLY for consumers that opted in via `autoDebtRemainder` (their own
  // validated charge predicate — see the prop doc) — everywhere else the
  // "Remaining (Debt)" warning stays as the honest signal.
  useEffect(() => {
    const trackedId = autoDebtLineIdRef.current;
    const primaryLines = trackedId
      ? paymentLines.filter((l) => l.id !== trackedId)
      : paymentLines;

    if (primaryLines.length !== 1) {
      // Operator built a real split around us — release the tracked line
      // as an ordinary manual leg.
      autoDebtLineIdRef.current = null;
      return;
    }

    const line = primaryLines[0];
    const debtLine = trackedId
      ? paymentLines.find((l) => l.id === trackedId)
      : undefined;

    const eligible =
      autoDebtRemainder &&
      hasClient &&
      line.method !== "CUSTOMER_ACCOUNT" &&
      paymentMethods.some((pm) => pm.code === "CUSTOMER_ACCOUNT");

    // Withdraw the auto leg when it no longer applies (feature toggled off,
    // method changed to CUSTOMER_ACCOUNT, or the primary now covers the
    // total). Only ever removes the line WE still manage — a detached
    // (operator-edited) leg has trackedId null and is never deleted here.
    const withdraw = () => {
      autoDebtLineIdRef.current = null;
      const updated = [line];
      setPaymentLines(updated);
      onChange(updated);
      if (autoRevealedRef.current) {
        autoRevealedRef.current = false;
        setIsSplitMode(false);
      }
    };

    if (!eligible) {
      if (debtLine) withdraw();
      return;
    }

    // Outstanding remainder in the primary line's own currency — via the
    // same per-currency engine the manual "+ Add Line" prefill uses
    // (allocatePayments: native remaining passes raw, only the
    // cross-currency slice is rate-converted), so multi-currency totals
    // never round-trip through a scalar.
    const amount = prefillAmountFor(line.currencyCode, trackedId ?? undefined);
    const lineTolerance = line.currencyCode === "LBP" ? 100 : 0.01;

    if (amount <= lineTolerance) {
      if (debtLine) withdraw();
      return;
    }

    // Explicitly removed and not yet re-armed by a fresh primary-line edit —
    // don't resurrect it.
    if (!debtLine && autoDebtDismissedRef.current) return;

    // An untouched single line is owned by the auto-sync effect above: it
    // follows the total, so there is no shortfall to book — only an amount
    // the operator TYPED below the total is one (the incident this effect
    // exists for). Both effects run in the same commit when the total moves,
    // and this one still sees the pre-sync amount, so without this guard it
    // turned "total went up" into a Customer Account leg for the difference.
    // Shop-day bug 13 (2026-10-17): a wallet-paid OMT send raised the total
    // by the 1% method fee, the $1 landed on Customer Account, the page lost
    // its single-line method fee, and the server refused the send.
    if (!debtLine && !isSplitMode && !singleAmountTouchedRef.current) return;

    if (
      debtLine &&
      debtLine.amount === amount &&
      debtLine.currencyCode === line.currencyCode
    ) {
      return; // already correct
    }

    const newId = debtLine?.id ?? crypto.randomUUID();
    autoDebtLineIdRef.current = newId;
    const updated = [
      line,
      {
        id: newId,
        method: "CUSTOMER_ACCOUNT",
        currencyCode: line.currencyCode,
        amount,
      },
    ];
    setPaymentLines(updated);
    onChange(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    paymentLines,
    autoDebtRemainder,
    hasClient,
    paymentMethods,
    effectiveRate,
    clampedDiscount,
    clampedExtra,
    addedTarget,
    totalsKey,
  ]);

  // Purely cosmetic: reveal the second row AUTO_SPLIT_REVEAL_MS after the
  // operator stops editing, so the layout doesn't flicker mid-keystroke.
  // Correctness never depends on this — the effect above already keeps
  // onChange accurate as soon as the shortfall appears, regardless of when
  // (or whether) this visual flip happens.
  useEffect(() => {
    if (isSplitMode) return;
    if (!autoDebtLineIdRef.current) return;
    const timer = setTimeout(() => {
      autoRevealedRef.current = true;
      setIsSplitMode(true);
    }, AUTO_SPLIT_REVEAL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentLines, isSplitMode]);

  const getSymbol = (currencyCode: string): string => {
    const curr = currencies.find((c) => c.code === currencyCode);
    return curr?.symbol || "$";
  };

  // --- Return / change derivation ---
  // Overpaid amount (in totalAmountCurrency); only positive when the customer
  // paid more than the (post-discount) total.
  // LIRA-322 — perCurrencyTotals: the sum of each currency's OWN overpay,
  // converted only for display (a short currency never offsets it). If
  // both currencies are overpaid, the change due is both extras together.
  const overpaidTarget = perCurrencyTotals
    ? pcRows.reduce(
        (s, r) => s + convertSafe(r.extra, r.currency, totalAmountCurrency),
        0,
      )
    : Math.max(0, totalPaid - effectiveTotalInTarget);
  // Payout mode: an overpaid payout is never "change" (see the `direction`
  // prop doc) — the whole Return/Change + T3 keep-change path stays off.
  const isOverpaid =
    !isPayout &&
    (perCurrencyTotals ? pcAnyExtra : overpaidTarget > matchTolerance);

  // --- Waive-remaining derivation ---
  // Shortfall in totalAmountCurrency — compared in that currency, never
  // converted (LIRA-310: the cap is $5 for a USD total and 450,000 LBP for
  // an LBP total).
  const remainingShortfall = perCurrencyTotals
    ? pcRows.reduce(
        (s, r) => s + convertSafe(r.short, r.currency, totalAmountCurrency),
        0,
      )
    : Math.max(0, effectiveTotalInTarget - totalPaid);
  // --- Payout keep-change (direction="payout", owner decision 2026-10-06) ---
  // The shortfall IS the kept amount: the shop hands out the round figure
  // and keeps the leftover as profit. Up to and including the shared core
  // cap (`isWithinShortfallMax` — the SAME predicate the server enforces;
  // $5 / 450,000 LBP since LIRA-310), in the total's own currency, and only
  // for USD/LBP totals. AUTOMATIC (owner decision 2026-10-06 — the "Keep
  // change" button is gone): any shortfall within the cap is kept, with the
  // green note below saying so.
  const payoutKeepActive =
    isPayout &&
    !!onKeptChange &&
    remainingShortfall > matchTolerance &&
    isWithinShortfallMax(remainingShortfall, totalAmountCurrency);
  const payoutKeptRounded = payoutKeepActive
    ? totalAmountCurrency === "LBP"
      ? Math.round(remainingShortfall)
      : Number(remainingShortfall.toFixed(2))
    : 0;
  // `payer` is part of the key so a payer switch WITHOUT a remount re-reports
  // (null when nothing is kept) instead of leaving the previous mode's kept
  // figure with the parent — see the payer-switch reset effect below.
  const payoutKeptKey = `${payer}|${
    payoutKeepActive
      ? `${totalAmountCurrency}:${payoutKeptRounded}:${remainingShortfall}`
      : "off"
  }`;
  useEffect(() => {
    // Not a payout consumer → the T3 effect below owns onKeptChange.
    if (!isPayout) return;
    onKeptChange?.(
      payoutKeepActive
        ? totalAmountCurrency === "LBP"
          ? {
              usd: 0,
              lbp: payoutKeptRounded,
              exactUsd: 0,
              exactLbp: remainingShortfall,
            }
          : {
              usd: payoutKeptRounded,
              lbp: 0,
              exactUsd: remainingShortfall,
              exactLbp: 0,
            }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutKeptKey]);

  // --- Payout round-up (LIRA-334, research R6) ---
  // The mirror of kept change: the shop hands out a little MORE than owed
  // (owner example: $102.90 owed, $103 handed over) and books the difference
  // as change rounding. Same cap predicate as the server, in the total's own
  // currency. Never with `payoutExcessToAccount` (there the excess is the
  // other side's debt). Not offered with `perCurrencyTotals` — the cap is a
  // single figure in the total's currency.
  const payoutRoundUpActive =
    isPayout &&
    !!onRoundUpChange &&
    !payoutExcessToAccount &&
    !perCurrencyTotals &&
    overpaidTarget > matchTolerance &&
    isWithinShortfallMax(overpaidTarget, totalAmountCurrency);
  const payoutRoundUpRounded = payoutRoundUpActive
    ? totalAmountCurrency === "LBP"
      ? Math.round(overpaidTarget)
      : Number(overpaidTarget.toFixed(2))
    : 0;
  // `payer` is in the key, and this effect reports null ITSELF whenever the
  // round-up is off — including a switch away from payout — since no other
  // effect clears it (unlike kept change, which the T3 effect also owns).
  const payoutRoundUpKey = `${payer}|${
    payoutRoundUpActive
      ? `${totalAmountCurrency}:${payoutRoundUpRounded}`
      : "off"
  }`;
  useEffect(() => {
    onRoundUpChange?.(
      payoutRoundUpActive
        ? totalAmountCurrency === "LBP"
          ? { usd: 0, lbp: payoutRoundUpRounded }
          : { usd: payoutRoundUpRounded, lbp: 0 }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutRoundUpKey]);

  // --- Customer adds change (LIRA-336, research R7) ---
  // Keyed like the round-up: `payer` is in the key and this effect reports
  // null itself whenever there is none (not a payout, section closed,
  // nothing added, over the cap — `addedTarget` is 0 in all of them).
  const addedChangeKey = `${payer}|${totalAmountCurrency}:${addedTarget}`;
  useEffect(() => {
    onAddedChange?.(
      addedTarget > 0
        ? totalAmountCurrency === "LBP"
          ? { usd: 0, lbp: addedTarget }
          : { usd: addedTarget, lbp: 0 }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addedChangeKey]);

  // --- Customer-pays round-up autofill (LIRA-334, research R7) ---
  // A small overpay on a page that allows Extra becomes the built-in line's
  // extra (owner example: $103 handed over on $102.90 → "+ Extra" 0.10), so
  // the total matches what was paid and no change box opens. Measured
  // against the total BEFORE the extra (`totalInTarget`), so the fill never
  // re-triggers itself. Only for a customer payer, never with
  // `perCurrencyTotals`, and only while no discount/extra was typed by the
  // cashier (an autofilled value may be updated or withdrawn). Clearing the
  // field or switching the line dismisses it until the lines change.
  const roundUpLinesKey = paymentLines
    .map((l) => `${l.id}:${l.currencyCode}:${l.amount}`)
    .join("|");
  // Only an amount the CASHIER typed (or a split they built) can be a
  // round-up: an untouched single line is the box's own prefill, and it
  // follows the total INCLUDING the extra — autofilling from it chases its
  // own tail (seen on an OMT send with fees included: the line sat above
  // the total, the extra raised the line, the line raised the extra, until
  // the cap withdrew it and the cycle restarted — a synchronous render loop).
  const roundUpEligible =
    extraAllowed &&
    payer === "customer" &&
    !perCurrencyTotals &&
    (isSplitMode || singleAmountTouchedRef.current);
  const roundUpSuggestion = roundUpEligible
    ? suggestRoundUpExtra({
        paidInTarget: totalPaid,
        baseTotalInTarget: totalInTarget,
        currency: totalAmountCurrency,
        cap: extraCap,
      })
    : 0;
  const prevRoundUpLinesKeyRef = useRef(roundUpLinesKey);
  useEffect(() => {
    if (prevRoundUpLinesKeyRef.current !== roundUpLinesKey) {
      prevRoundUpLinesKeyRef.current = roundUpLinesKey;
      roundUpDismissedRef.current = false;
    }
    if (!roundUpEligible) {
      // E.g. the payer switched to payout: an autofilled value must not
      // linger and turn into a discount.
      if (extraAutofilled) {
        setDiscountRaw("");
        setLineMode("discount");
        setExtraAutofilled(false);
      }
      return;
    }
    if (discountRaw !== "" && !extraAutofilled) return;
    if (roundUpDismissedRef.current) return;
    if (roundUpSuggestion > 0) {
      const fieldCurrency =
        !isSplitMode && paymentLines.length === 1
          ? paymentLines[0].currencyCode
          : discountCurrency;
      const converted = convertSafe(
        roundUpSuggestion,
        totalAmountCurrency,
        fieldCurrency,
      );
      // Same precision rule as Waive: a USD field against an LBP total
      // keeps 4 dp (one cent is ~900 LBP, far above the match tolerance).
      const inField =
        fieldCurrency === "LBP"
          ? Math.round(converted)
          : totalAmountCurrency === "LBP"
            ? Math.round(converted * 10_000) / 10_000
            : Math.round(converted * 100) / 100;
      if (fieldCurrency !== discountCurrency)
        setDiscountCurrency(fieldCurrency);
      if (showDiscount) setLineMode("extra");
      setDiscountRaw(String(inField));
      setExtraAutofilled(true);
    } else if (extraAutofilled) {
      // The overpay went away (e.g. the amount was corrected): withdraw the
      // autofilled extra rather than leave a stale one behind.
      setDiscountRaw("");
      if (showDiscount) setLineMode("discount");
      setExtraAutofilled(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundUpLinesKey, roundUpSuggestion, roundUpEligible]);

  // LIRA-310 — Waive. Rendered inside the Remaining row, so it inherits
  // every one of that row's visibility rules ("Waive follows Remaining").
  const waiveThreshold = waiveRemainingThreshold ?? 0;
  /** Round a shortfall to totalAmountCurrency's precision (LBP whole, else
   *  cents) — what the cashier sees and what a page books. */
  const roundToTarget = (v: number): number =>
    totalAmountCurrency === "LBP" ? Math.round(v) : Math.round(v * 100) / 100;
  // The cap check uses the cap's own rounding tolerance (the shared core
  // one), not the looser leg-matching tolerance — 450,001 LBP is over.
  // Owner decision 2026-10-12 — the gap Waive closes: against `waiveTotals`
  // when given (the ticked items on the Debts sheet), else the same
  // shortfall the Remaining row shows.
  const waiveTargets: Money[] = waiveTotals ?? effectiveTotals;
  const waiveShortfall = waiveTotals
    ? Math.max(0, sumInTarget(waiveTotals) - totalPaid)
    : remainingShortfall;
  // Its own "Remaining on ticked" line only when it differs from the whole
  // Remaining — everything ticked keeps the single row (no duplicate).
  const showTickedRemainingRow =
    !!waiveTotals &&
    !isPayout &&
    waiveShortfall > matchTolerance &&
    Math.abs(waiveShortfall - remainingShortfall) > matchTolerance;
  const waiveEligible =
    !waiveDisabled &&
    !isPayout &&
    waiveShortfall > matchTolerance &&
    (waiveRemainingThreshold === undefined
      ? isWithinShortfallMax(waiveShortfall, totalAmountCurrency)
      : waiveShortfall <= waiveThreshold);
  // Built-in path: no page handler → the gap goes into THIS component's own
  // discount, only where that discount is shown, lowers the total and is
  // booked by the page, and only when it still fits `maxDiscount`.
  // LIRA-319: never in extra mode — Waive writes this same field, which
  // there is the extra (it would raise the shortfall, not close it).
  const builtInWaive =
    !onWaiveRemaining &&
    !isExtraMode &&
    discountVisible &&
    discountLowersTotal &&
    !!onDiscountChange &&
    (maxDiscount === undefined ||
      clampedDiscount + waiveShortfall <= maxDiscount + matchTolerance);
  const externalWaive =
    !!onWaiveRemaining &&
    (waiveRemainingMax === undefined ||
      waiveShortfall <= waiveRemainingMax + matchTolerance);
  // LIRA-319: a page's own Waive is a discount — never with an extra.
  const showWaiveButton =
    waiveEligible &&
    !(isExtraMode && clampedExtra > 0) &&
    (externalWaive || builtInWaive);

  const handleWaive = () => {
    if (onWaiveRemaining) {
      const { remaining } = allocatePayments(
        {
          totals: waiveTargets,
          payments: paymentLines.map((l) => ({
            amount: Math.max(0, l.amount || 0),
            currency: l.currencyCode,
          })),
          rates: internalRates,
          side,
        },
        { round: false },
      );
      onWaiveRemaining(
        roundToTarget(waiveShortfall),
        remaining
          .filter((m) => m.amount > 0)
          .map((m) => ({
            currency: m.currency,
            amount:
              m.currency === "LBP"
                ? Math.round(m.amount)
                : Math.round(m.amount * 100) / 100,
          })),
      );
      return;
    }
    // Built-in: new discount = what is already applied + the gap, in the
    // discount's own currency, rounded UP so Remaining reaches 0 without
    // crossing into change (a USD discount against an LBP total keeps 4 dp —
    // one cent is ~900 LBP, far above the 100 LBP match tolerance).
    const target = convertSafe(
      clampedDiscount + waiveShortfall,
      totalAmountCurrency,
      discountCurrency,
    );
    const roundedUp =
      discountCurrency === "LBP"
        ? Math.ceil(target - 1e-9)
        : totalAmountCurrency === "LBP"
          ? Math.ceil(target * 10_000 - 1e-9) / 10_000
          : Math.ceil(target * 100 - 1e-9) / 100;
    setDiscountRaw(String(roundedUp));
  };
  // One Waive button, rendered in the Remaining row or — with `waiveTotals`
  // and a different ticked gap — in the "Remaining on ticked" line.
  const waiveButton = (
    <button
      type="button"
      data-testid="waive-remaining"
      onClick={handleWaive}
      className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors"
      title={t("waive.title")}
    >
      {t("waive.label")}
    </button>
  );
  // When the shop only has cash as a payment method, the change is obviously cash —
  // show a simple currency toggle. Any non-cash method available surfaces the full
  // method picker regardless of what the customer selected.
  // Owner 2026-10-13 — Customer Account is not a way to HAND BACK change:
  // the change box's Account button (`unreturnedChangeTo`) is the one place
  // change goes to an account, so the method list offers drawer methods only.
  const returnMethodOptions = paymentMethods.filter(
    (pm) => pm.code !== "CUSTOMER_ACCOUNT",
  );
  const isCashOnlyPayment =
    cashOnlyReturn || returnMethodOptions.every((pm) => pm.code === "CASH");
  const effectiveReturnMethod =
    isCashOnlyPayment ||
    !returnMethodOptions.some((pm) => pm.code === returnMethod)
      ? "CASH"
      : returnMethod;
  /** LIRA-308 answer 1 — change not entered as returned goes to the account. */
  const creditUnreturnedBase =
    !!unreturnedChangeTo &&
    !isPayout &&
    (unreturnedChangeTo === "ACCOUNT_BALANCE" || hasClient);
  /** Both destinations available: the cashier picks Account or Keep. */
  const canChooseKeep = creditUnreturnedBase && !!onKeptChange;
  const creditUnreturned =
    creditUnreturnedBase && !(canChooseKeep && keepUnreturned);
  /** Without an account, change left in the fields is KEPT (profit, or cost
   *  when the shop pays) — only on pages that wire `onKeptChange`. The
   *  change box's "Keep" button empties the fields for that. */
  const canKeepUnreturned = !creditUnreturned && !isPayout && !!onKeptChange;
  // LIRA-313 — which CASH return fields exist (e.g. a partner settlement
  // can only take change back in its own currency).
  const allowReturnUSD = !returnCurrencies || returnCurrencies.includes("USD");
  const allowReturnLBP = !returnCurrencies || returnCurrencies.includes("LBP");

  /** The full suggested return the auto-init effect below seeds. */
  const seedFullSuggestedReturn = (toAccount: boolean = changeToAccount) => {
    // LIRA-313 — "To account" chosen: nothing is handed back, the whole
    // change goes to the account. (LIRA-308 answer 1's empty seed is
    // replaced by owner decision 2026-10-12: "Return change" is the
    // default, so the fields start full like everywhere else.)
    if (creditUnreturned && toAccount) {
      setReturnAmountUSD("");
      setReturnAmountLBP("");
      return;
    }
    // LIRA-313 — a single allowed return currency takes the whole change.
    if (!allowReturnLBP && allowReturnUSD) {
      setReturnAmountUSD(
        convertSafe(overpaidTarget, totalAmountCurrency, "USD").toFixed(2),
      );
      setReturnAmountLBP("");
      return;
    }
    if (!allowReturnUSD && allowReturnLBP) {
      setReturnAmountUSD("");
      setReturnAmountLBP(
        String(
          Math.round(convertSafe(overpaidTarget, totalAmountCurrency, "LBP")),
        ),
      );
      return;
    }
    // LIRA-322 — perCurrencyTotals: each field starts with its own
    // currency's extra ($3 over → "$3.00"; 100,000 LBP over → LBP field).
    if (
      perCurrencyTotals &&
      pcRows.every(
        (r) => r.extra <= 0 || r.currency === "USD" || r.currency === "LBP",
      )
    ) {
      const usdExtra = pcRows.find((r) => r.currency === "USD")?.extra ?? 0;
      const lbpExtra = pcRows.find((r) => r.currency === "LBP")?.extra ?? 0;
      setReturnAmountUSD(usdExtra > 0 ? usdExtra.toFixed(2) : "");
      setReturnAmountLBP(lbpExtra > 0 ? String(Math.round(lbpExtra)) : "");
      return;
    }
    if (totalAmountCurrency === "USD") {
      if (smartSplitOverpay) {
        // Lebanon dual-currency drawer convention: hand back whole USD notes
        // and put the fractional remainder in LBP rather than a lump like
        // "$4.73" the drawer may not have coins for.
        const integerUSD = Math.floor(overpaidTarget);
        const fractionUSD = overpaidTarget - integerUSD;
        const roundedLBP = roundLBPUp(fractionUSD * effectiveRate);
        setReturnAmountUSD(integerUSD ? String(integerUSD) : "");
        setReturnAmountLBP(roundedLBP ? String(roundedLBP) : "");
      } else {
        setReturnAmountUSD(overpaidTarget.toFixed(2));
        setReturnAmountLBP("");
      }
    } else {
      setReturnAmountUSD("");
      setReturnAmountLBP(String(Math.round(overpaidTarget)));
    }
  };

  // Auto-init / reset CASH return fields whenever the overpaid amount
  // changes. The seed is the FULL change due (never a hair under it — see
  // the "untouched seeded return keeps nothing" guard in
  // MultiPaymentInput.autoKeepChange.test.tsx), so an untouched return keeps
  // nothing; the cashier lowers or clears the fields to keep some or all of
  // the change (owner decision 2026-10-06 — no "Keep change" button).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isOverpaid) {
      setReturnAmountUSD("");
      setReturnAmountLBP("");
      return;
    }
    seedFullSuggestedReturn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOverpaid,
    overpaidTarget,
    totalAmountCurrency,
    smartSplitOverpay,
    pcExtraKey,
  ]);

  // Payer switch without a remount (e.g. a form toggling customer ↔ payout,
  // or Expenses reusing the instance): an under-return typed in one mode
  // means something else in the next (customer profit vs. shop cost), so the
  // return fields go back to the full change due — nothing kept until the
  // cashier lowers them again. Together with `payer` in both kept keys this
  // makes the active mode re-report, so a stale kept never leaks. Skipped on
  // first mount and on re-renders with the same payer.
  // LIRA-318 review — empty change fields mean "kept" without an account and
  // "to the account" with one. When the account option appears or goes away
  // (a client is picked or removed), never let one silently become the
  // other: the change goes back to "hand it all back" and the cashier
  // chooses again.
  const prevCreditUnreturnedRef = useRef(creditUnreturnedBase);
  useEffect(() => {
    if (prevCreditUnreturnedRef.current === creditUnreturnedBase) return;
    prevCreditUnreturnedRef.current = creditUnreturnedBase;
    setChangeToAccount(false);
    setKeepUnreturned(false);
    if (isOverpaid) seedFullSuggestedReturn(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditUnreturnedBase]);

  const prevPayerRef = useRef(payer);
  useEffect(() => {
    if (prevPayerRef.current === payer) return;
    prevPayerRef.current = payer;
    if (!isOverpaid) {
      setReturnAmountUSD("");
      setReturnAmountLBP("");
      return;
    }
    seedFullSuggestedReturn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payer]);

  // CASH return handlers. Each field holds exactly what the operator typed
  // into IT — editing one never rewrites the other (owner note, 2026-09-24:
  // "the two change-return fields must stop overwriting each other, so
  // '40$ + 10,000 LBP' can be entered"). Before this fix, each handler
  // recomputed the OTHER field from the remaining overpay, so typing "40" in
  // USD then "10000" in LBP would silently rewrite USD back down to whatever
  // was left over — the operator's own second keystroke undid the first.
  // The auto-init effect above still seeds a sensible starting split the
  // moment an overpay appears (and re-seeds if the overpay amount changes).
  //
  // Fix-round finding #4 (2026-09-24): dropping the recompute also dropped
  // the only mechanism that kept sum(return legs) == the overpaid amount.
  // Rather than resurrect a same-keystroke auto-fill (which would silently
  // overwrite a field the operator seeded a moment earlier — exactly the
  // bug this fix removes, and exactly what the "independent" tests below
  // pin), the invariant is restored as a visible check instead:
  // `hasReturnMismatch`/`returnMismatch` (computed below, next to
  // `parsedReturnUSD`/`parsedReturnLBP`) compares the two fields' sum
  // against `overpaidTarget` and renders a warning — over or under — the
  // moment they disagree, so a bad combination is flagged rather than
  // silently accepted.
  const handleReturnUSDChange = (raw: string) => {
    setReturnAmountUSD(raw);
  };

  const handleReturnLBPChange = (raw: string) => {
    setReturnAmountLBP(raw);
  };

  // LIRA-313 — the change box's Account (or Keep) button: empties the return
  // fields, so the whole change goes to the account (or is kept). Typing or
  // the $ / LBP buttons hand it back again.
  const handleChangeToAccount = () => {
    setKeepUnreturned(false);
    setChangeToAccount(true);
    setReturnAmountUSD("");
    setReturnAmountLBP("");
  };

  // LIRA-264 (owner 2026-10-06) — "All in $" / "All in LBP": one tap puts
  // the WHOLE change due in one currency and zeroes the other field. The
  // rounding reuses the change seed's own rules above (rule 14 — no new
  // rule): USD to cents; LBP converted from a USD change rounds UP to the
  // smallest LBP note (`roundLBPUp`, the smart-split remainder rule); an
  // LBP-denominated change is already exact LBP (`Math.round`, the LBP
  // seed rule). Writes only the two fields — the OUT legs derive from them
  // exactly as for typed input.
  const handleReturnAllUSD = () => {
    const usd = convertSafe(overpaidTarget, totalAmountCurrency, "USD");
    setReturnAmountUSD(usd.toFixed(2));
    setReturnAmountLBP("0");
  };

  const handleReturnAllLBP = () => {
    const lbp =
      totalAmountCurrency === "LBP"
        ? Math.round(overpaidTarget)
        : roundLBPUp(convertSafe(overpaidTarget, totalAmountCurrency, "LBP"));
    setReturnAmountUSD("0");
    setReturnAmountLBP(String(lbp));
  };

  /** Convert a value from totalAmountCurrency into an arbitrary currency. */
  const convertFromTarget = (v: number, toCurrency: string): number =>
    convertSafe(v, totalAmountCurrency, toCurrency);

  const rawReturnAmount = convertFromTarget(overpaidTarget, returnCurrency);
  const returnAmount =
    returnCurrency === "LBP"
      ? Math.round(rawReturnAmount)
      : Number(rawReturnAmount.toFixed(2));

  // The "Change due" row shows USD and LBP; any other return currency
  // still needs its own figure next to the currency picker.
  const returnCurrencyInChangeDue =
    returnCurrency === "USD" || returnCurrency === "LBP";

  // CUSTOMER_ACCOUNT return requires a client (it becomes store credit).
  const returnNeedsClient =
    effectiveReturnMethod === "CUSTOMER_ACCOUNT" && !hasClient;

  const parsedReturnUSD = parseNum(returnAmountUSD);
  const parsedReturnLBP = parseNum(returnAmountLBP);

  // Fix-round finding #4 (2026-09-24): the two return fields are fully
  // independent (handlers above never rewrite one from the other), so
  // nothing upstream guarantees sum(return legs) == overpaidTarget once the
  // operator edits either field away from its auto-seeded value. Flag —
  // rather than silently allow — a return that doesn't add up, converting
  // both fields into totalAmountCurrency so an LBP-denominated job (e.g.
  // Whish/iPick) is compared correctly too.
  const returnTotalInTargetCurrency = isOverpaid
    ? convertSafe(parsedReturnUSD, "USD", totalAmountCurrency) +
      convertSafe(parsedReturnLBP, "LBP", totalAmountCurrency)
    : 0;
  const returnMismatch =
    effectiveReturnMethod === "CASH" && isOverpaid
      ? returnTotalInTargetCurrency - overpaidTarget
      : 0;
  // LIRA-264 — an over-return that the change rounding rules themselves
  // produce is not a mismatch: an LBP field holding a whole number of the
  // smallest note (`roundLBPUp`, as the smart-split seed and "All in LBP"
  // write it) may exceed the exact change by less than one note, and a
  // cents-rounded USD figure by half a cent. Without this, the smart-split
  // seed ($4 + 70,000 LBP for $4.73) and the one-tap autofill buttons
  // immediately flagged their own output. An UNDER-return is always
  // flagged, and anything past these bounds is still a real over-return.
  const lbpNoteRounded =
    parsedReturnLBP > 0 && roundLBPUp(parsedReturnLBP) === parsedReturnLBP;
  const roundingOverAllowance =
    (lbpNoteRounded ? convertSafe(5000, "LBP", totalAmountCurrency) : 0) +
    (parsedReturnUSD > 0 ? convertSafe(0.005, "USD", totalAmountCurrency) : 0);
  const hasReturnMismatch =
    returnMismatch > 0
      ? returnMismatch > matchTolerance + roundingOverAllowance
      : // LIRA-308 answer 1: an under-return is account credit, not a gap.
        !creditUnreturned && -returnMismatch > matchTolerance;
  // LIRA-308 answer 1 — what the cashier did not enter as returned, in the
  // change currency (the tender's under `returnCurrencyFollowsTender`).
  const unreturnedTarget =
    creditUnreturned && isOverpaid && effectiveReturnMethod === "CASH"
      ? Math.max(0, overpaidTarget - returnTotalInTargetCurrency)
      : 0;
  const unreturnedCreditAmount =
    unreturnedTarget > matchTolerance
      ? returnCurrency === "LBP"
        ? Math.round(convertFromTarget(unreturnedTarget, "LBP"))
        : Number(convertFromTarget(unreturnedTarget, returnCurrency).toFixed(2))
      : 0;

  // Kept change is AUTOMATIC (LIRA-259 generalised — owner decision
  // 2026-10-06, "Remove the Keep change button. Always show 'Keeping X as
  // profit' when the returned amount does not match the change due."): a
  // CASH return that covers LESS than the change due keeps the rest as
  // profit. The OUT legs stay exactly what was typed (lowering or clearing
  // the fields is how the cashier keeps some or all of it); the shortfall is
  // reported as kept change (computed with the keep math below), and the
  // red "not covered" warning gives way to the "Keeping … as profit"
  // summary. An OVER-return is still a mistake and still flagged. Gated on
  // `onKeptChange`: a consumer whose backend cannot book kept change does
  // not wire it, and keeps the red warning.
  const underReturnKept =
    !creditUnreturned &&
    !!onKeptChange &&
    effectiveReturnMethod === "CASH" &&
    isOverpaid &&
    hasReturnMismatch &&
    returnMismatch < 0;
  const keepActive = underReturnKept;

  // Production testing 2026-10-07: the "Paid" figure is red (with a warning
  // icon) only for a REAL problem — never merely because change is due or
  // kept, which are normal states the cashier should not read as an error.
  // A problem is: underpaid with nothing kept, a payout handing out more
  // than owed, or a CASH change return that does not add up (over-return,
  // or an under-return this page cannot keep).
  const paidExact = perCurrencyTotals
    ? !pcAnyShort && !pcAnyExtra
    : Math.abs(totalPaid - effectiveTotalInTarget) < matchTolerance;
  const paidHasProblem =
    !paidExact &&
    (((perCurrencyTotals ? pcAnyShort : remainingShortfall > matchTolerance) &&
      !payoutKeepActive) ||
      (isPayout &&
        overpaidTarget > matchTolerance &&
        !payoutExcessToAccount &&
        !payoutRoundUpActive) ||
      (effectiveReturnMethod === "CASH" &&
        hasReturnMismatch &&
        !underReturnKept) ||
      (isOverpaid && returnNeedsClient));

  // Array of shop→customer change legs (up to 2 for CASH, 0-1 for non-CASH).
  const suggestedReturnLegs: PaymentLine[] = (() => {
    if (!isOverpaid) return [];
    if (effectiveReturnMethod === "CASH") {
      const legs: PaymentLine[] = [];
      if (parsedReturnUSD > 0) {
        legs.push({
          id: `${returnLegIdRef.current}_usd`,
          method: "CASH",
          currencyCode: "USD",
          amount: parsedReturnUSD,
          direction: "OUT",
        });
      }
      if (parsedReturnLBP > 0) {
        legs.push({
          id: `${returnLegIdRef.current}_lbp`,
          method: "CASH",
          currencyCode: "LBP",
          amount: parsedReturnLBP,
          direction: "OUT",
        });
      }
      // LIRA-308 answer 1 — the change NOT entered as returned is credited.
      // LIRA-313 — "ACCOUNT_BALANCE" emits no leg: the server books the net,
      // so the unreturned change stays on the balance by itself.
      if (
        creditUnreturned &&
        unreturnedChangeTo === "CUSTOMER_ACCOUNT" &&
        unreturnedCreditAmount > 0
      ) {
        legs.push({
          id: `${returnLegIdRef.current}_credit`,
          method: unreturnedChangeTo!,
          currencyCode: returnCurrency,
          amount: unreturnedCreditAmount,
          direction: "OUT",
        });
      }
      return legs;
    }
    // Non-CASH: single derived leg
    if (returnAmount > 0 && !returnNeedsClient) {
      return [
        {
          id: returnLegIdRef.current,
          method: effectiveReturnMethod,
          currencyCode: returnCurrency,
          amount: returnAmount,
          direction: "OUT",
        },
      ];
    }
    return [];
  })();

  // Report the kept split in the TENDER currency — the engine's change
  // output (excess per currency the customer actually handed over), NOT the
  // return-field suggestion. The suggestion is denominated for returning
  // (e.g. a USD figure against an LBP tender); keeping is physical: the
  // drawer holds the excess tender itself, and cross-denominated kept
  // amounts corrupt per-currency netting downstream (caught by lira-107's
  // failing-first run: a kept 100,000 LBP reported as $1.12 became a phantom
  // client credit).
  //
  // LIRA-084 (owner decision 2026-10-02) — this is now the FULL available
  // change per currency, a ceiling the operator can partially return
  // against (below), not automatically the whole kept amount.
  const {
    keptUsd: fullKeptUsd,
    keptLbp: fullKeptLbp,
    keptUsdExact: fullKeptUsdExact,
    keptLbpExact: fullKeptLbpExact,
  } = (() => {
    if (!keepActive)
      return { keptUsd: 0, keptLbp: 0, keptUsdExact: 0, keptLbpExact: 0 };
    const allocationInput = {
      totals: effectiveTotals,
      payments: paymentLines.map((l) => ({
        amount: Math.max(0, l.amount || 0),
        currency: l.currencyCode,
      })),
      rates: internalRates,
      side,
    };
    const { change } = allocatePayments(allocationInput);
    // Exact (unrounded) companion — a consumer doing further cross-currency
    // ARITHMETIC with the kept amount (e.g. debt-reduction netting) must
    // use this, never the currency-rounded `keptUsd`/`keptLbp` below:
    // rounding kept change to USD cents before converting the LBP
    // remainder at the day's rate manufactures a several-hundred-LBP
    // residual (owner note #8, 2026-09-23). See the `onKeptChange` prop
    // doc above for which consumers want which.
    const { change: exactChange } = allocatePayments(allocationInput, {
      round: false,
    });
    return {
      keptUsd: change.find((m) => m.currency === "USD")?.amount ?? 0,
      keptLbp: change.find((m) => m.currency === "LBP")?.amount ?? 0,
      keptUsdExact: exactChange.find((m) => m.currency === "USD")?.amount ?? 0,
      keptLbpExact: exactChange.find((m) => m.currency === "LBP")?.amount ?? 0,
    };
  })();

  // LIRA-084 (owner decision 2026-10-02) — keeping is PARTIAL, per
  // currency: the two CASH return fields are what the operator actually
  // hands back; whatever is left of the change is kept. Keeping only ever
  // applies to a CASH return — a non-CASH return method (OMT,
  // CUSTOMER_ACCOUNT, …) posts its FULL leg to that method/account, so
  // there is nothing left to "keep" there.
  //
  // LIRA-259 — the ceiling is the WHOLE change expressed in the field's
  // currency, not just the change tendered in that currency: a customer who
  // paid $6 for a 450,000 LBP card is owed 30,000 LBP of change although the
  // drawer received no LBP. The old per-currency clamp (`min(typed,
  // fullKeptLbp)` = 0) silently dropped the cashier's 10,000 LBP OUT leg,
  // so the drawer never recorded the cash that left it.
  const wholeChangeUsdExact =
    fullKeptUsdExact + convertSafe(fullKeptLbpExact, "LBP", "USD");
  const maxReturnUSD = Math.max(
    fullKeptUsd,
    Number(wholeChangeUsdExact.toFixed(2)),
  );
  const keepChangeReturnUSD = keepActive
    ? Math.min(Math.max(0, parsedReturnUSD), maxReturnUSD)
    : 0;
  // The ceiling is JOINT: the LBP field may only return what is left of the
  // whole change after the USD field's return, so the two fields together
  // can never hand back more than the customer overpaid (LIRA-084's "a typo
  // can never return more than the drawer received").
  const maxReturnLBP = Math.max(
    keepChangeReturnUSD <= fullKeptUsd ? fullKeptLbp : 0,
    Math.round(
      convertSafe(
        Math.max(0, wholeChangeUsdExact - keepChangeReturnUSD),
        "USD",
        "LBP",
      ),
    ),
  );
  const keepChangeReturnLBP = keepActive
    ? Math.min(Math.max(0, parsedReturnLBP), maxReturnLBP)
    : 0;
  // True while the whole change is kept — both return fields empty/zero.
  // Its label ("Change kept (profit)") is the pre-LIRA-084 all-or-nothing
  // copy, which lira-107's debt-repayment e2e asserts.
  const isFullKeepChange =
    keepActive && keepChangeReturnUSD <= 0.005 && keepChangeReturnLBP <= 1;
  // The OUT legs are exactly what the two fields hold: an under-return (the
  // only state that keeps change) is below the change due by definition, so
  // no clamp is needed, and an over-return is flagged, never kept.
  const returnLegsValue: PaymentLine[] = suggestedReturnLegs;

  // Emit return legs whenever they change.
  const returnLegsKey = returnLegsValue
    .map((l) => `${l.method}:${l.currencyCode}:${l.amount}`)
    .join("|");
  useEffect(() => {
    onReturnChange?.(returnLegsValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnLegsKey]);

  // The kept amount reported to the parent — the full per-currency change
  // MINUS whatever was actually (and validly) returned above. Each currency
  // reduces independently, so returning all the LBP while keeping all the
  // USD (or any other split) works exactly as typed.
  //
  // LIRA-259 — a return in the OTHER currency (10,000 LBP handed back from a
  // dollar tender) is no longer dropped: whatever a field returns beyond the
  // change tendered in its own currency is converted and taken off the other
  // currency's kept amount. Kept change stays in the TENDER currency (see the
  // lira-107 note above): $6 for 450,000 LBP, 10,000 LBP returned → kept
  // $0.25, not 20,000 LBP. Same-currency returns keep the exact pre-LIRA-259
  // arithmetic and rounding.
  const crossReturnUsd = keepActive
    ? Math.max(0, keepChangeReturnUSD - fullKeptUsdExact) +
      convertSafe(
        Math.max(0, keepChangeReturnLBP - fullKeptLbpExact),
        "LBP",
        "USD",
      )
    : 0;
  const keptUsdExactSame = Math.max(
    0,
    fullKeptUsdExact - Math.min(keepChangeReturnUSD, fullKeptUsdExact),
  );
  const keptLbpExactSame = Math.max(
    0,
    fullKeptLbpExact - Math.min(keepChangeReturnLBP, fullKeptLbpExact),
  );
  const crossFromUsd = Math.min(keptUsdExactSame, crossReturnUsd);
  const keptUsdExact = keepActive ? keptUsdExactSame - crossFromUsd : 0;
  const keptLbpExact = keepActive
    ? Math.max(
        0,
        keptLbpExactSame -
          convertSafe(crossReturnUsd - crossFromUsd, "USD", "LBP"),
      )
    : 0;
  // Half a cent: below that it is float dust from the cents rounding.
  const hasCrossReturn = crossReturnUsd > 0.005;
  const keptUsd = !keepActive
    ? 0
    : hasCrossReturn
      ? Math.max(0, Number(keptUsdExact.toFixed(2)))
      : Math.max(0, Number((fullKeptUsd - keepChangeReturnUSD).toFixed(2)));
  const keptLbp = !keepActive
    ? 0
    : hasCrossReturn
      ? Math.max(0, Math.round(keptLbpExact))
      : Math.max(0, Math.round(fullKeptLbp - keepChangeReturnLBP));
  // `payer` in the key: see payoutKeptKey above.
  const keptKey = `${payer}|${
    keepActive ? `${keptUsd}:${keptLbp}:${keptUsdExact}:${keptLbpExact}` : "off"
  }`;
  useEffect(() => {
    // Payout mode reports through the payout keep-change effect above.
    if (isPayout) return;
    onKeptChange?.(
      keepActive
        ? {
            usd: keptUsd,
            lbp: keptLbp,
            exactUsd: keptUsdExact,
            exactLbp: keptLbpExact,
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptKey]);

  // Summary formatting helpers — in single mode, display in the line's currency
  const displayCurrency =
    !isSplitMode && paymentLines.length === 1
      ? paymentLines[0].currencyCode
      : totalAmountCurrency;
  const targetSymbol = getSymbol(displayCurrency);
  const targetDecimals = displayCurrency === "LBP" ? 0 : 2;

  /** Convert a value from totalAmountCurrency to displayCurrency for summary */
  const toDisplayCurrency = (v: number): number =>
    convertSafe(v, totalAmountCurrency, displayCurrency);

  /** Format an absolute amount with a currency symbol. Thousands grouping
   *  comes from the shared `formatWithCommas` (packages/ui utils/number.ts —
   *  locale-independent, unlike toLocaleString). Prefix symbols ($, €, £)
   *  go before the number, others (LBP) go after. */
  const fmtWithSymbol = (v: number, symbol: string, decimals: number) => {
    const formatted = formatWithCommas(Math.abs(v).toFixed(decimals));
    if (["$", "€", "£"].includes(symbol)) {
      return `${symbol}${formatted}`;
    }
    return `${formatted} ${symbol}`;
  };

  const fmtTarget = (v: number) =>
    fmtWithSymbol(v, targetSymbol, targetDecimals);

  /** LIRA-264 (owner 2026-10-06) — an amount in totalAmountCurrency shown in
   *  BOTH currencies, USD first then the LBP equivalent at the form's
   *  effective rate, e.g. "$4.00 | 360,000 LBP" — regardless of the bill's
   *  own currency. Separate spans so each figure stays individually
   *  findable. Display-only: no note rounding (that belongs to the change
   *  fields, not to an equivalent shown for reference). */
  /** One amount (in totalAmountCurrency) as its USD and LBP figures — the
   *  LIRA-264 "$4.00 | 360,000 LBP" convention, shared by the dual-amount
   *  rows and the green kept-change notes (rule 14). */
  const dualAmountParts = (vTarget: number): [string, string] => [
    fmtWithSymbol(convertSafe(vTarget, totalAmountCurrency, "USD"), "$", 2),
    fmtWithSymbol(
      Math.round(convertSafe(vTarget, totalAmountCurrency, "LBP")),
      "LBP",
      0,
    ),
  ];
  const dualAmountText = (vTarget: number): string =>
    dualAmountParts(vTarget).join(" | ");
  const renderDualAmount = (vTarget: number) => {
    const [usdText, lbpText] = dualAmountParts(vTarget);
    return (
      <>
        <span>{usdText}</span>
        <span className="opacity-60">|</span>
        <span>{lbpText}</span>
      </>
    );
  };
  /** LIRA-322 — perCurrencyTotals: amounts each in their own currency,
   *  joined " · " ("$197.00 · 900,000 LBP"). */
  const pcText = (items: Array<{ amount: number; currency: string }>) =>
    items
      .map(({ amount, currency: c }) =>
        fmtWithSymbol(
          amount,
          c === "USD"
            ? "$"
            : (currencies.find((x) => x.code === c)?.symbol ?? c),
          c === "LBP" ? 0 : 2,
        ),
      )
      .join(" · ");
  // The kept change (payment mode) as ONE amount in totalAmountCurrency,
  // from the unrounded per-currency figures, for the green note.
  const keptTotalTarget =
    convertSafe(keptUsdExact, "USD", totalAmountCurrency) +
    convertSafe(keptLbpExact, "LBP", totalAmountCurrency);

  const toggleSplitMode = () => {
    if (isSplitMode) {
      // Switching to single: reset to one line with full amount (re-enable
      // auto-sync) and fully reset the auto-debt machinery — a fresh start.
      singleAmountTouchedRef.current = false;
      autoDebtLineIdRef.current = null;
      autoDebtDismissedRef.current = false;
      const singleLine: PaymentLine[] = [
        {
          id: crypto.randomUUID(),
          method: paymentLines[0]?.method || "CASH",
          currencyCode: paymentLines[0]?.currencyCode || currency,
          // Transient — the single-mode auto-sync effect immediately
          // re-derives this via prefillAmountFor.
          amount: effectiveTotalInTarget,
        },
      ];
      setPaymentLines(singleLine);
      onChange(singleLine);
    }
    // Operator owns the split state from here — the auto-reveal must not
    // fold it back.
    autoRevealedRef.current = false;
    setIsSplitMode(!isSplitMode);
  };

  // LIRA-321 payout layout: "Customer pays" (IN) above "Shop pays" (OUT).
  // LIRA-336: a closed optional section counts as no section at all.
  const payoutCounterFlow = isPayout && cfActive;

  // Every reason this sheet needs a client, shown together at the bottom.
  // Same conditions the three separate messages used before.
  const visibleLines = isSplitMode ? paymentLines : paymentLines.slice(0, 1);
  const clientNeededReasons: string[] = [];
  if (hasDebt && requiresClientForDebt && !hasClient && totalInTarget > 0) {
    clientNeededReasons.push(t("client.debtRequired"));
  }
  if (isOverpaid && returnNeedsClient) {
    clientNeededReasons.push(t("client.forStoreCredit"));
  }
  if (
    fetchClientVouchers &&
    !clientId &&
    visibleLines.some((l) => l.method === "GIFT_CARD")
  ) {
    clientNeededReasons.push(t("client.forVoucher"));
  }

  const fmtCf = (n: number) =>
    `${formatWithCommas(String(cfCurrency === "LBP" ? Math.round(n) : Math.round(n * 100) / 100))} ${cfCurrency}`;
  // LIRA-336 — a closed optional section: just a link where it would sit.
  const addCustomerChangeLink =
    counterFlow && cfOptional && !cfOpen ? (
      <div
        className={`${isPayout ? "border-b" : "border-t"} border-slate-700/40 px-4 py-2`}
      >
        <button
          type="button"
          data-testid="counter-flow-add-change"
          onClick={() => setCfOpen(true)}
          className="text-xs font-medium text-emerald-300 hover:text-emerald-200 transition-colors"
        >
          {t("counterFlow.addCustomerChange")}
        </button>
      </div>
    ) : null;
  const counterFlowSection =
    counterFlow && cfActive ? (
      <div
        data-testid="counter-flow-section"
        className={`${
          payoutCounterFlow ? "border-b" : "border-t"
        } border-slate-700/40 px-4 py-3 space-y-2`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-200 tracking-wide">
            {cfOptional
              ? t("counterFlow.customerGivesChange")
              : payoutCounterFlow
                ? counterFlow.lockCurrency
                  ? t("counterFlow.customerPaysCurrency", {
                      currency: cfCurrency,
                    })
                  : t("counterFlow.customerPays")
                : counterFlow.label}
          </span>
          <span
            data-testid="direction-chip-customer-pays"
            className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-700/30 text-emerald-300 border border-emerald-600/40"
          >
            {payoutCounterFlow
              ? t("header.chipIn")
              : t("counterFlow.customerPays")}
          </span>
          <div className="flex-1" />
          <SplitToggle
            active={cf.isSplit}
            onClick={cf.toggleSplit}
            testId="counter-flow-split-toggle"
          />
          {cfOptional && (
            <button
              type="button"
              data-testid="counter-flow-remove-change"
              onClick={() => setCfOpen(false)}
              title={t("counterFlow.removeCustomerChange")}
              aria-label={t("counterFlow.removeCustomerChange")}
              className="flex-shrink-0 px-0.5 py-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* One list for both modes — line 1 keeps its key and position when
          single flips to split, so its input keeps focus mid-typing. */}
        {cf.lines.map((line) => (
          <PaymentLineRow
            key={line.id}
            rowTestId={`counter-flow-line-${line.id}`}
            testIdPrefix="counter-flow"
            lineId={line.id}
            method={line.method}
            currencyCode={line.currencyCode}
            amount={line.amount}
            methods={counterFlowMethods}
            currencies={counterFlow.currencies ?? currencies}
            symbol={
              counterFlow.currencies?.find((c) => c.code === line.currencyCode)
                ?.symbol ?? getSymbol(line.currencyCode)
            }
            size={cf.isSplit ? "compact" : "large"}
            accent="emerald"
            currencyLocked={!!counterFlow.lockCurrency}
            onMethodChange={(v) => cf.updateLine(line.id, "method", v)}
            onCurrencyChange={(v) => cf.updateLine(line.id, "currencyCode", v)}
            onAmountChange={(n) => cf.updateLine(line.id, "amount", n)}
            {...(cf.isSplit
              ? {
                  onRemove: () => cf.removeLine(line.id),
                  removeDisabled: cf.lines.length === 1,
                }
              : {})}
          />
        ))}

        {cf.isSplit && (
          <button
            type="button"
            data-testid="counter-flow-add-split"
            onClick={cf.addLine}
            className="w-full py-1.5 border-2 border-dashed border-slate-700 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-all"
          >
            {t("lines.addLine")}
          </button>
        )}

        {cf.state.unaccounted > 0 && (
          <div
            data-testid="counter-flow-unaccounted"
            className="text-xs text-amber-300"
          >
            {t("counterFlow.stillToSettle")}{" "}
            <Ltr>{fmtCf(cf.state.unaccounted)}</Ltr>
            {/* No account offered (no client): say how to settle it — the
              section never fills the gap with cash by itself (US1.3). */}
            {!cf.accountOffered &&
              counterFlowAccountPossible &&
              t(
                cf.canForgive
                  ? "counterFlow.pickClientOrForgive"
                  : cf.isSplit
                    ? "counterFlow.pickClientOrAddLine"
                    : "counterFlow.pickClient",
              )}
          </div>
        )}

        {cf.canForgive && (
          <button
            type="button"
            data-testid="counter-flow-forgive"
            onClick={cf.toggleForgive}
            className={`w-full py-1.5 rounded-xl text-xs font-medium border transition-all ${
              cf.forgiveOn
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                : "bg-slate-800 text-slate-300 border-slate-600 hover:text-slate-100 hover:border-slate-500"
            }`}
          >
            {cf.forgiveOn
              ? t("counterFlow.forgivenUndo", {
                  amount: fmtCf(cf.state.forgiven),
                })
              : t("counterFlow.forgive", { amount: fmtCf(cf.shortfall) })}
          </button>
        )}

        {cf.state.overpaid && (
          <div
            data-testid="counter-flow-overpaid"
            className="text-xs text-red-400"
          >
            {cf.addedOverCap
              ? t("counterFlow.addedChangeOverCap")
              : t("counterFlow.overpaid")}
          </div>
        )}
      </div>
    ) : null;

  return (
    <div
      data-testid="multi-payment-input"
      className="bg-slate-900/50 border border-slate-700/50 rounded-2xl overflow-hidden"
    >
      {/* LIRA-321: on payout screens "Customer pays" (IN) comes first. */}
      {payoutCounterFlow && counterFlowSection}
      {isPayout && addCustomerChangeLink}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/40">
        <span className="text-sm font-semibold text-slate-200 tracking-wide shrink-0">
          {/* Split state is shown on the Split toggle alone ("Split
              Active") — the title no longer repeats it. */}
          {payoutCounterFlow ? t("header.shopPays") : label || t("title")}
        </span>
        {/* Direction chip — only when a counter-flow section is active
            (owner decision #10 area, BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4
            Phase C): absent counterFlow, nothing renders here — identical to
            today. */}
        {cfActive && (
          <span
            data-testid="direction-chip-you-pay"
            className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 border border-slate-600"
          >
            {payoutCounterFlow ? t("header.chipOut") : t("header.youPay")}
          </span>
        )}

        {/* Exchange Rate — centred between title and Split button */}
        <div className="flex flex-1 items-center justify-center gap-1.5">
          <span className="text-xs text-slate-500">1 USD =</span>
          <input
            data-testid="payment-exchange-rate"
            type="text"
            inputMode="decimal"
            value={fmtNum(customExchangeRate)}
            onChange={(e) => {
              rateTouchedRef.current = true;
              const raw = e.target.value.replace(/,/g, "");
              setCustomExchangeRate(raw);
              const newRate = parseFloat(raw) || safeExchangeRate;
              onRateChange?.(newRate);
              onExchangeRateChange?.(newRate);
            }}
            className="w-24 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-white font-mono text-xs text-center focus:outline-none focus:border-violet-500 transition-colors"
            placeholder={fmtNum(safeExchangeRate)}
          />
          <span className="text-xs text-slate-500">LBP</span>
        </div>

        {allowSplit && (
          <SplitToggle
            active={isSplitMode}
            onClick={toggleSplitMode}
            testId="split-toggle"
          />
        )}
      </div>

      {/* Tender-rate sanity warning — non-blocking, never disables anything
          below (LIRA-240). */}
      {tenderRateWarning && (
        <div
          data-testid="tender-rate-warning"
          className={`px-4 py-1.5 text-[11px] border-b border-slate-700/40 ${
            tenderRateWarning.isTypoLevel
              ? "bg-red-500/10 text-red-300"
              : "bg-amber-500/10 text-amber-300"
          }`}
        >
          <Trans
            t={t}
            i18nKey={
              tenderRateWarning.isTypoLevel
                ? "rateWarning.awayTypo"
                : "rateWarning.away"
            }
            values={{
              pct: tenderRateWarning.pct,
              rate: tenderRateWarning.rate,
            }}
            components={LTR_SLOT}
          />
        </div>
      )}

      {/* Payment Lines */}
      <div className="px-4 py-3 space-y-2">
        {isSplitMode ? (
          <>
            {paymentLines.map((line, idx) => (
              <div
                key={line.id}
                data-testid={`payment-line-${line.id}`}
                className="bg-slate-800/60 border border-slate-700/40 rounded-xl overflow-hidden flex"
              >
                {/* Row-number rail — a slim strip fused to the card's left
                    edge, spanning its full height (incl. voucher/PM-fee
                    sub-rows), instead of a floating circle badge. */}
                <div className="flex-shrink-0 w-6 bg-slate-700 text-slate-300 text-[10px] font-bold flex items-center justify-center">
                  {idx + 1}
                </div>

                <div className="flex-1 min-w-0 p-3 space-y-2">
                  <PaymentLineRow
                    testIdPrefix="payment"
                    lineId={line.id}
                    method={line.method}
                    currencyCode={line.currencyCode}
                    amount={line.amount}
                    methods={paymentMethods}
                    currencies={currencies}
                    symbol={getSymbol(line.currencyCode)}
                    size="compact"
                    accent="violet"
                    onMethodChange={(v) =>
                      updatePaymentLine(line.id, "method", v)
                    }
                    onCurrencyChange={(v) =>
                      updatePaymentLine(line.id, "currencyCode", v)
                    }
                    onAmountChange={(n) =>
                      updatePaymentLine(line.id, "amount", n)
                    }
                    onRemove={() => removePaymentLine(line.id)}
                    removeDisabled={paymentLines.length === 1}
                  />

                  {/* Voucher picker (GIFT_CARD) */}
                  {fetchClientVouchers &&
                    !!clientId &&
                    line.method === "GIFT_CARD" && (
                      <div className="ps-3 border-s-2 border-orange-500/30">
                        {renderVoucherSelector(line)}
                      </div>
                    )}

                  {/* PM Fee sub-line */}
                  {showPmFee && !CASH_EQUIVALENT_METHODS.has(line.method) && (
                    <div className="flex items-center gap-2 ps-3 border-s-2 border-violet-500/30">
                      <span className="text-[11px] text-violet-400 whitespace-nowrap">
                        {t("lines.pmFee")}
                      </span>
                      <div className="relative w-24">
                        <span className="absolute start-2 top-1/2 -translate-y-1/2 text-violet-400 text-[10px]">
                          $
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={
                            pmFeeOverrides[line.id] ??
                            (line.amount * pmFeeRate).toFixed(2)
                          }
                          onChange={(e) => {
                            // LIRA-331: a text field (accepts ١٢٣ digits);
                            // only what a number field would have taken
                            // ("", "1", "1.", "1.25") is stored.
                            const raw = normalizeDigits(e.target.value);
                            if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
                            const newOverrides = { ...pmFeeOverrides };
                            newOverrides[line.id] = raw;
                            setPmFeeOverrides(newOverrides);
                          }}
                          className="w-full bg-violet-950/40 border border-violet-700/40 rounded-md ps-5 pe-2 py-1 text-violet-200 text-xs font-mono focus:outline-none focus:border-violet-500"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Add payment line button */}
            <button
              type="button"
              data-testid="add-payment-line"
              onClick={addPaymentLine}
              className="w-full py-2 border-2 border-dashed border-slate-700 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-all"
            >
              {t("lines.addLine")}
            </button>
          </>
        ) : (
          /* Single payment mode */
          <div
            data-testid={`payment-line-${paymentLines[0]?.id}`}
            className="space-y-2"
          >
            <PaymentLineRow
              testIdPrefix="payment"
              lineId={paymentLines[0]?.id}
              method={paymentLines[0]?.method || "CASH"}
              currencyCode={paymentLines[0]?.currencyCode || currency}
              amount={paymentLines[0]?.amount ?? 0}
              methods={paymentMethods}
              currencies={currencies}
              symbol={getSymbol(paymentLines[0]?.currencyCode || currency)}
              size="large"
              accent="violet"
              onMethodChange={(v) =>
                updatePaymentLine(paymentLines[0]?.id, "method", v)
              }
              onCurrencyChange={(v) =>
                updatePaymentLine(paymentLines[0]?.id, "currencyCode", v)
              }
              onAmountChange={(n) =>
                updatePaymentLine(paymentLines[0]?.id, "amount", n)
              }
            />

            {/* Voucher picker (GIFT_CARD) */}
            {fetchClientVouchers &&
              !!clientId &&
              paymentLines[0]?.method === "GIFT_CARD" &&
              paymentLines[0] && (
                <div>{renderVoucherSelector(paymentLines[0])}</div>
              )}
          </div>
        )}
      </div>

      {/* Counter-flow (opposite-direction) section — OPT-IN, owner decision
          #2: ONE card, a direction per line, never a second form. Below the
          main lines everywhere except payout screens (rendered above). */}
      {!payoutCounterFlow && counterFlowSection}
      {!isPayout && addCustomerChangeLink}

      {/* Summary */}
      <div
        data-testid="payment-summary"
        className="px-4 py-3 bg-slate-800/30 border-t border-slate-700/40 space-y-1.5"
      >
        {/* Provider fee breakdown */}
        {providerFee > 0 && (
          <>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">{t("summary.sendAmount")}</span>
              <span className="font-mono text-white">
                {fmtTarget(toDisplayCurrency(totalInTarget - providerFee))}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-amber-400">{t("summary.providerFee")}</span>
              <span className="font-mono text-amber-300">
                +{fmtTarget(toDisplayCurrency(providerFee))}
              </span>
            </div>
            <div className="flex justify-between text-xs pt-1 border-t border-slate-700/30">
              <span className="text-slate-300 font-medium">
                {t("summary.subtotal")}
              </span>
              <span className="font-mono text-slate-200 font-medium">
                {fmtTarget(toDisplayCurrency(totalInTarget))}
              </span>
            </div>
          </>
        )}
        {providerFee === 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">{t("summary.totalAmount")}</span>
            <span className="font-mono text-white">
              {perCurrencyTotals
                ? pcText(
                    pcRows.map((r) => ({
                      amount: r.total,
                      currency: r.currency,
                    })),
                  )
                : fmtTarget(
                    toDisplayCurrency(
                      totalBeforeDiscount
                        ? sumInTarget(totalBeforeDiscount)
                        : totalInTarget,
                    ),
                  )}
            </span>
          </div>
        )}

        {/* LIRA-336 — the customer added change: what the shop now pays. */}
        {addedTarget > 0 && (
          <div
            data-testid="payout-added-change-summary"
            className="text-xs text-emerald-300"
          >
            <Trans
              t={t}
              i18nKey="summary.owedPlusAddedChange"
              values={{
                owed: fmtTarget(toDisplayCurrency(totalInTarget)),
                added: fmtTarget(toDisplayCurrency(addedTarget)),
                total: fmtTarget(toDisplayCurrency(effectiveTotalInTarget)),
              }}
              components={LTR_SLOT}
            />
          </div>
        )}

        {/* LIRA-318 — the page's own Discount / Forgive line, then what is
            left after it. */}
        {discountRow}
        {discountRow &&
          totalBeforeDiscount &&
          sumInTarget(totalBeforeDiscount) - totalInTarget > matchTolerance && (
            <div
              data-testid="after-page-discount"
              className="flex justify-between text-xs pt-1 border-t border-emerald-700/20"
            >
              <span className="text-emerald-300 font-medium">
                {afterDiscountLabel}
              </span>
              <span className="font-mono text-emerald-200 font-medium">
                {fmtTarget(toDisplayCurrency(totalInTarget))}
              </span>
            </div>
          )}
        {/* LIRA-319 — the page's line added an extra: `totals` are above
            the total before it. */}
        {discountRow &&
          totalBeforeDiscount &&
          totalInTarget - sumInTarget(totalBeforeDiscount) > matchTolerance && (
            <div
              data-testid="after-page-extra"
              className="flex justify-between text-xs pt-1 border-t border-amber-700/20"
            >
              <span className="text-amber-300 font-medium">
                {t("summary.afterExtra")}
              </span>
              <span className="font-mono text-amber-200 font-medium">
                {fmtTarget(toDisplayCurrency(totalInTarget))}
              </span>
            </div>
          )}

        {/* Discount — the shared DiscountLine (LIRA-318), so this line
            looks the same as the pages' own discount rows. */}
        {lineVisible && !discountRow && (
          <DiscountLine
            label={isExtraMode ? t("summary.extra") : t("summary.discount")}
            {...(extraAllowed && showDiscount
              ? {
                  allowExtra: true,
                  mode: lineMode,
                  onModeChange: handleLineModeChange,
                }
              : {})}
            hint={
              isExtraMode && extraAutofilled
                ? tUi("discountLine.autoExtraHint")
                : undefined
            }
            capNote={
              isExtraMode
                ? discountNormalized > extraCap + 1e-9
                  ? t("summary.cappedToMax", {
                      amount: fmtTarget(toDisplayCurrency(extraCap)),
                    })
                  : undefined
                : maxDiscount !== undefined && discountNormalized > maxDiscount
                  ? t("summary.cappedToMax", {
                      amount: fmtTarget(toDisplayCurrency(maxDiscount)),
                    })
                  : undefined
            }
          >
            {isSplitMode && currencies.length > 1 && (
              <select
                value={discountCurrency}
                onChange={(e) => setDiscountCurrency(e.target.value)}
                aria-label={
                  isExtraMode
                    ? t("summary.extraCurrency")
                    : t("summary.discountCurrency")
                }
                className="bg-slate-900 border border-emerald-700/40 rounded-md px-1.5 py-0.5 text-emerald-300 text-[11px] focus:outline-none focus:border-emerald-500"
              >
                {currencies.map((curr) => (
                  <option key={curr.code} value={curr.code}>
                    {curr.code}
                  </option>
                ))}
              </select>
            )}
            {!isSplitMode && (
              <span className="text-[11px] text-emerald-400/60">
                {discountCurrency}
              </span>
            )}
            <div className="relative">
              {["$", "€", "£"].includes(getSymbol(discountCurrency)) && (
                <span className="absolute start-2 top-1/2 -translate-y-1/2 text-emerald-400 text-xs">
                  {getSymbol(discountCurrency)}
                </span>
              )}
              <input
                type="text"
                inputMode="decimal"
                aria-label={
                  isExtraMode ? t("summary.extra") : t("summary.discount")
                }
                value={discountRaw}
                onChange={(e) => {
                  const raw = e.target.value.replace(/,/g, "");
                  if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                    setDiscountRaw(raw);
                    // LIRA-334 — the cashier's own value (or a cleared
                    // field): the round-up autofill stays out of it.
                    roundUpDismissedRef.current = true;
                    setExtraAutofilled(false);
                  }
                }}
                className={`${discountFieldClass(
                  isExtraMode
                    ? discountNormalized > extraCap + 1e-9
                    : maxDiscount !== undefined &&
                        discountNormalized > maxDiscount,
                )} ${
                  ["$", "€", "£"].includes(getSymbol(discountCurrency))
                    ? "ps-5"
                    : "ps-2"
                }`}
                placeholder="0"
              />
            </div>
            {/* Payout only: off the shop's fee — the customer gets more.
                Elsewhere the "After Discount" row below already shows the
                result, so the amount is not echoed here. */}
            {discountAmount > 0 && !discountLowersTotal && (
              <span className="font-mono text-emerald-400 text-xs">
                +{fmtTarget(toDisplayCurrency(clampedDiscount))}
              </span>
            )}
          </DiscountLine>
        )}

        {/* After discount (a payout's total already includes it) */}
        {discountVisible &&
          !discountRow &&
          discountLowersTotal &&
          clampedDiscount > 0 && (
            <div className="flex justify-between text-xs pt-1 border-t border-emerald-700/20">
              <span className="text-emerald-300 font-medium">
                {t("summary.afterDiscount")}
              </span>
              <span className="font-mono text-emerald-200 font-medium">
                {fmtTarget(toDisplayCurrency(effectiveTotalInTarget))}
              </span>
            </div>
          )}

        {/* LIRA-319 — after the built-in line's extra. */}
        {isExtraMode && clampedExtra > 0 && (
          <div
            data-testid="after-page-extra"
            className="flex justify-between text-xs pt-1 border-t border-amber-700/20"
          >
            <span className="text-amber-300 font-medium">
              {t("summary.afterExtra")}
            </span>
            <span className="font-mono text-amber-200 font-medium">
              {fmtTarget(toDisplayCurrency(effectiveTotalInTarget))}
            </span>
          </div>
        )}

        {/* Total Paid */}
        <div className="flex justify-between items-center text-xs pt-1.5 border-t border-slate-700/40">
          <span className="text-slate-300 font-medium">{paidLabel}</span>
          <span className="flex items-center gap-1.5">
            {paidExact ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-emerald-400"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : paidHasProblem ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-red-400"
              >
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            ) : null}
            <span
              className={`font-mono font-semibold ${
                paidExact
                  ? "text-emerald-400"
                  : paidHasProblem
                    ? "text-red-400"
                    : "text-slate-100"
              }`}
            >
              {perCurrencyTotals
                ? pcText(
                    pcRows.map((r) => ({
                      amount: r.paid,
                      currency: r.currency,
                    })),
                  )
                : fmtTarget(toDisplayCurrency(totalPaid))}
            </span>
          </span>
        </div>

        {/* LIRA-321 — payout screens: what the customer's side came to, so
            the footer is not just the shop's "Total / Paid". Money-in
            screens are unchanged. */}
        {payoutCounterFlow && (
          <div className="pt-1.5 border-t border-slate-700/40 space-y-1">
            <div
              data-testid="counter-flow-summary-paid"
              className="flex justify-between text-xs"
            >
              <span className="text-slate-300 font-medium">
                {t("summary.customerPaid")}
              </span>
              <span className="font-mono text-emerald-400">
                {fmtCf(cf.state.paid)}
              </span>
            </div>
            {cf.state.owedToAccount > 0 && (
              <div
                data-testid="counter-flow-summary-owed"
                className="flex justify-between text-xs text-amber-300"
              >
                <span className="font-medium">
                  {t("summary.clientWillOwe")}
                </span>
                <span className="font-mono font-semibold">
                  {fmtCf(cf.state.owedToAccount)}
                </span>
              </div>
            )}
            {cf.state.forgiven > 0 && (
              <div
                data-testid="counter-flow-summary-forgiven"
                className="flex justify-between text-xs"
              >
                <span className="text-slate-300 font-medium">
                  {t("summary.forgiven")}
                </span>
                <span className="font-mono text-slate-200">
                  {fmtCf(cf.state.forgiven)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Remaining (underpaid → debt) warning */}
        {(perCurrencyTotals
          ? pcAnyShort
          : totalPaid < effectiveTotalInTarget - matchTolerance) && (
          <div
            data-testid="remaining-row"
            className={`flex items-center justify-between gap-2 text-xs px-2 py-1 rounded-md ${
              payoutKeepActive
                ? "bg-emerald-500/10 border border-emerald-500/20"
                : "bg-red-500/10 border border-red-500/20"
            }`}
          >
            <span
              className={payoutKeepActive ? "text-emerald-400" : "text-red-400"}
            >
              {isPayout
                ? payoutKeepActive
                  ? t("summary.changeKeptProfit")
                  : t("summary.remainingToPayOut")
                : isShopPayer
                  ? t("summary.remainingToPay")
                  : (owedLabel ?? t("summary.remainingDebt"))}
            </span>
            {/* Owner decision 2026-10-12 — what is left on the TICKED items
                (`waiveTotals`) when it differs from the whole Remaining;
                Waive sits on that figure then, so it only forgives the
                ticked items. One row, both figures (owner 2026-10-13: a
                second "Remaining on ticked" row said the same thing twice). */}
            {showTickedRemainingRow ? (
              <span className="flex flex-col items-end gap-0.5">
                <span
                  data-testid="remaining-ticked-row"
                  className="flex items-center gap-2"
                >
                  <span
                    data-testid="remaining-ticked-amount"
                    className="flex items-center gap-1 font-mono font-bold text-red-400"
                  >
                    {renderDualAmount(waiveShortfall)}
                  </span>
                  <span className="text-red-400/80">
                    {t("summary.onTicked")}
                  </span>
                  {showWaiveButton && waiveButton}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-red-400/70">
                  <span
                    data-testid="remaining-amount"
                    className="flex items-center gap-1 font-mono"
                  >
                    {renderDualAmount(effectiveTotalInTarget - totalPaid)}
                  </span>
                  {t("summary.total")}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span
                  data-testid="remaining-amount"
                  className={`flex items-center gap-1 font-mono font-bold ${payoutKeepActive ? "text-emerald-400" : "text-red-400"}`}
                >
                  {perCurrencyTotals
                    ? pcText(
                        pcRows
                          .filter((r) => r.short > 0)
                          .map((r) => ({
                            amount: r.short,
                            currency: r.currency,
                          })),
                      )
                    : renderDualAmount(effectiveTotalInTarget - totalPaid)}
                </span>
                {showWaiveButton && waiveButton}
              </span>
            )}
          </div>
        )}
        {/* LIRA-318 — nothing left: say so in the same words. */}
        {owedLabel &&
          !isPayout &&
          !isShopPayer &&
          !isOverpaid &&
          (perCurrencyTotals
            ? !pcAnyShort
            : totalPaid >= effectiveTotalInTarget - matchTolerance) && (
            <div
              data-testid="owed-after-row"
              className="flex items-center justify-between gap-2 text-xs px-2 py-1"
            >
              <span className="text-slate-300 font-medium">{owedLabel}</span>
              <span className="font-mono font-bold text-emerald-400">
                {perCurrencyTotals
                  ? pcText(
                      pcRows.map((r) => ({ amount: 0, currency: r.currency })),
                    )
                  : fmtTarget(toDisplayCurrency(0))}
              </span>
            </div>
          )}
        {/* LIRA-313 — payout above the total becomes the other side's debt. */}
        {isPayout &&
          payoutExcessToAccount &&
          overpaidTarget > matchTolerance && (
            <p
              data-testid="payout-excess-summary"
              className="text-[11px] text-amber-300 px-2"
            >
              <Trans
                t={t}
                i18nKey="summary.payoutExcess"
                values={{
                  amount: dualAmountText(overpaidTarget),
                  account: accountLabel ?? t("summary.theBalance"),
                }}
                components={LTR_SLOT}
              />
            </p>
          )}
        {/* LIRA-334 — payout handed out a little more than owed: booked as
            change rounding. */}
        {payoutRoundUpActive && (
          <p
            data-testid="payout-roundup-summary"
            className="text-[11px] text-emerald-400 px-2"
          >
            <Trans
              t={t}
              i18nKey="summary.roundUpBooked"
              values={{ amount: dualAmountText(overpaidTarget) }}
              components={LTR_SLOT}
            />
          </p>
        )}

        {/* Return / Change (overpaid). One compact box on every page (owner
            2026-10-13), three rows:
              1. label + change due + "hand back by" (Cash or a wallet);
              2. CASH: $ and LBP fields with one-tap $ / LBP / Account (or
                 Keep) buttons on the same line;
              3. one line saying where the change NOT handed back goes.
            Customer Account is no longer a return METHOD: the Account button
            (and any change left in the fields) does that job, so the same
            choice is never offered twice. */}
        {isOverpaid && (
          <div
            data-testid="return-change"
            className="px-2 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 min-w-0 flex-wrap text-xs text-amber-400 font-medium">
                <span className="whitespace-nowrap">
                  {isFullKeepChange
                    ? isShopPayer
                      ? t("change.notReturnedCost")
                      : // Both fields cleared → the whole change is kept. Same
                        // copy as the pre-LIRA-084 all-or-nothing keep
                        // (lira-107's debt-repayment e2e asserts this label).
                        t("summary.changeKeptProfit")
                    : isShopPayer
                      ? t("change.toGetBack")
                      : isCashOnlyPayment
                        ? t("change.toReturn")
                        : t("change.returnChange")}
                </span>
                {/* LIRA-264 — the change due, always in both currencies. */}
                <span
                  data-testid="change-due"
                  className="flex items-center gap-1 font-mono font-semibold text-amber-300 text-[11px]"
                >
                  <span className="sr-only">{t("change.changeDue")}</span>
                  {renderDualAmount(overpaidTarget)}
                </span>
              </span>
              {/* Hand back by — only when a non-cash drawer method exists. */}
              {!isCashOnlyPayment && (
                <select
                  data-testid="return-method"
                  aria-label={t("change.handBackBy")}
                  value={effectiveReturnMethod}
                  onChange={(e) => setReturnMethod(e.target.value)}
                  className="shrink-0 bg-slate-900 border border-amber-700/40 rounded-md px-1.5 py-0.5 text-amber-200 text-[11px] focus:outline-none focus:border-amber-500"
                >
                  {returnMethodOptions.map((pm) => (
                    <option key={pm.code} value={pm.code}>
                      {pm.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* CASH: $ + LBP fields and the one-tap buttons on one line. */}
            {effectiveReturnMethod === "CASH" && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {allowReturnUSD && (
                  <div className="relative flex-1 min-w-[5.5rem]">
                    <span className="absolute start-2 top-1/2 -translate-y-1/2 text-slate-400 text-[11px] pointer-events-none">
                      $
                    </span>
                    <input
                      data-testid="return-usd"
                      type="text"
                      inputMode="decimal"
                      aria-label={t("change.handedBackUsd")}
                      value={returnAmountUSD}
                      onChange={(e) => {
                        setChangeToAccount(false);
                        handleReturnUSDChange(e.target.value);
                      }}
                      placeholder="0.00"
                      className="w-full ps-5 pe-2 py-1 bg-slate-900 border border-amber-700/40 rounded-md text-amber-200 text-sm font-mono text-end focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}
                {allowReturnLBP && (
                  <div className="relative flex-1 min-w-[5.5rem]">
                    <input
                      data-testid="return-lbp"
                      type="text"
                      inputMode="numeric"
                      aria-label={t("change.handedBackLbp")}
                      value={returnAmountLBP}
                      onChange={(e) => {
                        setChangeToAccount(false);
                        handleReturnLBPChange(e.target.value);
                      }}
                      placeholder="0"
                      className="w-full ps-2 pe-8 py-1 bg-slate-900 border border-amber-700/40 rounded-md text-amber-200 text-sm font-mono text-end focus:outline-none focus:border-amber-500"
                    />
                    <span className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 text-[11px] pointer-events-none">
                      LBP
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  {/* LIRA-264 — hand the whole change back in one currency. */}
                  {allowReturnUSD && (
                    <button
                      type="button"
                      data-testid="return-all-usd"
                      onClick={() => {
                        setChangeToAccount(false);
                        handleReturnAllUSD();
                      }}
                      title={t("change.allUsdTitle")}
                      className="px-2 py-1 rounded-md text-[11px] font-semibold text-amber-300 bg-slate-900 border border-amber-700/40 hover:border-amber-500 transition-colors"
                    >
                      $
                    </button>
                  )}
                  {allowReturnLBP && (
                    <button
                      type="button"
                      data-testid="return-all-lbp"
                      onClick={() => {
                        setChangeToAccount(false);
                        handleReturnAllLBP();
                      }}
                      title={t("change.allLbpTitle")}
                      className="px-2 py-1 rounded-md text-[11px] font-semibold text-amber-300 bg-slate-900 border border-amber-700/40 hover:border-amber-500 transition-colors"
                    >
                      LBP
                    </button>
                  )}
                  {/* LIRA-313 — nothing handed back: the whole change goes to
                      the account. Without an account, the same tap keeps it
                      (as profit, or as cost when the shop pays). */}
                  {(creditUnreturnedBase || canKeepUnreturned) && (
                    <button
                      type="button"
                      data-testid={
                        creditUnreturnedBase
                          ? "change-destination-account"
                          : "change-keep-all"
                      }
                      aria-pressed={creditUnreturned && changeToAccount}
                      onClick={handleChangeToAccount}
                      title={
                        creditUnreturnedBase
                          ? t("change.putOnAccountTitle", {
                              account:
                                accountLabel ??
                                (unreturnedChangeTo === "ACCOUNT_BALANCE"
                                  ? t("change.theirAccount")
                                  : t("change.customersAccount")),
                            })
                          : t("change.handNothingBack")
                      }
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                        creditUnreturnedBase
                          ? changeToAccount
                            ? "bg-emerald-500/30 border-emerald-400 text-emerald-100"
                            : "bg-slate-900 border-emerald-700/50 text-emerald-300 hover:border-emerald-500"
                          : "bg-slate-900 border-amber-700/40 text-amber-300 hover:border-amber-500"
                      }`}
                    >
                      {creditUnreturnedBase
                        ? t("change.account")
                        : t("change.keep")}
                    </button>
                  )}
                  {canChooseKeep && (
                    <button
                      type="button"
                      data-testid="change-keep-all"
                      aria-pressed={keepUnreturned}
                      onClick={() => {
                        setChangeToAccount(false);
                        setKeepUnreturned(true);
                        setReturnAmountUSD("");
                        setReturnAmountLBP("");
                      }}
                      title={t("change.handNothingBack")}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                        keepUnreturned
                          ? "bg-amber-500/30 border-amber-400 text-amber-100"
                          : "bg-slate-900 border-amber-700/40 text-amber-300 hover:border-amber-500"
                      }`}
                    >
                      {t("change.keep")}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Owner decision 2026-10-06 — whenever the change handed back
                is less than the change due, say in green what is kept as
                profit (the button that used to arm this is gone). */}
            {keepActive &&
              (keptUsd > 0.005 || keptLbp > 1) &&
              (isShopPayer ? (
                /* payer="shop" (owner decision 2026-10-07): change the
                   outsider kept is added to the cost, never profit. */
                <p
                  data-testid="keep-change-summary"
                  className="text-[11px] text-amber-300"
                >
                  <Trans
                    t={t}
                    i18nKey="change.notReturnedAddedToCost"
                    values={{ amount: dualAmountText(keptTotalTarget) }}
                    components={LTR_SLOT}
                  />
                </p>
              ) : (
                <p
                  data-testid="keep-change-summary"
                  className="text-[11px] text-emerald-400"
                >
                  <Trans
                    t={t}
                    i18nKey={
                      keepChangeReturnUSD > 0.005 || keepChangeReturnLBP > 1
                        ? "change.keepingProfitRest"
                        : "change.keepingProfit"
                    }
                    values={{ amount: dualAmountText(keptTotalTarget) }}
                    components={LTR_SLOT}
                  />
                </p>
              ))}
            {/* LIRA-308 answer 1 — the change not handed back goes to the
                customer's account. */}
            {unreturnedCreditAmount > 0 && (
              <p
                data-testid="change-to-account-summary"
                className="text-[11px] text-emerald-400"
              >
                <Trans
                  t={t}
                  i18nKey={
                    unreturnedChangeTo === "ACCOUNT_BALANCE"
                      ? isShopPayer
                        ? "change.unreturnedStaysGivenBack"
                        : "change.unreturnedStaysReturned"
                      : "change.unreturnedToCredit"
                  }
                  values={{
                    amount:
                      returnCurrency === "LBP"
                        ? `${formatNumber(unreturnedCreditAmount)} LBP`
                        : `$${unreturnedCreditAmount.toFixed(2)}`,
                    account:
                      accountLabel ??
                      (unreturnedChangeTo === "ACCOUNT_BALANCE"
                        ? t("change.theirAccount")
                        : t("change.customersAccount")),
                  }}
                  components={LTR_SLOT}
                />
              </p>
            )}
            {/* Fix-round finding #4 (2026-09-24): the two return fields
            never rewrite each other, so nothing else guarantees they still
            add up to the overpaid amount once the operator edits either one
            — flag it instead of silently over- or under-returning. */}
            {effectiveReturnMethod === "CASH" &&
              hasReturnMismatch &&
              !underReturnKept && (
                <p
                  data-testid="return-mismatch-warning"
                  className="text-[11px] text-red-400 mt-1"
                >
                  <Trans
                    t={t}
                    i18nKey={
                      returnMismatch > 0
                        ? isShopPayer
                          ? "change.gettingBackMore"
                          : "change.returningMore"
                        : "change.notCovered"
                    }
                    values={{
                      amount: fmtWithSymbol(
                        convertSafe(
                          Math.abs(returnMismatch),
                          totalAmountCurrency,
                          "USD",
                        ),
                        "$",
                        2,
                      ),
                    }}
                    components={LTR_SLOT}
                  />
                </p>
              )}
            {effectiveReturnMethod !== "CASH" &&
              (currencies.length > 1 || !returnCurrencyInChangeDue) && (
                /* Non-CASH: currency dropdown. The amount itself is the
                   "Change due" row above (USD | LBP), so it is repeated here
                   only for a currency that row does not show (e.g. EUR). */
                <div className="flex items-center gap-1.5 justify-end">
                  {currencies.length > 1 && (
                    <select
                      data-testid="return-currency"
                      value={returnCurrency}
                      onChange={(e) => setReturnCurrency(e.target.value)}
                      className="bg-slate-900 border border-amber-700/40 rounded-md px-1.5 py-0.5 text-amber-200 text-[11px] focus:outline-none focus:border-amber-500"
                    >
                      {currencies.map((curr) => (
                        <option key={curr.code} value={curr.code}>
                          {curr.code}
                        </option>
                      ))}
                    </select>
                  )}
                  {!returnCurrencyInChangeDue && (
                    <span className="font-mono font-bold text-amber-300">
                      {/* Same figure as before this row was trimmed. */}
                      {formatNumber(Math.round(returnAmount))}
                    </span>
                  )}
                </div>
              )}
          </div>
        )}

        {/* PM fees: one Grand Total row that names the fee (owner
            2026-10-13 — a separate "Wallet Surcharge" row was a third total). */}
        {showPmFee && totalPmFees > 0 && (
          <div className="pt-1.5 mt-1 border-t border-violet-700/30">
            <div className="flex justify-between items-baseline gap-2 text-sm">
              <span className="text-white font-semibold">
                {t("summary.grandTotal")}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="font-mono text-white font-bold">
                  {fmtTarget(toDisplayCurrency(totalPaid + totalPmFees))}
                </span>
                <span className="text-[11px] text-violet-300">
                  <Trans
                    t={t}
                    i18nKey="summary.inclWalletFee"
                    values={{
                      amount: fmtTarget(toDisplayCurrency(totalPmFees)),
                    }}
                    components={LTR_SLOT}
                  />
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Validation Messages — every "a client is needed" reason in ONE box
          (debt line, store-credit change, gift-card voucher) instead of one
          message per section. */}
      {clientNeededReasons.length > 0 && (
        <div
          data-testid="client-needed"
          className="mx-4 mb-3 text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20 flex items-start gap-2"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="shrink-0 mt-px"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="space-y-0.5">
            {clientNeededReasons.map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
