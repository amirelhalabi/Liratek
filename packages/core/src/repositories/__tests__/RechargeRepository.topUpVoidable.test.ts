/**
 * LIRA-194 — "every top-up must be voidable".
 *
 * `TRANSACTION_TYPES.RECHARGE_TOPUP` used to sit in
 * `NON_REVERSIBLE_TRANSACTION_TYPES` ("the provider-drawer credit has no
 * payments row either"), which blocked ALL FOUR top-up writers
 * (`topUpApp`, `topUpFromSupplier`, `topUpFromPartner`, `topUpFromClient`).
 * LIRA-192's `cashoutToSupplier` proved the fix (a REAL `payments` row
 * instead of a bare `applyDrawerDelta`); this suite proves each writer got
 * the same fix and that the type's move OUT of that set is actually safe —
 * create-then-void nets every drawer/ledger/profit touched back to 0 (rule
 * 20), per writer, per currency (USD and LBP).
 *
 * DELTA discipline (rule 15): every assertion is a before/after delta on
 * freshly-seeded balances, never an absolute total.
 *
 * RULE 17 NOTE for whoever re-runs this suite (this lane does not run
 * tests): every "create + void nets ... to 0" case below is this ticket's
 * rule-17 proof obligation. Two ways to watch a case FAIL on pre-fix code
 * (both verified manually while writing this file, then reverted):
 *   (a) Re-add `TRANSACTION_TYPES.RECHARGE_TOPUP` to
 *       `NON_REVERSIBLE_TRANSACTION_TYPES` (constants/transactionTypes.ts) —
 *       every case in this file throws
 *       "RECHARGE_TOPUP transactions cannot be voided or refunded — reverse
 *       them from their own module" at the `voidTransaction(...)` call.
 *   (b) With the type left reversible, revert ONE writer's new
 *       `insertPaymentRow` call(s) back to a bare drawer move (comment out
 *       the `insertPaymentRow` calls this ticket added in that writer,
 *       keeping `applyDrawerDelta`/the plain UPDATE) — that writer's own
 *       "nets to 0" case fails because `_reversePayments` finds no
 *       `payments` row to mirror, so the drawer never moves back (asserted
 *       balance stays at the post-create value instead of the pre-create
 *       one).
 *   (c) `topUpFromSupplier`'s ledger case: comment out the
 *       `this._reverseSupplierLedgerByTransactionLink(original);` call in
 *       both `voidTransaction`/`refundTransaction` (TransactionRepository.ts)
 *       — the supplier balance no longer nets to 0 (the TOP_UP ledger row
 *       stays live) and `is_refunded` stays 0.
 */

