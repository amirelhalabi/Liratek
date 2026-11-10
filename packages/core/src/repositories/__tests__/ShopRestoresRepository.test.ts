/**
 * ShopRestoresRepository (LIRA-377, T013) — rows of the PLATFORM-only
 * `shop_restores` table (v231).
 *
 * Two real in-memory files wired through the same `setDatabaseResolver()` +
 * `runWithTenant` / `runWithoutTenant` seam the web backend installs in
 * per-tenant mode: every call below is made from INSIDE shop 5's own tenant
 * scope (the restore routes run there), and every row must still land in —
 * and be read from — the platform file.
 *
 * Guards: prepared → running → done; failed; expired; illegal transitions
 * refused (return false, row unchanged); getOpenForTenant; the partial
 * unique index (one open restore per shop, other shops unaffected);
 * latestDone picks the newest; listBeforeCopies filters by date and shop;
 * listPreparedOlderThan for the expiry sweep.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { setDatabaseResolver, closeDatabase } from "../../db/connection.js";
import {
  runWithTenant,
  getCurrentTenantId,
  resetTenantContext,
} from "../../db/tenantContext.js";
import {
  getShopRestoresRepository,
  resetShopRestoresRepository,
  type CreatePreparedRestoreInput,
} from "../ShopRestoresRepository.js";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-11-10T08:00:00.000Z";
const T1 = "2026-11-10T08:01:00.000Z";
const T2 = "2026-11-10T08:02:00.000Z";
const T3 = "2026-11-10T08:03:00.000Z";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_DB_SQL);
  return db;
}

let platformDb: Database.Database;
let shopDb: Database.Database;

beforeEach(() => {
  resetShopRestoresRepository();
  platformDb = freshDb();
  platformDb.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES
      (5, 'Shop Five', 'shop-five', 'active'),
      (6, 'Shop Six', 'shop-six', 'active');
  `);
  shopDb = freshDb();
  setDatabaseResolver(() => {
    try {
      return getCurrentTenantId() === 5 ? shopDb : platformDb;
    } catch {
      return platformDb;
    }
  });
});

afterEach(() => {
  setDatabaseResolver(null);
  closeDatabase();
  resetTenantContext();
  platformDb.close();
  shopDb.close();
});

/** Runs as shop 5's request would: inside its own tenant scope. */
const inShop = <T>(fn: () => T): T => runWithTenant(5, fn);
const repo = () => getShopRestoresRepository();

function input(over: Partial<CreatePreparedRestoreInput> = {}): CreatePreparedRestoreInput {
  return {
    targetTenantId: 5,
    kind: "time",
    restoredTo: "2026-11-09T21:00:00.000Z",
    clientTzOffsetMin: 120,
    requestedByUserId: 7,
    requestedByName: "Amir",
    candidatePath: "/data/restore-work/5-1.candidate",
    previewJson: '{"lastSale":null}',
    idFloorJson: '{"sales":10}',
    preparedAt: T0,
    ...over,
  };
}

const platformCount = (): number =>
  (platformDb.prepare(`SELECT COUNT(*) AS n FROM shop_restores`).get() as { n: number }).n;
const shopCount = (): number =>
  (shopDb.prepare(`SELECT COUNT(*) AS n FROM shop_restores`).get() as { n: number }).n;

