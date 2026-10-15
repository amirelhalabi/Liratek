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
 *   2. Budget S = paid + commission ± waive (the waive takes the sign of
 *      what is owed after netting). S > 0 covers debts oldest first, S < 0
 *      covers credits oldest first. Within the budget the commission is
 *      consumed first, then the waive, then the money — so the commission
 *      lands on the oldest rows, which close first.
 *   3. Extra — budget left after every in-scope row is covered.
 *   4. The entered commission is split over the commission-model-1 rows
 *      this settlement CLOSES, in proportion to what each owed before it
 *      (largest remainder, cents / whole LBP).
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
  /** ≥ 0. Always reduces what the shop owes. */
  commission: number;
  /** ≥ 0. Takes the sign of what is owed after netting. */
  waive: number;
  /** 0.005 USD, 0.5 LBP. */
  eps: number;
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
  /** At most one row. */
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
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
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

  const rows = [...input.rows].sort(compareAccountSettleRows);
  const orig = rows.map((r) => toMinor(r.remaining));
  const rem = [...orig];
  const takenMinor = rows.map(() => 0);
  const takes: Array<{ i: number; source: AccountSettleCoverageSource; m: number }> = [];

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

  // ── 1. Netting ────────────────────────────────────────────────────────
  const debtIdx = rows.map((_, i) => i).filter((i) => rem[i] > epsMinor);
  const creditIdx = rows.map((_, i) => i).filter((i) => rem[i] < -epsMinor);
  const totalDebt = debtIdx.reduce((s, i) => s + rem[i], 0);
  const totalCredit = creditIdx.reduce((s, i) => s - rem[i], 0);
  const netting = Math.min(totalDebt, totalCredit);

  const netPairs = new Map<string, AccountSettleNettingPair & { m: number }>();
  if (netting > 0) {
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
      const creditMember = rows[creditTakes[c].i].member_supplier_id;
      const debitMember = rows[debitTakes[d].i].member_supplier_id;
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
  }

  // ── 2. Budget ─────────────────────────────────────────────────────────
  const owedAfterNetting = rem.reduce((s, m) => s + m, 0);
  const direction_from_rows: AccountSettleAllocResult["direction_from_rows"] =
    owedAfterNetting > epsMinor
      ? "PAY"
      : owedAfterNetting < -epsMinor
        ? "COLLECT"
        : "NONE";
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
  const budget = paidMinor + commissionMinor + waiveMinor;

  let applied = 0;
  if (budget !== 0) {
    const sign = budget > 0 ? 1 : -1;
    const targets = rows
      .map((_, i) => i)
      .filter((i) => (sign > 0 ? rem[i] > epsMinor : rem[i] < -epsMinor));
    const budgetTakes = allocateFifo(
      targets.map((i) => ({ id: i, outstanding: rem[i] * sign })),
      Math.abs(budget),
      0.5,
    );
    // Tag each take: commission first, then waive, then money.
    let commissionLeft = Math.max(0, commissionMinor * sign);
    let waiveLeft = Math.max(0, waiveMinor * sign);
    for (const t of budgetTakes) {
      const i = Number(t.id);
      let left = t.take;
      const fromCommission = Math.min(left, commissionLeft);
      commissionLeft -= fromCommission;
      left -= fromCommission;
      const fromWaive = Math.min(left, waiveLeft);
      waiveLeft -= fromWaive;
      left -= fromWaive;
      record(i, "COMMISSION", fromCommission);
      record(i, "WAIVE", fromWaive);
      record(i, "PAYMENT", left);
      applied += t.take;
    }
    applied *= sign;
  }
  const extraMinor = budget - applied;

  // ── 3. Classify rows ──────────────────────────────────────────────────
  const closed: AccountSettleAllocRowRef[] = [];
  const untouched: AccountSettleAllocRowRef[] = [];
  let partial: AccountSettleAllocPartial | null = null;
  for (let i = 0; i < rows.length; i++) {
    const ref = { kind: rows[i].kind, id: rows[i].id };
    if (isZero(rem[i])) closed.push(ref);
    else if (takenMinor[i] === 0) untouched.push(ref);
    else if (partial === null) {
      partial = {
        ...ref,
        applied: fromMinor(takenMinor[i]),
        remaining: fromMinor(rem[i]),
      };
    }
  }
  const closedSet = new Set(rows.map((_, i) => i).filter((i) => isZero(rem[i])));

  // ── 4. Commission over closed model-1 rows ────────────────────────────
  let commission_alloc: Array<{ id: number; amount: number }> = [];
  let commission_without_closed_model1 = false;
  if (commissionMinor > 0) {
    const eligible = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => closedSet.has(i) && r.commission_model1 && orig[i] > 0);
    if (eligible.length === 0) {
      commission_without_closed_model1 = true;
    } else {
      commission_alloc = allocateProportional(
        eligible.map(({ i }) => ({ id: i, weight: orig[i] })),
        commissionMinor,
        1,
      ).map((s) => ({
        id: rows[Number(s.id)].id,
        amount: fromMinor(s.amount),
      }));
    }
  }

  // ── 5. Deferred cash-out commission on closed credits ─────────────────
  const cashoutMinor = rows.reduce(
    (s, r, i) =>
      closedSet.has(i) && orig[i] < 0
        ? s + toMinor(r.cashout_commission)
        : s,
    0,
  );

  return {
    takes: takes.map((t) => ({
      kind: rows[t.i].kind,
      id: rows[t.i].id,
      member_supplier_id: rows[t.i].member_supplier_id,
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
    remaining_after: fromMinor(rem.reduce((s, m) => s + m, 0)),
    commission_alloc,
    commission_without_closed_model1,
    cashout_commission_recognised: fromMinor(cashoutMinor),
    direction_from_rows,
  };
}
