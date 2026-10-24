/**
 * LIRA-306 (FR-021) — a voucher redeemed by a replayed offline sale carries
 * the event's time, not the reconnect time. `voucher:create`/`voucher:cancel`
 * are online-only (O-new-6, O-impl-C-1), but the GIFT_CARD leg of an offline
 * `sales:process` redeems through `VoucherRepository.redeemByCode`.
 */
import { runWithTenant } from "../../db/tenantContext";
import {
  getVoucherRepository,
  resetVoucherRepository,
} from "../VoucherRepository";
import {
  installReplayDb,
  uninstallReplayDb,
} from "../../offline/testHelpers/replayHarness";

describe("VoucherRepository writes take requestNow()", () => {
  it("redeemByCode inside a replay stamps redeemed_at with the event time", () => {
    resetVoucherRepository();
    const { db } = installReplayDb();
    try {
      db.exec(`
        INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (501, 1, 'Owner', '70111222');
        INSERT INTO vouchers (id, tenant_id, code, client_id, client_name, client_phone, amount, currency_code, status, created_by, created_at)
          VALUES (501, 1, 'GIFT-AAAA-BBBB', 501, 'Owner', '70111222', 10, 'USD', 'pending', 1, '2026-09-01 10:00:00');
      `);
      runWithTenant(
        1,
        () =>
          getVoucherRepository().redeemByCode({
            code: "GIFT-AAAA-BBBB",
            context: "sale",
            transactionId: null,
            userId: 2,
            day: "2026-10-01",
          }),
        { clientDay: "2026-10-01", effectiveNow: "2026-10-01T20:50:00.000Z" },
      );
      const row = db
        .prepare(`SELECT redeemed_at FROM vouchers WHERE id = 501`)
        .get();
      expect(row).toEqual({ redeemed_at: "2026-10-01 20:50:00" });
    } finally {
      uninstallReplayDb(db);
    }
  });
});
