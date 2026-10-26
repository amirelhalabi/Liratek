/**
 * LIRA-346 — the partner ledger's from / to filter is by SHOP DAY
 * (`localDayExpr`, rule 27), not a raw text compare of `created_at`:
 * the "to" day is inclusive, both stored formats (`YYYY-MM-DD HH:MM:SS` and
 * ISO `…T…Z`) work, and a 22:30 UTC row is the next day in Beirut.
 *
 * Rule 17: written and run before the fix (failing first).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { PartnerRepository, resetPartnerRepository } from "../PartnerRepository";
import { buildDb } from "../testHelpers/omtAccountDb";

describe("LIRA-346 — PartnerRepository.getLedgerEntries day filter", () => {
  let db: Database.Database;
  let repo: PartnerRepository;
  let partnerId: number;

  const insert = (amount: number, createdAt: string): void => {
    db.prepare(
      `INSERT INTO partner_ledger
         (tenant_id, partner_id, transaction_type, amount, currency, direction, created_at)
       VALUES (1, ?, 'FOR_POS', ?, 'USD', 'DEBIT', ?)`,
    ).run(partnerId, amount, createdAt);
  };

  beforeEach(() => {
    resetPartnerRepository();
    db = buildDb();
    initFixedTenantContext(1);
    repo = new PartnerRepository();
    partnerId = Number(
      db.prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'Day Desk')`).run()
        .lastInsertRowid,
    );
    insert(1, "2026-10-04 23:00:00");
    insert(2, "2026-10-05 10:00:00");
    insert(3, "2026-10-05T18:00:00.000Z");
    insert(4, "2026-10-06 08:00:00");
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const amounts = (opts: { clientTzOffsetMinutes: number }, from: string, to: string) =>
    runWithTenant(
      1,
      () =>
        repo
          .getLedgerEntries(partnerId, { startDate: from, endDate: to })
          .map((e) => e.amount)
          .sort(),
      opts,
    );

  it("the 'to' day is inclusive and both stored formats are read (UTC shop)", () => {
    expect(amounts({ clientTzOffsetMinutes: 0 }, "2026-10-05", "2026-10-05")).toEqual([2, 3]);
  });

  it("days follow the shop's zone: 23:00 UTC on 4 Oct is 5 Oct in Beirut", () => {
    expect(amounts({ clientTzOffsetMinutes: 180 }, "2026-10-05", "2026-10-05")).toEqual([
      1, 2, 3,
    ]);
  });
});
