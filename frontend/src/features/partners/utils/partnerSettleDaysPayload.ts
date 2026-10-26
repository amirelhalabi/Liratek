/**
 * LIRA-346 — settle partners by day: the ONE plan and the ONE payload
 * builder (rule 22). The calendar sheet's display (who pays, the credit
 * box, the pre-fill) and its confirm, and "Settle old history up to…", all
 * come from here, on top of core's `buildDaySelections`.
 *
 * Partner rows are signed like the partner balance (spec 346 D1):
 * + the partner owes the shop, − the shop owes the partner. So the core
 * builder's `prefill` > 0 means the PARTNER pays, < 0 the SHOP pays, and its
 * `account_credit` < 0 is partner credit (the shop owes the partner at
 * account level).
 *
 * Server contract (`PartnerSettlementRepository.settleDays`):
 *  - `include_account_credits` is ALWAYS true: the server's stale check sums
 *    the account rows only then, and `expected_owed` includes them.
 *  - `credit_used` only for a currency whose section is sent.
 *  - a section is sent for every currency the picked rows touch, even with
 *    no money (netting / credit close the rows).
 *  - every leg, change included, is in its section's currency.
 */
import {
  allocateAccountSettlement,
  buildDaySelections,
  daySelectionRowKey,
  isSettleRowOpen,
  type AccountSettleAllocRow,
  type DaySelectionsResult,
  type PartnerSettleDaysPayload,
  type PartnerSettleRow,
} from "@liratek/core";

export type PartnerSettleCurrency = "USD" | "LBP";
export type PartnerSettlePayer = "PARTNER" | "SHOP";

export const PARTNER_SETTLE_CURRENCIES: readonly PartnerSettleCurrency[] = [
  "USD",
  "LBP",
];

/** Below this a currency amount counts as 0 (half a cent / half a lira). */
export const PARTNER_SETTLE_EPS: Record<PartnerSettleCurrency, number> = {
  USD: 0.005,
  LBP: 0.5,
};

const KEY: Record<PartnerSettleCurrency, "usd" | "lbp"> = {
  USD: "usd",
  LBP: "lbp",
};

/** Cents for USD, whole lira for LBP. */
export function roundPartnerMoney(
  amount: number,
  currency: PartnerSettleCurrency,
): number {
  const r =
    currency === "USD" ? Math.round(amount * 100) / 100 : Math.round(amount);
  return Object.is(r, -0) ? 0 : r;
}

/** One payment line as `MultiPaymentInput` reports it. */
export interface PartnerSettleLeg {
  method: string;
  currencyCode: string;
  amount: number;
}

export interface PartnerSettleSectionMoney {
  /** Money handed over by the payer (pre-filled with |prefill|). */
  lines?: readonly PartnerSettleLeg[];
  /** Change handed back (sent as `direction: "OUT"` legs). */
  returnLegs?: readonly PartnerSettleLeg[];
  /** Forgive (no cash) — sent only when the partner pays. */
  forgive?: { amount: number; reason?: string };
}

export interface PartnerSettlePlanOptions {
  pickedDays: ReadonlySet<string> | readonly string[];
  /** `"LEDGER:<id>"` keys of picked-day rows the user unticked. */
  untickedRows?: ReadonlySet<string>;
  /** Partner credit to use per currency; missing = the builder's default. */
  creditUsed?: { usd?: number; lbp?: number };
}

export interface PartnerSettlePlanCurrency {
  currency: PartnerSettleCurrency;
  /** A picked row still open in this currency, or partner credit used. */
  touched: boolean;
  /** Who hands the money over (from the pre-fill, else the days' sign). */
  payer: PartnerSettlePayer;
  /** Signed: what the picked days owe in this currency (+ the partner owes). */
  owed: number;
  /** Signed pre-fill: owed − credit used. */
  prefill: number;
  /** Partner credit available (magnitude). */
  creditTotal: number;
  /** The most that may be used here. */
  creditLimit: number;
  /** What is used (typed amount clamped, or the default). */
  creditUsed: number;
}

export interface PartnerSettlePlan {
  selection: DaySelectionsResult<"LEDGER">;
  currencies: Record<PartnerSettleCurrency, PartnerSettlePlanCurrency>;
}

function payerOf(prefill: number, owed: number, c: PartnerSettleCurrency) {
  const eps = PARTNER_SETTLE_EPS[c];
  if (prefill > eps) return "PARTNER";
  if (prefill < -eps) return "SHOP";
  if (owed < -eps) return "SHOP";
  return "PARTNER";
}

