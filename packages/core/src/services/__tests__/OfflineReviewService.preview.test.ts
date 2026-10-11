/**
 * LIRA-306 FR-032 / O-new-27 — before an admin applies a drawer count taken
 * offline, the review list shows BOTH figures per drawer/currency: what the
 * PC's copy expected, and what the server's drawer was AS OF the count's
 * time (the PC could not see web or other PCs' sales). The preview books
 * nothing, and its server figure equals what Apply then books.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { ReplayEngine } from "../../offline/ReplayEngine";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { OfflineReviewService } from "../OfflineReviewService";
import { FIXTURES } from "../../offline/testHelpers/fixtures/checkpoints";
import { installReplayDb, storeEvent, uninstallReplayDb, resetSeq } from "../../offline/testHelpers/replayHarness";

let db: Database.Database;
let deviceId = 0;
beforeEach(() => {
  resetSeq();
  ({ db, deviceId } = installReplayDb());
  db.exec(FIXTURES[0].seedSql!);
  // a payment into "Safe" AFTER the count's time (10-10 20:50Z) must not count
  db.exec(`INSERT INTO payments (tenant_id, transaction_id, method, drawer_name, currency_code, amount, note, created_by, created_at)
    VALUES (1, NULL, 'CASH', 'Safe', 'USD', 7, 'after the count', 1, '2026-10-10 21:30:00');
    UPDATE drawer_balances SET balance = balance + 7 WHERE tenant_id = 1 AND drawer_name = 'Safe' AND currency_code = 'USD';`);
});
afterEach(() => uninstallReplayDb(db));

const count = (amounts: Array<Record<string, unknown>>) =>
  storeEvent({ deviceId, channel: "closing:create-checkpoint", actorUserId: 1, payload: { ...FIXTURES[0].payload, amounts } });
const held = async (row: ReturnType<typeof count>) => {
  await runWithTenant(1, () => new ReplayEngine().process(row, { mode: "auto" }));
  return runWithTenant(1, () => new OfflineReviewRepository().list({ state: "open", kind: "held_checkpoint" })[0]);
};

describe("OfflineReviewService.preview — drawer count taken offline", () => {
  it("shows the PC's and the server's as-of figures side by side, books nothing", async () => {
    const item = await held(count([{ drawer_name: "Safe", currency_code: "USD", expected_amount: 90, physical_amount: 95 }]));
    const before = db.prepare(`SELECT COUNT(*) AS c FROM daily_closings`).get();
    const r = runWithTenant(1, () => new OfflineReviewService().preview(item.id));
    expect(r).toEqual({
      success: true,
      data: {
        kind: "drawer_count",
        figures: [{ drawer_name: "Safe", currency_code: "USD", pc_expected: 90, server_expected: 100, physical: 95 }],
      },
    });
    expect(db.prepare(`SELECT COUNT(*) AS c FROM daily_closings`).get()).toEqual(before);
  });

  it("Apply then books the server figure the preview showed", async () => {
    const item = await held(count([{ drawer_name: "Safe", currency_code: "USD", expected_amount: 90, physical_amount: 95 }]));
    const shown = runWithTenant(1, () => new OfflineReviewService().preview(item.id)).data!;
    const r = await runWithTenant(1, () => new OfflineReviewService().apply(item.id, 1));
    expect(r.success).toBe(true);
    const booked = db
      .prepare(`SELECT opening_amount FROM daily_closing_amounts WHERE drawer_name = 'Safe' AND currency_code = 'USD' ORDER BY id DESC LIMIT 1`)
      .get() as { opening_amount: number };
    // the count's expected amount is stored in opening_amount
    expect(booked.opening_amount).toBe((shown as { figures: Array<{ server_expected: number }> }).figures[0].server_expected);
  });

  it("other items have no figures to compare", async () => {
    const row = storeEvent({ deviceId, channel: "carrier-lines:update-balance", actorUserId: 1, payload: { id: 15001, credits: 40 } });
    await runWithTenant(1, () => new ReplayEngine().process(row, { mode: "auto" }));
    const item = runWithTenant(1, () => new OfflineReviewRepository().list({ state: "open" })[0]);
    expect(runWithTenant(1, () => new OfflineReviewService().preview(item.id))).toEqual({ success: true, data: { kind: "none" } });
    expect(runWithTenant(1, () => new OfflineReviewService().preview(99999)).success).toBe(false);
  });
});
