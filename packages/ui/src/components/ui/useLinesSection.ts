import { useEffect, useRef, useState } from "react";
import type { PaymentLine, PaymentMethod } from "./MultiPaymentInput";

/**
 * LIRA-321 — the state of the "Customer pays" (money-in) section of the
 * payment box: single vs split mode, the lines, the leftover line, Forgive,
 * and the balance it reports to the page (contracts/payment-box.md).
 *
 * Kept apart from MultiPaymentInput's main ("Shop pays") lines on purpose:
 * those are bound to the discount, `allocatePayments` and the auto-debt
 * remainder, and must never read these lines (research R1).
 */

export interface LinesSectionSeed {
  method: string;
  currencyCode: string;
  amount: number;
}

export interface LinesSectionState {
  /** Non-account lines, in the section currency. */
  paid: number;
  /** CUSTOMER_ACCOUNT lines, in the section currency. */
  owedToAccount: number;
  forgiven: number;
  /** paid + owedToAccount + forgiven === totalAmount (within tolerance). */
  balanced: boolean;
  /** The lines add up to more than totalAmount. Never auto-corrected. */
  overpaid: boolean;
  /** A CUSTOMER_ACCOUNT line with no client. */
  needsClient: boolean;
  /** totalAmount − paid − owedToAccount − forgiven (≥ 0). */
  unaccounted: number;
}

export interface UseLinesSectionOptions {
  /** False when the page passes no counterFlow — the hook then idles. */
  enabled: boolean;
  totalAmount: number;
  currency: string;
  seedLines?: LinesSectionSeed[];
  /** The methods this section offers (already client-gated). */
  methods: PaymentMethod[];
  hasClient: boolean;
  maxForgive?: number;
  convert: (amount: number, from: string, to: string) => number;
  round: (amount: number, currency: string) => number;
  onChange?: (lines: PaymentLine[]) => void;
  onStateChange?: (state: LinesSectionState) => void;
}

const ACCOUNT = "CUSTOMER_ACCOUNT";

/** Below this a gap counts as settled (same tolerance as the main lines). */
function toleranceFor(currency: string): number {
  return currency === "LBP" ? 100 : 0.01;
}

function roundReport(amount: number, currency: string): number {
  return currency === "LBP"
    ? Math.round(amount)
    : Math.round(amount * 100) / 100;
}

