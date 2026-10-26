/**
 * LIRA-347 — the LIRA-343 settle-by-day calendar for CLIENT debts (Debts
 * page). Pure leaf (rule 29): reachable from `browser.ts`; imports only
 * other pure utils.
 *
 * - A debt "day row" is one coverable item — an unpaid-on-account sale, a
 *   module charge, a basket member — on the shop day it was booked
 *   (`shopDay`, computed by the repository with `localDayExpr`, rule 27).
 *   The generic {@link buildSettleDays} paints the month from them.
 * - Debts with no item (manual / imported / opening balance) and the
 *   client's unapplied credit sit on no day: they are the two derived
 *   "account lines" ({@link DebtAccountLines}), the same gap the repayment
 *   picker's "Earlier balance (no items)" line comes from.
 * - Picking days builds the repayment's `targets` through the generic
 *   {@link buildDaySelections} — ONE payload builder (rule 22).
 */
import type {
  AllocationItem,
  DebtItemKind,
  DebtItemRef,
  OpenDebtItem,
} from "./debtRepaymentAllocation.js";
import {
  buildDaySelections,
  type SettleCurrencyPair,
} from "./settleDaySelections.js";
import type { SettleDayRow } from "./settleDays.js";

/** The debt item kinds that sit on a day (the earlier-balance line never does). */
export type DebtDayKind = Exclude<DebtItemKind, "balance">;

/** One row of `DebtRepository.getClientDebtMonthRows`: a coverable item of
 *  the month, open or closed, with what the cashier reads. */
export interface DebtMonthRow extends SettleDayRow<DebtDayKind> {
  /** The item's own transaction summary. */
  label: string;
  /** Its transaction type (SALE, FINANCIAL_SERVICE, LOTO, …). */
  type: string | null;
  /** Set on basket members. */
  session_id: number | null;
}

/**
 * The two derived account lines of a client, per currency (each ≥ 0):
 * `earlier_*` — debt no listed item accounts for (the picker's
 * "Earlier balance (no items)" line, same figures); `credit_*` — credit not
 * yet applied to any item, the most "Use credit" may take.
 */
export interface DebtAccountLines {
  earlier_usd: number;
  earlier_lbp: number;
  credit_usd: number;
  credit_lbp: number;
}

export interface DebtMonthRows {
  /** `YYYY-MM`. */
  month: string;
  rows: DebtMonthRow[];
  account: DebtAccountLines;
}

const roundUsd = (n: number): number => Math.round(n * 100) / 100;
const roundLbp = (n: number): number => Math.round(n);

/**
 * THE gap between a client's ledger balance and its open items, split into
 * the two account lines (rule 14: `DebtRepository` uses this for both the
 * earlier-balance line and the credit "Use credit" may take).
 *
 * Per currency `gap = balance − Σ open items`: > 0 is debt with no item,
 * < 0 is credit not yet applied. A credit in one currency nets against a
 * no-item debt in the other at `rate` first (the LIRA-308 earlier-balance
 * rule, unchanged), so the credit left over is what remains after that.
 * Rounded to cents / whole LBP. The earlier-balance noise floor is the
 * caller's.
 */
export function splitAccountGap(
  balance: { usd: number; lbp: number },
  open: { usd: number; lbp: number },
  rate: number,
): DebtAccountLines {
  const r = rate > 0 ? rate : 1;
  let gapUsd = balance.usd - open.usd;
  let gapLbp = balance.lbp - open.lbp;
  if (gapUsd < 0 && gapLbp > 0) {
    gapLbp = gapLbp + gapUsd * r;
    gapUsd = gapLbp < 0 ? gapLbp / r : 0;
    gapLbp = Math.max(0, gapLbp);
  } else if (gapLbp < 0 && gapUsd > 0) {
    gapUsd = gapUsd + gapLbp / r;
    gapLbp = gapUsd < 0 ? gapUsd * r : 0;
    gapUsd = Math.max(0, gapUsd);
  }
  const clean = (n: number): number => (Object.is(n, -0) ? 0 : n);
  return {
    earlier_usd: clean(roundUsd(Math.max(0, gapUsd))),
    earlier_lbp: clean(roundLbp(Math.max(0, gapLbp))),
    credit_usd: clean(roundUsd(Math.max(0, -gapUsd))),
    credit_lbp: clean(roundLbp(Math.max(0, -gapLbp))),
  };
}

/**
 * THE stale-check figure (rule 14, shared by the Debts page and
 * `DebtRepository.addRepayment`): what the cashier's own ticks (not the
 * `auto` ones the amount added) are still owed, per currency.
 */