describe("ShopRestoresRepository", () => {
  it("createPrepared writes to the PLATFORM file even from inside the shop's own scope", () => {
    const row = inShop(() => repo().createPrepared(input()));
    expect(row.status).toBe("prepared");
    expect(row.target_tenant_id).toBe(5);
    expect(row.kind).toBe("time");
    expect(row.restored_to).toBe("2026-11-09T21:00:00.000Z");
    expect(row.client_tz_offset_min).toBe(120);
    expect(row.requested_by_user_id).toBe(7);
    expect(row.requested_by_name).toBe("Amir");
    expect(row.candidate_path).toBe("/data/restore-work/5-1.candidate");
    expect(row.preview_json).toBe('{"lastSale":null}');
    expect(row.id_floor_json).toBe('{"sales":10}');
    expect(row.prepared_at).toBe(T0);
    expect(row.created_at).toBe(T0);
    expect(row.updated_at).toBe(T0);
    expect(row.started_at).toBeNull();
    expect(row.finished_at).toBeNull();
    expect(platformCount()).toBe(1);
    expect(shopCount()).toBe(0);
  });

  it("prepared → running → done", () => {
    const { id } = inShop(() => repo().createPrepared(input()));
    expect(inShop(() => repo().markRunning(id, T1))).toBe(true);
    let row = inShop(() => repo().getById(id))!;
    expect(row.status).toBe("running");
    expect(row.started_at).toBe(T1);
    expect(row.updated_at).toBe(T1);

    expect(
      inShop(() =>
        repo().markDone(id, {
          finishedAt: T2,
          beforeCopyPath: "/data/restore-points/5/before-20261110T080200Z.sqlite",
        }),
      ),
    ).toBe(true);
    row = inShop(() => repo().getById(id))!;
    expect(row.status).toBe("done");
    expect(row.finished_at).toBe(T2);
    expect(row.updated_at).toBe(T2);
    expect(row.before_copy_path).toBe(
      "/data/restore-points/5/before-20261110T080200Z.sqlite",
    );
  });

  it("running → failed keeps the plain error message", () => {
    const { id } = inShop(() => repo().createPrepared(input()));
    inShop(() => repo().markRunning(id, T1));
    expect(inShop(() => repo().markFailed(id, "disk full", T2))).toBe(true);
    const row = inShop(() => repo().getById(id))!;
    expect(row.status).toBe("failed");
    expect(row.error).toBe("disk full");
    expect(row.finished_at).toBe(T2);
    expect(row.updated_at).toBe(T2);
  });

  it("prepared → failed is allowed (preparation itself can fail)", () => {
    const { id } = inShop(() => repo().createPrepared(input()));
    expect(inShop(() => repo().markFailed(id, "bad file", T1))).toBe(true);
    expect(inShop(() => repo().getById(id))!.status).toBe("failed");
  });

  it("prepared → expired", () => {
    const { id } = inShop(() => repo().createPrepared(input()));
    expect(inShop(() => repo().markExpired(id, T1))).toBe(true);
    const row = inShop(() => repo().getById(id))!;
    expect(row.status).toBe("expired");
    expect(row.finished_at).toBe(T1);
    expect(row.updated_at).toBe(T1);
  });

  it("refuses illegal transitions and leaves the row unchanged", () => {
    const { id } = inShop(() => repo().createPrepared(input()));
    // done only from running
    expect(inShop(() => repo().markDone(id, { finishedAt: T1, beforeCopyPath: null }))).toBe(false);
    inShop(() => repo().markRunning(id, T1));
    // expired only from prepared
    expect(inShop(() => repo().markExpired(id, T2))).toBe(false);
    inShop(() => repo().markDone(id, { finishedAt: T2, beforeCopyPath: "/x" }));
    // done → running / failed / expired all refused
    expect(inShop(() => repo().markRunning(id, T3))).toBe(false);
    expect(inShop(() => repo().markFailed(id, "late", T3))).toBe(false);
    expect(inShop(() => repo().markExpired(id, T3))).toBe(false);
    const row = inShop(() => repo().getById(id))!;
    expect(row.status).toBe("done");
    expect(row.updated_at).toBe(T2);
    expect(row.error).toBeNull();
    // an unknown id changes nothing
    expect(inShop(() => repo().markRunning(9999, T3))).toBe(false);
    expect(inShop(() => repo().getById(9999))).toBeNull();
  });

  it("getOpenForTenant returns the prepared/running restore only", () => {
    expect(inShop(() => repo().getOpenForTenant(5))).toBeNull();
    const { id } = inShop(() => repo().createPrepared(input()));
    expect(inShop(() => repo().getOpenForTenant(5))!.id).toBe(id);
    inShop(() => repo().markRunning(id, T1));
    expect(inShop(() => repo().getOpenForTenant(5))!.id).toBe(id);
    expect(inShop(() => repo().getOpenForTenant(6))).toBeNull();
    inShop(() => repo().markDone(id, { finishedAt: T2, beforeCopyPath: null }));
    expect(inShop(() => repo().getOpenForTenant(5))).toBeNull();
  });

  it("the partial unique index refuses a second open restore for the same shop but allows another shop", () => {
    const first = inShop(() => repo().createPrepared(input()));
    expect(() => inShop(() => repo().createPrepared(input({ preparedAt: T1 })))).toThrow(
      /UNIQUE/i,
    );
    // still refused while running
    inShop(() => repo().markRunning(first.id, T1));
    expect(() => inShop(() => repo().createPrepared(input({ preparedAt: T1 })))).toThrow(
      /UNIQUE/i,
    );
    // another shop is unaffected
    const other = inShop(() => repo().createPrepared(input({ targetTenantId: 6 })));
    expect(other.target_tenant_id).toBe(6);
    // once closed, a new one is allowed
    inShop(() => repo().markFailed(first.id, "x", T2));
    const next = inShop(() => repo().createPrepared(input({ preparedAt: T3 })));
    expect(next.status).toBe("prepared");
    expect(platformCount()).toBe(3);
  });

  it("latestDone picks the newest done restore of that shop", () => {
    expect(inShop(() => repo().latestDone(5))).toBeNull();
    const done = (tenantId: number, at: string): number => {
      const { id } = inShop(() => repo().createPrepared(input({ targetTenantId: tenantId, preparedAt: at })));
      inShop(() => repo().markRunning(id, at));
      inShop(() => repo().markDone(id, { finishedAt: at, beforeCopyPath: `/b/${id}` }));
      return id;
    };
    done(5, T0);
    const newest = done(5, T1);
    done(6, T2);
    // a later failed one is not "done"
    const failed = inShop(() => repo().createPrepared(input({ preparedAt: T3 })));
    inShop(() => repo().markFailed(failed.id, "x", T3));
    expect(inShop(() => repo().latestDone(5))!.id).toBe(newest);
  });

  it("listBeforeCopies returns done rows with a copy, for that shop, since the date, newest first", () => {
    const done = (tenantId: number, at: string, copy: string | null): number => {
      const { id } = inShop(() => repo().createPrepared(input({ targetTenantId: tenantId, preparedAt: at })));
      inShop(() => repo().markRunning(id, at));
      inShop(() => repo().markDone(id, { finishedAt: at, beforeCopyPath: copy }));
      return id;
    };
    done(5, "2026-11-01T10:00:00.000Z", "/b/old"); // before the window
    const a = done(5, "2026-11-05T10:00:00.000Z", "/b/a");
    done(5, "2026-11-06T10:00:00.000Z", null); // no copy
    const b = done(5, "2026-11-07T10:00:00.000Z", "/b/b");
    done(6, "2026-11-08T10:00:00.000Z", "/b/other-shop");
    const list = inShop(() => repo().listBeforeCopies(5, "2026-11-03T00:00:00.000Z"));
    expect(list.map((r) => r.id)).toEqual([b, a]);
    expect(list.map((r) => r.before_copy_path)).toEqual(["/b/b", "/b/a"]);
  });

  it("listPreparedOlderThan lists only prepared rows prepared before the instant", () => {
    const oldOne = inShop(() => repo().createPrepared(input({ preparedAt: "2026-11-10T07:00:00.000Z" })));
    const fresh = inShop(() =>
      repo().createPrepared(input({ targetTenantId: 6, preparedAt: "2026-11-10T07:50:00.000Z" })),
    );
    expect(fresh.status).toBe("prepared");
    const list = inShop(() => repo().listPreparedOlderThan("2026-11-10T07:45:00.000Z"));
    expect(list.map((r) => r.id)).toEqual([oldOne.id]);
    inShop(() => repo().markRunning(oldOne.id, T0));
    expect(inShop(() => repo().listPreparedOlderThan("2026-11-10T07:45:00.000Z"))).toEqual([]);
  });
});
