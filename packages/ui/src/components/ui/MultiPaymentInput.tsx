import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { DecimalInput } from "./DecimalInput";
import { roundLBPUp } from "../../config/denominations";
import {
  allocatePayments,
  convert as convertMoney,
  roundForCurrency,
  type Money,
  type RateSide,
  type RateTable,
} from "../../money";

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

export interface MultiPaymentInputProps {
  currency: string;
  /** The currency the summary/aggregate surfaces (total row, return-field
   *  seeding, tolerances) are expressed in. Defaults to "USD".
   *  e.g. Whish/iPick/KATCH pass "LBP", POS sale passes "USD". */
  totalAmountCurrency?: string;
  /** Per-currency totals — the multi-currency engine contract
   *  (docs/plans/MULTI_CURRENCY_PAYMENT_PLAN.md). Each entry is what is owed
   *  in that currency NATIVELY; a rate is only ever consulted when a payment
   *  crosses currencies, so e.g. an LBP debt paid in LBP is rate-invariant.
   *  Defaults to [] (nothing owed). */
  totals?: Money[];
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
  /** T3 "keep change" (docs/plans/T3_KEEP_CHANGE_PLAN.md): fires with the
   *  per-currency amounts the shop KEEPS instead of returning ({usd, lbp})
   *  when the operator activates the keep-change toggle, and with null when
   *  deactivated (or no longer overpaid). While active, onReturnChange
   *  emits [] — no OUT legs; the caller stamps the kept amounts as profit
   *  (profit_usd/profit_lbp) on the transaction it creates. */
  onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
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
  /** Payment methods to display in dropdown */
  paymentMethods: PaymentMethod[];
  /** Available currencies */
  currencies: Currency[];
  /** Current exchange rate (1 USD = X LBP). Defaults to 89000 if not provided */
  exchangeRate?: number;
  /** Callback when exchange rate changes */
  onRateChange?: (rate: number) => void;
  /** Show an optional discount field that reduces the amount the customer pays.
   *  Discount is subtracted from the totals before payment matching. */
  showDiscount?: boolean;
  /** Maximum allowed discount (in totalAmountCurrency). Cannot exceed cost. */
  maxDiscount?: number;
  /** Callback when discount changes. Receives discount normalized to totalAmountCurrency. */
  onDiscountChange?: (discount: number) => void;
  /** Custom label for the header (defaults to "Payment") */
  label?: string;
  /** Initial payment method for the first line (used on mount/remount). */
  initialMethod?: string;
  /** Selected client (voucher owner). Required to offer GIFT_CARD vouchers. */
  clientId?: number | null;
  /** Fetch the client's redeemable vouchers. When provided, GIFT_CARD lines show
   *  a dropdown of that client's vouchers (auto-selected when only one exists)
   *  instead of a manual code field. The selected voucher's value is deposited to
   *  the account on redemption; the leg amount stays the charged portion. */
  fetchClientVouchers?: (clientId: number) => Promise<VoucherOption[]>;
  /** When provided, shows a "Waive" button next to the Remaining (Debt)
   *  warning whenever the shortfall (converted to USD if needed) is below
   *  waiveRemainingThreshold. Clicking calls back with the shortfall amount
   *  (in totalAmountCurrency) — this component has no opinion on what
   *  "waiving" means upstream (e.g. the caller may fold it into a discount). */
  onWaiveRemaining?: (amount: number) => void;
  /** USD-equivalent threshold below which the waive button appears. Default 1. */
  waiveRemainingThreshold?: number;
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
}

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

