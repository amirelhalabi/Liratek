/**
 * LIRA-085 — PARTNER_SETTLEMENT / PARTNER_PAYMENT reversal (rule 20, owner
 * notes 25/26: "the shop owner made a mistake in the txn detail, should be
 * able to undo").
 *
 * Both types used to sit in `NON_REVERSIBLE_TRANSACTION_TYPES` — the
 * documented blocker was "the generic reversal would restore the drawer +
 * partner_ledger rows but NOT the FIFO covered_amount stamps the settlement
 * applied to FOR_% rows." `TransactionRepository._reversePartnerSettlementLedger`
 * (+ `_unwindPartnerSettlementCoverage`) is now the owner: it inserts a
 * compensating opposite-direction partner_ledger row (partner_ledger has no
 * soft-void column, unlike debt_ledger/supplier_ledger) and gives back the
 * FIFO `covered_amount` budget newest-covered-first, mirroring
 * `PartnerRepository.applySettlementCoverage` in reverse.
 *
 * A CQ-10 discount BUNDLED with a settlement is explicitly swept by the SAME
 * reversal (per this ticket's acceptance text — deliberately NOT the D3
 * DEBT_REPAYMENT precedent, where a bundled discount stays untouched): its
 * own ledger row and its COUNTERPARTY_DISCOUNT transaction's profit stamp
 * both net to 0 too. This requires `PartnerService.settle()`'s bundled
 * discount to stamp `reference_table='partner_ledger'`/`reference_id=
 * <settlement row id>` at creation (LIRA-085 addition — previously these two
 * rows were linked only by time proximity).
 *
 * Rule-17 classification (manually verified: temporarily re-adding
 * PARTNER_SETTLEMENT/PARTNER_PAYMENT to NON_REVERSIBLE_TRANSACTION_TYPES and
 * re-running this file turns every "reverses"/"nets to 0"/"unwinds" case
 * red with "cannot be voided or refunded" — confirming these are true
 * regression guards, not tests that would pass regardless):
 *
 *   FAILING-FIRST:
 *     - single-leg settlement void/refund nets ledger + drawer + coverage to 0
 *     - CQ-11 split-leg settlement void reverses every leg's drawer
 *     - bundled discount is SWEPT (ledger nets to 0, profit stamp negated,
 *       full coverage give-back — not just the settlement's own share)
 *     - PARTNER_PAYMENT (cash-moved manual entry) nets to 0 identically
 *
 *   INVARIANT (unrelated to this fix, proven not broken):
 *     - double-void/refund guards
 *     - CLIENT_ACCOUNT settlement (no drawer leg) still reverses the ledger
 */

import Database from "better-sqlite3";
import { PartnerRepository } from "../PartnerRepository";
import { PartnerService } from "../../services/PartnerService";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE partners (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      tenant_id          INTEGER DEFAULT 1,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO partners (id, name) VALUES (1, 'Reversal Partner');

    CREATE TABLE partner_ledger (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      tenant_id         INTEGER DEFAULT 1,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
      covered_amount    REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      device_id TEXT,
      summary TEXT,
      metadata_json TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Unrelated to this fixture's own scenarios, but _cancelDebt runs
    -- unconditionally on every void/refund (no-op here — no rows ever
    -- match) and needs the table to exist.
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 1000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'USD', 200);
  `);
  return db;
}

function ledgerBalanceUsd(db: Database.Database, partnerId: number): number {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS net
       FROM partner_ledger WHERE partner_id = ? AND currency = 'USD'`,
    )
    .get(partnerId) as { net: number };
  return row.net;
}

function forPosRow(
  db: Database.Database,
  partnerId: number,
): { amount: number; covered_amount: number } {
  return db
    .prepare(
      `SELECT amount, covered_amount FROM partner_ledger
       WHERE partner_id = ? AND transaction_type = 'FOR_POS'`,
    )
    .get(partnerId) as { amount: number; covered_amount: number };
}