export function ownTargetsOpen(
  items: readonly Pick<AllocationItem, "kind" | "id" | "openUsd" | "openLbp">[],
  targets: readonly DebtItemRef[],
): SettleCurrencyPair {
  let usd = 0;
  let lbp = 0;
  for (const t of targets) {
    if (t.auto) continue;
    const it = items.find((i) => i.kind === t.kind && i.id === t.id);
    if (!it) continue;
    usd += Math.max(0, it.openUsd);
    lbp += Math.max(0, it.openLbp);
  }
  return { usd: roundUsd(usd), lbp: roundLbp(lbp) };
}

/** Is the stale check passed? Same tolerance as the coverage epsilons. */
export function expectedOwedMatches(
  expected: SettleCurrencyPair,
  actual: SettleCurrencyPair,
): boolean {
  return (
    Math.abs(expected.usd - actual.usd) < 0.01 &&
    Math.abs(expected.lbp - actual.lbp) < 1
  );
}

/** Open items as DAY rows (items with no shop day — the earlier-balance
 *  line — are left out). `amount_*` = what is open; nothing covered. */
export function debtItemsToSettleRows(
  items: readonly OpenDebtItem[],
): SettleDayRow<DebtDayKind>[] {
  const out: SettleDayRow<DebtDayKind>[] = [];
  for (const it of items) {
    if (it.kind === "balance" || !it.shopDay) continue;
    out.push({
      shop_day: it.shopDay,
      kind: it.kind,
      id: it.id,
      amount_usd: it.openUsd,
      amount_lbp: it.openLbp,
      covered_usd: 0,
      covered_lbp: 0,
      remaining_usd: it.openUsd,
      remaining_lbp: it.openLbp,
      row_scope: "DAY",
    });
  }
  return out;
}

export interface BuildDebtDayTargetsOptions {
  pickedDays: ReadonlySet<string> | readonly string[];
  /** `"kind:id"` keys of items unticked inside a picked day. */
  untickedRows?: ReadonlySet<string>;
  /** Credit available (the `credit_*` account line). */
  credit: { usd: number; lbp: number };
  /** The cashier's "Use credit" amount per currency; missing = pre-fill
   *  min(what the picked days owe, credit). Clamped to that limit. */
  creditUsed?: { usd?: number; lbp?: number };
}

export interface DebtDayTargets {
  /** The picked days' open items, as the cashier's ticks. */
  targets: DebtItemRef[];
  /** What those items owe (the stale check's `expectedOwed`). */
  owed: SettleCurrencyPair;
  /** "Use credit", clamped to 0 … min(owed, credit) per currency. */
  credit_used: SettleCurrencyPair;
  /** The payment to pre-fill: owed − credit_used. */
  prefill: SettleCurrencyPair;
}

/**
 * THE builder for "pay these days" (rule 22): the Debts page's calendar
 * calls only this to turn picked days into the repayment's ticks, the
 * expected-owed figure and the credit / payment pre-fill. Built on the
 * generic {@link buildDaySelections}; the client's credit enters as an
 * ACCOUNT row (never selected, never on a day).
 */
export function buildDebtDayTargets(
  openItems: readonly OpenDebtItem[],
  opts: BuildDebtDayTargetsOptions,
): DebtDayTargets {
  const rows: SettleDayRow<DebtDayKind>[] = debtItemsToSettleRows(openItems);
  const creditUsd = Math.max(0, opts.credit.usd);
  const creditLbp = Math.max(0, opts.credit.lbp);
  if (creditUsd > 0 || creditLbp > 0) {
    // Synthetic ACCOUNT row (kind/id unused: ACCOUNT rows are never
    // selected). Negative remaining = credit, as on the OMT sheet.
    rows.push({
      shop_day: "",
      kind: "charge",
      id: 0,
      amount_usd: -creditUsd,
      amount_lbp: -creditLbp,
      covered_usd: 0,
      covered_lbp: 0,
      remaining_usd: -creditUsd,
      remaining_lbp: -creditLbp,
      row_scope: "ACCOUNT",
    });
  }
  const base = buildDaySelections(rows, {
    pickedDays: opts.pickedDays,
    ...(opts.untickedRows ? { untickedRows: opts.untickedRows } : {}),
  });
  const limitUsd = Math.max(0, Math.min(base.owed.usd, creditUsd));
  const limitLbp = Math.max(0, Math.min(base.owed.lbp, creditLbp));
  const pick = (v: number | undefined, limit: number, round: (n: number) => number) =>
    v === undefined ? limit : round(Math.min(Math.max(0, v), limit));
  const usedUsd = pick(opts.creditUsed?.usd, limitUsd, roundUsd);
  const usedLbp = pick(opts.creditUsed?.lbp, limitLbp, roundLbp);
  return {
    targets: base.selections.map((s) => ({ kind: s.kind, id: s.id })),
    owed: base.owed,
    credit_used: { usd: usedUsd, lbp: usedLbp },
    prefill: {
      usd: roundUsd(Math.max(0, base.owed.usd - usedUsd)),
      lbp: roundLbp(Math.max(0, base.owed.lbp - usedLbp)),
    },
  };
}
