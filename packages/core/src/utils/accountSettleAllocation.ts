/**
 * LIRA-322 — settle the OMT account by amount, one currency at a time.
 * Contract: specs/322-omt-amount-first-settle/contracts/allocator.md
 * (research R3/R4/R12).
 *
 * The ONE rule deciding what a settlement closes (rule 14): the Settle
 * Account sheet's preview and `SupplierRepository`'s write both call this,
 * so they agree to the cent.
 *
 * Per currency, all amounts signed (+ the shop owes OMT, − OMT owes the
 * shop):
 *   1. Netting — open credits are applied oldest first to open debts, up to
 *      the smaller total. Both sides get NETTING coverage of equal size.
 *   2. Budget S = paid ± waive (the waive takes the sign of what is owed
 *      after netting). S > 0 covers debts oldest first, S < 0 covers
 *      credits oldest first. Within the budget the waive is consumed first,
 *      then the money.
 *   3. Extra — budget left after every in-scope row is covered.
 *   4. The entered commission is split over the commission-model-1 rows
 *      this settlement CLOSES, in proportion to what each owed before it
 *      (largest remainder, cents / whole LBP). That split is for PROFIT
 *      only.
 *
 * LIRA-343 (specs/343-omt-settle-by-day research R5, contract
 * "LIRA-343 extension" in the allocator.md above): optional
 * `account_credits` (account-level rows, kept apart from `rows`) and the
 * user-chosen `credit_used`. Positive account rows net against negative
 * ones, then join the scope as debts after the day debts. Shop pays:
 * exactly `credit_used` of account credit covers the oldest debts
 * (NETTING) before the money. OMT pays: the money received covers the day
 * credits, then up to `credit_used` of account credit (PAYMENT). Account
 * credit never makes extra. Absent/empty = LIRA-322 output, unchanged.
 *
 * The commission is NEVER a coverage source (owner decision 2026-10-15,
 * replacing FR-013a: "Pay the amount in full; don't let the commission
 * amount affect the payment leg amount. After the payment is processed, the
 * commission amount is credited to the supplier account."). Only money and
 * a waive close rows; the repository books the commission as an open credit
 * on the account, which nets first at the next settlement.
 *
 * Order: `created_at` compared as a STRING (never `new Date()` — rule 27;
 * matches SQL `ORDER BY created_at`), then kind (FINANCIAL_SERVICE before
 * LEDGER), then id.
 *
 * All arithmetic runs in integer minor units (USD cents, whole LBP), so
 * 496.30 − 476 is exactly 20.30, never 20.299999….
 *
 * PURE and a LEAF (rule 29): reachable from `browser.ts`, so it imports
 * only other pure utils and no Node built-in, at any depth.
 */
import { allocateFifo } from "./fifoCoverage.js";
import { allocateProportional } from "./largestRemainder.js";

export type AccountSettleRowKind = "FINANCIAL_SERVICE" | "LEDGER";
export type AccountSettleCurrency = "USD" | "LBP";
/**
 * "COMMISSION" is a legacy value: coverage rows written before the owner
 * decision of 2026-10-15 may carry it (the table's CHECK keeps it), but the
 * allocator no longer emits it.
 */
export type AccountSettleCoverageSource =
  | "NETTING"
  | "PAYMENT"
  | "COMMISSION"
  | "WAIVE";

/** One in-scope queue row, in ONE currency. */
export interface AccountSettleAllocRow {
  kind: AccountSettleRowKind;
  id: number;
  member_supplier_id: number;
  /** Compared as a string. */
  created_at: string;
  /** Signed, this currency: + shop owes, − OMT owes. Already net of earlier coverage. */
  remaining: number;
  /** Eligible for the entered-commission allocation. */
  commission_model1: boolean;
  /** Deferred commission recognised if this credit closes. */
  cashout_commission: number;
}