function drawerBalance(
  db: Database.Database,
  drawer: string,
  ccy = "USD",
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(drawer, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function seedForPos(
  db: Database.Database,
  partnerId: number,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, user_id)
     VALUES (?, 'FOR_POS', 'sales', 1, ?, 'USD', 'DEBIT', 1)`,
  ).run(partnerId, amount);
}

function discountTxnRow(db: Database.Database):
  | {
      id: number;
      profit_usd: number;
      status: string;
    }
  | undefined {
  return db
    .prepare(
      `SELECT id, profit_usd, status FROM transactions
       WHERE type = 'COUNTERPARTY_DISCOUNT' ORDER BY id ASC LIMIT 1`,
    )
    .get() as { id: number; profit_usd: number; status: string } | undefined;
}

function sumActiveProfitUsd(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS p FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { p: number };
  return row.p;
}

describe("LIRA-085 — PARTNER_SETTLEMENT / PARTNER_PAYMENT reversal", () => {
  let db: Database.Database;
  let repo: PartnerRepository;
  let service: PartnerService;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetTransactionRepository();
    repo = new PartnerRepository();
    service = new PartnerService(repo);
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
  });

  // ── Simple single-leg CASH settlement ────────────────────────────────────

  describe("single-leg CASH settlement covering a FOR_POS row fully", () => {
    beforeEach(() => {
      seedForPos(db, 1, 100);
    });

    function makeSettlement(): number {
      const entry = service.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      });
      const txn = txnRepo.getBySourceId("partner_ledger", entry.id)!;
      return txn.id;
    }

    it("forward sanity: ledger nets to 0, FOR_POS fully covered", () => {
      makeSettlement();
      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(0, 2);
      const row = forPosRow(db, 1);
      expect(row.covered_amount).toBeCloseTo(100, 2);
    });

    it("VOID: ledger restores to the pre-settlement +100 (partner owes us again)", () => {
      const txnId = makeSettlement();
      txnRepo.voidTransaction(txnId, 1);
      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(100, 2);
    });

    it("VOID: drawer (General CASH) restores to its pre-settlement balance", () => {
      const generalBefore = drawerBalance(db, "General");
      const txnId = makeSettlement();
      expect(drawerBalance(db, "General")).toBeCloseTo(generalBefore + 100, 2);
      txnRepo.voidTransaction(txnId, 1);
      expect(drawerBalance(db, "General")).toBeCloseTo(generalBefore, 2);
    });

    it("VOID: unwinds the FOR_POS covered_amount stamp back to 0 (uncovered again)", () => {
      const txnId = makeSettlement();
      expect(forPosRow(db, 1).covered_amount).toBeCloseTo(100, 2);
      txnRepo.voidTransaction(txnId, 1);
      expect(forPosRow(db, 1).covered_amount).toBeCloseTo(0, 2);
    });

    it("REFUND does the identical restore; original stays ACTIVE, a REFUND row is posted", () => {
      const txnId = makeSettlement();
      const refundId = txnRepo.refundTransaction(txnId, 1);

      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(100, 2);
      expect(forPosRow(db, 1).covered_amount).toBeCloseTo(0, 2);

      const original = db
        .prepare(`SELECT status FROM transactions WHERE id = ?`)
        .get(txnId) as { status: string };
      expect(original.status).toBe("ACTIVE");
      const refundRow = db
        .prepare(`SELECT type, reverses_id FROM transactions WHERE id = ?`)
        .get(refundId) as { type: string; reverses_id: number };
      expect(refundRow.type).toBe("REFUND");
      expect(refundRow.reverses_id).toBe(txnId);
    });

    it("second VOID is blocked (already voided)", () => {
      const txnId = makeSettlement();
      txnRepo.voidTransaction(txnId, 1);
      expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(
        /already voided/i,
      );
    });

    it("refuses voiding an already-refunded settlement", () => {
      const txnId = makeSettlement();
      txnRepo.refundTransaction(txnId, 1);
      expect(() => txnRepo.voidTransaction(txnId, 1)).toThrow(
        /already been refunded/i,
      );
    });
  });

  // ── CQ-11 split-leg settlement ────────────────────────────────────────────

  describe("split-leg settlement ($60 CASH + $40 WHISH)", () => {
    beforeEach(() => {
      seedForPos(db, 1, 100);
    });

    it("VOID reverses BOTH legs' drawers independently", () => {
      const generalBefore = drawerBalance(db, "General");
      const whishAppBefore = drawerBalance(db, "Whish_App");

      // "WHISH" (not "WHISH_APP") is what utils/payments.ts's
      // FALLBACK_DRAWER_MAP resolves to the "Whish_App" drawer when no
      // payment_methods table is present (this fixture's minimal schema) —
      // an unmapped method silently falls back to "General", which would
      // mask this test's whole point (two DIFFERENT drawers).
      const entry = service.settle({
        partnerId: 1,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 60 },
          { method: "WHISH", currency_code: "USD", amount: 40 },
        ],
      });
      const txnId = txnRepo.getBySourceId("partner_ledger", entry.id)!.id;

      expect(drawerBalance(db, "General")).toBeCloseTo(generalBefore + 60, 2);
      expect(drawerBalance(db, "Whish_App")).toBeCloseTo(
        whishAppBefore + 40,
        2,
      );

      txnRepo.voidTransaction(txnId, 1);

      expect(drawerBalance(db, "General")).toBeCloseTo(generalBefore, 2);
      expect(drawerBalance(db, "Whish_App")).toBeCloseTo(whishAppBefore, 2);
      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(100, 2);
      expect(forPosRow(db, 1).covered_amount).toBeCloseTo(0, 2);
    });
  });

  // ── Bundled CQ-10 discount ("owed 100, paid 60, forgive 40") ─────────────

  describe("settlement with a bundled CQ-10 discount", () => {
    beforeEach(() => {
      seedForPos(db, 1, 100);
    });

    function makeSettlementWithDiscount(): number {
      const entry = service.settle({
        partnerId: 1,
        amount: 60,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
        discount: { amount_usd: 40, amount_lbp: 0, reason: "goodwill" },
      });
      return txnRepo.getBySourceId("partner_ledger", entry.id)!.id;
    }

    it("forward sanity: ledger nets to 0, FOR_POS fully covered by cash+discount", () => {
      makeSettlementWithDiscount();
      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(0, 2);
      expect(forPosRow(db, 1).covered_amount).toBeCloseTo(100, 2);
    });

    it("VOID sweeps the bundled discount too: ledger fully restores to +100 (not left at +40)", () => {
      const txnId = makeSettlementWithDiscount();
      txnRepo.voidTransaction(txnId, 1);
      // If the discount were left untouched (D3-style boundary), the ledger
      // would sit at only +40 (100 - 60 settlement reversal - the still-
      // standing -40 discount). This ticket's acceptance text requires the
      // FULL restore.
      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(100, 2);
    });

    it("VOID fully unwinds coverage (both the settlement's AND the discount's share)", () => {
      const txnId = makeSettlementWithDiscount();
      txnRepo.voidTransaction(txnId, 1);
      expect(forPosRow(db, 1).covered_amount).toBeCloseTo(0, 2);
    });

    it("VOID negates the discount's own COUNTERPARTY_DISCOUNT profit stamp — net profit returns to 0", () => {
      const txnId = makeSettlementWithDiscount();
      const before = discountTxnRow(db)!;
      expect(before.profit_usd).toBeCloseTo(-40, 2); // "forgiven" = profit negative (D1)
      expect(sumActiveProfitUsd(db)).toBeCloseTo(-40, 2);

      txnRepo.voidTransaction(txnId, 1);

      // The original discount transaction is untouched (never mutated —
      // additive convention); a NEW reversal row negates it.
      const after = discountTxnRow(db)!;
      expect(after.profit_usd).toBeCloseTo(-40, 2);
      expect(after.status).toBe("ACTIVE");

      expect(sumActiveProfitUsd(db)).toBeCloseTo(0, 2);
    });

    it("REFUND does the identical full sweep (ledger, coverage, profit)", () => {
      const txnId = makeSettlementWithDiscount();
      txnRepo.refundTransaction(txnId, 1);

      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(100, 2);
      expect(forPosRow(db, 1).covered_amount).toBeCloseTo(0, 2);
      expect(sumActiveProfitUsd(db)).toBeCloseTo(0, 2);
    });
  });

  // ── PARTNER_PAYMENT (cash-moved manual "Record Tx" entry) ────────────────

  describe("PARTNER_PAYMENT — cash-moved manual entry (moveCash: true)", () => {
    beforeEach(() => {
      seedForPos(db, 1, 50);
    });

    it("VOID nets ledger, drawer, and coverage back to their pre-payment values", () => {
      const generalBefore = drawerBalance(db, "General");

      const entry = service.recordPartnerTransaction({
        partnerId: 1,
        transactionType: "SETTLEMENT",
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
        userId: 1,
        moveCash: true,
      });
      const txnId = txnRepo.getBySourceId("partner_ledger", entry.id)!.id;

      const txnRow = db
        .prepare(`SELECT type FROM transactions WHERE id = ?`)
        .get(txnId) as { type: string };
      expect(txnRow.type).toBe("PARTNER_PAYMENT");
      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(0, 2);
      expect(forPosRow(db, 1).covered_amount).toBeCloseTo(50, 2);
      expect(drawerBalance(db, "General")).toBeCloseTo(generalBefore + 50, 2);

      txnRepo.voidTransaction(txnId, 1);

      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(50, 2);
      expect(forPosRow(db, 1).covered_amount).toBeCloseTo(0, 2);
      expect(drawerBalance(db, "General")).toBeCloseTo(generalBefore, 2);
    });
  });

  // ── CLIENT_ACCOUNT settlement (no drawer leg at all) ─────────────────────

  describe("CLIENT_ACCOUNT settlement (LIRA-066 residual — no cash moves)", () => {
    beforeEach(() => {
      seedForPos(db, 1, 30);
    });

    it("VOID still restores the ledger + coverage even though no drawer ever moved", () => {
      const generalBefore = drawerBalance(db, "General");
      const entry = service.settle({
        partnerId: 1,
        amount: 30,
        currency: "USD",
        settlementMethod: "CLIENT_ACCOUNT",
        userId: 1,
      });
      const txnId = txnRepo.getBySourceId("partner_ledger", entry.id)!.id;

      expect(drawerBalance(db, "General")).toBeCloseTo(generalBefore, 2); // unchanged
      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(0, 2);

      txnRepo.voidTransaction(txnId, 1);

      expect(ledgerBalanceUsd(db, 1)).toBeCloseTo(30, 2);
      expect(forPosRow(db, 1).covered_amount).toBeCloseTo(0, 2);
      expect(drawerBalance(db, "General")).toBeCloseTo(generalBefore, 2); // still unchanged
    });
  });
});
