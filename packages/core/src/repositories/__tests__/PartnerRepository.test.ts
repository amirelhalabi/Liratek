import Database from "better-sqlite3";
import { PartnerRepository } from "../PartnerRepository";

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
  `);
  return db;
}

describe("PartnerRepository", () => {
  let db: Database.Database;
  let repo: PartnerRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    repo = new PartnerRepository();
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    db.close();
  });

  // ── CRUD ───────────────────────────────────────────────────────────────────

  describe("create()", () => {
    it("creates and returns a partner with all fields", () => {
      const partner = repo.create({
        name: "Samer",
        phone: "01234567",
        notes: "Regular partner",
      });
      expect(partner.id).toBeGreaterThan(0);
      expect(partner.name).toBe("Samer");
      expect(partner.phone).toBe("01234567");
      expect(partner.notes).toBe("Regular partner");
      expect(partner.is_active).toBe(1);
    });

    it("trims whitespace from name", () => {
      const partner = repo.create({ name: "  Ahmad  " });
      expect(partner.name).toBe("Ahmad");
    });

    it("stores null for omitted optional fields", () => {
      const partner = repo.create({ name: "Minimal" });
      expect(partner.phone).toBeNull();
      expect(partner.notes).toBeNull();
    });
  });

  describe("getById()", () => {
    it("returns null for non-existent id", () => {
      expect(repo.getById(999)).toBeNull();
    });

    it("returns the correct partner", () => {
      const created = repo.create({ name: "Findable" });
      const found = repo.getById(created.id);
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe("Findable");
    });
  });

  describe("getAll()", () => {
    it("returns only active partners by default", () => {
      repo.create({ name: "Active" });
      const p2 = repo.create({ name: "Inactive" });
      repo.deactivate(p2.id);

      const result = repo.getAll();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Active");
    });

    it("includes inactive partners when flag is true", () => {
      repo.create({ name: "Active" });
      const p2 = repo.create({ name: "Inactive" });
      repo.deactivate(p2.id);

      expect(repo.getAll(true)).toHaveLength(2);
    });

    it("returns partners sorted by name ascending", () => {
      repo.create({ name: "Zara" });
      repo.create({ name: "Ahmad" });
      repo.create({ name: "Mona" });

      const names = repo.getAll().map((p) => p.name);
      expect(names).toEqual(["Ahmad", "Mona", "Zara"]);
    });
  });

  describe("update()", () => {
    it("updates only the specified fields", () => {
      const p = repo.create({ name: "Original", phone: "111" });
      const updated = repo.update(p.id, { phone: "999" });
      expect(updated.name).toBe("Original");
      expect(updated.phone).toBe("999");
    });

    it("returns existing partner unchanged when no fields provided", () => {
      const p = repo.create({ name: "NoChange" });
      const result = repo.update(p.id, {});
      expect(result.name).toBe("NoChange");
    });

    it("throws when partner does not exist", () => {
      expect(() => repo.update(999, { name: "Ghost" })).toThrow();
    });
  });

  describe("deactivate() / activate()", () => {
    it("deactivate sets is_active to 0", () => {
      const p = repo.create({ name: "ToDeactivate" });
      repo.deactivate(p.id);
      expect(repo.getById(p.id)?.is_active).toBe(0);
    });

    it("activate restores is_active to 1", () => {
      const p = repo.create({ name: "ToActivate" });
      repo.deactivate(p.id);
      repo.activate(p.id);
      expect(repo.getById(p.id)?.is_active).toBe(1);
    });

    it("deactivated partner does not appear in getAll() active list", () => {
      const p = repo.create({ name: "Hidden" });
      repo.deactivate(p.id);
      expect(repo.getAll()).toHaveLength(0);
    });
  });

  // ── Ledger ─────────────────────────────────────────────────────────────────

  describe("addLedgerEntry()", () => {
    it("inserts and returns the entry with all fields", () => {
      const p = repo.create({ name: "LedgerPartner" });
      const entry = repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "SETTLEMENT",
        reference_table: "financial_services",
        reference_id: 42,
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
        notes: "Test entry",
        user_id: 1,
        settlement_method: "CASH",
      });
      expect(entry.id).toBeGreaterThan(0);
      expect(entry.partner_id).toBe(p.id);
      expect(entry.amount).toBe(100);
      expect(entry.direction).toBe("DEBIT");
      expect(entry.transaction_type).toBe("SETTLEMENT");
      expect(entry.reference_table).toBe("financial_services");
      expect(entry.reference_id).toBe(42);
      expect(entry.settlement_method).toBe("CASH");
      expect(entry.notes).toBe("Test entry");
    });

    it("stores null for omitted optional fields", () => {
      const p = repo.create({ name: "MinimalLedger" });
      const entry = repo.addLedgerEntry({
        partner_id: p.id,
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
      });
      expect(entry.transaction_type).toBeNull();
      expect(entry.notes).toBeNull();
      expect(entry.user_id).toBeNull();
      expect(entry.settlement_method).toBeNull();
    });
  });

  // CQ-2 — the shared FIFO allocator (utils/fifoCoverage.ts) is used here via
  // applySettlementCoverage. This is a genuine multi-row spillover: a single
  // SETTLEMENT budget must fully cover the OLDEST FOR_% row before touching
  // the next one, never overshoot a row's own outstanding, and stop the
  // instant the budget is spent (not spill unrelated cash into a third row).
  describe("addLedgerEntry() — SETTLEMENT FIFO coverage (CQ-2 multi-row proof)", () => {
    it("fully covers the oldest FOR_% row before partially covering the next", () => {
      const p = repo.create({ name: "FifoCoveragePartner" });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "FOR_POS",
        amount: 60,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "FOR_RECHARGE",
        amount: 40,
        currency: "USD",
        direction: "DEBIT",
      });
      // Untouched control row: same partner, currency, opposite-of-CREDIT
      // direction, but NOT a FOR_% type — must never receive coverage.
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "WHISH_TOPUP",
        amount: 999,
        currency: "USD",
        direction: "DEBIT",
      });

      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "SETTLEMENT",
        amount: 70,
        currency: "USD",
        direction: "CREDIT",
      });

      const covered = (transactionType: string) =>
        (
          db
            .prepare(
              `SELECT amount, covered_amount FROM partner_ledger WHERE partner_id = ? AND transaction_type = ?`,
            )
            .get(p.id, transactionType) as {
            amount: number;
            covered_amount: number;
          }
        ).covered_amount;

      expect(covered("FOR_POS")).toBeCloseTo(60, 2); // fully covered, oldest first
      expect(covered("FOR_RECHARGE")).toBeCloseTo(10, 2); // 70 - 60 = 10 left, partial
      expect(covered("WHISH_TOPUP")).toBeCloseTo(0, 2); // not a FOR_% row — untouched
    });
  });

  describe("getLedgerEntries()", () => {
    it("returns all entries for a partner", () => {
      const p = repo.create({ name: "MultiEntry" });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 50,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 20,
        currency: "USD",
        direction: "CREDIT",
      });
      expect(repo.getLedgerEntries(p.id)).toHaveLength(2);
    });

    it("returns empty array for partner with no entries", () => {
      const p = repo.create({ name: "Empty" });
      expect(repo.getLedgerEntries(p.id)).toHaveLength(0);
    });

    it("does not include entries from other partners", () => {
      const p1 = repo.create({ name: "P1" });
      const p2 = repo.create({ name: "P2" });
      repo.addLedgerEntry({
        partner_id: p1.id,
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      expect(repo.getLedgerEntries(p2.id)).toHaveLength(0);
    });

    it("filters by transaction_type", () => {
      const p = repo.create({ name: "TypeFilter" });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "SETTLEMENT",
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "ADJUSTMENT",
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
      });

      const settlements = repo.getLedgerEntries(p.id, { type: "SETTLEMENT" });
      expect(settlements).toHaveLength(1);
      expect(settlements[0].transaction_type).toBe("SETTLEMENT");
    });
  });

  describe("getBalance()", () => {
    it("returns zero balance for partner with no entries", () => {
      const p = repo.create({ name: "Zero" });
      const bal = repo.getBalance(p.id);
      expect(bal.usd).toBe(0);
      expect(bal.lbp).toBe(0);
      expect(bal.usdt).toBe(0);
    });

    it("calculates USD as DEBIT minus CREDIT", () => {
      const p = repo.create({ name: "Balance" });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 200,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
      });
      expect(repo.getBalance(p.id).usd).toBeCloseTo(150, 2);
    });

    it("tracks USD and LBP independently", () => {
      const p = repo.create({ name: "MultiCurrency" });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 500000,
        currency: "LBP",
        direction: "CREDIT",
      });
      const bal = repo.getBalance(p.id);
      expect(bal.usd).toBeCloseTo(100, 2);
      expect(bal.lbp).toBeCloseTo(-500000, 2);
    });

    it("returns negative balance when shop owes partner", () => {
      const p = repo.create({ name: "WeOwe" });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 300,
        currency: "USD",
        direction: "CREDIT",
      });
      expect(repo.getBalance(p.id).usd).toBeCloseTo(-300, 2);
    });

    it("calculates USDT as DEBIT minus CREDIT", () => {
      const p = repo.create({ name: "USDTBalance" });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 500,
        currency: "USDT",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 120,
        currency: "USDT",
        direction: "CREDIT",
      });
      expect(repo.getBalance(p.id).usdt).toBeCloseTo(380, 2);
    });

    it("tracks USDT independently from USD and LBP", () => {
      const p = repo.create({ name: "TriCurrency" });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 500000,
        currency: "LBP",
        direction: "CREDIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 50,
        currency: "USDT",
        direction: "DEBIT",
      });
      const bal = repo.getBalance(p.id);
      expect(bal.usd).toBeCloseTo(100, 2);
      expect(bal.lbp).toBeCloseTo(-500000, 2);
      expect(bal.usdt).toBeCloseTo(50, 2);
    });
  });

  describe("getAllBalances()", () => {
    it("returns active partners with their computed balances", () => {
      const p1 = repo.create({ name: "AAA" });
      const p2 = repo.create({ name: "BBB" });
      repo.addLedgerEntry({
        partner_id: p1.id,
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p2.id,
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
      });

      const results = repo.getAllBalances();
      const a = results.find((r) => r.name === "AAA")!;
      const b = results.find((r) => r.name === "BBB")!;
      expect(a.usd).toBeCloseTo(100, 2);
      expect(b.usd).toBeCloseTo(-50, 2);
    });

    it("returns zero balance for partner with no ledger entries", () => {
      repo.create({ name: "Fresh" });
      const results = repo.getAllBalances();
      expect(results[0].usd).toBe(0);
      expect(results[0].lbp).toBe(0);
    });

    it("excludes inactive partners by default", () => {
      repo.create({ name: "Active" });
      const p2 = repo.create({ name: "Inactive" });
      repo.deactivate(p2.id);
      expect(repo.getAllBalances()).toHaveLength(1);
    });

    it("includes inactive partners when flag is true", () => {
      repo.create({ name: "Active" });
      const p2 = repo.create({ name: "Inactive" });
      repo.deactivate(p2.id);
      expect(repo.getAllBalances(true)).toHaveLength(2);
    });

    it("includes computed usdt balances (not just usd/lbp)", () => {
      const p1 = repo.create({ name: "USDTGroup" });
      repo.addLedgerEntry({
        partner_id: p1.id,
        amount: 75,
        currency: "USDT",
        direction: "DEBIT",
      });
      const results = repo.getAllBalances();
      const a = results.find((r) => r.name === "USDTGroup")!;
      expect(a.usdt).toBeCloseTo(75, 2);
    });
  });

  // ── Integration — ledger flow ──────────────────────────────────────────────

  describe("Integration — ledger flow", () => {
    it("multiple entries accumulate correctly in balance", () => {
      const p = repo.create({ name: "FlowTest" });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 60,
        currency: "USD",
        direction: "CREDIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 20,
        currency: "USD",
        direction: "DEBIT",
      });

      expect(repo.getBalance(p.id).usd).toBeCloseTo(60, 2); // 100 + 20 - 60
      expect(repo.getLedgerEntries(p.id)).toHaveLength(3);
    });

    it("two partners maintain independent balances", () => {
      const p1 = repo.create({ name: "Samer" });
      const p2 = repo.create({ name: "Ahmad" });
      repo.addLedgerEntry({
        partner_id: p1.id,
        amount: 200,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p2.id,
        amount: 150,
        currency: "USD",
        direction: "CREDIT",
      });

      expect(repo.getBalance(p1.id).usd).toBeCloseTo(200, 2);
      expect(repo.getBalance(p2.id).usd).toBeCloseTo(-150, 2);
    });
  });

  // ── Enriched ledger JOIN ───────────────────────────────────────────────────

  describe("getLedgerEntries() — enriched JOIN", () => {
    it("returns null fs_* fields when entry has no financial_services reference", () => {
      const p = repo.create({ name: "JoinTest" });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "SETTLEMENT",
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
      });
      const entries = repo.getLedgerEntries(p.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].fs_provider).toBeNull();
      expect(entries[0].fs_customer).toBeNull();
    });

    it("returns enriched fs_* fields when linked to financial_services row", () => {
      const p = repo.create({ name: "Enriched" });
      // Insert a stub financial_services row directly
      const fsId = (db as any)
        .prepare(
          `INSERT INTO financial_services (provider, service_type, amount, currency, omt_fee, sender_name, reference_number, phone_number)
           VALUES ('OMT', 'SEND', 100, 'USD', 2.5, 'Ali Hassan', 'REF123', '70123456')`,
        )
        .run().lastInsertRowid as number;

      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "FOR_OMT_SEND",
        reference_table: "financial_services",
        reference_id: fsId,
        amount: 102.5,
        currency: "USD",
        direction: "DEBIT",
      });
      const entries = repo.getLedgerEntries(p.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].fs_provider).toBe("OMT");
      expect(entries[0].fs_service_type).toBe("SEND");
      expect(entries[0].fs_amount).toBe(100);
      expect(entries[0].fs_fee).toBeCloseTo(2.5, 2);
      expect(entries[0].fs_customer).toBe("Ali Hassan");
      expect(entries[0].fs_reference_number).toBe("REF123");
      expect(entries[0].fs_phone_number).toBe("70123456");
    });
  });

  // ── getLedgerEntries() filters ─────────────────────────────────────────────

  describe("getLedgerEntries() — filters", () => {
    it("filters by FOR mode", () => {
      const p = repo.create({ name: "ModeFilter" });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "FOR_OMT_SEND",
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "THROUGH_WHISH_RECEIVE",
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "SETTLEMENT",
        amount: 30,
        currency: "USD",
        direction: "CREDIT",
      });

      const forEntries = repo.getLedgerEntries(p.id, { mode: "FOR" });
      expect(forEntries).toHaveLength(1);
      expect(forEntries[0].transaction_type).toBe("FOR_OMT_SEND");
    });

    it("filters by THROUGH mode", () => {
      const p = repo.create({ name: "ThroughFilter" });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "FOR_OMT_SEND",
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "THROUGH_WHISH_RECEIVE",
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
      });

      const throughEntries = repo.getLedgerEntries(p.id, { mode: "THROUGH" });
      expect(throughEntries).toHaveLength(1);
      expect(throughEntries[0].transaction_type).toBe("THROUGH_WHISH_RECEIVE");
    });

    it("filters by direction DEBIT", () => {
      const p = repo.create({ name: "DirFilter" });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
      });

      const debits = repo.getLedgerEntries(p.id, { direction: "DEBIT" });
      expect(debits).toHaveLength(1);
      expect(debits[0].direction).toBe("DEBIT");
    });

    it("combines mode + direction filters", () => {
      const p = repo.create({ name: "ComboFilter" });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "FOR_OMT_SEND",
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "FOR_OMT_RECEIVE",
        amount: 80,
        currency: "USD",
        direction: "CREDIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "THROUGH_WHISH_SEND",
        amount: 60,
        currency: "USD",
        direction: "DEBIT",
      });

      const result = repo.getLedgerEntries(p.id, {
        mode: "FOR",
        direction: "DEBIT",
      });
      expect(result).toHaveLength(1);
      expect(result[0].transaction_type).toBe("FOR_OMT_SEND");
    });
  });

  // ── getBalanceBreakdown() ──────────────────────────────────────────────────

  describe("getBalanceBreakdown()", () => {
    it("returns zeros for a new partner", () => {
      const p = repo.create({ name: "BreakdownEmpty" });
      const bd = repo.getBalanceBreakdown(p.id);
      expect(bd.usd.for).toBe(0);
      expect(bd.usd.through).toBe(0);
      expect(bd.usd.other).toBe(0);
      expect(bd.usd.total).toBe(0);
    });

    it("correctly buckets FOR, THROUGH, and other entries", () => {
      const p = repo.create({ name: "BreakdownFull" });
      // FOR: net +$100 (100 DEBIT, 0 CREDIT)
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "FOR_OMT_SEND",
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });
      // THROUGH: net -$50 (0 DEBIT, 50 CREDIT)
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "THROUGH_WHISH_RECEIVE",
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
      });
      // Settlement (other): net -$30 (0 DEBIT, 30 CREDIT)
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "SETTLEMENT",
        amount: 30,
        currency: "USD",
        direction: "CREDIT",
      });

      const bd = repo.getBalanceBreakdown(p.id);
      expect(bd.usd.for).toBeCloseTo(100, 2);
      expect(bd.usd.through).toBeCloseTo(-50, 2);
      expect(bd.usd.other).toBeCloseTo(-30, 2);
      expect(bd.usd.total).toBeCloseTo(20, 2);
    });

    it("tracks LBP separately from USD", () => {
      const p = repo.create({ name: "BreakdownLBP" });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "FOR_OMT_SEND",
        amount: 5_000_000,
        currency: "LBP",
        direction: "DEBIT",
      });
      repo.addLedgerEntry({
        partner_id: p.id,
        transaction_type: "FOR_OMT_SEND",
        amount: 100,
        currency: "USD",
        direction: "DEBIT",
      });

      const bd = repo.getBalanceBreakdown(p.id);
      expect(bd.lbp.for).toBeCloseTo(5_000_000, 0);
      expect(bd.usd.for).toBeCloseTo(100, 2);
      expect(bd.lbp.through).toBe(0);
    });
  });
});