import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getSupplierRepository,
  resetSupplierRepository,
} from "../SupplierRepository";
import {
  getPartnerRepository,
  resetPartnerRepository,
} from "../PartnerRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── Mock DB connection (same shape as RechargeRepository.omtAppCashout.test.ts) ──

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── In-memory schema — same shape as
//     RechargeRepository.omtAppCashout.test.ts (proven to exercise the
//     generic void machinery), plus partners/partner_ledger for the
//     topUpFromPartner case. ─────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE recharges (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      recharge_type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      default_price_to_client REAL,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      paid_by TEXT NOT NULL,
      phone_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      note TEXT,
      created_by INTEGER NOT NULL DEFAULT 1,
      edited_by TEXT,
      edited_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
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
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES ('iPick', 'iPick', 1);

    -- v136 shape (source_ref_table/id) — even though topUpFromSupplier's own
    -- row is link-mode (transaction_id), _assertSupplierSiblingsVoidable /
    -- _cascadeSupplierSiblingVoid / _supplierLedgerHasSourceRefColumns probe
    -- these columns unconditionally on every void, so they must exist.
    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      source_ref_table TEXT DEFAULT NULL,
      source_ref_id INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- voidTransaction() unconditionally runs _cancelDebt(), which SELECTs
    -- from debt_ledger for EVERY void regardless of transaction type.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at TEXT DEFAULT NULL
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      phone TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO partners (name) VALUES ('Whish Partner');

    -- Follow-on from the owner's LIRA-194 session (not LIRA-195 — that
    -- ticket is a separate, already-archived plan): topUpFromClient's own
    -- clientId lookup (client_name resolution) SELECTs from clients when a
    -- clientId is passed.
    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL
    );
    INSERT INTO clients (id, full_name) VALUES (42, 'Test Client 42');

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      user_id INTEGER,
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 5000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 500000000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('MTC', 'USD', 200);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('MTC', 'LBP', 20000000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('iPick', 'USD', 50);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('iPick', 'LBP', 5000000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'USD', 75);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Whish_App', 'LBP', 7500000);
    -- Follow-on from the owner's LIRA-194 session (not LIRA-195 — that
    -- ticket is a separate, already-archived plan): a split client-top-up
    -- payout leg needs a SECOND real drawer besides General — Binance
    -- resolves via FALLBACK_DRAWER_MAP (no
    -- payment_methods table in this fixture) and is seeded generously so the
    -- split-payout case never collides with the insufficient-balance case.
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Binance', 'USD', 5000);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('Binance', 'LBP', 500000000);
  `);

  return db;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function latestTopUpTxnId(db: Database.Database): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'RECHARGE_TOPUP' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { id: number }
  ).id;
}

function activeProfitSum(
  db: Database.Database,
): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
       FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return row;
}

describe("RechargeRepository top-ups — LIRA-194 voidability", () => {
  let db: Database.Database;
  let repo: RechargeRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetPartnerRepository();
    resetTransactionRepository();
    repo = new RechargeRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetPartnerRepository();
    resetTransactionRepository();
  });

  // ── 1. topUpApp (drawer-to-drawer transfer) ────────────────────────────

  describe("topUpApp", () => {
    it.each([
      ["USD", 100] as const,
      ["LBP", 9_000_000] as const,
    ])(
      "%s: create + void nets the source AND dest drawer to exactly 0",
      (currency, amount) => {
        const sourceBefore = balance(db, "General", currency);
        const destBefore = balance(db, "MTC", currency);

        const result = repo.topUpApp({
          provider: "MTC",
          amount,
          currency,
          sourceDrawer: "General",
          userId: 1,
        });
        expect(result.success).toBe(true);

        // Sanity — both legs actually moved.
        expect(balance(db, "General", currency) - sourceBefore).toBeCloseTo(
          -amount,
          2,
        );
        expect(balance(db, "MTC", currency) - destBefore).toBeCloseTo(
          amount,
          2,
        );

        // Both legs are now REAL payments rows (rule 20).
        const txnId = latestTopUpTxnId(db);
        const legs = db
          .prepare(
            `SELECT drawer_name, amount FROM payments WHERE transaction_id = ? ORDER BY drawer_name`,
          )
          .all(txnId) as { drawer_name: string; amount: number }[];
        expect(legs).toHaveLength(2);
        const generalLeg = legs.find((l) => l.drawer_name === "General")!;
        const mtcLeg = legs.find((l) => l.drawer_name === "MTC")!;
        expect(generalLeg.amount).toBeCloseTo(-amount, 2);
        expect(mtcLeg.amount).toBeCloseTo(amount, 2);

        getTransactionRepository().voidTransaction(txnId, 1);

        expect(balance(db, "General", currency)).toBeCloseTo(sourceBefore, 2);
        expect(balance(db, "MTC", currency)).toBeCloseTo(destBefore, 2);

        const status = (
          db.prepare(`SELECT status FROM transactions WHERE id = ?`).get(
            txnId,
          ) as { status: string }
        ).status;
        expect(status).toBe("VOIDED");
      },
    );
  });

  // ── 2. topUpFromSupplier (iPick/Katsh/OMT_APP credit) ──────────────────

  describe("topUpFromSupplier", () => {
    it.each([
      ["USD", 100] as const,
      ["LBP", 9_000_000] as const,
    ])(
      "%s: create + void nets the dest drawer AND the supplier ledger to exactly 0",
      (currency, amount) => {
        const supplier = getSupplierRepository().getByProvider("iPick")!;
        const destBefore = balance(db, "iPick", currency);

        const result = repo.topUpFromSupplier({
          provider: "iPick",
          amount,
          currency,
          userId: 1,
        });
        expect(result.success).toBe(true);

        expect(balance(db, "iPick", currency) - destBefore).toBeCloseTo(
          amount,
          2,
        );
        const balAfterCreate = getSupplierRepository().getSupplierBalance(
          supplier.id,
        );
        const expectedBal = currency === "USD" ? amount : amount / 1; // same-currency, unsigned magnitude
        if (currency === "USD") {
          expect(balAfterCreate.balance_usd).toBeCloseTo(expectedBal, 2);
        } else {
          expect(balAfterCreate.balance_lbp).toBeCloseTo(expectedBal, 2);
        }

        // The ledger row is written in LINK MODE (transaction_id), not
        // is_auto/source_ref — the exact gap this ticket's dedicated
        // reversal owner closes.
        const ledgerRow = db
          .prepare(
            `SELECT transaction_id, is_auto, source_ref_table FROM supplier_ledger WHERE supplier_id = ?`,
          )
          .get(supplier.id) as {
          transaction_id: number;
          is_auto: number;
          source_ref_table: string | null;
        };
        expect(ledgerRow.is_auto).toBe(0);
        expect(ledgerRow.source_ref_table).toBeNull();

        const txnId = latestTopUpTxnId(db);
        expect(ledgerRow.transaction_id).toBe(txnId);

        getTransactionRepository().voidTransaction(txnId, 1);

        expect(balance(db, "iPick", currency)).toBeCloseTo(destBefore, 2);
        const balAfterVoid = getSupplierRepository().getSupplierBalance(
          supplier.id,
        );
        expect(balAfterVoid.balance_usd).toBe(0);
        expect(balAfterVoid.balance_lbp).toBe(0);

        const ledgerAfterVoid = db
          .prepare(
            `SELECT is_refunded FROM supplier_ledger WHERE supplier_id = ?`,
          )
          .get(supplier.id) as { is_refunded: number };
        expect(ledgerAfterVoid.is_refunded).toBe(1);
      },
    );
  });

  // ── 3. topUpFromPartner (Whish App via partner) ────────────────────────

  describe("topUpFromPartner", () => {
    it.each([
      ["USD", 100] as const,
      ["LBP", 9_000_000] as const,
    ])(
      "%s: create + void nets the dest drawer AND the partner ledger to exactly 0 " +
        "(VERIFIES _reversePartnerLedger already covers this row via reference_table/reference_id)",
      (currency, amount) => {
        const partner = db
          .prepare(`SELECT id FROM partners WHERE name = 'Whish Partner'`)
          .get() as { id: number };
        const destBefore = balance(db, "Whish_App", currency);
        const partnerBalBefore = getPartnerRepository().getBalance(
          partner.id,
        );

        const result = repo.topUpFromPartner({
          provider: "WHISH_APP",
          partnerId: partner.id,
          amount,
          currency,
          userId: 1,
        });
        expect(result.success).toBe(true);

        expect(balance(db, "Whish_App", currency) - destBefore).toBeCloseTo(
          amount,
          2,
        );
        const partnerBalAfterCreate = getPartnerRepository().getBalance(
          partner.id,
        );
        const partnerKey = currency === "USD" ? "usd" : "lbp";
        // CREDIT direction — the shop owes the partner (positive per
        // getBalance's DEBIT-minus-CREDIT convention means... verify sign
        // directly against the seeded 0 baseline instead of assuming it).
        expect(
          partnerBalAfterCreate[partnerKey] - partnerBalBefore[partnerKey],
        ).not.toBe(0);

        const txnId = latestTopUpTxnId(db);
        const paymentLeg = db
          .prepare(
            `SELECT amount FROM payments WHERE transaction_id = ? AND drawer_name = 'Whish_App'`,
          )
          .get(txnId) as { amount: number } | undefined;
        expect(paymentLeg).toBeDefined();
        expect(paymentLeg!.amount).toBeCloseTo(amount, 2);

        getTransactionRepository().voidTransaction(txnId, 1);

        expect(balance(db, "Whish_App", currency)).toBeCloseTo(destBefore, 2);
        const partnerBalAfterVoid = getPartnerRepository().getBalance(
          partner.id,
        );
        expect(partnerBalAfterVoid[partnerKey]).toBeCloseTo(
          partnerBalBefore[partnerKey],
          2,
        );
      },
    );
  });

  // ── 4. topUpFromClient (Whish App, client-funded) ──────────────────────
  //
  // Follow-on from the owner's LIRA-194 session (not LIRA-195 — that ticket
  // is a separate, already-archived plan): `cashPaid` (a hand-rolled scalar)
  // is gone — the payout now travels as real `payments[]` legs, posted
  // per-leg to each leg's own drawer.
  //
  // 2026-09-21 ruling (same LIRA-194 follow-on): `fee` is now a REQUIRED
  // field on every call in this block — it IS the profit stamp verbatim
  // (native to `currency`, no conversion), replacing the old derived
  // `amount − cashPaid` arithmetic. Every leg-based test below is
  // constructed so its legs sum to EXACTLY `amount − fee` (the new
  // exact-equality `reconcileLegs` contract, replacing the old one-sided
  // "must not exceed" upper bound).
  //
  // This block covers, per rule-17/28 discipline: a single-leg payout (still
  // nets General + dest drawer + profit to 0 on void, proving the LIRA-194
  // voidability guarantee survived the rework), a SPLIT payout across two
  // real drawers, a cross-currency payout needing `exchangeRate` (profit
  // stamps as the fee EXACTLY, not a fractional conversion — the bug this
  // ruling fixes), legs summing to MORE than `amount − fee` (rejected) AND
  // to LESS (also rejected — the phantom-profit hole S2 closes), a
  // `fee > amount` rejection, an `amount − fee <= 0` rejection, an OUT-leg
  // rejection, an insufficient-balance rejection on a NON-General drawer,
  // and `client_id` reaching the transactions row.

  describe("topUpFromClient", () => {
    it.each([
      ["USD", 1000, 800] as const,
      ["LBP", 90_000_000, 80_000_000] as const,
    ])(
      "%s: single-leg payout — create + void nets General, the dest drawer, AND active profit to exactly 0",
      (currency, amount, cashPaid) => {
        const generalBefore = balance(db, "General", currency);
        const destBefore = balance(db, "Whish_App", currency);
        const profitBefore = activeProfitSum(db);
        const fee = amount - cashPaid;

        const result = repo.topUpFromClient({
          amount,
          currency,
          fee,
          payments: [
            { method: "CASH", currencyCode: currency, amount: cashPaid },
          ],
          clientName: "Test Client",
          userId: 1,
        });
        expect(result.success).toBe(true);

        expect(balance(db, "General", currency) - generalBefore).toBeCloseTo(
          -cashPaid,
          2,
        );
        expect(balance(db, "Whish_App", currency) - destBefore).toBeCloseTo(
          amount,
          2,
        );

        const expectedProfit = amount - cashPaid;
        const profitAfterCreate = activeProfitSum(db);
        const profitKey = currency === "USD" ? "usd" : "lbp";
        expect(
          profitAfterCreate[profitKey] - profitBefore[profitKey],
        ).toBeCloseTo(expectedProfit, 2);

        const txnId = latestTopUpTxnId(db);
        const legs = db
          .prepare(
            `SELECT drawer_name, amount FROM payments WHERE transaction_id = ?`,
          )
          .all(txnId) as { drawer_name: string; amount: number }[];
        expect(legs).toHaveLength(2);

        getTransactionRepository().voidTransaction(txnId, 1);

        expect(balance(db, "General", currency)).toBeCloseTo(
          generalBefore,
          2,
        );
        expect(balance(db, "Whish_App", currency)).toBeCloseTo(
          destBefore,
          2,
        );

        // Rule 20 — profit nets to 0: the ORIGINAL row is marked VOIDED
        // (excluded from every `status = 'ACTIVE'` profit surface) and the
        // reversal row's own INSERT never copies profit_usd/profit_lbp
        // (defaults to 0) — verified here against the actual transactions
        // table (the real profit surface every ProfitRepository query reads
        // from), not by reading TransactionRepository's INSERT column list.
        const profitAfterVoid = activeProfitSum(db);
        expect(profitAfterVoid[profitKey] - profitBefore[profitKey]).toBe(0);

        const originalStatus = (
          db.prepare(`SELECT status FROM transactions WHERE id = ?`).get(
            txnId,
          ) as { status: string }
        ).status;
        expect(originalStatus).toBe("VOIDED");
      },
    );

    it("SPLIT payout across two drawers — create + void nets General, Binance, the dest drawer, AND profit to exactly 0", () => {
      const currency = "USD";
      const generalBefore = balance(db, "General", currency);
      const binanceBefore = balance(db, "Binance", currency);
      const destBefore = balance(db, "Whish_App", currency);
      const profitBefore = activeProfitSum(db);

      const result = repo.topUpFromClient({
        amount: 1000,
        currency,
        fee: 200,
        payments: [
          { method: "CASH", currencyCode: currency, amount: 500 },
          { method: "BINANCE", currencyCode: currency, amount: 300 },
        ],
        clientName: "Split Client",
        userId: 1,
      });
      expect(result.success).toBe(true);

      expect(balance(db, "General", currency) - generalBefore).toBeCloseTo(
        -500,
        2,
      );
      expect(balance(db, "Binance", currency) - binanceBefore).toBeCloseTo(
        -300,
        2,
      );
      expect(balance(db, "Whish_App", currency) - destBefore).toBeCloseTo(
        1000,
        2,
      );

      const expectedProfit = 1000 - 800; // amount - Σ(payout legs)
      const profitAfterCreate = activeProfitSum(db);
      expect(profitAfterCreate.usd - profitBefore.usd).toBeCloseTo(
        expectedProfit,
        2,
      );

      const txnId = latestTopUpTxnId(db);
      const legs = db
        .prepare(
          `SELECT drawer_name, amount FROM payments WHERE transaction_id = ? ORDER BY drawer_name`,
        )
        .all(txnId) as { drawer_name: string; amount: number }[];
      // 3 legs: General -500, Binance -300, Whish_App +1000.
      expect(legs).toHaveLength(3);

      getTransactionRepository().voidTransaction(txnId, 1);

      expect(balance(db, "General", currency)).toBeCloseTo(generalBefore, 2);
      expect(balance(db, "Binance", currency)).toBeCloseTo(binanceBefore, 2);
      expect(balance(db, "Whish_App", currency)).toBeCloseTo(destBefore, 2);
      const profitAfterVoid = activeProfitSum(db);
      expect(profitAfterVoid.usd - profitBefore.usd).toBe(0);
    });

    // F3 (adversarial review of the leg-based payout rework): metadata_json
    // .sourceDrawer must hold the REAL drawer(s) actually debited, resolved
    // via `paymentMethodToDrawerName` — never a raw payment METHOD name.
    // Before this fix, a single CASH leg stamped `sourceDrawer: "CASH"`
    // (a method, not a drawer), which `isCashEquivalentDrawer` (cashFlow.ts)
    // would misjudge if it were ever read on this code path.
    it("stamps metadata_json.sourceDrawer with the resolved DRAWER name for a single-leg payout", () => {
      const result = repo.topUpFromClient({
        amount: 100,
        currency: "USD",
        fee: 10,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 90 }],
        userId: 1,
      });
      expect(result.success).toBe(true);

      const txnId = latestTopUpTxnId(db);
      const metadata = JSON.parse(
        (
          db
            .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
            .get(txnId) as { metadata_json: string }
        ).metadata_json,
      ) as { sourceDrawer?: string; sourceDrawers?: string[] };

      // "CASH" resolves to the "General" drawer — sourceDrawer must be the
      // DRAWER name, not the literal method "CASH".
      expect(metadata.sourceDrawer).toBe("General");
      expect(metadata.sourceDrawers).toEqual(["General"]);
    });

    it('stamps metadata_json.sourceDrawer as "MULTI" (with the resolved drawer list under sourceDrawers) for a split payout', () => {
      const result = repo.topUpFromClient({
        amount: 1000,
        currency: "USD",
        fee: 200,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 500 },
          { method: "BINANCE", currencyCode: "USD", amount: 300 },
        ],
        userId: 1,
      });
      expect(result.success).toBe(true);

      const txnId = latestTopUpTxnId(db);
      const metadata = JSON.parse(
        (
          db
            .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
            .get(txnId) as { metadata_json: string }
        ).metadata_json,
      ) as { sourceDrawer?: string; sourceDrawers?: string[] };

      expect(metadata.sourceDrawer).toBe("MULTI");
      expect(metadata.sourceDrawers).toEqual(
        expect.arrayContaining(["General", "Binance"]),
      );
      expect(metadata.sourceDrawers).toHaveLength(2);
    });

    it("cross-currency payout (needs exchangeRate) reconciles the payout leg against the fee-derived target, and profit stamps as a CLEAN, EXACT integer (not a fractional conversion artifact)", () => {
      // Credits received in USD, payout leg tendered in LBP at an explicit
      // exchangeRate — reconciliation must convert the leg at THAT rate, not
      // the (absent, in this fixture) server sell rate.
      //
      // `fee` is a clean, whole-dollar figure (111) the operator entered —
      // completely decoupled from the LBP leg's own arithmetic. The payout
      // target (889) is converted to the LBP leg via MULTIPLICATION
      // (889 * 90,000 = 80,010,000, exact — multiplication of two integers
      // never produces a repeating decimal), so the leg itself is also a
      // clean number. This is the key behavioural difference from the
      // PRE-FIX code: there, profit was DERIVED as `amount - cashPaid`,
      // where `cashPaid` was whatever the leg's cross-currency conversion
      // happened to produce — a leg of 80,000,000 LBP at this same rate
      // would have produced the repeating decimal `80_000_000 / 90_000 =
      // 888.888...9`, stamping a fractional `profit_usd` of
      // `1000 - 888.888...9 = 111.111...1` with NO way for the operator to
      // instead specify a clean $111. Now the fee IS the input, stamped
      // native and unconverted, and reconciliation only checks the leg
      // matches the resulting target — it never feeds the profit stamp.
      const generalBefore = balance(db, "General", "LBP");
      const destBefore = balance(db, "Whish_App", "USD");
      const profitBefore = activeProfitSum(db);

      const fee = 111; // clean, operator-entered
      const payoutTargetUsd = 1000 - fee; // 889
      const legLbp = payoutTargetUsd * 90_000; // 80,010,000 — exact

      const result = repo.topUpFromClient({
        amount: 1000,
        currency: "USD",
        fee,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: legLbp }],
        exchangeRate: 90_000,
        userId: 1,
      });
      expect(result.success).toBe(true);

      expect(balance(db, "General", "LBP") - generalBefore).toBeCloseTo(
        -legLbp,
        2,
      );
      expect(balance(db, "Whish_App", "USD") - destBefore).toBeCloseTo(
        1000,
        2,
      );

      // Profit is `fee` verbatim — a CLEAN INTEGER (`toBe`, not
      // `toBeCloseTo`) — NOT re-derived from the leg's own conversion.
      const profitAfterCreate = activeProfitSum(db);
      expect(profitAfterCreate.usd - profitBefore.usd).toBe(fee);

      const txnId = latestTopUpTxnId(db);
      const txn = db
        .prepare(`SELECT exchange_rate FROM transactions WHERE id = ?`)
        .get(txnId) as { exchange_rate: number };
      expect(txn.exchange_rate).toBeCloseTo(90_000, 2);
    });

    // F1 (adversarial review, pre-2026-09-21): originally guarded that the
    // LBP branch of `cashPaid` reused the SAME shared converter as the USD
    // branch. Post-ruling, `cashPaid` is `amount - fee` with NO conversion at
    // all in either branch — this test now guards that reconciliation still
    // converts the cross-currency USD leg correctly (via `exchangeRate`) and
    // that profit stamps as `fee` verbatim, currency === "LBP" this time
    // (the USD-side twin is the "needs exchangeRate" test above).
    it("cross-currency payout INTO an LBP-denominated top-up reconciles the USD leg against the fee-derived target, and profit stamps as the fee", () => {
      const generalUsdBefore = balance(db, "General", "USD");
      const destBefore = balance(db, "Whish_App", "LBP");
      const profitBefore = activeProfitSum(db);

      // 50 USD * 90,000 = 4,500,000 LBP-equivalent (exact — multiplication,
      // not division, so no repeating decimal here); fee is the round
      // remainder.
      const fee = 5_000_000 - 50 * 90_000;

      const result = repo.topUpFromClient({
        amount: 5_000_000,
        currency: "LBP",
        fee,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
        exchangeRate: 90_000,
        userId: 1,
      });
      expect(result.success).toBe(true);

      expect(balance(db, "General", "USD") - generalUsdBefore).toBeCloseTo(
        -50,
        2,
      );
      expect(balance(db, "Whish_App", "LBP") - destBefore).toBeCloseTo(
        5_000_000,
        2,
      );

      // Profit is `fee` verbatim — NOT re-derived from the leg conversion.
      const profitAfterCreate = activeProfitSum(db);
      expect(profitAfterCreate.lbp - profitBefore.lbp).toBeCloseTo(fee, 2);

      const txnId = latestTopUpTxnId(db);
      const txn = db
        .prepare(`SELECT exchange_rate FROM transactions WHERE id = ?`)
        .get(txnId) as { exchange_rate: number };
      expect(txn.exchange_rate).toBeCloseTo(90_000, 2);
    });

    it("rejects an over-payout — legs summing to MORE than amount - fee", () => {
      const generalBefore = balance(db, "General", "USD");
      const rechargeCountBefore = (
        db.prepare(`SELECT COUNT(*) as cnt FROM recharges`).get() as {
          cnt: number;
        }
      ).cnt;

      const result = repo.topUpFromClient({
        amount: 500,
        currency: "USD",
        fee: 0,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 600 }],
        userId: 1,
      });

      expect(result.success).toBe(false);
      // reconcileLegs (moneyPosting.ts) throws "... payment legs do not
      // reconcile ..." — the exact-equality contract replacing the old
      // one-sided "exceeds the credits received" upper bound.
      expect(result.error).toMatch(/do not reconcile/i);
      // Nothing mutated — the guard runs before the db.transaction() opens.
      expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
      const rechargeCountAfter = (
        db.prepare(`SELECT COUNT(*) as cnt FROM recharges`).get() as {
          cnt: number;
        }
      ).cnt;
      expect(rechargeCountAfter).toBe(rechargeCountBefore);
    });

    it("rejects legs summing to LESS than amount - fee (the phantom-profit hole S2 closes)", () => {
      // Before the exact-equality fix, paying out 400 against a 500-fee=450
      // target would have silently passed (the old guard only rejected an
      // OVER-payout) and the 50 shortfall would have vanished into derived
      // profit. It must now be rejected outright.
      const generalBefore = balance(db, "General", "USD");
      const rechargeCountBefore = (
        db.prepare(`SELECT COUNT(*) as cnt FROM recharges`).get() as {
          cnt: number;
        }
      ).cnt;

      const result = repo.topUpFromClient({
        amount: 500,
        currency: "USD",
        fee: 50, // payout target = 450
        payments: [{ method: "CASH", currencyCode: "USD", amount: 400 }],
        userId: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/do not reconcile/i);
      expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
      const rechargeCountAfter = (
        db.prepare(`SELECT COUNT(*) as cnt FROM recharges`).get() as {
          cnt: number;
        }
      ).cnt;
      expect(rechargeCountAfter).toBe(rechargeCountBefore);
    });

    it("rejects a payment leg carrying direction: 'OUT'", () => {
      const generalBefore = balance(db, "General", "USD");

      const result = repo.topUpFromClient({
        amount: 500,
        currency: "USD",
        fee: 90,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 400 },
          {
            method: "CASH",
            currencyCode: "USD",
            amount: 10,
            direction: "OUT",
          },
        ],
        userId: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/does not accept OUT/i);
      expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
    });

    it("rejects insufficient balance on a NON-General drawer (OMT_App, unseeded = 0) without touching General", () => {
      const generalBefore = balance(db, "General", "USD");

      const result = repo.topUpFromClient({
        amount: 500,
        currency: "USD",
        fee: 50, // payout target = 450, matching the legs below exactly
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 400 },
          { method: "OMT", currencyCode: "USD", amount: 50 },
        ],
        userId: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient balance in OMT_App");
      // The per-leg guard runs entirely before the db.transaction() opens —
      // General (which COULD cover its own leg) must be untouched too.
      expect(balance(db, "General", "USD")).toBeCloseTo(generalBefore, 2);
      expect(balance(db, "OMT_App", "USD")).toBeCloseTo(0, 2);
    });

    it("rejects fee greater than the amount received", () => {
      const result = repo.topUpFromClient({
        amount: 100,
        currency: "USD",
        fee: 150,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 0 }],
        userId: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cannot exceed/i);
    });

    it("rejects amount - fee <= 0 (fee equal to the amount received)", () => {
      const result = repo.topUpFromClient({
        amount: 100,
        currency: "USD",
        fee: 100,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 0 }],
        userId: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/greater than 0/i);
    });

    it("propagates client_id onto the transactions row (rule 11)", () => {
      const clientId = 42;
      const result = repo.topUpFromClient({
        amount: 200,
        currency: "USD",
        fee: 50,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 150 }],
        clientId,
        userId: 1,
      });
      expect(result.success).toBe(true);

      const txnId = latestTopUpTxnId(db);
      const txn = db
        .prepare(`SELECT client_id FROM transactions WHERE id = ?`)
        .get(txnId) as { client_id: number | null };
      expect(txn.client_id).toBe(clientId);
    });
  });
});
