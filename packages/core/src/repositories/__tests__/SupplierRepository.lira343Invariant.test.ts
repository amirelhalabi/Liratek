/**
 * LIRA-343 T036 (US5/US6, FR-018–FR-020, research R12) — seeded property
 * test: random sequences of settle, undo of ANY active settlement (any
 * order) and void / refund of ANY live transfer (covered or not).
 *
 * After EVERY step, per member and currency:
 *   1. ledger balance == Σ open remaining (DAY + ACCOUNT rows);
 *   2. no row's active coverage exceeds its |amount|;
 *   3. an undo's drawer delta equals the money the undone settlement moved,
 *      reversed (its payments rows negated), per currency;
 *   4. nothing is refused: undo and void have no exception any more.
 *
 * Not vacuous: minimum counts of out-of-order undos, undos that left an
 * account row, and voids of covered transfers are asserted. A failure names
 * the seed and step.
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
import { getFinancialServiceRepository } from "../FinancialServiceRepository";
import { DatabaseError } from "../../utils/errors";
import {
  buildDb,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  resetAll,
  seedLedgerRow,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";
import {
  seedOmtSendWithTxns,
  type SeededTransfer,
} from "../testHelpers/omtTransferTxns";

const SEEDS = [7, 18, 29, 40, 51];
const STEPS_PER_SEED = 45;
const RATE = 89000;

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

interface Stats {
  settled: number;
  undone: number;
  undoneOutOfOrder: number;
  undoWithAccountRow: number;
  voidedTransfers: number;
  voidedCovered: number;
}

/** A random settle may legitimately find nothing to do; nothing else. */
const LEGIT_SETTLE_REFUSALS = [
  /^There is nothing to settle for the amounts entered\./,
];

const round2 = (v: number): number => Math.round(v * 100) / 100 + 0;

describe("LIRA-343 T036 — undo any / void covered: property test", () => {
  afterEach(() => resetTenantContext());

  it(`holds the account invariants over ${SEEDS.length} seeds × ${STEPS_PER_SEED} random steps`, () => {
    const total: Stats = {
      settled: 0,
      undone: 0,
      undoneOutOfOrder: 0,
      undoWithAccountRow: 0,
      voidedTransfers: 0,
      voidedCovered: 0,
    };
    for (const seed of SEEDS) {
      const s = runSeed(seed);
      for (const k of Object.keys(total) as Array<keyof Stats>) total[k] += s[k];
    }
    expect(total.settled).toBeGreaterThanOrEqual(40);
    expect(total.undone).toBeGreaterThanOrEqual(15);
    expect(total.undoneOutOfOrder).toBeGreaterThanOrEqual(5);
    expect(total.undoWithAccountRow).toBeGreaterThanOrEqual(3);
    expect(total.voidedTransfers).toBeGreaterThanOrEqual(10);
    expect(total.voidedCovered).toBeGreaterThanOrEqual(5);
  });
});

