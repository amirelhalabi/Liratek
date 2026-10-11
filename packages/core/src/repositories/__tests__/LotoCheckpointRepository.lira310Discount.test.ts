/**
 * LIRA-310 (US3, T035) — Waive on a LOTO checkpoint settlement
 * (`LotoCheckpointRepository.settleCheckpoint` and the batch
 * `settleCheckpoints`).
 *
 *   - net −1,200,000 (the shop pays LOTO), legs 1,000,000, waive 200,000 →
 *     LOTO let the shop pay less ("received"): DISCOUNT −200,000, profit
 *     +200,000;
 *   - net +1,200,000 (LOTO pays the shop), legs 1,000,000, waive 200,000 →
 *     the shop let LOTO pay less ("forgiven"): DISCOUNT +200,000, profit
 *     −200,000.
 * The SETTLEMENT ledger row books the cash actually moved and the LOTO
 * supplier balance closes to exactly 0. Refusals: waive above 450,000 LBP;
 * waive equal to (or above) the whole net; legs that do not add up to
 * |net| − waive. LOTO settlements stay non-reversible (unchanged).
 *
 * Real production schema (create_db.sql + migrations), real writers.
 * Rule 17: written before the fix and run red — see tasks.md T035.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  getLotoCheckpointRepository,
  resetLotoCheckpointRepository,
} from "../LotoCheckpointRepository";
import { resolveLotoSupplierId } from "../LotoTicketRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { resetProfitRepository } from "../ProfitRepository";
import { resetSettingsService } from "../../services/SettingsService";
import { ProfitService } from "../../services/ProfitService";
import {
  expectPostings,
  ledgerDeltas,
  snapshotLedgers,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

let db: Database.Database;

function resetAll(): void {
  resetLotoCheckpointRepository();
  resetSupplierRepository();
  resetTransactionRepository();
  resetPaymentMethodRepository();
  resetSettingsRepository();
  resetSettingsService();
  resetRateRepository();
  resetProfitRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

type Shape = "shopPays" | "lotoPays";

/** A checkpoint whose net is −1,200,000 (shop pays) or +1,200,000 (LOTO
 *  pays), with the LOTO supplier balance seeded to match (−net). */
function seedCheckpoint(
  shape: Shape,
  date = "2026-10-01",
): { cpId: number; lotoId: number; sales: number; commission: number } {
  const lotoId = resolveLotoSupplierId(db, 1);
  const sales = shape === "shopPays" ? 1_250_000 : 0;
  const commission = shape === "shopPays" ? 50_000 : 0;
  const cashPrizes = shape === "shopPays" ? 0 : 1_200_000;
  const cp = getLotoCheckpointRepository().createCheckpoint({
    checkpoint_date: date,
    period_start: date,
    period_end: date,
    total_sales: sales,
    total_commission: commission,
    total_cash_prizes: cashPrizes,
  });
  const net = commission + cashPrizes - sales;
  db.prepare(
    `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by)
     VALUES (1, ?, 'ADJUSTMENT', 0, ?, 1)`,
  ).run(lotoId, -net);
  return { cpId: cp.id, lotoId, sales, commission };
}

function profit(): { usd: number; lbp: number } {
  const s = new ProfitService().getSummary("2000-01-01", "2100-01-01");
  return { usd: s.totals.gross_profit_usd, lbp: s.totals.gross_profit_lbp };
}

function lbpDrawerDelta(d: Record<string, number>): number {
  return Object.entries(d)
    .filter(([k]) => k.endsWith("|LBP"))
    .reduce((a, [, v]) => a + v, 0);
}

function discountRow(lotoId: number):
  | { amount_lbp: number; source_ref_id: number | null; transaction_id: number }
  | undefined {
  return db
    .prepare(
      `SELECT amount_lbp, source_ref_id, transaction_id FROM supplier_ledger WHERE entry_type = 'DISCOUNT' AND supplier_id = ?`,
    )
    .get(lotoId) as
    | { amount_lbp: number; source_ref_id: number | null; transaction_id: number }
    | undefined;
}

