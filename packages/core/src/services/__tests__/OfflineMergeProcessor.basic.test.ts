/**
 * LIRA-306 T046 — OfflineMergeProcessor, one PC (FR-017): events are booked
 * in the PC's own sequence; a gap stops that PC until the missing event
 * arrives; a later round never re-books; one `data:invalidate` per round
 * after commit; the processing rate is reported.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { getDatabase } from "../../db/connection";
import { OfflineMergeProcessor } from "../OfflineMergeProcessor";
import { ReplayEngine } from "../../offline/ReplayEngine";
import type { OfflineBinding } from "../../offline/bindings/types";
import { OfflineDeviceRepository } from "../../repositories/OfflineDeviceRepository";
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

let invalidations = 0;
let rounds: Array<{ processed: number; perSecond: number }> = [];
const processor = () =>
  new OfflineMergeProcessor({
    engine: new ReplayEngine({ bindings: () => binding }),
    onRoundCommitted: () => {
      invalidations += 1;
    },
    onRoundDone: (r) => rounds.push(r),
  });

const ev = (seq: number) => storeEvent({ deviceId, channel: CH, payload: { id: seq }, seq });
const round = () => processor().runRound(1);

beforeEach(() => {
  ({ db, deviceId } = installReplayDb());
  resetSeq();
  order.length = 0;
  invalidations = 0;
  rounds = [];
});
afterEach(() => uninstallReplayDb(db));

describe("OfflineMergeProcessor — one PC", () => {
  it("books a PC's events in its own sequence order and advances its cursor", async () => {
    ev(3);
    ev(1);
    ev(2);
    const r = await round();
    expect(order).toEqual([1, 2, 3]);
    expect(r.processed).toBe(3);
    runWithTenant(1, () => expect(new OfflineDeviceRepository().findById(deviceId)?.next_expected_seq).toBe(4));
  });

  it("a gap stops the PC until the missing event arrives", async () => {
    ev(1);
    ev(3);
    await round();
    expect(order).toEqual([1]);
    ev(2);
    await round();
    expect(order).toEqual([1, 2, 3]);
  });

  it("a later round never books an event twice", async () => {
    ev(1);
    await round();
    await round();
    expect(order).toEqual([1]);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM clients`).get() as { n: number }).n).toBe(1);
  });

  it("emits one invalidation per round that booked something, and reports the rate", async () => {
    for (let s = 1; s <= 25; s++) ev(s);
    await round();
    expect(invalidations).toBe(1);
    await round(); // nothing to do
    expect(invalidations).toBe(1);
    expect(rounds[0].processed).toBe(25);
    expect(rounds[0].perSecond).toBeGreaterThanOrEqual(20);
  });

  it("an event refused at upload (stored refused) does not block the PC's queue", async () => {
    ev(1);
    storeEvent({ deviceId, channel: "no:such", payload: {}, seq: 2 });
    db.prepare(`UPDATE offline_events SET status = 'refused' WHERE channel = 'no:such'`).run();
    ev(3);
    await round();
    expect(order).toEqual([1, 3]);
  });
});

describe("OfflineMergeProcessor — the rest of the server keeps running", () => {
  it("yields to the event loop BETWEEN events (never inside one), so web requests are served during a round", async () => {
    for (let s = 1; s <= 5; s++) ev(s);
    let ranDuringRound = false;
    setImmediate(() => {
      ranDuringRound = true;
    });
    const r = processor().runRound(1);
    expect(ranDuringRound).toBe(false);
    await r;
    expect(ranDuringRound).toBe(true);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it("an upload that arrives during a round is booked by that round (no wait for the sweep)", async () => {
    ev(1);
    const p = processor();
    const first = p.runRound(1);
    // a second request for the same shop while the round runs
    await new Promise((r) => setImmediate(r));
    ev(2);
    const second = await processor().runRound(1);
    expect(second.processed).toBe(0); // the lock refused it…
    await first;
    expect(order).toEqual([1, 2]); // …and the running round picked the event up
  });
});
