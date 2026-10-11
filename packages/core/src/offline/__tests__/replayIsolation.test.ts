/**
 * LIRA-306 T034 — HIGH guard (analyze pass 3, D2). While a replay
 * transaction is open, a statement from ANOTHER async context (a web request
 * that slipped in) is refused with REPLAY_IN_PROGRESS — it can never join
 * the replay's transaction nor be undone by its rollback. A binding that
 * awaits a macrotask is rolled back as a technical failure.
 */
import { AsyncResource } from "node:async_hooks";
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { getDatabase } from "../../db/connection";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { ReplayEngine } from "../ReplayEngine";
import type { OfflineBinding } from "../bindings/types";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../testHelpers/replayHarness";

const CH = "sales:update-metadata";
let db: Database.Database;
let deviceId = 0;

beforeEach(() => {
  ({ db, deviceId } = installReplayDb());
  resetSeq();
});
afterEach(() => uninstallReplayDb(db));

const outsideCount = () => (db.prepare(`SELECT COUNT(*) AS n FROM offline_review_items`).get() as { n: number }).n;

describe("replay isolation", () => {
  it("refuses a statement from another async context while the replay transaction is open", async () => {
    let outsideError: unknown = null;
    let outsideAttempted = false;
    const before = outsideCount();
    // A web request lives in its OWN async context (bound here, outside the
    // replay window) — a callback merely scheduled from inside the binding
    // would inherit the replay's context.
    const webRequest = AsyncResource.bind(() => {
      outsideAttempted = true;
      try {
        runWithTenant(1, () =>
          new OfflineReviewRepository().insert({ eventRowId: null, deviceId, kind: "pc_data_mismatch", details: {} }),
        );
      } catch (e) {
        outsideError = e;
      }
    });
    const binding: OfflineBinding = {
      channel: CH,
      run: async () => {
        // Something else gets the event loop (only possible if the binding yields):
        await new Promise<void>((resolve) => {
          setImmediate(() => {
            webRequest();
            resolve();
          });
        });
        return { success: true };
      },
    };
    const engine = new ReplayEngine({ bindings: () => binding });
    const row = storeEvent({ deviceId, channel: CH, payload: { id: 5 } });
    const out = await runWithTenant(1, () => engine.process(row, { mode: "auto" }));
    expect(outsideAttempted).toBe(true);
    expect(() => {
      if (outsideError) throw outsideError;
    }).toThrow(/REPLAY_IN_PROGRESS/);
    // the replay itself was rolled back as a technical failure (it yielded)
    expect(out).toMatchObject({ status: "received", technical: true });
    // nothing joined, nothing silently undone
    expect(outsideCount()).toBe(before);
  });

  it("outside any replay, statements run normally", () => {
    expect(() => getDatabase().prepare("SELECT 1").get()).not.toThrow();
  });
});