export function useLinesSection(opts: UseLinesSectionOptions) {
  const {
    enabled,
    totalAmount,
    currency,
    seedLines,
    methods,
    hasClient,
    maxForgive,
  } = opts;

  // Callbacks and helpers change identity every render (pages pass a fresh
  // counterFlow object) — read them through a ref so effects never re-fire
  // on identity churn (CLAUDE.md rule 25).
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [lines, setLines] = useState<PaymentLine[]>([]);
  const [isSplit, setIsSplit] = useState(false);
  const [forgiveOn, setForgiveOn] = useState(false);
  /** The cashier edited something — stop re-seeding from the props. */
  const touchedRef = useRef(false);
  /** The leftover line whose amount still follows the other lines. */
  const followIdRef = useRef<string | null>(null);
  /** Account leftover lines the section added by itself (never "+ Add
   *  line" lines) whose method the cashier has not changed — dropped again
   *  when the account stops being offered (client unpicked). */
  const autoMethodIdsRef = useRef<Set<string>>(new Set());
  /** Split was entered by the leftover rule, not by the Split button. */
  const autoSplitRef = useRef(false);

  const tol = toleranceFor(currency);
  const accountOffered = methods.some((m) => m.code === ACCOUNT);

  const emit = (next: PaymentLine[]) => {
    setLines(next);
    optsRef.current.onChange?.(next);
  };

  const inCurrency = (l: PaymentLine): number =>
    optsRef.current.convert(l.amount || 0, l.currencyCode, currency);

  const sumExcept = (ls: PaymentLine[], excludeId?: string): number =>
    ls
      .filter((l) => l.id !== excludeId)
      .reduce((s, l) => s + inCurrency(l), 0);

  const leftoverMethod = (remaining: number): string =>
    remaining > tol && accountOffered ? ACCOUNT : "CASH";

  const clearTracking = () => {
    followIdRef.current = null;
    autoMethodIdsRef.current = new Set();
    autoSplitRef.current = false;
  };

  // ── Seed from the props until the cashier edits ──────────────────────────
  const seedKey = JSON.stringify(seedLines ?? null);
  useEffect(() => {
    if (!enabled) {
      // Section hidden: forget the cashier's edits so it re-seeds fresh
      // when the page shows it again.
      touchedRef.current = false;
      clearTracking();
      setForgiveOn(false);
      setIsSplit(false);
      setLines((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    if (touchedRef.current) return;
    const seeds: LinesSectionSeed[] =
      seedLines && seedLines.length > 0
        ? seedLines
        : [
            {
              method: lines[0]?.method ?? "CASH",
              currencyCode: currency,
              amount: totalAmount,
            },
          ];
    const same =
      lines.length === seeds.length &&
      seeds.every(
        (s, i) =>
          lines[i].method === s.method &&
          lines[i].currencyCode === s.currencyCode &&
          lines[i].amount === s.amount,
      );
    const next: PaymentLine[] = same
      ? lines
      : seeds.map((s, i) => ({
          id: lines[i]?.id ?? crypto.randomUUID(),
          method: s.method,
          currencyCode: s.currencyCode,
          amount: s.amount,
        }));
    if (!same) setLines(next);
    setIsSplit(seeds.length > 1);
    // Always notify, even when unchanged, so the page's state matches the
    // screen from the first render.
    optsRef.current.onChange?.(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, totalAmount, currency, seedKey]);

  // ── The account becomes offered (client picked) while something is still
  //    unsettled → add the account leftover. It stops being offered (client
  //    unpicked) → drop the auto account line; never turn it into cash, which
  //    would balance on money the customer never handed over (US1.3). ──────
  const prevAccountOfferedRef = useRef(accountOffered);
  useEffect(() => {
    const was = prevAccountOfferedRef.current;
    prevAccountOfferedRef.current = accountOffered;
    if (!enabled || lines.length === 0 || was === accountOffered) return;

    if (!accountOffered) {
      const autoIds = autoMethodIdsRef.current;
      if (autoIds.size === 0) return;
      const next = lines.filter((l) => !autoIds.has(l.id));
      if (followIdRef.current && autoIds.has(followIdRef.current)) {
        followIdRef.current = null;
      }
      autoMethodIdsRef.current = new Set();
      if (autoSplitRef.current && next.length === 1) {
        autoSplitRef.current = false;
        setIsSplit(false);
      }
      if (next.length !== lines.length) emit(next);
      return;
    }

    if (lines.some((l) => l.method === ACCOUNT)) return;
    if (forgiveOn && canForgive) return; // already settled by Forgive
    const remaining = totalAmount - sumExcept(lines);
    if (remaining <= tol) return;
    const id = crypto.randomUUID();
    followIdRef.current = id;
    autoMethodIdsRef.current = new Set([id]);
    if (!isSplit) {
      autoSplitRef.current = true;
      setIsSplit(true);
    }
    emit([
      ...lines,
      {
        id,
        method: ACCOUNT,
        currencyCode: currency,
        amount: optsRef.current.round(remaining, currency),
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, accountOffered]);

  /** Keep the following leftover at what the other lines leave unpaid;
   *  drop it once nothing is left (and fold an auto split back). */
  const syncLeftover = (ls: PaymentLine[]): PaymentLine[] => {
    const id = followIdRef.current;
    if (!id || !ls.some((l) => l.id === id)) return ls;
    const remaining = totalAmount - sumExcept(ls, id);
    if (remaining <= tol) {
      followIdRef.current = null;
      autoMethodIdsRef.current.delete(id);
      const without = ls.filter((l) => l.id !== id);
      if (autoSplitRef.current && without.length === 1) {
        autoSplitRef.current = false;
        setIsSplit(false);
      }
      return without;
    }
    return ls.map((l) =>
      l.id === id
        ? {
            ...l,
            amount: optsRef.current.round(
              optsRef.current.convert(remaining, currency, l.currencyCode),
              l.currencyCode,
            ),
          }
        : l,
    );
  };

  const updateLine = (
    id: string,
    field: keyof PaymentLine,
    value: string | number,
  ) => {
    if (!enabled) return;
    touchedRef.current = true;
    setForgiveOn(false);
    if (id === followIdRef.current && field !== "method") {
      followIdRef.current = null; // the cashier owns this amount now
    }
    if (field === "method") autoMethodIdsRef.current.delete(id);

    let next = lines.map((line) => {
      if (line.id !== id) return line;
      const updated: PaymentLine = { ...line, [field]: value };
      if (field === "currencyCode" && value !== line.currencyCode) {
        const newCurr = value as string;
        updated.amount = optsRef.current.round(
          optsRef.current.convert(line.amount, line.currencyCode, newCurr),
          newCurr,
        );
      }
      return updated;
    });

    if (!isSplit && next.length === 1 && field !== "method") {
      // Single mode: less than the total → split, with an account leftover
      // line — only when the account is offered. With no account there is
      // NO auto line (a cash one would balance on money never handed over);
      // the gap stays in `unaccounted` and Confirm stays off (US1.3).
      const remaining = totalAmount - sumExcept(next);
      if (remaining > tol && accountOffered) {
        const leftoverId = crypto.randomUUID();
        followIdRef.current = leftoverId;
        autoMethodIdsRef.current = new Set([leftoverId]);
        autoSplitRef.current = true;
        setIsSplit(true);
        next = [
          ...next,
          {
            id: leftoverId,
            method: ACCOUNT,
            currencyCode: currency,
            amount: optsRef.current.round(remaining, currency),
          },
        ];
      }
    } else if (field !== "method") {
      next = syncLeftover(next);
      // Split mode: the lines now come to less than owed and nothing puts
      // the gap on the account yet → add the account leftover, tracked like
      // single mode's (follows later edits, dropped when the gap closes or
      // the client is unpicked). Only when the account is offered — never
      // an automatic cash line (US1.3). A line the cashier edited by hand
      // is an ACCOUNT line already or not tracked, so it is never touched.
      const followAlive =
        !!followIdRef.current &&
        next.some((l) => l.id === followIdRef.current);
      if (
        accountOffered &&
        !followAlive &&
        !next.some((l) => l.method === ACCOUNT)
      ) {
        const remaining = totalAmount - sumExcept(next);
        if (remaining > tol) {
          const leftoverId = crypto.randomUUID();
          followIdRef.current = leftoverId;
          autoMethodIdsRef.current = new Set([
            ...autoMethodIdsRef.current,
            leftoverId,
          ]);
          next = [
            ...next,
            {
              id: leftoverId,
              method: ACCOUNT,
              currencyCode: currency,
              amount: optsRef.current.round(remaining, currency),
            },
          ];
        }
      }
    }
    emit(next);
  };

  const addLine = () => {
    if (!enabled) return;
    touchedRef.current = true;
    setForgiveOn(false);
    followIdRef.current = null;
    autoSplitRef.current = false;
    setIsSplit(true);
    const remaining = Math.max(0, totalAmount - sumExcept(lines));
    // A "+ Add line" line is explicit: it keeps its method on client pick.
    const id = crypto.randomUUID();
    emit([
      ...lines,
      {
        id,
        method: leftoverMethod(remaining),
        currencyCode: currency,
        amount: optsRef.current.round(remaining, currency),
      },
    ]);
  };

  const removeLine = (id: string) => {
    if (!enabled || lines.length <= 1) return;
    touchedRef.current = true;
    setForgiveOn(false);
    if (followIdRef.current === id) followIdRef.current = null;
    autoMethodIdsRef.current.delete(id);
    autoSplitRef.current = false;
    emit(lines.filter((l) => l.id !== id));
  };

  const toggleSplit = () => {
    if (!enabled) return;
    setForgiveOn(false);
    clearTracking();
    if (isSplit) {
      // Back to single: one line at the full amount, re-seedable again.
      touchedRef.current = false;
      setIsSplit(false);
      emit([
        {
          id: lines[0]?.id ?? crypto.randomUUID(),
          method: lines[0]?.method || "CASH",
          currencyCode: currency,
          amount: totalAmount,
        },
      ]);
    } else {
      touchedRef.current = true;
      setIsSplit(true);
    }
  };

  // ── Balance ──────────────────────────────────────────────────────────────
  let paidRaw = 0;
  let owedRaw = 0;
  for (const l of lines) {
    const v = inCurrency(l);
    if (l.method === ACCOUNT) owedRaw += v;
    else paidRaw += v;
  }
  const gap = totalAmount - paidRaw - owedRaw;
  const shortfall = gap > tol ? gap : 0;
  const overpaid = -gap > tol;
  const canForgive =
    shortfall > 0 && maxForgive !== undefined && shortfall <= maxForgive + tol;
  const forgivenRaw = forgiveOn && canForgive ? shortfall : 0;
  const unaccountedRaw = shortfall - forgivenRaw;
  const state: LinesSectionState = {
    paid: roundReport(paidRaw, currency),
    owedToAccount: roundReport(owedRaw, currency),
    forgiven: roundReport(forgivenRaw, currency),
    balanced: !overpaid && unaccountedRaw === 0,
    overpaid,
    needsClient:
      !hasClient && lines.some((l) => l.method === ACCOUNT && l.amount > 0),
    unaccounted: roundReport(unaccountedRaw, currency),
  };

  // Report only when a value changes — the deps are plain numbers/booleans.
  useEffect(() => {
    if (!enabled || lines.length === 0) return; // not seeded yet
    optsRef.current.onStateChange?.({ ...state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    lines.length === 0,
    state.paid,
    state.owedToAccount,
    state.forgiven,
    state.balanced,
    state.overpaid,
    state.needsClient,
    state.unaccounted,
  ]);

  return {
    lines,
    isSplit,
    state,
    accountOffered,
    shortfall: roundReport(shortfall, currency),
    canForgive,
    forgiveOn: forgiveOn && canForgive,
    toggleForgive: () => setForgiveOn((v) => !v),
    toggleSplit,
    addLine,
    removeLine,
    updateLine,
  };
}
