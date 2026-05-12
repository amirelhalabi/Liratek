import Database from "better-sqlite3";
import { DebtRepository } from "../../repositories/DebtRepository.js";
import { DebtService } from "../DebtService.js";

describe("DebtService — Customer Credit System", () => {
  let db: Database.Database;
  let service: DebtService;
  const CLIENT_ID = 1;
  const USER_ID = 1;

  beforeEach(() => {
    db = new Database(":memory:");

    // Minimal schema for debt_ledger + clients + exchange_rates
    db.exec(`
      CREATE TABLE clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE debt_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        amount_usd DECIMAL(10,2) DEFAULT 0,
        amount_lbp DECIMAL(15,2) DEFAULT 0,
        transaction_id INTEGER,
        due_date TEXT,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        edited_by TEXT,
        edited_at TEXT,
        is_refunded INTEGER DEFAULT 0,
        refunded_at TEXT,
        FOREIGN KEY (client_id) REFERENCES clients(id)
      );

      CREATE TABLE exchange_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        to_code TEXT NOT NULL UNIQUE,
        market_rate REAL NOT NULL,
        buy_rate REAL NOT NULL,
        sell_rate REAL NOT NULL,
        is_stronger INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT
      );

      INSERT INTO clients (full_name, phone_number) VALUES ('Test Client', '71123456');
      INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
        VALUES ('LBP', 89500, 89000, 90000, 1);
    `);

    // Inject test DB
    (globalThis as any).__LIRATEK_TEST_DB__ = db;

    // Reset singletons so they pick up the test DB
    const repo = new DebtRepository();
    service = new DebtService(repo);
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    db.close();
  });

  describe("addCredit", () => {
    it("should add credit (negative entry) for a client", () => {
      const result = service.addCredit({
        clientId: CLIENT_ID,
        amountUsd: 25,
        amountLbp: 0,
        userId: USER_ID,
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();

      // Verify the entry is stored as negative
      const entry = db
        .prepare("SELECT * FROM debt_ledger WHERE id = ?")
        .get(result.id) as any;
      expect(entry.transaction_type).toBe("CREDIT_DEPOSIT");
      expect(entry.amount_usd).toBe(-25);
    });

    it("should reject if no amount provided", () => {
      const result = service.addCredit({
        clientId: CLIENT_ID,
        amountUsd: 0,
        amountLbp: 0,
        userId: USER_ID,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("greater than 0");
    });

    it("should reject if no clientId", () => {
      const result = service.addCredit({
        clientId: 0,
        amountUsd: 10,
        amountLbp: 0,
        userId: USER_ID,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Client ID");
    });
  });

  describe("useCredit", () => {
    it("should fail if client has no credit", () => {
      const result = service.useCredit({
        clientId: CLIENT_ID,
        amountUsd: 10,
        amountLbp: 0,
        userId: USER_ID,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient");
    });

    it("should succeed when credit is available", () => {
      // Add $50 credit first
      service.addCredit({
        clientId: CLIENT_ID,
        amountUsd: 50,
        amountLbp: 0,
        userId: USER_ID,
      });

      // Use $30
      const result = service.useCredit({
        clientId: CLIENT_ID,
        amountUsd: 30,
        amountLbp: 0,
        userId: USER_ID,
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();

      // Verify stored as positive
      const entry = db
        .prepare("SELECT * FROM debt_ledger WHERE id = ?")
        .get(result.id) as any;
      expect(entry.transaction_type).toBe("CREDIT_USED");
      expect(entry.amount_usd).toBe(30);
    });

    it("should fail if trying to use more credit than available", () => {
      service.addCredit({
        clientId: CLIENT_ID,
        amountUsd: 20,
        amountLbp: 0,
        userId: USER_ID,
      });

      const result = service.useCredit({
        clientId: CLIENT_ID,
        amountUsd: 50,
        amountLbp: 0,
        userId: USER_ID,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient USD credit");
      expect(result.error).toContain("$20.00");
    });

    it("should handle LBP credit correctly", () => {
      service.addCredit({
        clientId: CLIENT_ID,
        amountUsd: 0,
        amountLbp: 5000000,
        userId: USER_ID,
      });

      const result = service.useCredit({
        clientId: CLIENT_ID,
        amountUsd: 0,
        amountLbp: 3000000,
        userId: USER_ID,
      });

      expect(result.success).toBe(true);

      const balance = service.getClientBalance(CLIENT_ID);
      expect(balance.balance_lbp).toBe(-2000000);
    });
  });

  describe("getClientBalance", () => {
    it("should return zero for client with no entries", () => {
      const balance = service.getClientBalance(CLIENT_ID);
      expect(balance.balance_usd).toBe(0);
      expect(balance.balance_lbp).toBe(0);
    });

    it("should return positive balance when client owes shop", () => {
      // Simulate a debt entry (positive = owes shop)
      db.prepare(
        "INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by) VALUES (?, 'Sale Debt', 100, 0, ?)",
      ).run(CLIENT_ID, USER_ID);

      const balance = service.getClientBalance(CLIENT_ID);
      expect(balance.balance_usd).toBe(100);
    });

    it("should show net balance (debt + credit)", () => {
      // Add $80 debt
      db.prepare(
        "INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by) VALUES (?, 'Sale Debt', 80, 0, ?)",
      ).run(CLIENT_ID, USER_ID);

      // Add $30 credit
      service.addCredit({
        clientId: CLIENT_ID,
        amountUsd: 30,
        amountLbp: 0,
        userId: USER_ID,
      });

      // Net = 80 - 30 = 50 (still owes shop)
      const balance = service.getClientBalance(CLIENT_ID);
      expect(balance.balance_usd).toBe(50);
    });

    it("should show negative balance when shop owes customer", () => {
      service.addCredit({
        clientId: CLIENT_ID,
        amountUsd: 75,
        amountLbp: 0,
        userId: USER_ID,
      });

      const balance = service.getClientBalance(CLIENT_ID);
      expect(balance.balance_usd).toBe(-75);
    });
  });

  describe("net balance scenario: debt fully offset by credit", () => {
    it("$50 debt + $50 credit = zero balance", () => {
      db.prepare(
        "INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, created_by) VALUES (?, 'Sale Debt', 50, 0, ?)",
      ).run(CLIENT_ID, USER_ID);

      service.addCredit({
        clientId: CLIENT_ID,
        amountUsd: 50,
        amountLbp: 0,
        userId: USER_ID,
      });

      const balance = service.getClientBalance(CLIENT_ID);
      expect(balance.balance_usd).toBe(0);
    });
  });
});
