/**
 * LIRA-289 T040 — "sales since the last count", per drawer (spec FR-010,
 * data-model "New query").
 *
 * For each drawer: the ACTIVE transactions with a payment leg on that drawer
 * created after the drawer's latest count, excluding the count itself
 * (CHECKPOINT rows and CHECKPOINT_ADJUSTMENT legs) and system-written is_auto
 * siblings (rule 26). Malformed metadata reads as NOT auto. Timestamps are
 * compared through julianday(), because the database stores both ISO `…Z` and
 * `YYYY-MM-DD HH:MM:SS`. A drawer never counted has no lower bound.
 *
 * Real schema (create_db.sql). Written before the query existed.
 */
import type Database from "better-sqlite3";
import { installWarrantyTestDb, uninstallWarrantyTestDb } from "../testHelpers/warrantyDb";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";
import { getClosingService, resetClosingService } from "../../services/ClosingService";
import { resetClosingRepository } from "../ClosingRepository";

let db: Database.Database;
let nextId = 5000;

function txn(opts: { type?: string; at: string; status?: string; metadata?: string | null; clientId?: number | null }) {
  const id = nextId++;
  db.prepare(
    `INSERT INTO transactions (id, tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, summary, metadata_json, client_id, created_at)
     VALUES (?, 1, ?, ?, 'financial_services', ?, 1, 50, 0, ?, ?, ?, ?)`,
  ).run(id, opts.type ?? "FINANCIAL_SERVICE", opts.status ?? "ACTIVE", id, `txn ${id}`, opts.metadata ?? null, opts.clientId ?? null, opts.at);
  return id;
}

function leg(transactionId: number, drawer: string, amount: number, at: string, method = "WHISH") {
  db.prepare(
    `INSERT INTO payments (tenant_id, transaction_id, method, drawer_name, currency_code, amount, created_at)
     VALUES (1, ?, ?, ?, 'USD', ?, ?)`,
  ).run(transactionId, method, drawer, amount, at);
}

function count(drawer: string, at: string) {
  const r = db
    .prepare(`INSERT INTO daily_closings (tenant_id, closing_date, drawer_name, created_at) VALUES (1, ?, ?, ?)`)
    .run(at.slice(0, 10), drawer, at);
  db.prepare(
    `INSERT INTO daily_closing_amounts (tenant_id, closing_id, drawer_name, currency_code, opening_amount, physical_amount)
     VALUES (1, ?, ?, 'USD', 100, 100)`,
  ).run(r.lastInsertRowid, drawer);
}

let before: number, afterSpace: number, afterIso: number, auto: number, badMeta: number, voided: number, otherDrawer: number, checkpointTxn: number;

beforeAll(() => {
  db = installWarrantyTestDb();
  initFixedTenantContext(1);
  db.prepare(`INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (3, 1, 'Hassan', '70111222')`).run();

  before = txn({ at: "2026-10-09 17:00:00" });
  leg(before, "Whish_App", -50, "2026-10-09 17:00:00");

  count("Whish_App", "2026-10-09 18:00:00");
  checkpointTxn = txn({ type: "CHECKPOINT", at: "2026-10-09 18:00:00" });
  leg(checkpointTxn, "Whish_App", 3, "2026-10-09 18:00:00", "CHECKPOINT_ADJUSTMENT");

  // After the count, in both stored shapes (ISO 18:30Z sorts BELOW the space
  // form "18:00:00" as text — julianday must decide).
  afterSpace = txn({ at: "2026-10-09 21:30:00", clientId: 3 });
  leg(afterSpace, "Whish_App", -50, "2026-10-09 21:30:00");
  afterIso = txn({ at: "2026-10-09T18:30:00.000Z" });
  leg(afterIso, "Whish_App", 20, "2026-10-09T18:30:00.000Z");

  auto = txn({ type: "SUPPLIER_PAYMENT", at: "2026-10-09 21:31:00", metadata: '{"is_auto":true}' });
  leg(auto, "Whish_App", -1, "2026-10-09 21:31:00");
  badMeta = txn({ at: "2026-10-09 21:32:00", metadata: "{not json" });
  leg(badMeta, "Whish_App", 5, "2026-10-09 21:32:00");
  voided = txn({ at: "2026-10-09 21:33:00", status: "VOIDED" });
  leg(voided, "Whish_App", 7, "2026-10-09 21:33:00");

  otherDrawer = txn({ at: "2026-10-09 21:34:00" });
  leg(otherDrawer, "OMT_App", -10, "2026-10-09 21:34:00", "OMT");
});

afterAll(() => {
  resetTenantContext();
  uninstallWarrantyTestDb(db);
});

beforeEach(() => {
  resetClosingRepository();
  resetClosingService();
});

describe("transactions since the last count", () => {
  it("lists only this drawer's sales after its last count, newest first, with the client and the drawer amount", () => {
    const [whish] = getClosingService().getTransactionsSinceLastCount(["Whish_App"]);
    expect(whish.drawer).toBe("Whish_App");
    expect(whish.lastCountAt).toBe("2026-10-09 18:00:00");
    expect(whish.transactions.map((t) => t.id)).toEqual([badMeta, afterSpace, afterIso]);
    const sale = whish.transactions.find((t) => t.id === afterSpace)!;
    expect(sale.client_name).toBe("Hassan");
    expect(sale.drawer_amounts).toEqual({ USD: -50 });
  });

  it("excludes the count's own rows, automatic siblings and voided sales; malformed metadata stays visible", () => {
    const ids = getClosingService().getTransactionsSinceLastCount(["Whish_App"])[0].transactions.map((t) => t.id);
    expect(ids).not.toContain(before);
    expect(ids).not.toContain(checkpointTxn);
    expect(ids).not.toContain(auto);
    expect(ids).not.toContain(voided);
    expect(ids).toContain(badMeta);
  });

  it("a drawer never counted lists everything on it", () => {
    const [omt] = getClosingService().getTransactionsSinceLastCount(["OMT_App"]);
    expect(omt.lastCountAt).toBeNull();
    expect(omt.transactions.map((t) => t.id)).toEqual([otherDrawer]);
  });
});
