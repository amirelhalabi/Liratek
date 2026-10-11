/**
 * LIRA-306 FR-021 — supplier / partner ledger writers that an OFFLINE action
 * reaches carry the event's own time on replay (23:50 Beirut day N, replayed
 * later), not the server's clock:
 *   - SupplierRepository.recordStockIntake (inventory:receive-stock with a
 *     supplier → STOCK_INTAKE row),
 *   - SupplierRepository.attachRecordedDebtToIntake (inventory:receive-stock
 *     attached to a recorded debt → `attached_at`),
 *   - PartnerRepository.addLedgerEntry (the shared partner-ledger writer of
 *     for-partner sales of recharges / services / custom services).
 * Online-only supplier writers (create supplier, record debt, settlements,
 * discounts, commission) are deliberately left on the clock.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { STOCK_BINDINGS } from "../../offline/bindings/stock";
import { FIXTURES } from "../../offline/testHelpers/fixtures/stock";
import { bindingLookup, replayOne, EVENT_SQL_TIME, EVENT_INSTANT } from "../../offline/testHelpers/familyHarness";
import { installReplayDb, uninstallReplayDb, resetSeq } from "../../offline/testHelpers/replayHarness";
import { getPartnerRepository } from "../PartnerRepository";

let db: Database.Database;
let deviceId = 0;
beforeEach(() => {
  resetSeq();
  ({ db, deviceId } = installReplayDb());
  db.exec(FIXTURES[0].seedSql!);
});
afterEach(() => uninstallReplayDb(db));

const bindings = bindingLookup(STOCK_BINDINGS);

describe("supplier / partner ledger rows on replay carry the event's time", () => {
  it("receive stock from a supplier: the STOCK_INTAKE row is dated at the event", async () => {
    const out = await replayOne(deviceId, "inventory:receive-stock", FIXTURES[0].payload, bindings);
    expect(out.status).toBe("booked");
    const row = db.prepare(`SELECT created_at FROM supplier_ledger WHERE entry_type = 'STOCK_INTAKE'`).get() as { created_at: string };
    expect(row.created_at).toBe(EVENT_SQL_TIME);
  });

  it("receive stock attached to a recorded debt: attached_at is the event time", async () => {
    const out = await replayOne(deviceId, "inventory:receive-stock", FIXTURES[1].payload, bindings);
    expect(out.status).toBe("booked");
    const row = db.prepare(`SELECT attached_at FROM supplier_ledger WHERE id = 13001`).get() as { attached_at: string };
    expect(row.attached_at).toBe(EVENT_SQL_TIME);
  });

  it("a partner-ledger row written inside a replay context carries the event time; a given time still wins", () => {
    db.exec(`INSERT INTO partners (id, tenant_id, name, is_active, created_at, updated_at) VALUES (77, 1, 'Partner', 1, '2026-10-01 10:00:00', '2026-10-01 10:00:00')`);
    const [a, b] = runWithTenant(
      1,
      () => [
        getPartnerRepository().addLedgerEntry({ partner_id: 77, transaction_type: "FOR_RECHARGE", amount: 5, currency: "USD", direction: "DEBIT" }),
        getPartnerRepository().addLedgerEntry({ partner_id: 77, transaction_type: "FOR_RECHARGE", amount: 5, currency: "USD", direction: "DEBIT", created_at: "2026-10-05 09:00:00" }),
      ],
      { effectiveNow: EVENT_INSTANT },
    );
    const at = (id: number) => (db.prepare(`SELECT created_at FROM partner_ledger WHERE id = ?`).get(id) as { created_at: string }).created_at;
    expect(at(a.id)).toBe(EVENT_SQL_TIME);
    expect(at(b.id)).toBe("2026-10-05 09:00:00");
  });
});
