/**
 * LIRA-343 — calendar days from settlement rows (data-model "Day").
 *
 * Generic: any settlement screen whose rows carry `shop_day`, signed
 * `amount_*` / `remaining_*`, covered magnitudes and `row_scope` can use it.
 * Days are never stored; they are worked out here on read.
 *
 * - ACCOUNT rows (research R4) sit on no day and never change a day's
 *   state; the only use of them is `account_marks` (T037): an OPEN account
 *   row an undo / void wrote (`relief_origin` set) marks its own shop day.
 * - Money is summed in integer minor units (cents / whole LBP) so a day's
 *   "left" never drifts; a row is open when either currency's remaining is
 *   not 0 in minor units (|x| < 0.005 USD / 0.5 LBP counts as closed).
 * - Calendar math is pure string / UTC arithmetic: `shop_day` is already the
 *   shop's day (computed by the repository, rule 27), so no local time here.
 *
 * Pure leaf (rule 29): reachable from `browser.ts`; imports only
 * `./omtCoveredTypes.js`. Never import `requestDay.ts` here.
 */
import { isOmtRowCovered, type OmtCoveredType } from "./omtCoveredTypes.js";

export type SettleDayState = "NONE" | "SETTLED" | "UNPAID" | "PARTIAL";
export type SettleCurrencyState = "OWED" | "PART" | "PAID";

/** The OMT settle sheet's row kinds (the default of {@link SettleDayRow}). */
export type OmtSettleRowKind = "FINANCIAL_SERVICE" | "LEDGER";

/**
 * One coverable row on a settle calendar. Generic over its `kind` (LIRA-347:
 * the Debts page passes debt items, `"sale" | "charge" | "member"`); the
 * default keeps the OMT sheet's kinds. Nothing here reads `kind` except the
 * OMT-only statement-type rule, which only matches `"FINANCIAL_SERVICE"`.
 */
export interface SettleDayRow<K extends string = OmtSettleRowKind> {
  shop_day: string;
  kind: K;
  id: number;
  /** Signed: + the shop owes OMT, − OMT owes the shop. */
  amount_usd: number;
  amount_lbp: number;
  /** Magnitude paid so far. */
  covered_usd: number;
  covered_lbp: number;
  /** Signed like `amount_*`; 0 when closed. */
  remaining_usd: number;
  remaining_lbp: number;
  row_scope: "DAY" | "ACCOUNT";
  omt_service_type?: string | null;
  commission_model?: number | null;
  source_provider?: string | null;
  /** T037 — set on an ACCOUNT row an undo / void wrote. */
  relief_origin?: "UNDO" | "VOID" | null;
  /** T037 — `"#<reversed transaction id>"` when `relief_origin` is set. */
  relief_ref?: string | null;
}

export interface SettleAccountMark {
  origin: "UNDO" | "VOID";
  ref: string;
  currency: "USD" | "LBP";
  amount: number;
}

export interface SettleDay {
  day: string;
  state: SettleDayState;
  /** Signed Σ remaining of the day's DAY rows (day credits net in). */
  left_usd: number;
  left_lbp: number;
  /** Σ positive amounts of the day's DAY rows (debts only, closed too). */
  owed_usd: number;
  owed_lbp: number;
  /** Paid share of the day's net amount in that currency, 0..1, measured in
   *  the direction the money goes (see `currencyState`); null when the day
   *  has no amount in that currency. */
  paid_pct_usd: number | null;
  paid_pct_lbp: number | null;
  currency_state_usd: SettleCurrencyState | null;
  currency_state_lbp: SettleCurrencyState | null;
  /** state UNPAID | PARTIAL and day <= today. */
  selectable: boolean;
  /** Open DAY rows waiting for their statement type (research R9). */
  waiting_count: number;
  /** Open undo / void account rows dated this day (T037), per origin,
   *  ref and currency; amount = |remaining|. Never affects `state`. */
  account_marks: SettleAccountMark[];
}

export interface BuildSettleDaysOptions {
  /** The shop's today, `YYYY-MM-DD`. */
  today: string;
  /** `YYYY-MM`. */
  month: string;
  /** OMT statement types; undefined = all covered (non-OMT screens). */
  coveredTypes?: readonly string[];
}