export interface AccountSettleAllocInput {
  currency: AccountSettleCurrency;
  /** Already scoped (selections, covered types), this currency only. */
  rows: AccountSettleAllocRow[];
  /** Signed money toward rows: + shop paid, − shop received. */
  paid: number;
  /** ≥ 0. Never covers a row — drives the profit split over closed
   *  commission-model-1 rows only (owner decision 2026-10-15). */
  commission: number;
  /** ≥ 0. Takes the sign of what is owed after netting. */
  waive: number;
  /** 0.005 USD, 0.5 LBP. */
  eps: number;
  /**
   * LIRA-343 (research R5). Open account-level rows (`row_scope =
   * 'ACCOUNT'`), this currency, kept APART from `rows`. Usually remaining
   * < 0 (OMT owes the shop); a positive one (shop owes OMT) is possible.
   * Absent or empty = the LIRA-322 behaviour, byte-identical.
   */
  account_credits?: AccountSettleAllocRow[];
  /**
   * LIRA-343: how much account credit the user chose to use, this
   * currency (magnitude, ≥ 0, default 0). The payment never moves it
   * (owner 2026-10-26, "I want to be in control").
   */
  credit_used?: number;
}

export interface AccountSettleAllocTake {
  kind: AccountSettleRowKind;
  id: number;
  member_supplier_id: number;
  source: AccountSettleCoverageSource;
  /** Magnitude applied; always reduces the row's |remaining|. */
  amount: number;
}

export interface AccountSettleAllocRowRef {
  kind: AccountSettleRowKind;
  id: number;
}

export interface AccountSettleAllocPartial extends AccountSettleAllocRowRef {
  /** Magnitude this settlement applied to the row. */
  applied: number;
  /** Signed amount the row still owes afterwards. */
  remaining: number;
}

export interface AccountSettleNettingPair {
  credit_member: number;
  debit_member: number;
  amount: number;
}

export interface AccountSettleAllocResult {
  takes: AccountSettleAllocTake[];
  /** Remaining within eps after this settlement (includes rows already within eps). */
  closed: AccountSettleAllocRowRef[];
  /** At most one row, and only a day row (`rows`); see `account_partial`. */
  partial: AccountSettleAllocPartial | null;
  untouched: AccountSettleAllocRowRef[];
  /** Cross-member netting only, aggregated per member pair. */
  netting_pairs: AccountSettleNettingPair[];
  /** Signed; goes on the account (LIRA-315). */
  extra: number;
  /** Signed in-scope total still owed. */
  remaining_after: number;
  /** Over CLOSED commission-model-1 rows. */
  commission_alloc: Array<{ id: number; amount: number }>;
  /** A commission was entered but no commission-model-1 row closes — the repository refuses this. */
  commission_without_closed_model1: boolean;
  cashout_commission_recognised: number;
  /** Sign of the in-scope total owed. */
  direction_from_rows: "PAY" | "COLLECT" | "NONE";
  /**
   * LIRA-343: `credit_used` is more than may be used (shop pays: more than
   * min(owed, open account credit); OMT pays: more than the open account
   * credit). Nothing of it was applied; the caller refuses. The key is
   * present only when true.
   */
  credit_used_too_high?: boolean;
  /** LIRA-343: account credit actually applied (magnitude). */
  account_credit_applied: number;
  /**
   * LIRA-343: the one ACCOUNT row (either sign) left part-covered, if any.
   * `partial` now covers day rows (`rows`) only. Both can be set at once:
   * a user-chosen credit can leave a credit row part-used while the money
   * leaves a day debt part-paid.
   */
  account_partial: AccountSettleAllocPartial | null;
}

const KIND_ORDER: Record<AccountSettleRowKind, number> = {
  FINANCIAL_SERVICE: 0,
  LEDGER: 1,
};

/** Row order shared by the server and the sheet. */
export function compareAccountSettleRows(
  a: Pick<AccountSettleAllocRow, "kind" | "id" | "created_at">,
  b: Pick<AccountSettleAllocRow, "kind" | "id" | "created_at">,
): number {
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? -1 : 1;
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  return a.id - b.id;
}

/** Minor units per currency unit: cents for USD, whole LBP. */
function minorFactor(currency: AccountSettleCurrency): number {
  return currency === "USD" ? 100 : 1;
}