export default function MultiPaymentInput({
  currency,
  totalAmountCurrency = "USD",
  totals: totalsProp,
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
  label,
  initialMethod,
  initialLines,
  clientId,
  fetchClientVouchers,
  onWaiveRemaining,
  waiveRemainingThreshold = 1,
  smartSplitOverpay = false,
  cashOnlyReturn = false,
}: MultiPaymentInputProps) {
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
  const [returnMethod, setReturnMethod] = useState<string>("CASH");
  // For non-CASH returns: which currency to express the amount in.
  const [returnCurrency, setReturnCurrency] =
    useState<string>(totalAmountCurrency);
  // For CASH returns: editable USD and LBP amounts (mirrors POS "Change Given").
  const [returnAmountUSD, setReturnAmountUSD] = useState<string>("");
  const [returnAmountLBP, setReturnAmountLBP] = useState<string>("");
  // Stable id prefix for return legs (consumers don't use the id).
  const returnLegIdRef = useRef<string>(crypto.randomUUID());
  // Tracks whether the user manually edited the single-mode amount, so a
  // deliberate overpayment isn't clobbered by the auto-sync-to-total effect.
  const singleAmountTouchedRef = useRef<boolean>(false);

  const safeExchangeRate =
    exchangeRate || rateTableProp?.rates["LBP"]?.[side] || 89000;
  const [customExchangeRate, setCustomExchangeRate] = useState<string>(
    safeExchangeRate.toString(),
  );

  const effectiveRate = parseFloat(customExchangeRate) || safeExchangeRate;

  // ── Multi-currency engine model (docs/plans/MULTI_CURRENCY_PAYMENT_PLAN.md) ──
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
  const convertSafe = (
    amount: number,
    from: string,
    to: string,
  ): number => {
    if (from === to) return amount;
    try {
      return convertMoney({ amount, currency: from }, to, internalRates, side)
        .amount;
    } catch {
      return amount;
    }
  };

  // --- Discount logic ---
  const discountAmount = parseNum(discountRaw);

  /** Normalize discount from discountCurrency to totalAmountCurrency */
  const discountNormalized = convertSafe(
    discountAmount,
    discountCurrency,
    totalAmountCurrency,
  );
  const clampedDiscount =
    maxDiscount !== undefined
      ? Math.min(discountNormalized, maxDiscount)
      : discountNormalized;

  // What is owed, per currency — the native composition callers provide.
  // Discount (normalized to totalAmountCurrency) is taken out of the buckets
  // largest-first.
  const baseTotals: Money[] = totalsProp ?? [];
  const effectiveTotals: Money[] = (() => {
    if (clampedDiscount <= 0) return baseTotals;
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
  ): number => {
    const otherPayments: Money[] = paymentLines
      .filter((l) => l.id !== excludeLineId)
      .map((l) => ({
        amount: Math.max(0, l.amount || 0),
        currency: l.currencyCode,
      }));
    const { remaining } = allocatePayments(
      {
        totals: effectiveTotals,
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

  // Update custom rate when exchange rate prop changes
  useEffect(() => {
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
    isSplitMode,
    effectiveRate,
    singleLineCurrency,
    clampedDiscount,
  ]);

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
    if (!clientId) {
      return (
        <p className="mt-1 text-[11px] text-amber-400">
          Select a client to use a voucher.
        </p>
      );
    }
    if (clientVouchers.length === 0) {
      return (
        <p className="mt-1 text-[11px] text-amber-400">
          No available vouchers for this client.
        </p>
      );
    }
    const options = voucherOptionsForLine(line);
    if (options.length === 0) {
      return (
        <p className="mt-1 text-[11px] text-amber-400">
          No more vouchers available.
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
            +${selected.amount.toFixed(2)} credit added on redemption
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
  const matchTolerance = totalAmountCurrency === "LBP" ? 100 : 0.01;

  const hasDebt = paymentLines.some(
    (line) => line.method === "CUSTOMER_ACCOUNT",
  );

  const getSymbol = (currencyCode: string): string => {
    const curr = currencies.find((c) => c.code === currencyCode);
    return curr?.symbol || "$";
  };

  // --- Return / change derivation ---
  // Overpaid amount (in totalAmountCurrency); only positive when the customer
  // paid more than the (post-discount) total.
  const overpaidTarget = Math.max(0, totalPaid - effectiveTotalInTarget);
  const isOverpaid = overpaidTarget > matchTolerance;

  // --- Waive-remaining derivation ---
  // Shortfall in totalAmountCurrency, converted to USD-equivalent purely for
  // the threshold check (so waiveRemainingThreshold means "$1" regardless of
  // whether the job is USD- or LBP-denominated).
  const remainingShortfall = Math.max(0, effectiveTotalInTarget - totalPaid);
  const remainingShortfallUsd = convertSafe(
    remainingShortfall,
    totalAmountCurrency,
    "USD",
  );
  const showWaiveButton =
    !!onWaiveRemaining &&
    remainingShortfall > matchTolerance &&
    remainingShortfallUsd < waiveRemainingThreshold;
  // When the shop only has cash as a payment method, the change is obviously cash —
  // show a simple currency toggle. Any non-cash method available surfaces the full
  // method picker regardless of what the customer selected.
  const isCashOnlyPayment =
    cashOnlyReturn || paymentMethods.every((pm) => pm.code === "CASH");
  const effectiveReturnMethod = isCashOnlyPayment ? "CASH" : returnMethod;

  // T3 "keep change": while active, no OUT legs are emitted (the drawer keeps
  // the full tender) and the suggested-change split is reported to the parent
  // for the per-currency profit stamp. Resets whenever the overpay clears.
  const [keepChange, setKeepChange] = useState(false);

  // Auto-init / reset CASH return fields whenever the overpaid amount changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isOverpaid) {
      setReturnAmountUSD("");
      setReturnAmountLBP("");
      setKeepChange(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOverpaid, overpaidTarget, totalAmountCurrency, smartSplitOverpay]);

  // CASH return handlers: entering one currency auto-fills the other with the remainder.
  const handleReturnUSDChange = (raw: string) => {
    setReturnAmountUSD(raw);
    const parsed = parseNum(raw);
    const overpaidUSD =
      totalAmountCurrency === "USD"
        ? overpaidTarget
        : overpaidTarget / effectiveRate;
    const remaining = overpaidUSD - parsed;
    if (remaining > 0.005) {
      setReturnAmountLBP(String(Math.round(remaining * effectiveRate)));
    } else {
      setReturnAmountLBP("");
    }
  };

  const handleReturnLBPChange = (raw: string) => {
    setReturnAmountLBP(raw);
    const parsed = parseNum(raw);
    const overpaidUSD =
      totalAmountCurrency === "USD"
        ? overpaidTarget
        : overpaidTarget / effectiveRate;
    const remaining = overpaidUSD - parsed / effectiveRate;
    if (remaining > 0.005) {
      setReturnAmountUSD(remaining.toFixed(2));
    } else {
      setReturnAmountUSD("");
    }
  };

  /** Convert a value from totalAmountCurrency into an arbitrary currency. */
  const convertFromTarget = (v: number, toCurrency: string): number =>
    convertSafe(v, totalAmountCurrency, toCurrency);

  const rawReturnAmount = convertFromTarget(overpaidTarget, returnCurrency);
  const returnAmount =
    returnCurrency === "LBP"
      ? Math.round(rawReturnAmount)
      : Number(rawReturnAmount.toFixed(2));

  // CUSTOMER_ACCOUNT return requires a client (it becomes store credit).
  const returnNeedsClient =
    effectiveReturnMethod === "CUSTOMER_ACCOUNT" && !hasClient;

  const parsedReturnUSD = parseNum(returnAmountUSD);
  const parsedReturnLBP = parseNum(returnAmountLBP);

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

  // Keep-change gates the OUT legs entirely: the drawer keeps the tender and
  // the suggested split becomes the kept amounts (reported below).
  const returnLegsValue: PaymentLine[] = keepChange ? [] : suggestedReturnLegs;

  // Emit return legs whenever they change.
  const returnLegsKey = returnLegsValue
    .map((l) => `${l.method}:${l.currencyCode}:${l.amount}`)
    .join("|");
  useEffect(() => {
    onReturnChange?.(returnLegsValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnLegsKey]);

  // Report the kept split in the TENDER currency — the engine's change
  // output (excess per currency the customer actually handed over), NOT the
  // return-field suggestion. The suggestion is denominated for returning
  // (e.g. a USD figure against an LBP tender); keeping is physical: the
  // drawer holds the excess tender itself, and cross-denominated kept
  // amounts corrupt per-currency netting downstream (caught by lira-107's
  // failing-first run: a kept 100,000 LBP reported as $1.12 became a phantom
  // client credit).
  const { keptUsd, keptLbp } = (() => {
    if (!keepChange) return { keptUsd: 0, keptLbp: 0 };
    const { change } = allocatePayments({
      totals: effectiveTotals,
      payments: paymentLines.map((l) => ({
        amount: Math.max(0, l.amount || 0),
        currency: l.currencyCode,
      })),
      rates: internalRates,
      side,
    });
    return {
      keptUsd: change.find((m) => m.currency === "USD")?.amount ?? 0,
      keptLbp: change.find((m) => m.currency === "LBP")?.amount ?? 0,
    };
  })();
  const keptKey = keepChange ? `${keptUsd}:${keptLbp}` : "off";
  useEffect(() => {
    onKeptChange?.(keepChange ? { usd: keptUsd, lbp: keptLbp } : null);
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

  const fmtTarget = (v: number) => {
    const abs = Math.abs(v);
    const fixed = abs.toFixed(targetDecimals);
    const parts = fixed.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const formatted = parts.join(".");
    // Prefix symbols ($, €, £) go before the number, others (LBP) go after
    if (["$", "€", "£"].includes(targetSymbol)) {
      return `${targetSymbol}${formatted}`;
    }
    return `${formatted} ${targetSymbol}`;
  };

  const toggleSplitMode = () => {
    if (isSplitMode) {
      // Switching to single: reset to one line with full amount (re-enable auto-sync)
      singleAmountTouchedRef.current = false;
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
    setIsSplitMode(!isSplitMode);
  };

  return (
    <div
      data-testid="multi-payment-input"
      className="bg-slate-900/50 border border-slate-700/50 rounded-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/40">
        <span className="text-sm font-semibold text-slate-200 tracking-wide shrink-0">
          {isSplitMode ? `${label || "Payment"} Split` : label || "Payment"}
        </span>

        {/* Exchange Rate — centred between title and Split button */}
        <div className="flex flex-1 items-center justify-center gap-1.5">
          <span className="text-xs text-slate-500">1 USD =</span>
          <input
            data-testid="payment-exchange-rate"
            type="text"
            inputMode="decimal"
            value={fmtNum(customExchangeRate)}
            onChange={(e) => {
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

        <button
          type="button"
          data-testid="split-toggle"
          onClick={toggleSplitMode}
          className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-all ${
            isSplitMode
              ? "bg-violet-500/20 text-violet-300 border border-violet-500/40"
              : "bg-slate-800 text-slate-400 border border-slate-600 hover:text-slate-200 hover:border-slate-500"
          }`}
        >
          {isSplitMode ? (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
              Split Active
            </>
          ) : (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M16 3h5v5M4 20L21 3" />
              </svg>
              Split
            </>
          )}
        </button>
      </div>

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
                <div className="flex items-center gap-2">
                  {/* Payment Method */}
                  <select
                    data-testid={`payment-method-${line.id}`}
                    value={line.method}
                    onChange={(e) =>
                      updatePaymentLine(line.id, "method", e.target.value)
                    }
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 transition-colors"
                  >
                    {paymentMethods.map((pm) => (
                      <option key={pm.code} value={pm.code}>
                        {pm.label}
                      </option>
                    ))}
                  </select>

                  {/* Currency */}
                  <select
                    data-testid={`payment-currency-${line.id}`}
                    value={line.currencyCode}
                    onChange={(e) =>
                      updatePaymentLine(line.id, "currencyCode", e.target.value)
                    }
                    className="w-20 bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-violet-500 transition-colors"
                  >
                    {currencies.map((curr) => (
                      <option key={curr.code} value={curr.code}>
                        {curr.code}
                      </option>
                    ))}
                  </select>

                  {/* Amount — DecimalInput keeps the raw text while focused so
                      decimal points survive typing (a controlled fmtNum/parseNum
                      round-trip ate the "." on every keystroke). */}
                  <div className="relative w-28">
                    {["$", "€", "£"].includes(getSymbol(line.currencyCode)) && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                        {getSymbol(line.currencyCode)}
                      </span>
                    )}
                    <DecimalInput
                      data-testid={`payment-amount-${line.id}`}
                      value={line.amount}
                      decimals={line.currencyCode === "LBP" ? 0 : 2}
                      onChange={(n) => updatePaymentLine(line.id, "amount", n)}
                      className={`w-full bg-slate-900 border border-slate-600 rounded-lg pr-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-violet-500 transition-colors ${
                        ["$", "€", "£"].includes(getSymbol(line.currencyCode))
                          ? "pl-7"
                          : "pl-3"
                      }`}
                      placeholder="0"
                    />
                  </div>

                  {/* Remove */}
                  <button
                    type="button"
                    disabled={paymentLines.length === 1}
                    onClick={() => removePaymentLine(line.id)}
                    className="flex-shrink-0 px-0.5 py-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-500 transition-all"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Voucher picker (GIFT_CARD) */}
                {fetchClientVouchers && line.method === "GIFT_CARD" && (
                  <div className="pl-3 border-l-2 border-orange-500/30">
                    {renderVoucherSelector(line)}
                  </div>
                )}

                {/* PM Fee sub-line */}
                {showPmFee && !CASH_EQUIVALENT_METHODS.has(line.method) && (
                  <div className="flex items-center gap-2 pl-3 border-l-2 border-violet-500/30">
                    <span className="text-[11px] text-violet-400 whitespace-nowrap">
                      PM fee
                    </span>
                    <div className="relative w-24">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-violet-400 text-[10px]">
                        $
                      </span>
                      <input
                        type="number"
                        value={
                          pmFeeOverrides[line.id] ??
                          (line.amount * pmFeeRate).toFixed(2)
                        }
                        onChange={(e) => {
                          const newOverrides = { ...pmFeeOverrides };
                          newOverrides[line.id] = e.target.value;
                          setPmFeeOverrides(newOverrides);
                        }}
                        className="w-full bg-violet-950/40 border border-violet-700/40 rounded-md pl-5 pr-2 py-1 text-violet-200 text-xs font-mono focus:outline-none focus:border-violet-500"
                        placeholder="0.00"
                        step="0.01"
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
              onClick={addPaymentLine}
              className="w-full py-2 border-2 border-dashed border-slate-700 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-all"
            >
              + Add {label || "Payment"} Line
            </button>
          </>
        ) : (
          /* Single payment mode */
          <div
            data-testid={`payment-line-${paymentLines[0]?.id}`}
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              {/* Payment Method */}
              <select
                data-testid={`payment-method-${paymentLines[0]?.id}`}
                value={paymentLines[0]?.method || "CASH"}
                onChange={(e) =>
                  updatePaymentLine(
                    paymentLines[0]?.id,
                    "method",
                    e.target.value,
                  )
                }
                className="flex-1 min-w-0 bg-slate-800/80 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 transition-colors"
              >
                {paymentMethods.map((pm) => (
                  <option key={pm.code} value={pm.code}>
                    {pm.label}
                  </option>
                ))}
              </select>

              {/* Currency */}
              <select
                data-testid={`payment-currency-${paymentLines[0]?.id}`}
                value={paymentLines[0]?.currencyCode || currency}
                onChange={(e) =>
                  updatePaymentLine(
                    paymentLines[0]?.id,
                    "currencyCode",
                    e.target.value,
                  )
                }
                className="w-20 bg-slate-800/80 border border-slate-600 rounded-lg px-2 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 transition-colors"
              >
                {currencies.map((curr) => (
                  <option key={curr.code} value={curr.code}>
                    {curr.code}
                  </option>
                ))}
              </select>

              {/* Amount */}
              <div className="relative w-36">
                {["$", "€", "£"].includes(
                  getSymbol(paymentLines[0]?.currencyCode || currency),
                ) && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    {getSymbol(paymentLines[0]?.currencyCode || currency)}
                  </span>
                )}
                <DecimalInput
                  data-testid={`payment-amount-${paymentLines[0]?.id}`}
                  value={paymentLines[0]?.amount ?? 0}
                  decimals={
                    (paymentLines[0]?.currencyCode || currency) === "LBP"
                      ? 0
                      : 2
                  }
                  onChange={(n) =>
                    updatePaymentLine(paymentLines[0]?.id, "amount", n)
                  }
                  className={`w-full bg-slate-800/80 border border-slate-600 rounded-lg pr-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-violet-500 transition-colors ${
                    ["$", "€", "£"].includes(
                      getSymbol(paymentLines[0]?.currencyCode || currency),
                    )
                      ? "pl-7"
                      : "pl-3"
                  }`}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Voucher picker (GIFT_CARD) */}
            {fetchClientVouchers &&
              paymentLines[0]?.method === "GIFT_CARD" &&
              paymentLines[0] && (
                <div>{renderVoucherSelector(paymentLines[0])}</div>
              )}
          </div>
        )}
      </div>

      {/* Summary */}
      <div
        data-testid="payment-summary"
        className="px-4 py-3 bg-slate-800/30 border-t border-slate-700/40 space-y-1.5"
      >
        {/* Provider fee breakdown */}
        {providerFee > 0 && (
          <>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Send Amount</span>
              <span className="font-mono text-white">
                {fmtTarget(toDisplayCurrency(totalInTarget - providerFee))}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-amber-400">Provider Fee</span>
              <span className="font-mono text-amber-300">
                +{fmtTarget(toDisplayCurrency(providerFee))}
              </span>
            </div>
            <div className="flex justify-between text-xs pt-1 border-t border-slate-700/30">
              <span className="text-slate-300 font-medium">Subtotal</span>
              <span className="font-mono text-slate-200 font-medium">
                {fmtTarget(toDisplayCurrency(totalInTarget))}
              </span>
            </div>
          </>
        )}
        {providerFee === 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Total Amount</span>
            <span className="font-mono text-white">
              {fmtTarget(toDisplayCurrency(totalInTarget))}
            </span>
          </div>
        )}

        {/* Discount */}
        {showDiscount && (
          <div className="flex items-center justify-between gap-2 py-1">
            <span className="text-xs text-emerald-400 font-medium">
              Discount
            </span>
            <div className="flex items-center gap-1.5">
              {isSplitMode && currencies.length > 1 && (
                <select
                  value={discountCurrency}
                  onChange={(e) => setDiscountCurrency(e.target.value)}
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
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-emerald-400 text-xs">
                    {getSymbol(discountCurrency)}
                  </span>
                )}
                <input
                  type="text"
                  inputMode="decimal"
                  value={discountRaw}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, "");
                    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                      setDiscountRaw(raw);
                    }
                  }}
                  className={`w-24 bg-emerald-950/30 border rounded-md px-2 py-1 text-emerald-200 text-xs font-mono focus:outline-none focus:border-emerald-500 transition-colors ${
                    maxDiscount !== undefined &&
                    discountNormalized > maxDiscount
                      ? "border-red-500"
                      : "border-emerald-700/40"
                  } ${
                    ["$", "€", "£"].includes(getSymbol(discountCurrency))
                      ? "pl-5"
                      : "pl-2"
                  }`}
                  placeholder="0"
                />
              </div>
              {discountAmount > 0 && (
                <span className="font-mono text-emerald-400 text-xs">
                  -{fmtTarget(toDisplayCurrency(clampedDiscount))}
                </span>
              )}
            </div>
          </div>
        )}

        {/* After discount */}
        {showDiscount && clampedDiscount > 0 && (
          <div className="flex justify-between text-xs pt-1 border-t border-emerald-700/20">
            <span className="text-emerald-300 font-medium">After Discount</span>
            <span className="font-mono text-emerald-200 font-medium">
              {fmtTarget(toDisplayCurrency(effectiveTotalInTarget))}
            </span>
          </div>
        )}

        {/* Discount cap warning */}
        {showDiscount &&
          maxDiscount !== undefined &&
          discountNormalized > maxDiscount && (
            <div className="text-[11px] text-red-400">
              Capped to max ({fmtTarget(toDisplayCurrency(maxDiscount))})
            </div>
          )}

        {/* Total Paid */}
        <div className="flex justify-between items-center text-xs pt-1.5 border-t border-slate-700/40">
          <span className="text-slate-300 font-medium">Paid</span>
          <span className="flex items-center gap-1.5">
            {Math.abs(totalPaid - effectiveTotalInTarget) < matchTolerance ? (
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
            ) : (
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
            )}
            <span
              className={`font-mono font-semibold ${
                Math.abs(totalPaid - effectiveTotalInTarget) < matchTolerance
                  ? "text-emerald-400"
                  : "text-red-400"
              }`}
            >
              {fmtTarget(toDisplayCurrency(totalPaid))}
            </span>
          </span>
        </div>

        {/* Remaining (underpaid → debt) warning */}
        {totalPaid < effectiveTotalInTarget - matchTolerance && (
          <div className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded-md bg-red-500/10 border border-red-500/20">
            <span className="text-red-400">Remaining (Debt)</span>
            <span className="flex items-center gap-2">
              <span className="font-mono font-bold text-red-400">
                {fmtTarget(toDisplayCurrency(effectiveTotalInTarget - totalPaid))}
              </span>
              {showWaiveButton && (
                <button
                  type="button"
                  data-testid="waive-remaining"
                  onClick={() => onWaiveRemaining?.(remainingShortfall)}
                  className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors"
                  title="Waive the remaining shortfall (adds it to the discount)"
                >
                  Waive
                </button>
              )}
            </span>
          </div>
        )}

        {/* Return / Change (overpaid) — choose how to hand the change back */}
        {isOverpaid && (
          <div
            data-testid="return-change"
            className="px-2 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-amber-400 font-medium whitespace-nowrap">
                {keepChange
                  ? "Change kept (profit)"
                  : isCashOnlyPayment
                    ? "Change to return"
                    : "Return / Change"}
              </span>
              <div className="flex items-center gap-1.5">
                {/* T3 keep-change toggle: return nothing, book the extra as
                    profit (docs/plans/T3_KEEP_CHANGE_PLAN.md). OPT-IN: renders
                    only when the parent wired onKeptChange — on a consumer
                    whose backend doesn't accept the kept amounts yet, the
                    button would suppress the return without stamping profit
                    (silent money hole). */}
                {onKeptChange && (
                <button
                  type="button"
                  data-testid="keep-change"
                  onClick={() => setKeepChange((k) => !k)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                    keepChange
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      : "bg-slate-900 text-amber-300 border-amber-700/40 hover:border-amber-500"
                  }`}
                  title={
                    keepChange
                      ? "Keeping the change as profit — tap to return it"
                      : "Return nothing — keep the change as profit"
                  }
                >
                  {keepChange ? "Keeping ✓" : "Keep change"}
                </button>
                )}
                {/* Method selector — only when non-cash methods are available */}
                {!isCashOnlyPayment && !keepChange && (
                  <select
                    data-testid="return-method"
                    value={returnMethod}
                    onChange={(e) => setReturnMethod(e.target.value)}
                    className="bg-slate-900 border border-amber-700/40 rounded-md px-1.5 py-0.5 text-amber-200 text-[11px] focus:outline-none focus:border-amber-500"
                  >
                    {paymentMethods.map((pm) => (
                      <option key={pm.code} value={pm.code}>
                        {pm.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* CASH: dual USD + LBP editable fields */}
            {effectiveReturnMethod === "CASH" ? (
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[11px] pointer-events-none">
                    $
                  </span>
                  <input
                    data-testid="return-usd"
                    type="text"
                    inputMode="decimal"
                    value={returnAmountUSD}
                    onChange={(e) => handleReturnUSDChange(e.target.value)}
                    disabled={keepChange}
                    placeholder="0.00"
                    className={`w-full pl-5 pr-2 py-1 bg-slate-900 border border-amber-700/40 rounded-md text-amber-200 text-sm font-mono text-right focus:outline-none focus:border-amber-500 ${
                      keepChange ? "opacity-60 line-through" : ""
                    }`}
                  />
                </div>
                <div className="flex-1 relative">
                  <input
                    data-testid="return-lbp"
                    type="text"
                    inputMode="numeric"
                    value={returnAmountLBP}
                    onChange={(e) => handleReturnLBPChange(e.target.value)}
                    disabled={keepChange}
                    placeholder="0"
                    className={`w-full pl-2 pr-8 py-1 bg-slate-900 border border-amber-700/40 rounded-md text-amber-200 text-sm font-mono text-right focus:outline-none focus:border-amber-500 ${
                      keepChange ? "opacity-60 line-through" : ""
                    }`}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-[11px] pointer-events-none">
                    LBP
                  </span>
                </div>
              </div>
            ) : (
              /* Non-CASH: currency dropdown + derived read-only amount */
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
                <span className="font-mono font-bold text-amber-300">
                  {returnCurrency === "USD"
                    ? `$${returnAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : Math.round(returnAmount).toLocaleString()}
                </span>
              </div>
            )}

            {returnNeedsClient && (
              <p className="text-[11px] text-red-400">
                Select a client to return change as store credit.
              </p>
            )}
          </div>
        )}

        {/* PM Fees & Grand Total */}
        {showPmFee && totalPmFees > 0 && (
          <div className="pt-1.5 mt-1 border-t border-violet-700/30 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-violet-400">Wallet Surcharge</span>
              <span className="font-mono text-violet-300">
                +{fmtTarget(toDisplayCurrency(totalPmFees))}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white font-semibold">Grand Total</span>
              <span className="font-mono text-white font-bold">
                {fmtTarget(toDisplayCurrency(totalPaid + totalPmFees))}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Validation Messages */}
      {hasDebt && requiresClientForDebt && !hasClient && totalInTarget > 0 && (
        <div className="mx-4 mb-3 text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20 flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Client is required when using DEBT payment method
        </div>
      )}
    </div>
  );
}