function runSeed(seed: number): Stats {
  const rnd = mulberry32(seed);
  const stats: Stats = {
    settled: 0,
    undone: 0,
    undoneOutOfOrder: 0,
    undoWithAccountRow: 0,
    voidedTransfers: 0,
    voidedCovered: 0,
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
    let minute = 0;
    const at = (): string => {
      const m = minute++;
      return `2026-10-${String(10 + Math.floor(m / 20)).padStart(2, "0")} ${String(
        8 + Math.floor((m % 20) / 2),
      ).padStart(2, "0")}:${m % 2 ? "30" : "00"}:00`;
    };
    const usdAmt = (lo: number, hi: number) => round2(lo + rnd() * (hi - lo));
    const lbpAmt = (lo: number, hi: number) =>
      Math.round((lo + rnd() * (hi - lo)) / 1000) * 1000;

    const transfers: SeededTransfer[] = [];
    const addTransfer = (): void => {
      const lbp = rnd() < 0.3;
      transfers.push(
        seedOmtSendWithTxns(db, acc.omtId, {
          amount: lbp ? lbpAmt(100_000, 2_000_000) : usdAmt(10, 200),
          currency: lbp ? "LBP" : "USD",
          created_at: at(),
        }),
      );
    };
    for (let i = 0; i < 8; i++) addTransfer();
    // OMT App day credits (cash-outs) and a manual receive on the counter.
    for (let i = 0; i < 2; i++)
      seedLedgerRow(db, acc.appId, {
        entry_type: "SUPPLIER_PAYS_US",
        amount_usd: -usdAmt(5, 60),
        created_at: at(),
      });
    seedLedgerRow(db, acc.omtId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_lbp: -lbpAmt(100_000, 600_000),
      created_at: at(),
    });

    const active: number[] = [];

    const checkInvariants = (): void => {
      const q = repo.getAccountUnsettled(acc.omtId);
      for (const m of members) {
        const bal = memberBalance(db, m);
        const rows = q.filter((r) => r.supplier_id === m);
        expect({ m, usd: round2(bal.usd) }).toEqual({
          m,
          usd: round2(rows.reduce((s, r) => s + r.remaining_usd, 0)),
        });
        expect({ m, lbp: Math.round(bal.lbp) + 0 }).toEqual({
          m,
          lbp: Math.round(rows.reduce((s, r) => s + r.remaining_lbp, 0)) + 0,
        });
      }
      const covered = db
        .prepare(
          `SELECT row_kind, row_id, currency, SUM(amount) AS amount
             FROM supplier_settlement_coverage
            WHERE tenant_id = 1 AND is_reversed = 0
            GROUP BY row_kind, row_id, currency`,
        )
        .all() as Array<{ row_kind: string; row_id: number; currency: Currency; amount: number }>;
      for (const c of covered) {
        let size: number;
        if (c.row_kind === "FINANCIAL_SERVICE") {
          const row = getFinancialServiceRepository().findById(c.row_id) as unknown as {
            supplier_owed: number;
          };
          size = Math.abs(row.supplier_owed);
        } else {
          const row = db
            .prepare(`SELECT amount_usd, amount_lbp FROM supplier_ledger WHERE id = ?`)
            .get(c.row_id) as { amount_usd: number; amount_lbp: number };
          size = Math.abs(c.currency === "USD" ? row.amount_usd : row.amount_lbp);
        }
        const eps = c.currency === "USD" ? 0.005 : 0.5;
        expect({ row: `${c.row_kind}:${c.row_id}`, over: c.amount > size + eps }).toEqual({
          row: `${c.row_kind}:${c.row_id}`,
          over: false,
        });
      }
    };

    const trySettle = (): void => {
      const queue = repo.getAccountUnsettled(acc.omtId);
      if (queue.length === 0) return;
      let scope = queue;
      let selections: SettleAccountRequest["selections"];
      if (rnd() < 0.6) {
        scope = queue.filter(() => rnd() < 0.5);
        if (scope.length === 0) scope = [queue[Math.floor(rnd() * queue.length)]];
        selections = scope.map((r) => ({ kind: r.kind, id: r.id }));
      }
      const owed = {
        USD: round2(scope.reduce((s, r) => s + r.remaining_usd, 0)),
        LBP: Math.round(scope.reduce((s, r) => s + r.remaining_lbp, 0)),
      };
      const perCurrency: NonNullable<SettleAccountRequest["per_currency"]> = {};
      for (const c of ["USD", "LBP"] as const) {
        const o = owed[c];
        const eps = c === "USD" ? 0.005 : 0.5;
        if (Math.abs(o) <= eps || rnd() < 0.15) continue;
        const direction = o > 0 ? "PAY" : "COLLECT";
        const r = rnd();
        let paid = Math.abs(o) * (r < 0.1 ? 0 : r < 0.6 ? 0.05 + rnd() * 0.9 : 1 + rnd() * 0.2);
        paid = c === "USD" ? round2(paid) : Math.round(paid / 1000) * 1000;
        perCurrency[c] = {
          direction,
          payments: paid > 0 ? [{ method: "CASH", currency_code: c, amount: paid }] : [],
        };
      }
      if (!perCurrency.USD && !perCurrency.LBP) return;
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
        if (!LEGIT_SETTLE_REFUSALS.some((re) => re.test(e.message))) {
          throw new Error(`unexpected settle refusal: ${e.message}`);
        }
        return;
      }
      const txn = db
        .prepare(
          `SELECT MAX(id) AS id FROM transactions WHERE tenant_id = 1 AND type = 'SUPPLIER_SETTLEMENT' AND reverses_id IS NULL`,
        )
        .get() as { id: number };
      active.push(txn.id);
      stats.settled++;
    };

    const tryUndo = (): void => {
      if (active.length === 0) return;
      const idx = Math.floor(rnd() * active.length);
      const id = active[idx];
      const moved = db
        .prepare(
          `SELECT currency_code AS c, COALESCE(SUM(amount), 0) AS v
             FROM payments WHERE transaction_id = ? GROUP BY currency_code`,
        )
        .all(id) as Array<{ c: Currency; v: number }>;
      const d0 = drawerTotals(db);
      if (rnd() < 0.7) txRepo.voidTransaction(id, 1);
      else txRepo.refundTransaction(id, 1);
      const d1 = drawerTotals(db);
      const usd = moved.find((m) => m.c === "USD")?.v ?? 0;
      const lbp = moved.find((m) => m.c === "LBP")?.v ?? 0;
      expect(round2(d1.usd - d0.usd)).toBe(round2(-usd));
      expect(Math.round(d1.lbp - d0.lbp) + 0).toBe(Math.round(-lbp) + 0);
      const reversal = db
        .prepare(`SELECT MAX(id) AS id FROM transactions WHERE reverses_id = ?`)
        .get(id) as { id: number };
      const wrote = db
        .prepare(`SELECT COUNT(*) AS n FROM supplier_ledger WHERE transaction_id = ?`)
        .get(reversal.id) as { n: number };
      if (idx < active.length - 1) stats.undoneOutOfOrder++;
      if (wrote.n > 0) stats.undoWithAccountRow++;
      active.splice(idx, 1);
      stats.undone++;
    };

    const tryVoidTransfer = (): void => {
      const live = transfers.filter(
        (t) =>
          (
            db
              .prepare(`SELECT COALESCE(is_refunded, 0) AS r FROM financial_services WHERE id = ?`)
              .get(t.fsId) as { r: number }
          ).r === 0,
      );
      if (live.length === 0) return;
      const t = live[Math.floor(rnd() * live.length)];
      const coveredNow = db
        .prepare(
          `SELECT COUNT(*) AS n FROM supplier_settlement_coverage
            WHERE row_kind = 'FINANCIAL_SERVICE' AND row_id = ? AND is_reversed = 0`,
        )
        .get(t.fsId) as { n: number };
      if (rnd() < 0.6) txRepo.voidTransaction(t.txnId, 1);
      else txRepo.refundTransaction(t.txnId, 1);
      stats.voidedTransfers++;
      if (coveredNow.n > 0) stats.voidedCovered++;
    };

    checkInvariants();
    for (step = 0; step < STEPS_PER_SEED; step++) {
      const r = rnd();
      if (r < 0.45) trySettle();
      else if (r < 0.7) tryUndo();
      else if (r < 0.85) tryVoidTransfer();
      else addTransfer();
      checkInvariants();
    }
    // Unwind in random order: still no refusal, invariants hold.
    step = STEPS_PER_SEED;
    while (active.length > 0) {
      tryUndo();
      checkInvariants();
    }
    return stats;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`LIRA-343 property test failed — seed ${seed}, step ${step}: ${msg}`);
  } finally {
    resetTenantContext();
    db.close();
  }
}