// ── minor units ─────────────────────────────────────────────────────────
/** USD → cents. */
export const toSettleCents = (usd: number): number => Math.round(usd * 100);
/** LBP → whole LBP. */
export const toSettleWholeLbp = (lbp: number): number => Math.round(lbp);
const fromCents = (cents: number): number => cents / 100;
const clean = (n: number): number => (Object.is(n, -0) ? 0 : n);

/** Is the row still open (either currency's remaining ≠ 0 in minor units)? */
export function isSettleRowOpen(
  row: Pick<SettleDayRow<string>, "remaining_usd" | "remaining_lbp">,
): boolean {
  return (
    toSettleCents(row.remaining_usd) !== 0 ||
    toSettleWholeLbp(row.remaining_lbp) !== 0
  );
}

/**
 * THE client-side "waiting for its statement type" predicate. Mirrors the
 * server exactly (`SupplierRepository._amountFirstScope` and
 * `_assertRowsCoveredByStatement`): only FINANCIAL_SERVICE rows with
 * `commission_model = 1` can wait, judged by `isOmtRowCovered`.
 */
export function isSettleRowWaiting(
  row: Pick<
    SettleDayRow<string>,
    "kind" | "commission_model" | "source_provider" | "omt_service_type"
  >,
  coveredTypes: readonly string[] | undefined,
): boolean {
  if (coveredTypes === undefined) return false;
  if (row.kind !== "FINANCIAL_SERVICE" || row.commission_model !== 1) {
    return false;
  }
  return !isOmtRowCovered(
    {
      provider: row.source_provider ?? null,
      omt_service_type: row.omt_service_type ?? null,
    },
    coveredTypes as readonly OmtCoveredType[],
  );
}