/** What a selection means per currency, before any money is entered. */
export function planPartnerSettle(
  openRows: readonly PartnerSettleRow[],
  opts: PartnerSettlePlanOptions,
): PartnerSettlePlan {
  const base = buildDaySelections<"LEDGER">(openRows, {
    pickedDays: opts.pickedDays,
    ...(opts.untickedRows ? { untickedRows: opts.untickedRows } : {}),
  });
  const used = { usd: 0, lbp: 0 };
  const limits = {} as Record<PartnerSettleCurrency, [number, number]>;
  for (const c of PARTNER_SETTLE_CURRENCIES) {
    const k = KEY[c];
    const total = roundPartnerMoney(Math.max(0, -base.account_credit[k]), c);
    const owed = base.owed[k];
    const limit = roundPartnerMoney(owed > 0 ? Math.min(owed, total) : total, c);
    const wanted = opts.creditUsed?.[k] ?? base.credit_used[k];
    used[k] = roundPartnerMoney(Math.min(Math.max(wanted, 0), limit), c);
    limits[c] = [total, limit];
  }
  const selection = buildDaySelections<"LEDGER">(openRows, {
    pickedDays: opts.pickedDays,
    ...(opts.untickedRows ? { untickedRows: opts.untickedRows } : {}),
    creditUsed: used,
  });
  const ids = new Set(selection.selections.map((s) => s.id));
  const currencies = {} as Record<
    PartnerSettleCurrency,
    PartnerSettlePlanCurrency
  >;
  for (const c of PARTNER_SETTLE_CURRENCIES) {
    const k = KEY[c];
    const eps = PARTNER_SETTLE_EPS[c];
    const rowsHere = openRows.some(
      (r) =>
        r.row_scope === "DAY" &&
        ids.has(r.id) &&
        Math.abs(c === "USD" ? r.remaining_usd : r.remaining_lbp) >= eps,
    );
    const owed = selection.owed[k];
    const prefill = roundPartnerMoney(selection.prefill[k], c);
    currencies[c] = {
      currency: c,
      touched: rowsHere || used[k] >= eps,
      payer: payerOf(prefill, owed, c),
      owed,
      prefill,
      creditTotal: limits[c][0],
      creditLimit: limits[c][1],
      creditUsed: used[k],
    };
  }
  return { selection, currencies };
}

export interface BuildPartnerSettleDaysInput extends PartnerSettlePlanOptions {
  partnerId: number;
  openRows: readonly PartnerSettleRow[];
  money?: Partial<Record<PartnerSettleCurrency, PartnerSettleSectionMoney>>;
  notes?: string;
  /** The rate on the payment box (stamp only, never converts). */
  exchangeRate?: number;
}

type Section = NonNullable<
  PartnerSettleDaysPayload["per_currency"]["USD"]
>;

/** THE settle-picked-days payload (typed from the core schema, rule 21). */
export function buildPartnerSettleDaysPayload(
  input: BuildPartnerSettleDaysInput,
): PartnerSettleDaysPayload {
  const plan = planPartnerSettle(input.openRows, input);
  const perCurrency: PartnerSettleDaysPayload["per_currency"] = {};
  const creditUsed = { usd: 0, lbp: 0 };
  for (const c of PARTNER_SETTLE_CURRENCIES) {
    const p = plan.currencies[c];
    if (!p.touched) continue;
    const money = input.money?.[c];
    const payments: Section["payments"] = [
      ...(money?.lines ?? [])
        .filter((l) => l.amount > 0)
        .map((l) => ({
          method: l.method,
          currency_code: l.currencyCode,
          amount: roundPartnerMoney(l.amount, c),
        })),
      ...(money?.returnLegs ?? [])
        .filter((l) => l.amount > 0)
        .map((l) => ({
          method: l.method,
          currency_code: l.currencyCode,
          amount: roundPartnerMoney(l.amount, c),
          direction: "OUT" as const,
        })),
    ];
    const forgive = money?.forgive;
    const forgiveAmount = forgive
      ? roundPartnerMoney(forgive.amount, c)
      : 0;
    const reason = forgive?.reason?.trim();
    const section: Section = {
      payer: p.payer,
      payments,
      ...(p.payer === "PARTNER" && forgiveAmount > 0
        ? {
            forgive: {
              amount: forgiveAmount,
              ...(reason ? { reason } : {}),
            },
          }
        : {}),
    };
    perCurrency[c] = section;
    creditUsed[KEY[c]] = p.creditUsed;
  }
  const notes = input.notes?.trim();
  return {
    partnerId: input.partnerId,
    selections: plan.selection.selections.map((s) => s.id),
    include_account_credits: true,
    credit_used: creditUsed,
    expected_owed: plan.selection.expected_owed,
    per_currency: perCurrency,
    ...(notes ? { notes } : {}),
    ...(input.exchangeRate && input.exchangeRate > 0
      ? { exchange_rate: input.exchangeRate }
      : {}),
  };
}

