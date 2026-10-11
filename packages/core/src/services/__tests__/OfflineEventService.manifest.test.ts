/**
 * LIRA-306 T065 — the N5 cross-check (FR-035, FR-036): the PC sends, per key
 * table, the ids in its range present in its working copy; every one must be
 * explained by an event it sent (`created`). A row no event created →
 * `pc_data_mismatch` listing table and ids. Rows created then deleted offline
 * are absent from the manifest and are fine. Read-screen writes the PC logged
 * are listed in the item.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { OfflineEventService } from "../OfflineEventService";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { encodeOfflineId, offlineTableIndex } from "../../offline/idRange";
import { COPY_ID, installReplayDb, storeEvent, uninstallReplayDb, resetSeq } from "../../offline/testHelpers/replayHarness";

let db: Database.Database;
let pc1 = 0;
const id = (table: string, k: number) => encodeOfflineId(1, offlineTableIndex(table), k);
beforeEach(() => {
  resetSeq();
  ({ db, deviceId: pc1 } = installReplayDb());
  // e1 created client 1 + its transaction; e2 created sale 1 and sale 2 (sale 2 later deleted offline)
  storeEvent({ deviceId: pc1, channel: "clients:create", payload: {}, seq: 1, created: { clients: [id("clients", 1)], transactions: [id("transactions", 1)] } });
  storeEvent({ deviceId: pc1, channel: "sales:process", payload: {}, seq: 2, created: { sales: [id("sales", 1), id("sales", 2)] } });
});
afterEach(() => uninstallReplayDb(db));

const svc = () => new OfflineEventService({ serverSchemaVersion: () => 210 });
const items = () => runWithTenant(1, () => new OfflineReviewRepository().list({ kind: "pc_data_mismatch" }));

describe("OfflineEventService.compareManifest", () => {
  it("every row explained by an event (incl. a row deleted offline) → matched, no item", () => {
    const r = runWithTenant(1, () =>
      svc().compareManifest(pc1, {
        copyId: COPY_ID,
        tables: { clients: [id("clients", 1)], transactions: [id("transactions", 1)], sales: [id("sales", 1)] },
        readWrites: [],
      }),
    );
    expect(r).toEqual({ success: true, data: { matched: true, unexplained: [] } });
    expect(items()).toEqual([]);
  });

  it("a row no event created → pc_data_mismatch listing the table and ids", () => {
    const r = runWithTenant(1, () =>
      svc().compareManifest(pc1, {
        copyId: COPY_ID,
        tables: { clients: [id("clients", 1), id("clients", 7)], sales: [id("sales", 1)], debt_ledger: [id("debt_ledger", 3)] },
        readWrites: [],
      }),
    );
    expect(r.data).toEqual({
      matched: false,
      unexplained: [
        { table: "clients", ids: [id("clients", 7)] },
        { table: "debt_ledger", ids: [id("debt_ledger", 3)] },
      ],
    });
    const [item] = items();
    expect(item.event_row_id).toBeNull();
    expect(JSON.parse(item.details_json).unexplained).toEqual(r.data!.unexplained);
  });

  it("read-screen writes are listed (and make it a mismatch)", () => {
    const r = runWithTenant(1, () =>
      svc().compareManifest(pc1, { copyId: COPY_ID, tables: {}, readWrites: [{ channel: "inventory:get-products", changes: 2 }] }),
    );
    expect(r.data?.matched).toBe(false);
    expect(JSON.parse(items()[0].details_json).readWrites).toEqual([{ channel: "inventory:get-products", changes: 2 }]);
  });

  it("server ids (below the offline range) are ignored", () => {
    const r = runWithTenant(1, () => svc().compareManifest(pc1, { copyId: COPY_ID, tables: { clients: [5] }, readWrites: [] }));
    expect(r.data?.matched).toBe(true);
  });
});
