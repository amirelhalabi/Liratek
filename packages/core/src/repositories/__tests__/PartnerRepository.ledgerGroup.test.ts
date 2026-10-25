/**
 * LIRA-340 T002 — the partner ledger read splits into two display groups,
 * defined once in core (rule 14): "payments" = SETTLEMENT / DISCOUNT /
 * ADJUSTMENT, "transactions" = every other entry type (incl. unknown/NULL),
 * no group = everything. Rule 17: written and run before the filter existed.
 *
 * Real schema: create_db.sql + migrations.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  PartnerRepository,
  resetPartnerRepository,
  PARTNER_PAYMENT_ENTRY_TYPES,
} from "../PartnerRepository";
import { buildDb } from "../testHelpers/omtAccountDb";

describe("LIRA-340 — PartnerRepository.getLedgerEntries group filter", () => {
  let db: Database.Database;
  let repo: PartnerRepository;
  let partnerId: number;

  function insert(
    type: string | null,
    amount: number,
    createdAt: string,
    method: string | null = null,
  ): void {
    db.prepare(
      `INSERT INTO partner_ledger
         (tenant_id, partner_id, transaction_type, amount, currency, direction, settlement_method, created_at)
       VALUES (1, ?, ?, ?, 'USD', 'DEBIT', ?, ?)`,
    ).run(partnerId, type, amount, method, createdAt);
  }

  beforeEach(() => {
    resetPartnerRepository();
    db = buildDb();
    initFixedTenantContext(1);
    repo = new PartnerRepository();
    partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name) VALUES (1, 'Dora Desk')`,
        )
        .run().lastInsertRowid,
    );
    insert("FOR_POS", 10, "2026-10-01 10:00:00");
    insert("THROUGH_OMT_SEND", 20, "2026-10-02 10:00:00");
    insert("SETTLEMENT", 30, "2026-10-03 10:00:00", "SPLIT");
    insert("DISCOUNT", 4, "2026-10-04 10:00:00");
    insert("ADJUSTMENT", 50, "2026-10-05 10:00:00");
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const types = (rows: { transaction_type: string | null }[]) =>
    rows.map((r) => r.transaction_type).sort();

  it("defines the payment types once", () => {
    expect([...PARTNER_PAYMENT_ENTRY_TYPES]).toEqual([
      "SETTLEMENT",
      "DISCOUNT",
      "ADJUSTMENT",
    ]);
  });

  it("payments = settlement, discount, adjustment (Split kept as method)", () => {
    const rows = repo.getLedgerEntries(partnerId, { group: "payments" });
    expect(types(rows)).toEqual(["ADJUSTMENT", "DISCOUNT", "SETTLEMENT"]);
    expect(
      rows.find((r) => r.transaction_type === "SETTLEMENT")?.settlement_method,
    ).toBe("SPLIT");
  });

  it("transactions = everything else", () => {
    const rows = repo.getLedgerEntries(partnerId, { group: "transactions" });
    expect(types(rows)).toEqual(["FOR_POS", "THROUGH_OMT_SEND"]);
  });

  it("no group = all entries; the two groups add up to it (SC-001)", () => {
    const all = repo.getLedgerEntries(partnerId);
    expect(all).toHaveLength(5);
    expect(
      repo.getLedgerEntries(partnerId, { group: "payments" }).length +
        repo.getLedgerEntries(partnerId, { group: "transactions" }).length,
    ).toBe(all.length);
  });

  it("dates still filter inside a group", () => {
    const rows = repo.getLedgerEntries(partnerId, {
      group: "payments",
      startDate: "2026-10-04 00:00:00",
    });
    expect(types(rows)).toEqual(["ADJUSTMENT", "DISCOUNT"]);
  });
});
