/**
 * LIRA-322 T049 — seeded property test for amount-first account settlement
 * (data-model.md invariants 1–4, SC-004).
 *
 * For each seed, a fresh OMT account with mixed USD/LBP debts and credits on
 * two members (the OMT counter and OMT App) goes through a random sequence
 * of amount-first settlements (one or two currency sections, either
 * direction, optional ticked scope, overpay, change in either currency) and
 * voids (mostly newest first, sometimes an older one that must be refused).
 *
 * After EVERY step:
 *   1. per member and currency, the ledger sum equals Σ remaining over that
 *      member's open queue rows;
 *   2. per active settlement and currency, Σ NETTING on debts equals
 *      Σ NETTING on credits;
 *   3. no queue row has two active `closes_row = 1` coverage rows;
 *   a refused step wrote nothing.
 * At the end every remaining settlement is voided newest first and the
 * drawers, every member balance and profit are back to the start
 * (create + void nets to 0 per currency, rule 20).
 *
 * The run must not pass vacuously: minimum counts of successful
 * settlements, voids, two-direction settlements and cross-member netting
 * pairs are asserted. A failure names the seed and step.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  type SettleAccountRequest,
} from "../SupplierRepository";
import { getTransactionRepository } from "../TransactionRepository";
import { DatabaseError } from "../../utils/errors";
import {
  buildDb,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  profitTotals,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  writeCounts,
  type CurrencyPair,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

const SEEDS = [11, 22, 33, 44];
const STEPS_PER_SEED = 40;
const RATE = 89000;

/** Deterministic PRNG (never Math.random — the seed must replay). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Currency = "USD" | "LBP";
type Leg = SettleAccountRequest["per_currency"] extends infer P
  ? P extends { USD?: { payments: Array<infer L> } }
    ? L
    : never
  : never;

interface Stats {
  settled: number;
  refusedSettle: number;
  voided: number;
  refusedVoid: number;
  mixed: number;
  pairs: number;
  /** Settlements that booked a commission (owner 2026-10-15: an open credit). */
  commissioned: number;
}

/**
 * The ONLY refusals a well-formed random step may meet. Anything else —
 * in particular the internal consistency throws ("aborted", "disagree")
 * and the wrapper "Failed to settle account" around a crash — is a defect
 * the property test exists to catch, never a counted refusal.
 */
