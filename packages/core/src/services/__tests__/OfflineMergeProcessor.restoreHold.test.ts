/**
 * LIRA-377 T022 — a shop held for a file swap runs no merge round: its events
 * stay waiting and the next round after `release()` books them. New hook,
 * written together with it (not proven failing-first, rule 17).
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../../db/connection";
import { OfflineMergeProcessor } from "../OfflineMergeProcessor";
import { ReplayEngine } from "../../offline/ReplayEngine";
import type { OfflineBinding } from "../../offline/bindings/types";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../../offline/testHelpers/replayHarness";

const CH = "sales:update-metadata";
let db: Database.Database;
let deviceId = 0;
const order: number[] = [];
const binding: OfflineBinding = {
  channel: CH,
  run: (p) => {
    order.push(p.id as number);
    getDatabase().prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, ?)`).run(`c${String(p.id)}`);
    return { success: true };
  },
};
const processor = () => new OfflineMergeProcessor({ engine: new ReplayEngine({ bindings: () => binding }) });

beforeEach(() => {
  ({ db, deviceId } = installReplayDb());
  resetSeq();
  order.length = 0;
});
afterEach(() => {
  OfflineMergeProcessor.release(1);
  uninstallReplayDb(db);
});

describe("OfflineMergeProcessor — restore hold", () => {
  it("skips rounds while held and books the waiting events after release", async () => {
    storeEvent({ deviceId, channel: CH, payload: { id: 1 }, seq: 1 });
    OfflineMergeProcessor.hold(1);
    expect(OfflineMergeProcessor.isHeld(1)).toBe(true);
    const skipped = await processor().runRound(1);
    expect(skipped.processed).toBe(0);
    expect(order).toEqual([]);
    expect(OfflineMergeProcessor.isRunning(1)).toBe(false);

    OfflineMergeProcessor.release(1);
    const r = await processor().runRound(1);
    expect(r.processed).toBe(1);
    expect(order).toEqual([1]);
  });
});
