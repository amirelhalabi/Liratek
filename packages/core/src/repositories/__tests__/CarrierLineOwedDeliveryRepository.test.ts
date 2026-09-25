/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * #28 (LIRA-218, v184) — CarrierLineOwedDeliveryRepository, the "days still
 * to send" list. Pure checklist bookkeeping: `markSent` only flips status
 * and stamps sent_at/sent_by — never a second sale, never a second charge,
 * never touches `carrier_lines.days_owed` (proven by the last test below).
 */

import Database from "better-sqlite3";
import {
  CarrierLineOwedDeliveryRepository,
  resetCarrierLineOwedDeliveryRepository,
} from "../CarrierLineOwedDeliveryRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE carrier_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      carrier TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      days_owed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE carrier_line_owed_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      carrier_line_id INTEGER NOT NULL,
      transaction_id INTEGER,
      client_id INTEGER,
      client_name TEXT,
      days_owed INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT')),
      sent_at DATETIME,
      sent_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- M5 fix: getAllPending() now LEFT JOINs this table to exclude a
    -- delivery whose source transaction was voided/refunded.
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      type TEXT NOT NULL DEFAULT 'RECHARGE',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      reverses_id INTEGER
    );
    INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number, days_owed)
      VALUES (1, 1, 'mtc', '71000000', 210);
  `);
  return db;
}

describe("CarrierLineOwedDeliveryRepository (#28, LIRA-218)", () => {
  let db: Database.Database;
  let repo: CarrierLineOwedDeliveryRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetCarrierLineOwedDeliveryRepository();
    repo = new CarrierLineOwedDeliveryRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetCarrierLineOwedDeliveryRepository();
    resetTenantContext();
  });

  it("create() writes a PENDING row carrying the sold-ahead amount and the client", () => {
    const created = repo.create({
      carrier_line_id: 1,
      transaction_id: 99,
      client_id: 5,
      client_name: "Jean",
      days_owed: 210,
    });
    expect(created.status).toBe("PENDING");
    expect(created.days_owed).toBe(210);
    expect(created.client_id).toBe(5);
    expect(created.transaction_id).toBe(99);
    expect(created.sent_at).toBeNull();
  });

  it("getAllPending() returns only PENDING rows, oldest first", () => {
    const a = repo.create({
      carrier_line_id: 1,
      transaction_id: 1,
      days_owed: 10,
    });
    const b = repo.create({
      carrier_line_id: 1,
      transaction_id: 2,
      days_owed: 20,
    });
    repo.markSent(a.id, 1);

    const pending = repo.getAllPending();
    expect(pending.map((d) => d.id)).toEqual([b.id]);
  });

  it("markSent() flips status and stamps sent_at/sent_by, exactly once", () => {
    const created = repo.create({
      carrier_line_id: 1,
      transaction_id: 1,
      days_owed: 15,
    });

    const sent = repo.markSent(created.id, 7);
    expect(sent!.status).toBe("SENT");
    expect(sent!.sent_by).toBe(7);
    expect(sent!.sent_at).not.toBeNull();
  });

  it("markSent() is idempotent — a second call on an already-SENT row is a no-op, not an error", () => {
    const created = repo.create({
      carrier_line_id: 1,
      transaction_id: 1,
      days_owed: 15,
    });
    const first = repo.markSent(created.id, 7)!;
    const second = repo.markSent(created.id, 8)!;
    // sent_by/sent_at are NOT overwritten by the second call.
    expect(second.sent_by).toBe(first.sent_by);
    expect(second.sent_at).toBe(first.sent_at);
  });

  it("markSent() returns null for an unknown id rather than throwing", () => {
    expect(repo.markSent(999999, 1)).toBeNull();
  });

  // M5 fix (2026-09-24 adversarial review): getAllPending() previously had
  // no join at all against `transactions`, despite the module doc claiming
  // one — a refunded/voided sale's delivery stayed on the "days still to
  // send" list with a live "Mark sent" button. Per CLAUDE.md rule 17 these
  // are expected to FAIL against the pre-fix query.

  it("M5: getAllPending() excludes a delivery whose source transaction was VOIDED", () => {
    db.prepare(
      `INSERT INTO transactions (id, tenant_id, type, status) VALUES (1, 1, 'RECHARGE', 'VOIDED')`,
    ).run();
    const delivery = repo.create({
      carrier_line_id: 1,
      transaction_id: 1,
      days_owed: 30,
    });

    expect(repo.getAllPending().map((d) => d.id)).not.toContain(delivery.id);
  });

  it("M5: getAllPending() excludes a delivery whose source transaction was REFUNDED", () => {
    db.prepare(
      `INSERT INTO transactions (id, tenant_id, type, status) VALUES (1, 1, 'RECHARGE', 'ACTIVE')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (id, tenant_id, type, status, reverses_id) VALUES (2, 1, 'REFUND', 'ACTIVE', 1)`,
    ).run();
    const delivery = repo.create({
      carrier_line_id: 1,
      transaction_id: 1,
      days_owed: 30,
    });

    expect(repo.getAllPending().map((d) => d.id)).not.toContain(delivery.id);
  });

  it("M5: getAllPending() still returns a PENDING delivery whose source transaction is ACTIVE (not reversed)", () => {
    db.prepare(
      `INSERT INTO transactions (id, tenant_id, type, status) VALUES (1, 1, 'RECHARGE', 'ACTIVE')`,
    ).run();
    const delivery = repo.create({
      carrier_line_id: 1,
      transaction_id: 1,
      days_owed: 30,
    });

    expect(repo.getAllPending().map((d) => d.id)).toContain(delivery.id);
  });

  it("M5 companion: getByCarrierLineId() still shows a refunded delivery — it is a HISTORY view, not the action list", () => {
    db.prepare(
      `INSERT INTO transactions (id, tenant_id, type, status) VALUES (1, 1, 'RECHARGE', 'VOIDED')`,
    ).run();
    const delivery = repo.create({
      carrier_line_id: 1,
      transaction_id: 1,
      days_owed: 30,
    });

    expect(
      repo.getByCarrierLineId(1).map((d) => d.id),
    ).toContain(delivery.id);
  });

  it("markSent() never touches carrier_lines.days_owed — that balance is settled independently by the next charge", () => {
    const created = repo.create({
      carrier_line_id: 1,
      transaction_id: 1,
      days_owed: 210,
    });
    repo.markSent(created.id, 1);

    const line = db
      .prepare(`SELECT days_owed FROM carrier_lines WHERE id = 1`)
      .get() as { days_owed: number };
    expect(line.days_owed).toBe(210); // unchanged by markSent
  });
});
