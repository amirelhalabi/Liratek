/**
 * LIRA-343 (US2) — the ONE payload builder for settling picked days
 * (rule 22): the settle sheet, old-history settling and any preview all
 * build `selections` and the totals here, never in their own literal.
 *
 * - `selections`: open DAY rows whose `shop_day` is picked, minus unticked
 *   rows (`"KIND:id"`), minus rows waiting for their statement type
 *   (`isSettleRowWaiting`, the server's own rule), in the order given.
 * - ACCOUNT rows are never selected; the server adds them to the scope with
 *   `include_account_credits`. Their signed sum is `account_credit`.
 * - `expected_owed` = owed + account_credit: what the server stale-checks.
 * - Money is summed in integer minor units (cents / whole LBP).
 *
 * Pure leaf (rule 29): reachable from `browser.ts`.
 */
import {
  isSettleRowOpen,
  isSettleRowWaiting,
  toSettleCents,
  toSettleWholeLbp,
  type OmtSettleRowKind,
  type SettleDayRow,
} from "./settleDays.js";

export type SelectionRow<K extends string = OmtSettleRowKind> = SettleDayRow<K>;

/** One selected row. Generic over the row kind like {@link SettleDayRow}
 *  (LIRA-347: debt items on the Debts page); defaults to the OMT kinds. */
export interface DaySelectionKey<K extends string = OmtSettleRowKind> {
  kind: K;
  id: number;
}

export interface SettleCurrencyPair {
  usd: number;
  lbp: number;
}

export interface BuildDaySelectionsOptions {
  pickedDays: ReadonlySet<string> | readonly string[];
  /** `"KIND:id"`, e.g. `"FINANCIAL_SERVICE:430"`. */
  untickedRows?: ReadonlySet<string>;
  coveredTypes?: readonly string[];
  /** Per currency; a missing currency takes the default. */
  creditUsed?: { usd?: number; lbp?: number };
}

export interface DaySelectionsResult<K extends string = OmtSettleRowKind> {
  selections: DaySelectionKey<K>[];
  /** Signed Σ remaining over `selections`. */
  owed: SettleCurrencyPair;
  /** Signed Σ remaining over ACCOUNT rows (negative = OMT owes the shop). */
  account_credit: SettleCurrencyPair;
  credit_used: SettleCurrencyPair;
  /** owed + account_credit (signed). */
  expected_owed: SettleCurrencyPair;
  /** owed − credit_used (signed: + the shop pays, − OMT pays). */
  prefill: SettleCurrencyPair;
}

/** The `untickedRows` key of a row. */
export const daySelectionRowKey = (row: {
  kind: string;
  id: number;
}): string => `${row.kind}:${row.id}`;

const clean = (n: number): number => (Object.is(n, -0) ? 0 : n);

/** Default credit use, in minor units, per currency: the picked days' debt
 *  caps it when the shop pays; when OMT pays, the whole credit comes back;
 *  when nothing is owed in this currency (nothing picked, or only the
 *  other currency picked), no credit is used, so the payment pre-fills 0
 *  rather than "collect the whole credit". */
function defaultCreditUsed(owed: number, accountCredit: number): number {
  const credit = Math.max(-accountCredit, 0);
  if (owed > 0) return Math.min(owed, credit);
  if (owed < 0) return credit;
  return 0;
}

export function buildDaySelections<K extends string = OmtSettleRowKind>(
  openRows: readonly SettleDayRow<K>[],
  opts: BuildDaySelectionsOptions,
): DaySelectionsResult<K> {
  const picked: ReadonlySet<string> =
    opts.pickedDays instanceof Set
      ? opts.pickedDays
      : new Set(opts.pickedDays as readonly string[]);
  const unticked = opts.untickedRows;

  const selections: DaySelectionKey<K>[] = [];
  let owedUsd = 0;
  let owedLbp = 0;
  let creditUsd = 0;
  let creditLbp = 0;

  for (const r of openRows) {
    if (!isSettleRowOpen(r)) continue;
    if (r.row_scope === "ACCOUNT") {
      creditUsd += toSettleCents(r.remaining_usd);
      creditLbp += toSettleWholeLbp(r.remaining_lbp);
      continue;
    }
    if (!picked.has(r.shop_day)) continue;
    if (unticked?.has(daySelectionRowKey(r))) continue;
    if (isSettleRowWaiting(r, opts.coveredTypes)) continue;
    selections.push({ kind: r.kind, id: r.id });
    owedUsd += toSettleCents(r.remaining_usd);
    owedLbp += toSettleWholeLbp(r.remaining_lbp);
  }

  const usedUsd =
    opts.creditUsed?.usd !== undefined
      ? toSettleCents(opts.creditUsed.usd)
      : defaultCreditUsed(owedUsd, creditUsd);
  const usedLbp =
    opts.creditUsed?.lbp !== undefined
      ? toSettleWholeLbp(opts.creditUsed.lbp)
      : defaultCreditUsed(owedLbp, creditLbp);

  const usd = (cents: number): number => clean(cents / 100);
  const lbp = (whole: number): number => clean(whole);
  return {
    selections,
    owed: { usd: usd(owedUsd), lbp: lbp(owedLbp) },
    account_credit: { usd: usd(creditUsd), lbp: lbp(creditLbp) },
    credit_used: { usd: usd(usedUsd), lbp: lbp(usedLbp) },
    expected_owed: {
      usd: usd(owedUsd + creditUsd),
      lbp: lbp(owedLbp + creditLbp),
    },
    prefill: { usd: usd(owedUsd - usedUsd), lbp: lbp(owedLbp - usedLbp) },
  };
}