function settlementRow(lotoId: number): { id: number; amount_lbp: number } {
  return db
    .prepare(
      `SELECT id, amount_lbp FROM supplier_ledger WHERE entry_type = 'SETTLEMENT' AND supplier_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(lotoId) as { id: number; amount_lbp: number };
}

const CASES: Array<{
  shape: Shape;
  leg: number;
  settlementLedger: number;
  discountLedger: number;
  profitDelta: number;
}> = [
  {
    shape: "shopPays",
    leg: -1_000_000,
    settlementLedger: -1_000_000,
    discountLedger: -200_000,
    profitDelta: 200_000,
  },
  {
    shape: "lotoPays",
    leg: 1_000_000,
    settlementLedger: 1_000_000,
    discountLedger: 200_000,
    profitDelta: -200_000,
  },
];

describe("LIRA-310 — LOTO checkpoint settlement with a waived gap", () => {
  for (const c of CASES) {
    for (const path of ["single", "batch"] as const) {
      it(`${path}, ${c.shape}: waive 200,000 → SETTLEMENT ${c.settlementLedger}, DISCOUNT ${c.discountLedger}, profit ${c.profitDelta}, LOTO balance 0`, () => {
        const { cpId, lotoId, sales, commission } = seedCheckpoint(c.shape);
        const before = snapshotLedgers(db);
        const profitBefore = profit();
        const legs = [
          { method: "CASH", currency_code: "LBP", amount: c.leg },
        ];

        if (path === "single") {
          getLotoCheckpointRepository().settleCheckpoint(
            cpId,
            sales,
            commission,
            0,
            0,
            undefined,
            1,
            legs,
            undefined,
            200_000,
          );
        } else {
          getLotoCheckpointRepository().settleCheckpoints(
            [cpId],
            sales,
            commission,
            undefined,
            1,
            legs,
            undefined,
            200_000,
          );
        }

        const settlement = settlementRow(lotoId);
        expect(settlement.amount_lbp).toBe(c.settlementLedger);
        const disc = discountRow(lotoId);
        expect(disc).toBeDefined();
        expect(disc!.amount_lbp).toBe(c.discountLedger);
        expect(disc!.source_ref_id).toBe(settlement.id);
        const discTxn = db
          .prepare(
            `SELECT type, amount_lbp, profit_lbp FROM transactions WHERE id = ?`,
          )
          .get(disc!.transaction_id) as {
          type: string;
          amount_lbp: number;
          profit_lbp: number;
        };
        expect(discTxn.type).toBe("COUNTERPARTY_DISCOUNT");
        expect(discTxn.amount_lbp).toBe(0);
        expect(discTxn.profit_lbp).toBe(c.profitDelta);

        const d = ledgerDeltas(before, snapshotLedgers(db));
        // The supplier moves by the WHOLE net; only the cash leg hits a drawer.
        expect(d.supplier).toEqual({
          [`${lotoId}|LBP`]: c.settlementLedger + c.discountLedger,
        });
        expect(lbpDrawerDelta(d.drawers)).toBe(c.leg);
        expect(profit().lbp - profitBefore.lbp).toBe(c.profitDelta);
        const bal = db
          .prepare(
            `SELECT COALESCE(SUM(amount_lbp),0) AS lbp FROM supplier_ledger WHERE supplier_id = ? AND COALESCE(is_refunded,0) = 0`,
          )
          .get(lotoId) as { lbp: number };
        expect(bal.lbp).toBe(0);
      });
    }
  }

  for (const path of ["single", "batch"] as const) {
    it(`${path}: refuses a waive above 450,000 LBP`, () => {
      const { cpId, sales, commission } = seedCheckpoint("shopPays");
      const before = snapshotLedgers(db);
      const legs = [{ method: "CASH", currency_code: "LBP", amount: -749_999 }];
      const run = () =>
        path === "single"
          ? getLotoCheckpointRepository().settleCheckpoint(
              cpId,
              sales,
              commission,
              0,
              0,
              undefined,
              1,
              legs,
              undefined,
              450_001,
            )
          : getLotoCheckpointRepository().settleCheckpoints(
              [cpId],
              sales,
              commission,
              undefined,
              1,
              legs,
              undefined,
              450_001,
            );
      expect(run).toThrow(/more than/i);
      expectPostings(before, snapshotLedgers(db), {});
    });
  }

  it("refuses legs that do not add up to |net| − waive", () => {
    const { cpId, sales, commission } = seedCheckpoint("shopPays");
    const before = snapshotLedgers(db);
    expect(() =>
      getLotoCheckpointRepository().settleCheckpoint(
        cpId,
        sales,
        commission,
        0,
        0,
        undefined,
        1,
        [{ method: "CASH", currency_code: "LBP", amount: -900_000 }],
        undefined,
        200_000,
      ),
    ).toThrow();
    expectPostings(before, snapshotLedgers(db), {});
  });

  for (const path of ["single", "batch"] as const) {
    it(`${path}: refuses a waive sent with NO payment legs (nothing to reconcile it against)`, () => {
      const { cpId, sales, commission } = seedCheckpoint("shopPays");
      const before = snapshotLedgers(db);
      const run = () =>
        path === "single"
          ? getLotoCheckpointRepository().settleCheckpoint(
              cpId,
              sales,
              commission,
              0,
              0,
              undefined,
              1,
              [],
              undefined,
              200_000,
            )
          : getLotoCheckpointRepository().settleCheckpoints(
              [cpId],
              sales,
              commission,
              undefined,
              1,
              [],
              undefined,
              200_000,
            );
      expect(run).toThrow(/waive/i);
      expectPostings(before, snapshotLedgers(db), {});
    });
  }

  it("refuses a waive that covers the whole net (nothing paid)", () => {
    const { cpId, sales, commission } = seedCheckpoint("shopPays");
    // Shrink the checkpoint so the whole net (−300,000) is under the cap.
    db.prepare(
      `UPDATE loto_checkpoints SET total_sales = 350000 WHERE id = ?`,
    ).run(cpId);
    const before = snapshotLedgers(db);
    expect(() =>
      getLotoCheckpointRepository().settleCheckpoint(
        cpId,
        350_000,
        commission,
        0,
        0,
        undefined,
        1,
        [{ method: "CASH", currency_code: "LBP", amount: -1 }],
        undefined,
        300_000,
      ),
    ).toThrow(/must be less than the settlement/i);
    expect(sales).toBeGreaterThan(0);
    expectPostings(before, snapshotLedgers(db), {});
  });
});