/** Every shop day up to `upTo` (inclusive) holding an open day row. */
export function oldHistoryDays(
  openRows: readonly PartnerSettleRow[],
  upTo: string,
): string[] {
  const days = new Set<string>();
  for (const r of openRows) {
    if (r.row_scope === "DAY" && r.shop_day <= upTo && isSettleRowOpen(r)) {
      days.add(r.shop_day);
    }
  }
  return [...days].sort();
}

/** Old history uses partner credit only where the old days owe (no money
 *  moves, so credit on a shop-pays currency would apply nothing). */
function oldHistoryCredit(
  openRows: readonly PartnerSettleRow[],
  pickedDays: readonly string[],
): { usd: number; lbp: number } {
  const base = planPartnerSettle(openRows, { pickedDays });
  const out = { usd: 0, lbp: 0 };
  for (const c of PARTNER_SETTLE_CURRENCIES) {
    const p = base.currencies[c];
    out[KEY[c]] = p.owed > 0 ? roundPartnerMoney(Math.min(p.owed, p.creditTotal), c) : 0;
  }
  return out;
}

export interface BuildPartnerOldHistoryInput {
  partnerId: number;
  openRows: readonly PartnerSettleRow[];
  /** `YYYY-MM-DD`, inclusive. */
  upTo: string;
  notes?: string;
}

/** "Settle old history up to…": the same request with no money. */
export function buildPartnerOldHistoryPayload(
  input: BuildPartnerOldHistoryInput,
): PartnerSettleDaysPayload {
  const pickedDays = oldHistoryDays(input.openRows, input.upTo);
  return buildPartnerSettleDaysPayload({
    partnerId: input.partnerId,
    openRows: input.openRows,
    pickedDays,
    creditUsed: oldHistoryCredit(input.openRows, pickedDays),
    ...(input.notes ? { notes: input.notes } : {}),
  });
}

/**
 * Would "Settle old history up to `upTo`" close anything? Runs core's
 * allocator per currency with the SAME inputs the server uses (no money,
 * the picked day rows, every open account row, the old-history credit), so
 * the sheet never offers a confirm the server would refuse with "nothing to
 * settle". Whether anything is taken does not depend on row order, so the
 * rows' `created_at` stands in for the server's `sort_at` here.
 */
export function oldHistoryWouldSettle(
  openRows: readonly PartnerSettleRow[],
  upTo: string,
): boolean {
  const payload = buildPartnerOldHistoryPayload({
    partnerId: 0,
    openRows,
    upTo,
  });
  if (payload.selections.length === 0) return false;
  const ids = new Set(payload.selections);
  for (const c of PARTNER_SETTLE_CURRENCIES) {
    if (!payload.per_currency[c]) continue;
    const eps = PARTNER_SETTLE_EPS[c];
    const rem = (r: PartnerSettleRow) =>
      c === "USD" ? r.remaining_usd : r.remaining_lbp;
    const toAlloc = (r: PartnerSettleRow): AccountSettleAllocRow => ({
      kind: "LEDGER",
      id: r.id,
      member_supplier_id: 0,
      created_at: r.created_at,
      remaining: rem(r),
      commission_model1: false,
      cashout_commission: 0,
    });
    const alloc = allocateAccountSettlement({
      currency: c,
      rows: openRows
        .filter((r) => r.row_scope === "DAY" && ids.has(r.id) && Math.abs(rem(r)) >= eps)
        .map(toAlloc),
      paid: 0,
      commission: 0,
      waive: 0,
      eps,
      account_credits: openRows
        .filter((r) => r.row_scope === "ACCOUNT" && Math.abs(rem(r)) >= eps)
        .map(toAlloc),
      credit_used: payload.credit_used?.[KEY[c]] ?? 0,
    });
    if (alloc.takes.length > 0 && !alloc.credit_used_too_high) return true;
  }
  return false;
}

/** The day-details untick key of a partner row (core's key, rule 14). */
export const partnerSettleRowKey = (row: PartnerSettleRow): string =>
  daySelectionRowKey(row);