export function allocateAccountSettlement(
  input: AccountSettleAllocInput,
): AccountSettleAllocResult {
  const factor = minorFactor(input.currency);
  const toMinor = (x: number): number => Math.round((x || 0) * factor);
  const fromMinor = (m: number): number => (m === 0 ? 0 : m / factor);
  // Integer amounts: a row is closed when its remaining rounds to 0.
  const epsMinor = Math.max(0.5, (input.eps || 0) * factor);
  const isZero = (m: number): boolean => Math.abs(m) <= epsMinor;

  // LIRA-343: account rows ride in the same arrays AFTER the scope rows
  // (indices ≥ nRows), so every take, netting pair and classification uses
  // one code path. With no account rows the arrays are exactly LIRA-322's.
  const rows = [...input.rows].sort(compareAccountSettleRows);
  const nRows = rows.length;
  const acct = [...(input.account_credits ?? [])].sort(
    compareAccountSettleRows,
  );
  const all = [...rows, ...acct];
  const orig = all.map((r) => toMinor(r.remaining));
  const rem = [...orig];
  const takenMinor = all.map(() => 0);
  const takes: Array<{
    i: number;
    source: AccountSettleCoverageSource;
    m: number;
  }> = [];
  const indices = all.map((_, i) => i);
  const rowIdx = indices.slice(0, nRows);
  const acctIdx = indices.slice(nRows);
  /** Positive account rows: debts in scope, queued after every day debt. */
  const acctDebtIdx = acctIdx.filter((i) => orig[i] > 0);
  /** Negative account rows: the account credit pool. */
  const acctCreditIdx = acctIdx.filter((i) => orig[i] < 0);
  /** The debt queue / scope: day rows, then positive account rows. */
  const scopeIdx = [...rowIdx, ...acctDebtIdx];

  const record = (
    i: number,
    source: AccountSettleCoverageSource,
    m: number,
  ): void => {
    if (m <= 0) return;
    takes.push({ i, source, m });
    takenMinor[i] += m;
    rem[i] += orig[i] > 0 ? -m : m;
  };

  const netPairs = new Map<string, AccountSettleNettingPair & { m: number }>();
  /**
   * Net open debts in `debtPool` against open credits in `creditPool`, both
   * oldest first in the order given, up to `cap` (default: the smaller
   * total). Both sides get NETTING coverage of equal size. Returns the
   * amount netted.
   */
  const net = (
    debtPool: number[],
    creditPool: number[],
    cap?: number,
  ): number => {
    const debtIdx = debtPool.filter((i) => rem[i] > epsMinor);
    const creditIdx = creditPool.filter((i) => rem[i] < -epsMinor);
    const totalDebt = debtIdx.reduce((s, i) => s + rem[i], 0);
    const totalCredit = creditIdx.reduce((s, i) => s - rem[i], 0);
    const netting = Math.min(totalDebt, totalCredit, cap ?? Infinity);
    if (netting <= 0) return 0;
    const debitTakes = allocateFifo(
      debtIdx.map((i) => ({ id: i, outstanding: rem[i] })),
      netting,
      0.5,
    ).map((t) => ({ i: Number(t.id), m: t.take }));
    const creditTakes = allocateFifo(
      creditIdx.map((i) => ({ id: i, outstanding: -rem[i] })),
      netting,
      0.5,
    ).map((t) => ({ i: Number(t.id), m: t.take }));

    // Pair the credit pieces with the debit pieces, oldest against oldest,
    // to find which member's credit paid which member's debt.
    let d = 0;
    let c = 0;
    let dLeft = debitTakes[0]?.m ?? 0;
    let cLeft = creditTakes[0]?.m ?? 0;
    while (d < debitTakes.length && c < creditTakes.length) {
      const m = Math.min(dLeft, cLeft);
      const creditMember = all[creditTakes[c].i].member_supplier_id;
      const debitMember = all[debitTakes[d].i].member_supplier_id;
      if (m > 0 && creditMember !== debitMember) {
        const key = `${creditMember}:${debitMember}`;
        const pair = netPairs.get(key) ?? {
          credit_member: creditMember,
          debit_member: debitMember,
          amount: 0,
          m: 0,
        };
        pair.m += m;
        netPairs.set(key, pair);
      }
      dLeft -= m;
      cLeft -= m;
      if (dLeft <= 0) dLeft = debitTakes[++d]?.m ?? 0;
      if (cLeft <= 0) cLeft = creditTakes[++c]?.m ?? 0;
    }

    for (const t of debitTakes) record(t.i, "NETTING", t.m);
    for (const t of creditTakes) record(t.i, "NETTING", t.m);
    return netting;
  };

  // ── 1. Netting ────────────────────────────────────────────────────────
  // 1a. Day credits against day debts (LIRA-322, unchanged).
  net(rowIdx, rowIdx);
  // 1b. LIRA-343: positive account rows against the account credit pool.
  net(acctDebtIdx, acctCreditIdx);
  // 1c. LIRA-343: day credits still open against the positive account rows
  //     still open (they are debts in scope). After 1a–1c the scope is
  //     one-sided: only debts or only credits remain open in it.
  net(acctDebtIdx, rowIdx);

  // ── 2. Budget ─────────────────────────────────────────────────────────
  // D: what the scope (day rows + positive account rows) owes after
  // netting. The account credit pool is NOT in D.
  const owedAfterNetting = scopeIdx.reduce((s, i) => s + rem[i], 0);
  const direction_from_rows: AccountSettleAllocResult["direction_from_rows"] =
    owedAfterNetting > epsMinor
      ? "PAY"
      : owedAfterNetting < -epsMinor
        ? "COLLECT"
        : "NONE";

  // LIRA-343: the user-chosen account credit. Compared in minor units, so
  // 8.70 of an 8.70 credit is accepted and 9.00 is not.
  const creditUsedMinor = Math.abs(toMinor(input.credit_used ?? 0));
  const creditPoolMinor = acctCreditIdx.reduce(
    (s, i) => s + Math.max(0, -rem[i]),
    0,
  );
  const creditCap =
    direction_from_rows === "PAY"
      ? Math.min(owedAfterNetting, creditPoolMinor)
      : creditPoolMinor;
  const credit_used_too_high = creditUsedMinor > creditCap;
  let accountCreditAppliedMinor = 0;

  // Shop pays: exactly `credit_used` of account credit covers the oldest
  // open debts first (NETTING on both sides), then the money the rest.
  if (
    direction_from_rows === "PAY" &&
    !credit_used_too_high &&
    creditUsedMinor > 0
  ) {
    accountCreditAppliedMinor = net(scopeIdx, acctCreditIdx, creditUsedMinor);
  }

  const paidMinor = toMinor(input.paid);
  const waiveSign =
    direction_from_rows === "PAY"
      ? 1
      : direction_from_rows === "COLLECT"
        ? -1
        : paidMinor < 0
          ? -1
          : 1;
  const commissionMinor = Math.abs(toMinor(input.commission));
  const waiveMinor = Math.abs(toMinor(input.waive)) * waiveSign;
  // The commission is not money and covers nothing (owner 2026-10-15).
  const budget = paidMinor + waiveMinor;

  let applied = 0;
  if (budget !== 0) {
    const sign = budget > 0 ? 1 : -1;
    // Money only ever reaches the scope here; the account credit pool is
    // reached only through `credit_used` below, so it never makes extra.
    const targets = scopeIdx.filter((i) =>
      sign > 0 ? rem[i] > epsMinor : rem[i] < -epsMinor,
    );
    const budgetTakes = allocateFifo(
      targets.map((i) => ({ id: i, outstanding: rem[i] * sign })),
      Math.abs(budget),
      0.5,
    );
    // OMT pays (money received): after every day credit, up to
    // `credit_used` of account credit, oldest first, as PAYMENT. If the
    // money runs out first, less than `credit_used` is applied.
    if (
      sign < 0 &&
      direction_from_rows !== "PAY" &&
      !credit_used_too_high &&
      creditUsedMinor > 0
    ) {
      const leftOver =
        Math.abs(budget) - budgetTakes.reduce((s, t) => s + t.take, 0);
      const creditTakes = allocateFifo(
        acctCreditIdx.map((i) => ({
          id: i,
          outstanding: Math.max(0, -rem[i]),
        })),
        Math.min(leftOver, creditUsedMinor),
        0.5,
      );
      accountCreditAppliedMinor = creditTakes.reduce((s, t) => s + t.take, 0);
      budgetTakes.push(...creditTakes);
    }
    // Tag each take: waive first, then money.
    let waiveLeft = Math.max(0, waiveMinor * sign);
    for (const t of budgetTakes) {
      const i = Number(t.id);
      let left = t.take;
      const fromWaive = Math.min(left, waiveLeft);
      waiveLeft -= fromWaive;
      left -= fromWaive;
      record(i, "WAIVE", fromWaive);
      record(i, "PAYMENT", left);
      applied += t.take;
    }
    applied *= sign;
  }
  const extraMinor = budget - applied;

  // ── 3. Classify rows ──────────────────────────────────────────────────
  // Every input row lands in exactly one of closed / untouched / partial /
  // account_partial.
  //
  // `partial` (day rows only, LIRA-322's meaning) is at most one row: after
  // step 1a only one sign is open among the day rows, and every later step
  // (1c, the account credit, the money) continues that side's oldest-first
  // queue without a gap, so only the row where the last one stops can be
  // left part-covered.
  //
  // `account_partial` (account rows, either sign) is at most one row for
  // the same reason: after step 1b only one sign is open among the account
  // rows, and 1c / `credit_used` / the money continue that side's queue.
  //
  // The two can BOTH be set. The user chooses the credit (owner
  // 2026-10-26), so credit 5 of 8.70 with too little money leaves a credit
  // part-used AND a day debt part-paid; and step 1b can part-net a
  // positive account row before the money stops inside a day debt. R5's
  // original "never both" no longer holds, hence the separate field.
  const closed: AccountSettleAllocRowRef[] = [];
  const untouched: AccountSettleAllocRowRef[] = [];
  let partial: AccountSettleAllocPartial | null = null;
  let account_partial: AccountSettleAllocPartial | null = null;
  for (const i of indices) {
    const ref = { kind: all[i].kind, id: all[i].id };
    if (isZero(rem[i])) closed.push(ref);
    else if (takenMinor[i] === 0) untouched.push(ref);
    else {
      const p = {
        ...ref,
        applied: fromMinor(takenMinor[i]),
        remaining: fromMinor(rem[i]),
      };
      if (i >= nRows) {
        if (account_partial === null) account_partial = p;
      } else if (partial === null) partial = p;
    }
  }
  const closedSet = new Set(indices.filter((i) => isZero(rem[i])));

  // ── 4. Commission over closed model-1 rows ────────────────────────────
  let commission_alloc: Array<{ id: number; amount: number }> = [];
  let commission_without_closed_model1 = false;
  if (commissionMinor > 0) {
    const eligible = all
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r, i }) => closedSet.has(i) && r.commission_model1 && orig[i] > 0,
      );
    if (eligible.length === 0) {
      commission_without_closed_model1 = true;
    } else {
      commission_alloc = allocateProportional(
        eligible.map(({ i }) => ({ id: i, weight: orig[i] })),
        commissionMinor,
        1,
      ).map((s) => ({
        id: all[Number(s.id)].id,
        amount: fromMinor(s.amount),
      }));
    }
  }

  // ── 5. Deferred cash-out commission on closed credits ─────────────────
  const cashoutMinor = all.reduce(
    (s, r, i) =>
      closedSet.has(i) && orig[i] < 0 ? s + toMinor(r.cashout_commission) : s,
    0,
  );

  const result: AccountSettleAllocResult = {
    takes: takes.map((t) => ({
      kind: all[t.i].kind,
      id: all[t.i].id,
      member_supplier_id: all[t.i].member_supplier_id,
      source: t.source,
      amount: fromMinor(t.m),
    })),
    closed,
    partial,
    untouched,
    netting_pairs: [...netPairs.values()].map((p) => ({
      credit_member: p.credit_member,
      debit_member: p.debit_member,
      amount: fromMinor(p.m),
    })),
    extra: fromMinor(extraMinor),
    remaining_after: fromMinor(scopeIdx.reduce((s, i) => s + rem[i], 0)),
    commission_alloc,
    commission_without_closed_model1,
    cashout_commission_recognised: fromMinor(cashoutMinor),
    direction_from_rows,
    account_credit_applied: fromMinor(accountCreditAppliedMinor),
    account_partial,
  };
  // Present only when true, so a LIRA-322 call's output keeps its shape.
  if (credit_used_too_high) result.credit_used_too_high = true;
  return result;
}
