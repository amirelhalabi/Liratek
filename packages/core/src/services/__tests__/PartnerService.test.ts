import Database from "better-sqlite3";
import { PartnerRepository } from "../../repositories/PartnerRepository";
import { PartnerService } from "../PartnerService";
import { NotFoundError } from "../../utils/errors";
import { TRANSACTION_TYPES } from "../../constants/transactionTypes";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
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

    CREATE TABLE financial_services (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      provider         TEXT NOT NULL,
      service_type     TEXT NOT NULL,
      amount           REAL NOT NULL DEFAULT 0,
      currency         TEXT NOT NULL DEFAULT 'USD',
      omt_fee          REAL,
      whish_fee        REAL,
      sender_name      TEXT,
      receiver_name    TEXT,
      client_name      TEXT,
      reference_number TEXT,
      phone_number     TEXT,
      tenant_id        INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- PFT-6b: PartnerService.settle() writes a real money movement via
    -- PartnerRepository.recordSettlementMoneyMovement(), which needs the
    -- unified transactions/payments journal + a live drawer_balances row.
    -- LIRA-066 residual: CLIENT_ACCOUNT settlements now ALSO call this
    -- method (for the unified transactions row) but skip the payments/
    -- drawer effect internally -- no schema change needed for that case.
    CREATE TABLE users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT NOT NULL,
      role       TEXT DEFAULT 'staff',
      tenant_id  INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER DEFAULT 1,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT NOT NULL,
      source_id     INTEGER NOT NULL,
      user_id       INTEGER NOT NULL DEFAULT 1,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER DEFAULT 1,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
  `);
  return db;
}

describe("PartnerService", () => {
  let db: Database.Database;
  let service: PartnerService;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    service = new PartnerService(new PartnerRepository());
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    db.close();
  });

  // ── Partner CRUD ───────────────────────────────────────────────────────────

  describe("createPartner()", () => {
    it("creates and returns a partner", () => {
      const p = service.createPartner({ name: "Samer" });
      expect(p.id).toBeGreaterThan(0);
      expect(p.name).toBe("Samer");
      expect(p.is_active).toBe(1);
    });

    it("throws when name is empty", () => {
      expect(() => service.createPartner({ name: "" })).toThrow(
        "Partner name is required",
      );
    });

    it("throws when name is only whitespace", () => {
      expect(() => service.createPartner({ name: "   " })).toThrow(
        "Partner name is required",
      );
    });

    it("stores optional fields correctly", () => {
      const p = service.createPartner({
        name: "Full",
        phone: "71000000",
        notes: "VIP",
      });
      expect(p.phone).toBe("71000000");
      expect(p.notes).toBe("VIP");
    });
  });

  describe("getPartnerById()", () => {
    it("returns the partner when it exists", () => {
      const created = service.createPartner({ name: "Findable" });
      const found = service.getPartnerById(created.id);
      expect(found.id).toBe(created.id);
      expect(found.name).toBe("Findable");
    });

    it("throws NotFoundError for non-existent id", () => {
      expect(() => service.getPartnerById(999)).toThrow(NotFoundError);
    });
  });

  describe("getAllPartners()", () => {
    it("returns only active partners by default", () => {
      service.createPartner({ name: "Active" });
      const p2 = service.createPartner({ name: "Inactive" });
      service.deactivatePartner(p2.id);
      expect(service.getAllPartners()).toHaveLength(1);
    });

    it("includes inactive partners when flag is true", () => {
      service.createPartner({ name: "Active" });
      const p2 = service.createPartner({ name: "Inactive" });
      service.deactivatePartner(p2.id);
      expect(service.getAllPartners(true)).toHaveLength(2);
    });
  });

  describe("updatePartner()", () => {
    it("updates and returns the modified partner", () => {
      const p = service.createPartner({ name: "Before" });
      const updated = service.updatePartner(p.id, { name: "After" });
      expect(updated.name).toBe("After");
    });

    it("does not overwrite untouched fields", () => {
      const p = service.createPartner({ name: "Keep", phone: "111" });
      const updated = service.updatePartner(p.id, { notes: "new note" });
      expect(updated.name).toBe("Keep");
      expect(updated.phone).toBe("111");
    });
  });

  describe("deactivatePartner() / activatePartner()", () => {
    it("deactivated partner disappears from the active list", () => {
      const p = service.createPartner({ name: "ToDeactivate" });
      service.deactivatePartner(p.id);
      expect(service.getAllPartners()).toHaveLength(0);
    });

    it("reactivated partner reappears in the active list", () => {
      const p = service.createPartner({ name: "ToReactivate" });
      service.deactivatePartner(p.id);
      service.activatePartner(p.id);
      expect(service.getAllPartners()).toHaveLength(1);
    });
  });

  // ── Settlement direction logic ─────────────────────────────────────────────

  describe("settle() — direction logic", () => {
    it("creates a CREDIT entry when partner balance is positive (partner owes us)", () => {
      const p = service.createPartner({ name: "OwesUs" });
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 200,
        currency: "USD",
        direction: "DEBIT",
        userId: 1,
      });

      const entry = service.settle({
        partnerId: p.id,
        amount: 50,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      });

      expect(entry.direction).toBe("CREDIT");
      expect(entry.transaction_type).toBe("SETTLEMENT");
    });

    it("creates a DEBIT entry when balance is negative (we owe partner)", () => {
      const p = service.createPartner({ name: "WeOwe" });
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 200,
        currency: "USD",
        direction: "CREDIT",
        userId: 1,
      });

      const entry = service.settle({
        partnerId: p.id,
        amount: 50,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      });

      expect(entry.direction).toBe("DEBIT");
    });

    it("creates a CREDIT entry when balance is exactly zero (>= 0 boundary)", () => {
      const p = service.createPartner({ name: "Balanced" });
      // No ledger entries → balance = 0 → direction should be CREDIT
      const entry = service.settle({
        partnerId: p.id,
        amount: 50,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      });
      expect(entry.direction).toBe("CREDIT");
    });

    it("settlement reduces a positive balance correctly", () => {
      const p = service.createPartner({ name: "ReduceBalance" });
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 200,
        currency: "USD",
        direction: "DEBIT",
        userId: 1,
      });
      service.settle({
        partnerId: p.id,
        amount: 50,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      });

      expect(service.getPartnerBalance(p.id).usd).toBeCloseTo(150, 2);
    });

    it("settlement reduces a negative balance (we owe) correctly", () => {
      const p = service.createPartner({ name: "ReduceNegative" });
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 100,
        currency: "USD",
        direction: "CREDIT",
        userId: 1,
      });
      service.settle({
        partnerId: p.id,
        amount: 40,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      });

      expect(service.getPartnerBalance(p.id).usd).toBeCloseTo(-60, 2);
    });

    it("uses LBP currency balance for LBP settlement direction", () => {
      const p = service.createPartner({ name: "LBPPartner" });
      // LBP balance is positive (partner owes us in LBP) → CREDIT
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 500000,
        currency: "LBP",
        direction: "DEBIT",
        userId: 1,
      });

      const entry = service.settle({
        partnerId: p.id,
        amount: 100000,
        currency: "LBP",
        settlementMethod: "CASH",
        userId: 1,
      });
      expect(entry.direction).toBe("CREDIT");
      expect(entry.currency).toBe("LBP");
    });
  });

  // ── Settlement cashout methods ─────────────────────────────────────────────

  describe("settle() — all cashout methods accepted", () => {
    const methods = [
      "CASH",
      "OMT",
      "WHISH",
      "BINANCE",
      "CLIENT_ACCOUNT",
    ] as const;

    methods.forEach((method) => {
      it(`records settlement_method = ${method}`, () => {
        const p = service.createPartner({ name: `Partner_${method}` });
        service.recordPartnerTransaction({
          partnerId: p.id,
          amount: 100,
          currency: "USD",
          direction: "DEBIT",
          userId: 1,
        });

        const entry = service.settle({
          partnerId: p.id,
          amount: 10,
          currency: "USD",
          settlementMethod: method,
          userId: 1,
        });
        expect(entry.settlement_method).toBe(method);
        expect(entry.transaction_type).toBe("SETTLEMENT");
      });
    });
  });

  // ── getPartnerStatement() ──────────────────────────────────────────────────

  describe("getPartnerStatement()", () => {
    it("returns partner, balance, and entries in one call", () => {
      const p = service.createPartner({ name: "StatementTest" });
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
        userId: 1,
      });
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 30,
        currency: "USD",
        direction: "CREDIT",
        userId: 1,
      });

      const stmt = service.getPartnerStatement(p.id);

      expect(stmt.partner.id).toBe(p.id);
      expect(stmt.partner.name).toBe("StatementTest");
      expect(stmt.balance.usd).toBeCloseTo(70, 2);
      expect(stmt.entries).toHaveLength(2);
    });

    it("throws NotFoundError for non-existent partner", () => {
      expect(() => service.getPartnerStatement(999)).toThrow(NotFoundError);
    });

    it("returns empty entries and zero balance for a new partner", () => {
      const p = service.createPartner({ name: "Fresh" });
      const stmt = service.getPartnerStatement(p.id);

      expect(stmt.entries).toHaveLength(0);
      expect(stmt.balance.usd).toBe(0);
      expect(stmt.balance.lbp).toBe(0);
    });
  });

  // ── getAllBalances() ───────────────────────────────────────────────────────

  describe("getAllBalances()", () => {
    it("returns partners joined with their net USD and LBP balances", () => {
      const p1 = service.createPartner({ name: "Samer" });
      const p2 = service.createPartner({ name: "Ahmad" });
      service.recordPartnerTransaction({
        partnerId: p1.id,
        amount: 200,
        currency: "USD",
        direction: "DEBIT",
        userId: 1,
      });
      service.recordPartnerTransaction({
        partnerId: p2.id,
        amount: 100,
        currency: "USD",
        direction: "CREDIT",
        userId: 1,
      });

      const balances = service.getAllBalances();
      const samer = balances.find((b) => b.name === "Samer")!;
      const ahmad = balances.find((b) => b.name === "Ahmad")!;

      expect(samer.usd).toBeCloseTo(200, 2);
      expect(ahmad.usd).toBeCloseTo(-100, 2);
    });

    it("excludes inactive partners by default", () => {
      service.createPartner({ name: "Active" });
      const p2 = service.createPartner({ name: "Inactive" });
      service.deactivatePartner(p2.id);

      expect(service.getAllBalances()).toHaveLength(1);
    });

    it("includes inactive partners when flag is true", () => {
      service.createPartner({ name: "Active" });
      const p2 = service.createPartner({ name: "Inactive" });
      service.deactivatePartner(p2.id);

      expect(service.getAllBalances(true)).toHaveLength(2);
    });
  });

  // ── LIRA-066 — paper Record Tx unified-transaction visibility ──────────────

  describe("recordPartnerTransaction() — LIRA-066 unified transaction visibility", () => {
    function txnRowsFor(entryId: number): Array<{
      type: string;
      amount_usd: number;
      amount_lbp: number;
      summary: string;
      profit_usd: number;
      profit_lbp: number;
      client_id: number | null;
    }> {
      return db
        .prepare(
          `SELECT type, amount_usd, amount_lbp, summary, profit_usd, profit_lbp, client_id
           FROM transactions WHERE source_table = 'partner_ledger' AND source_id = ?`,
        )
        .all(entryId) as Array<{
        type: string;
        amount_usd: number;
        amount_lbp: number;
        summary: string;
        profit_usd: number;
        profit_lbp: number;
        client_id: number | null;
      }>;
    }

    it("a paper (no cash) CREDIT entry posts exactly one PARTNER_ADJUSTMENT transaction row", () => {
      const p = service.createPartner({ name: "PaperCredit" });
      const entry = service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 250,
        currency: "USD",
        direction: "CREDIT",
        userId: 1,
        notes: "owner note",
        // moveCash omitted — the general "Record Tx" paper path.
      });

      const rows = txnRowsFor(entry.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe(TRANSACTION_TYPES.PARTNER_ADJUSTMENT);
      expect(rows[0].summary).toBeTruthy();
      expect(rows[0].summary).toContain("250");
      expect(rows[0].summary).toContain("USD");
      expect(rows[0].summary).toContain("PaperCredit");
      expect(rows[0].amount_usd).toBeCloseTo(250, 2);
      expect(rows[0].amount_lbp).toBe(0);
      expect(rows[0].profit_usd).toBe(0);
      expect(rows[0].profit_lbp).toBe(0);
      expect(rows[0].client_id).toBeNull();

      // No cash moved — no payments row, no drawer delta.
      const payments = db.prepare(`SELECT * FROM payments`).all();
      expect(payments).toHaveLength(0);
      const drawers = db.prepare(`SELECT * FROM drawer_balances`).all();
      expect(drawers).toHaveLength(0);
    });

    it("a paper (no cash) DEBIT entry also posts exactly one PARTNER_ADJUSTMENT row (negative signed value)", () => {
      const p = service.createPartner({ name: "PaperDebit" });
      const entry = service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 100000,
        currency: "LBP",
        direction: "DEBIT",
        userId: 1,
      });

      const rows = txnRowsFor(entry.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe(TRANSACTION_TYPES.PARTNER_ADJUSTMENT);
      expect(rows[0].amount_lbp).toBeCloseTo(-100000, 2);
      expect(rows[0].amount_usd).toBe(0);

      const payments = db.prepare(`SELECT * FROM payments`).all();
      expect(payments).toHaveLength(0);
    });

    it("moveCash=true still posts exactly ONE transactions row (no double-posting)", () => {
      const p = service.createPartner({ name: "CashMovedOnce" });
      const entry = service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 60,
        currency: "USD",
        direction: "DEBIT",
        userId: 1,
        moveCash: true,
      });

      const rows = txnRowsFor(entry.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe(TRANSACTION_TYPES.PARTNER_PAYMENT);

      // Cash-moved path still writes its real payments/drawer effect.
      const payments = db.prepare(`SELECT * FROM payments`).all();
      expect(payments).toHaveLength(1);
    });
  });

  // ── LIRA-066 residual — settle() CLIENT_ACCOUNT unified-transaction
  //    visibility ───────────────────────────────────────────────────────────
  //
  // Verified fact (2026-07-20): settle()'s CLIENT_ACCOUNT method has NO
  // client_id anywhere in the flow (partnerSettleSchema carries no such
  // field) — it is a "no cash moved" flag, structurally identical to
  // recordPartnerTransaction's moveCash=false paper path, NOT a charge
  // against any specific client's debt_ledger. Previously
  // PartnerService.settle() skipped recordSettlementMoneyMovement entirely
  // for this method, so the settlement wrote a partner_ledger row with NO
  // unified `transactions` row at all — invisible on the Transactions page.

  describe("settle() — CLIENT_ACCOUNT unified-transaction visibility (LIRA-066 residual)", () => {
    function txnRowsFor(entryId: number): Array<{
      type: string;
      amount_usd: number;
      amount_lbp: number;
      summary: string;
      profit_usd: number;
      profit_lbp: number;
      metadata_json: string;
    }> {
      return db
        .prepare(
          `SELECT type, amount_usd, amount_lbp, summary, profit_usd, profit_lbp, metadata_json
           FROM transactions WHERE source_table = 'partner_ledger' AND source_id = ?`,
        )
        .all(entryId) as Array<{
        type: string;
        amount_usd: number;
        amount_lbp: number;
        summary: string;
        profit_usd: number;
        profit_lbp: number;
        metadata_json: string;
      }>;
    }

    it("a CLIENT_ACCOUNT settlement posts exactly ONE PARTNER_SETTLEMENT transaction row, no cash moved", () => {
      const p = service.createPartner({ name: "ClientAcctSettle" });
      // Partner owes us $100 (DEBIT from partner's perspective via the
      // manual entry helper) so the settlement direction resolves to CREDIT.
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
        userId: 1,
      });

      const entry = service.settle({
        partnerId: p.id,
        amount: 40,
        currency: "USD",
        settlementMethod: "CLIENT_ACCOUNT",
        userId: 1,
      });

      const rows = txnRowsFor(entry.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe(TRANSACTION_TYPES.PARTNER_SETTLEMENT);
      expect(rows[0].summary).toContain("ClientAcctSettle");
      expect(rows[0].summary).toContain("40");
      expect(rows[0].summary).toContain("USD");
      expect(rows[0].summary.toLowerCase()).toContain(
        "paper settlement, no cash moved",
      );
      expect(rows[0].profit_usd).toBe(0);
      expect(rows[0].profit_lbp).toBe(0);

      const meta = JSON.parse(rows[0].metadata_json) as {
        counterparty?: { method?: string; flow?: string };
      };
      expect(meta.counterparty?.method).toBe("CLIENT_ACCOUNT");

      // No cash moved — no payments row, no drawer delta (ledger effect —
      // the partner_ledger row + its FIFO coverage — is unchanged; this is
      // a visibility-only fix).
      const payments = db.prepare(`SELECT * FROM payments`).all();
      expect(payments).toHaveLength(0);
      const drawers = db.prepare(`SELECT * FROM drawer_balances`).all();
      expect(drawers).toHaveLength(0);
    });

    it("a cash-method (CASH) settlement still posts exactly ONE transaction row (no regression)", () => {
      const p = service.createPartner({ name: "CashSettleOnce" });
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
        userId: 1,
      });

      const entry = service.settle({
        partnerId: p.id,
        amount: 40,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      });

      const rows = txnRowsFor(entry.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe(TRANSACTION_TYPES.PARTNER_SETTLEMENT);

      // Cash settlement still writes its real payments/drawer effect.
      const payments = db.prepare(`SELECT * FROM payments`).all();
      expect(payments).toHaveLength(1);
    });
  });

  // ── Integration — transaction → ledger → balance ───────────────────────────

  describe("Integration — transaction flow", () => {
    it("multiple transactions accumulate into correct net balance", () => {
      const p = service.createPartner({ name: "NetFlow" });
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 300,
        currency: "USD",
        direction: "DEBIT",
        userId: 1,
      });
      service.recordPartnerTransaction({
        partnerId: p.id,
        amount: 100,
        currency: "USD",
        direction: "CREDIT",
        userId: 1,
      });
      service.settle({
        partnerId: p.id,
        amount: 50,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      });

      // 300 (DEBIT) - 100 (CREDIT) - 50 (CREDIT settlement) = 150
      expect(service.getPartnerBalance(p.id).usd).toBeCloseTo(150, 2);

      const stmt = service.getPartnerStatement(p.id);
      expect(stmt.entries).toHaveLength(3);
    });

    it("two partners have completely independent ledgers", () => {
      const p1 = service.createPartner({ name: "PartnerOne" });
      const p2 = service.createPartner({ name: "PartnerTwo" });

      service.recordPartnerTransaction({
        partnerId: p1.id,
        amount: 500,
        currency: "USD",
        direction: "DEBIT",
        userId: 1,
      });
      service.recordPartnerTransaction({
        partnerId: p2.id,
        amount: 200,
        currency: "USD",
        direction: "CREDIT",
        userId: 1,
      });

      expect(service.getPartnerBalance(p1.id).usd).toBeCloseTo(500, 2);
      expect(service.getPartnerBalance(p2.id).usd).toBeCloseTo(-200, 2);

      expect(service.getPartnerStatement(p1.id).entries).toHaveLength(1);
      expect(service.getPartnerStatement(p2.id).entries).toHaveLength(1);
    });
  });
});