const LEGIT_SETTLE_REFUSALS = [
  /^There is nothing to settle for the amounts entered\./,
  // A random commission where no commission-carrying transfer closes.
  /^Commission can only be entered when this payment fully pays at least one transfer that carries commission\./,
];
const LEGIT_VOID_REFUSALS = [
  /^A later settlement \(#\d+, [^)]+\) paid the same transfers\. Void it first\.$/,
  /^It is partly paid by settlement #\d+ — void that settlement first\.$/,
];
const expectLegit = (e: unknown, allowed: readonly RegExp[]): void => {
  const msg = e instanceof Error ? e.message : String(e);
  if (!allowed.some((re) => re.test(msg))) {
    throw new Error(`unexpected refusal: ${msg}`);
  }
};

const round2 = (v: number): number => Math.round(v * 100) / 100 + 0;
const roundC = (v: number, c: Currency): number =>
  c === "USD" ? round2(v) : Math.round(v) + 0;

describe("LIRA-322 T049 — amount-first settlement property test", () => {
  afterEach(() => {
    resetTenantContext();
  });

  it(`holds the ledger invariants over ${SEEDS.length} seeds × ${STEPS_PER_SEED} random steps`, () => {
    const total: Stats = {
      settled: 0,
      refusedSettle: 0,
      voided: 0,
      refusedVoid: 0,
      mixed: 0,
      pairs: 0,
      commissioned: 0,
    };
    for (const seed of SEEDS) {
      const s = runSeed(seed);
      for (const k of Object.keys(total) as Array<keyof Stats>) total[k] += s[k];
    }
    // Not vacuous: the sequence really exercised what it claims to.
    expect(total.settled).toBeGreaterThanOrEqual(30);
    expect(total.voided).toBeGreaterThanOrEqual(10);
    expect(total.mixed).toBeGreaterThanOrEqual(1);
    expect(total.pairs).toBeGreaterThanOrEqual(1);
    expect(total.commissioned).toBeGreaterThanOrEqual(3);
  });
});

function runSeed(seed: number): Stats {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const stats: Stats = {
    settled: 0,
    refusedSettle: 0,
    voided: 0,
    refusedVoid: 0,
    mixed: 0,
    pairs: 0,
    commissioned: 0,
  };

  resetAll();
  const db: Database.Database = buildDb();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  const repo = new SupplierRepository();
  const txRepo = getTransactionRepository();
  const acc: OmtAccount = omtAccount(db);
  const members = [acc.omtId, acc.appId, acc.ipickId];
  let step = -1;

  try {
    for (const d of ["OMT_System", "General", "OMT_App"]) {
      fundDrawer(db, d, "USD", 1_000_000);
      fundDrawer(db, d, "LBP", 100_000_000_000);
    }

    // ── Seed rows: distinct, shuffled timestamps (oldest-first is by text) ──
    const slots = Array.from({ length: 24 }, (_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    let slot = 0;
    const at = (): string => {
      const n = slots[slot++];
      return `2026-10-01 ${String(Math.floor(n / 2)).padStart(2, "0")}:${n % 2 ? "30" : "00"}:00`;
    };
    const usdAmt = (lo: number, hi: number) => round2(lo + rnd() * (hi - lo));
    const lbpAmt = (lo: number, hi: number) =>
      Math.round((lo + rnd() * (hi - lo)) / 1000) * 1000;
    // Counter (OMT): transfers (debts) in both currencies + one credit each.
    for (let i = 0; i < 6; i++)
      seedOmtSend(db, acc.omtId, { amount: usdAmt(10, 200), created_at: at() });
    for (let i = 0; i < 3; i++)
      seedOmtSend(db, acc.omtId, {
        amount: lbpAmt(100_000, 2_000_000),
        currency: "LBP",
        created_at: at(),
      });
    seedLedgerRow(db, acc.omtId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -usdAmt(5, 60),
      created_at: at(),
    });
    seedLedgerRow(db, acc.omtId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_lbp: -lbpAmt(100_000, 800_000),
      created_at: at(),
    });
    // OMT App: raw debts and credits in both currencies.
    for (let i = 0; i < 2; i++)
      seedLedgerRow(db, acc.appId, {
        entry_type: "TOP_UP",
        amount_usd: usdAmt(10, 120),
        created_at: at(),
      });
    seedLedgerRow(db, acc.appId, {
      entry_type: "TOP_UP",
      amount_lbp: lbpAmt(100_000, 1_500_000),
      created_at: at(),
    });
    for (let i = 0; i < 3; i++)
      seedLedgerRow(db, acc.appId, {
        entry_type: "SUPPLIER_PAYS_US",
        amount_usd: -usdAmt(10, 250),
        created_at: at(),
      });
    for (let i = 0; i < 3; i++)
      seedLedgerRow(db, acc.appId, {
        entry_type: "SUPPLIER_PAYS_US",
        amount_lbp: -lbpAmt(300_000, 3_000_000),
        created_at: at(),
      });

    const start = {
      drawers: drawerTotals(db),
      balances: Object.fromEntries(
        members.map((m) => [m, memberBalance(db, m)]),
      ) as Record<number, CurrencyPair>,
      profit: profitTotals(db),
    };
    const active: number[] = []; // settlement transaction ids, creation order

    const checkInvariants = (): void => {
      const q = repo.getAccountUnsettled(acc.omtId);
      // 1. per member, per currency: ledger == Σ remaining
      for (const m of members) {
        const bal = memberBalance(db, m);
        const rows = q.filter((r) => r.supplier_id === m);
        expect({ m, usd: round2(bal.usd) }).toEqual({
          m,
          usd: round2(rows.reduce((s2, r) => s2 + r.remaining_usd, 0)),
        });
        expect({ m, lbp: Math.round(bal.lbp) + 0 }).toEqual({
          m,
          lbp: Math.round(rows.reduce((s2, r) => s2 + r.remaining_lbp, 0)) + 0,
        });
      }
      // 2. Σ NETTING on debts == Σ NETTING on credits, per settlement & currency
      const netting = db
        .prepare(
          `SELECT c.transaction_id AS txn, c.currency AS currency, c.amount AS amount,
                  CASE WHEN c.row_kind = 'FINANCIAL_SERVICE' THEN 1
                       WHEN (CASE c.currency WHEN 'USD' THEN l.amount_usd ELSE l.amount_lbp END) > 0 THEN 1
                       ELSE -1 END AS sign
             FROM supplier_settlement_coverage c
             LEFT JOIN supplier_ledger l
               ON c.row_kind = 'LEDGER' AND l.id = c.row_id AND l.tenant_id = c.tenant_id
            WHERE c.tenant_id = 1 AND c.is_reversed = 0 AND c.source = 'NETTING'`,
        )
        .all() as Array<{ txn: number; currency: Currency; amount: number; sign: number }>;
      const bySettlement = new Map<string, number>();
      for (const n of netting) {
        const k = `${n.txn}:${n.currency}`;
        bySettlement.set(k, (bySettlement.get(k) ?? 0) + n.sign * n.amount);
      }
      for (const [k, v] of bySettlement) {
        const c = k.endsWith("USD") ? "USD" : "LBP";
        expect({ k, net: roundC(v, c) }).toEqual({ k, net: 0 });
      }
      // 3. a row has at most one active closes_row = 1
      const doubleClosed = db
        .prepare(
          `SELECT row_kind, row_id, COUNT(*) AS n FROM supplier_settlement_coverage
            WHERE tenant_id = 1 AND is_reversed = 0 AND closes_row = 1
            GROUP BY row_kind, row_id HAVING COUNT(*) > 1`,
        )
        .all();
      expect(doubleClosed).toEqual([]);
    };

    const pairCount = (): number =>
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM supplier_ledger
              WHERE tenant_id = 1 AND is_auto = 1 AND note LIKE 'Auto: netted with %'`,
          )
          .get() as { n: number }
      ).n;

    const trySettle = (): void => {
      const queue = repo.getAccountUnsettled(acc.omtId);
      let scope = queue;
      let selections: SettleAccountRequest["selections"];
      if (queue.length > 0 && rnd() < 0.2) {
        scope = queue.filter(() => rnd() < 0.5);
        if (scope.length === 0) scope = [pick(queue)];
        selections = scope.map((r) => ({ kind: r.kind, id: r.id }));
      }
      const owed = {
        USD: round2(scope.reduce((s2, r) => s2 + r.remaining_usd, 0)),
        LBP: Math.round(scope.reduce((s2, r) => s2 + r.remaining_lbp, 0)),
      };
      const perCurrency: NonNullable<SettleAccountRequest["per_currency"]> = {};
      for (const c of ["USD", "LBP"] as const) {
        const o = owed[c];
        const eps = c === "USD" ? 0.005 : 0.5;
        const include = Math.abs(o) > eps ? rnd() < 0.8 : rnd() < 0.1;
        if (!include) continue;
        const direction: "PAY" | "COLLECT" =
          o > eps ? "PAY" : o < -eps ? "COLLECT" : rnd() < 0.5 ? "PAY" : "COLLECT";
        const base = Math.abs(o) > eps ? Math.abs(o) : c === "USD" ? 50 : 1_000_000;
        // 0 (pure netting) sometimes, otherwise 1%–130% of what is owed.
        const r = rnd();
        let paid =
          r < 0.1 ? 0 : base * (r < 0.6 ? 0.01 + rnd() * 0.99 : 1 + rnd() * 0.3);
        paid = c === "USD" ? round2(Math.max(paid, paid > 0 ? 0.01 : 0)) : Math.round(paid / 1000) * 1000;
        const payments: Leg[] = [];
        if (paid > 0) {
          payments.push({ method: "CASH", currency_code: c, amount: paid });
          const over = paid - Math.abs(o);
          if (Math.abs(o) > eps && over > (c === "USD" ? 1 : 10_000) && rnd() < 0.5) {
            // Change for part of the overpay, in either currency.
            const valueUsd = (c === "USD" ? over : over / RATE) * rnd();
            if (rnd() < 0.5) {
              const usd = round2(valueUsd);
              if (usd > 0)
                payments.push({ method: "CASH", currency_code: "USD", amount: usd, direction: "OUT" });
            } else {
              const lbp = Math.floor((valueUsd * RATE) / 1000) * 1000;
              if (lbp > 0)
                payments.push({ method: "CASH", currency_code: "LBP", amount: lbp, direction: "OUT" });
            }
          }
        }
        // Owner 2026-10-15 — a commission sometimes: it covers nothing and
        // goes on the account as an open credit (invariant 1 must hold).
        const commission =
          direction === "PAY" && paid > 0 && rnd() < 0.35
            ? c === "USD"
              ? round2(0.01 + rnd() * 3)
              : Math.round((1000 + rnd() * 50_000) / 1000) * 1000
            : 0;
        perCurrency[c] = {
          direction,
          payments,
          ...(commission > 0 ? { commission } : {}),
        };
      }
      if (!perCurrency.USD && !perCurrency.LBP) return;

      const counts0 = writeCounts(db);
      const pairs0 = pairCount();
      try {
        repo.settleAccount({
          account_supplier_id: acc.omtId,
          per_currency: perCurrency,
          expected_owed: { usd: owed.USD, lbp: owed.LBP },
          ...(selections ? { selections } : {}),
          exchange_rate: RATE,
          created_by: 1,
        });
      } catch (e) {
        if (!(e instanceof DatabaseError)) throw e;
        expectLegit(e, LEGIT_SETTLE_REFUSALS);
        stats.refusedSettle++;
        expect(writeCounts(db)).toEqual(counts0);
        return;
      }
      const txn = db
        .prepare(
          `SELECT MAX(id) AS id FROM transactions WHERE tenant_id = 1 AND type = 'SUPPLIER_SETTLEMENT'`,
        )
        .get() as { id: number };
      active.push(txn.id);
      stats.settled++;
      if (
        perCurrency.USD &&
        perCurrency.LBP &&
        perCurrency.USD.direction !== perCurrency.LBP.direction
      )
        stats.mixed++;
      stats.pairs += pairCount() - pairs0;
      if (perCurrency.USD?.commission || perCurrency.LBP?.commission)
        stats.commissioned++;
    };

    const tryVoid = (): void => {
      if (active.length === 0) return;
      const idx = rnd() < 0.7 ? active.length - 1 : Math.floor(rnd() * active.length);
      const id = active[idx];
      const counts0 = writeCounts(db);
      try {
        txRepo.voidTransaction(id, 1);
      } catch (e) {
        if (!(e instanceof DatabaseError)) throw e;
        expectLegit(e, LEGIT_VOID_REFUSALS);
        // Only an older settlement may be refused (newest first, R8).
        expect(idx).toBeLessThan(active.length - 1);
        stats.refusedVoid++;
        expect(writeCounts(db)).toEqual(counts0);
        return;
      }
      active.splice(idx, 1);
      stats.voided++;
    };

    checkInvariants();
    for (step = 0; step < STEPS_PER_SEED; step++) {
      if (rnd() < 0.65) trySettle();
      else tryVoid();
      checkInvariants();
    }

    // ── Unwind newest first: every ledger back to the start ─────────────
    step = STEPS_PER_SEED;
    while (active.length > 0) {
      txRepo.voidTransaction(active.pop()!, 1);
      stats.voided++;
      checkInvariants();
    }
    const d = drawerTotals(db);
    expect(round2(d.usd - start.drawers.usd)).toBe(0);
    expect(Math.round(d.lbp - start.drawers.lbp) + 0).toBe(0);
    for (const m of members) {
      const b = memberBalance(db, m);
      expect({ m, usd: round2(b.usd - start.balances[m].usd) }).toEqual({ m, usd: 0 });
      expect({ m, lbp: Math.round(b.lbp - start.balances[m].lbp) + 0 }).toEqual({ m, lbp: 0 });
    }
    const p = profitTotals(db);
    expect(round2(p.usd - start.profit.usd)).toBe(0);
    expect(Math.round(p.lbp - start.profit.lbp) + 0).toBe(0);
    const activeCoverage = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM supplier_settlement_coverage WHERE tenant_id = 1 AND is_reversed = 0`,
        )
        .get() as { n: number }
    ).n;
    expect(activeCoverage).toBe(0);
    return stats;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`LIRA-322 property test failed — seed ${seed}, step ${step}: ${msg}`);
  } finally {
    resetTenantContext();
    db.close();
  }
}
