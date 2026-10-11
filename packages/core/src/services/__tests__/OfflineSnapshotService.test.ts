/**
 * LIRA-306 T114 — OfflineSnapshotService: one copy per shop reused for
 * OFFLINE_SNAPSHOT_TTL_MS (5 min) by all its PCs, each fresh build recorded
 * in `offline_snapshots`. Written failing-first (module did not exist).
 */
import type Database from "better-sqlite3";
import zlib from "node:zlib";
import { runWithTenant } from "../../db/tenantContext";
import { installWarrantyTestDb, uninstallWarrantyTestDb } from "../../repositories/testHelpers/warrantyDb";
import { OfflineSnapshotRepository } from "../../repositories/OfflineSnapshotRepository";
import type { TenantSnapshot } from "../../db/tenantSnapshot";
import { OfflineSnapshotService } from "../OfflineSnapshotService";

let db: Database.Database;
beforeEach(() => {
  db = installWarrantyTestDb();
});
afterEach(() => {
  delete process.env.OFFLINE_SNAPSHOT_TTL_MS;
  uninstallWarrantyTestDb(db);
});

function fakeBuild() {
  let n = 0;
  const calls: number[] = [];
  const build = (opts: { tenantId: number }): TenantSnapshot => {
    n += 1;
    calls.push(opts.tenantId);
    return {
      copyId: `copy-${opts.tenantId}-${n}`,
      tenantId: opts.tenantId,
      builtAt: `2026-10-11T10:00:0${n}.000Z`,
      schemaVersion: 210,
      highWater: { clients: n },
      gzip: Buffer.from("x"),
      sizeBytes: 1,
      buildMs: 1,
      foreignKeyViolations: 0,
    };
  };
  return { build, calls };
}

const seedDevice = (tenantId: number): number =>
  db
    .prepare(
      `INSERT INTO offline_devices (tenant_id, device_no, name, key_id, key_hash, paired_by, paired_at, created_at, updated_at)
       VALUES (?, 1, 'PC', ?, 'h', 1, 'now', 'now', 'now')`,
    )
    .run(tenantId, `key-${tenantId}`).lastInsertRowid as number;

describe("OfflineSnapshotService", () => {
  it("builds once per shop within the TTL, shares it across PCs, records offline_snapshots only on a build", () => {
    const { build, calls } = fakeBuild();
    let now = 1_000_000;
    const repo = new OfflineSnapshotRepository();
    const svc = new OfflineSnapshotService(repo, { build, now: () => now });
    const dev1 = seedDevice(1);

    const a = runWithTenant(1, () => svc.getSnapshot({ deviceId: dev1 }));
    now += 299_000;
    const b = runWithTenant(1, () => svc.getSnapshot({ deviceId: null }));
    expect(b.copyId).toBe(a.copyId);
    expect(calls).toEqual([1]);

    const rows = db.prepare(`SELECT tenant_id, copy_id, device_id, schema_version, built_at, high_water_json FROM offline_snapshots`).all();
    expect(rows).toEqual([
      { tenant_id: 1, copy_id: a.copyId, device_id: dev1, schema_version: 210, built_at: a.builtAt, high_water_json: '{"clients":1}' },
    ]);
    expect(runWithTenant(1, () => repo.findByCopyId(a.copyId))?.highWater).toEqual({ clients: 1 });

    now += 2_000; // past 5 minutes
    const c = runWithTenant(1, () => svc.getSnapshot({ deviceId: null }));
    expect(c.copyId).not.toBe(a.copyId);
    expect(calls).toEqual([1, 1]);
    expect(db.prepare(`SELECT COUNT(*) c FROM offline_snapshots`).get()).toEqual({ c: 2 });
  });

  it("caches per shop: shop 2 never receives shop 1's copy", () => {
    const { build, calls } = fakeBuild();
    const svc = new OfflineSnapshotService(new OfflineSnapshotRepository(), { build, now: () => 0 });
    const one = runWithTenant(1, () => svc.getSnapshot({ deviceId: null }));
    const two = runWithTenant(2, () => svc.getSnapshot({ deviceId: null }));
    expect(two.tenantId).toBe(2);
    expect(two.copyId).not.toBe(one.copyId);
    expect(calls).toEqual([1, 2]);
    expect(runWithTenant(2, () => new OfflineSnapshotRepository().latest())?.copy_id).toBe(two.copyId);
  });

  it("reads the TTL knob at call time (OFFLINE_SNAPSHOT_TTL_MS)", () => {
    process.env.OFFLINE_SNAPSHOT_TTL_MS = "0";
    const { build, calls } = fakeBuild();
    const svc = new OfflineSnapshotService(new OfflineSnapshotRepository(), { build, now: () => 5 });
    runWithTenant(1, () => svc.getSnapshot({ deviceId: null }));
    runWithTenant(1, () => svc.getSnapshot({ deviceId: null }));
    expect(calls).toEqual([1, 1]);
  });

  it("a failed build is not cached and records nothing", () => {
    const svc = new OfflineSnapshotService(new OfflineSnapshotRepository(), {
      build: () => {
        throw new Error("narrowing refused");
      },
      now: () => 0,
    });
    expect(() => runWithTenant(1, () => svc.getSnapshot({ deviceId: null }))).toThrow(/narrowing refused/);
    expect(db.prepare(`SELECT COUNT(*) c FROM offline_snapshots`).get()).toEqual({ c: 0 });
  });

  it("default builder: builds a real copy of the current shop from getDatabase()", () => {
    db.prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (2, 'Other shop client')`).run();
    db.prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, 'Mine')`).run();
    const svc = new OfflineSnapshotService(new OfflineSnapshotRepository());
    const snap = runWithTenant(1, () => svc.getSnapshot({ deviceId: null }));
    expect(snap.tenantId).toBe(1);
    expect(zlib.gunzipSync(snap.gzip).subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(runWithTenant(1, () => new OfflineSnapshotRepository().latest())?.copy_id).toBe(snap.copyId);
  });
});