/** Every `YYYY-MM-DD` of `month` (`YYYY-MM`), in order. Pure UTC math. */
export function daysOfMonth(month: string): string[] {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`Invalid month "${month}" (expected YYYY-MM)`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= count; d++) {
    out.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

/**
 * One currency's badge and % for a day, measured in the direction the day's
 * money goes (owner scenario 2026-10-27): the day's NET amount is what is
 * owed — by the shop when positive, by OMT / the other side when negative —
 * and `left` in that same direction is what is still open. So a send netted
 * by a receive on the same day is not counted as a payment, and a day OMT
 * still owes on reads partly paid instead of "PAID".
 *
 * A day whose sends and receives net to exactly 0 falls back to its larger
 * side. `PAID` only when nothing is left; money left in the other direction
 * keeps the currency at `PART`. Null when the day has no amount in it.
 */
function currencyState(
  debtMinor: number,
  creditMinor: number,
  netMinor: number,
  leftMinor: number,
): { pct: number | null; state: SettleCurrencyState | null } {
  if (debtMinor === 0 && creditMinor === 0) return { pct: null, state: null };
  const sign =
    netMinor !== 0 ? Math.sign(netMinor) : debtMinor >= creditMinor ? 1 : -1;
  const total =
    netMinor !== 0 ? Math.abs(netMinor) : Math.max(debtMinor, creditMinor);
  const leftThisWay = Math.max(sign * leftMinor, 0);
  const paid = Math.min(Math.max(total - leftThisWay, 0), total);
  const state: SettleCurrencyState =
    leftMinor === 0 ? "PAID" : paid === 0 ? "OWED" : "PART";
  return { pct: paid / total, state };
}

/** T037 — marks from the open undo / void ACCOUNT rows of one day. */
function marksOf(rows: readonly SettleDayRow<string>[]): SettleAccountMark[] {
  const sums = new Map<string, SettleAccountMark & { minor: number }>();
  for (const r of rows) {
    if (r.row_scope !== "ACCOUNT" || !r.relief_origin) continue;
    const parts: Array<["USD" | "LBP", number]> = [
      ["USD", toSettleCents(r.remaining_usd)],
      ["LBP", toSettleWholeLbp(r.remaining_lbp)],
    ];
    for (const [currency, minor] of parts) {
      if (minor === 0) continue;
      const ref = r.relief_ref ?? "";
      const key = `${r.relief_origin}|${ref}|${currency}`;
      const prev = sums.get(key);
      if (prev) prev.minor += Math.abs(minor);
      else
        sums.set(key, {
          origin: r.relief_origin,
          ref,
          currency,
          amount: 0,
          minor: Math.abs(minor),
        });
    }
  }
  return [...sums.values()].map(({ minor, ...m }) => ({
    ...m,
    amount: m.currency === "USD" ? fromCents(minor) : minor,
  }));
}

function buildDay(
  day: string,
  rows: readonly SettleDayRow<string>[],
  today: string,
  coveredTypes: readonly string[] | undefined,
  marks: SettleAccountMark[] = [],
): SettleDay {
  let leftUsd = 0;
  let leftLbp = 0;
  let owedUsd = 0;
  let owedLbp = 0;
  let creditUsd = 0;
  let creditLbp = 0;
  let anyOpen = false;
  let anyCovered = false;
  let waiting = 0;
  for (const r of rows) {
    const amtUsd = toSettleCents(r.amount_usd);
    const amtLbp = toSettleWholeLbp(r.amount_lbp);
    if (amtUsd > 0) owedUsd += amtUsd;
    else creditUsd -= amtUsd;
    if (amtLbp > 0) owedLbp += amtLbp;
    else creditLbp -= amtLbp;
    if (
      toSettleCents(r.covered_usd) !== 0 ||
      toSettleWholeLbp(r.covered_lbp) !== 0
    ) {
      anyCovered = true;
    }
    if (isSettleRowOpen(r)) {
      anyOpen = true;
      leftUsd += toSettleCents(r.remaining_usd);
      leftLbp += toSettleWholeLbp(r.remaining_lbp);
      if (isSettleRowWaiting(r, coveredTypes)) waiting++;
    } else if (amtUsd !== 0 || amtLbp !== 0) {
      // a closed row that owed something means something on the day was
      // settled (legacy whole-row settled rows carry no coverage). A row
      // born with nothing owed (owed 0) was never paid, so it does not.
      anyCovered = true;
    }
  }
  const state: SettleDayState =
    rows.length === 0
      ? "NONE"
      : !anyOpen
        ? "SETTLED"
        : anyCovered
          ? "PARTIAL"
          : "UNPAID";
  const usd = currencyState(owedUsd, creditUsd, owedUsd - creditUsd, leftUsd);
  const lbp = currencyState(owedLbp, creditLbp, owedLbp - creditLbp, leftLbp);
  return {
    day,
    state,
    left_usd: clean(fromCents(leftUsd)),
    left_lbp: clean(leftLbp),
    owed_usd: fromCents(owedUsd),
    owed_lbp: owedLbp,
    paid_pct_usd: usd.pct,
    paid_pct_lbp: lbp.pct,
    currency_state_usd: usd.state,
    currency_state_lbp: lbp.state,
    selectable: (state === "UNPAID" || state === "PARTIAL") && day <= today,
    waiting_count: waiting,
    account_marks: marks,
  };
}

/** One {@link SettleDay} per calendar day of `opts.month`, in order. */
export function buildSettleDays(
  rows: readonly SettleDayRow<string>[],
  opts: BuildSettleDaysOptions,
): SettleDay[] {
  const byDay = new Map<string, SettleDayRow<string>[]>();
  const accountByDay = new Map<string, SettleDayRow<string>[]>();
  for (const r of rows) {
    const target = r.row_scope === "DAY" ? byDay : accountByDay;
    const list = target.get(r.shop_day);
    if (list) list.push(r);
    else target.set(r.shop_day, [r]);
  }
  return daysOfMonth(opts.month).map((day) =>
    buildDay(
      day,
      byDay.get(day) ?? [],
      opts.today,
      opts.coveredTypes,
      marksOf(accountByDay.get(day) ?? []),
    ),
  );
}

/** Sorted shop days (any month) holding an open DAY row, before `today`. */
export function openDaysBefore(
  rows: readonly SettleDayRow<string>[],
  today: string,
): string[] {
  const days = new Set<string>();
  for (const r of rows) {
    if (r.row_scope === "DAY" && r.shop_day < today && isSettleRowOpen(r)) {
      days.add(r.shop_day);
    }
  }
  return [...days].sort();
}

/** "Left this month": Σ `left_*` over the days. */
export function monthLeft(days: readonly SettleDay[]): {
  usd: number;
  lbp: number;
} {
  let usd = 0;
  let lbp = 0;
  for (const d of days) {
    usd += toSettleCents(d.left_usd);
    lbp += toSettleWholeLbp(d.left_lbp);
  }
  return { usd: clean(fromCents(usd)), lbp: clean(lbp) };
}
