/**
 * LIRA-306 T123 — the working copy (FR-008a, FR-012; data-model "Id layout").
 * Real better-sqlite3 (Node ABI) on the real schema (`create_db.sql`).
 *
 *  - go-offline copies the newest copy, writes `offline_copy_meta.device_no`;
 *  - `sqlite_sequence` is seeded for EVERY `OFFLINE_ID_TABLES` table from the
 *    max of pairing.json's counters, the finished copies and the server's
 *    maxima for this PC → a new sale gets `P·10¹²+T·10⁹+n`;
 *  - an existing working copy is never overwritten; resume keeps sequences;
 *  - counters are persisted on finish, so a SECOND outage on a fresh copy
 *    continues the ids (no restart at 1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  OFFLINE_ID_TABLES,
  encodeOfflineId,
  offlineTableIndex,
} from "@liratek/core";
import {
  createWorkingCopy,
  finishWorkingCopy,
  readCounters,
  WorkingCopyExistsError,
} from "../workingCopy";
import { listFinished, workingCopyPath } from "../offlineFiles";

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "../../create_db.sql"),
  "utf8",
);
const P = 3;
const T_SALES = offlineTableIndex("sales");
const T_CLIENTS = offlineTableIndex("clients");

let dir = "";

function makeMirror(name: string, opts: { serverSales?: number } = {}): string {
  const file = path.join(dir, name);
  const db = new Database(file);
  db.exec(SCHEMA);
  db.exec(
    `INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (7, 'Corner Tech', 'cornertech', 'active')`,
  );
  for (let i = 0; i < (opts.serverSales ?? 2); i++) {
    db.prepare(
      `INSERT INTO sales (tenant_id, total_amount_usd, status) VALUES (7, 10, 'completed')`,
    ).run();
  }
  db.prepare(
    `INSERT INTO offline_copy_meta (tenant_id, copy_id, built_at, schema_version, high_water_json, created_at, updated_at)
     VALUES (7, ?, '2026-10-11T10:00:00.000Z', 210, '{}', 'x', 'x')`,
  ).run(
    `c0000000-0000-4000-8000-${name.replace(/\D/g, "").padStart(12, "0").slice(-12)}`,
  );
  db.close();
  return file;
}

function insertSale(file: string): number {
  const db = new Database(file);
  try {
    return Number(
      db
        .prepare(
          `INSERT INTO sales (tenant_id, total_amount_usd, status) VALUES (7, 5, 'completed')`,
        )
        .run().lastInsertRowid,
    );
  } finally {
    db.close();
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lira306-work-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("createWorkingCopy", () => {
  it("copies the newest copy, stamps the PC number, and seeds every id-range table", () => {
    const mirror = makeMirror("mirror-20261011T100000000Z.db");
    const r = createWorkingCopy({
      offlineDir: dir,
      mirrorFile: mirror,
      deviceNo: P,
      pairingLastUsed: {},
      serverMaxOfflineIds: {},
      DatabaseCtor: Database,
      now: () => Date.parse("2026-10-11T10:06:00.000Z"),
    });
    expect(r.file).toBe(workingCopyPath(dir));
    const db = new Database(r.file, { readonly: true });
    try {
      expect(
        db.prepare(`SELECT device_no, opened_at FROM offline_copy_meta`).get(),
      ).toEqual({
        device_no: P,
        opened_at: "2026-10-11T10:06:00.000Z",
      });
      const seq = new Map(
        (
          db.prepare(`SELECT name, seq FROM sqlite_sequence`).all() as Array<{
            name: string;
            seq: number;
          }>
        ).map((x) => [x.name, x.seq]),
      );
      const existing = new Set(
        (
          db
            .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
            .all() as Array<{ name: string }>
        ).map((x) => x.name),
      );
      for (const t of OFFLINE_ID_TABLES) {
        if (!existing.has(t)) continue;
        expect({ t, seq: seq.get(t) }).toEqual({
          t,
          seq: P * 1e12 + offlineTableIndex(t) * 1e9,
        });
      }
    } finally {
      db.close();
    }
    // the copy itself is untouched
    const m = new Database(mirror, { readonly: true });
    expect(
      (
        m.prepare(`SELECT device_no FROM offline_copy_meta`).get() as {
          device_no: number | null;
        }
      ).device_no,
    ).toBeNull();
    m.close();
  });

  it("a new sale gets P·10¹²+T·10⁹+1", () => {
    const mirror = makeMirror("mirror-20261011T100000000Z.db");
    const r = createWorkingCopy({
      offlineDir: dir,
      mirrorFile: mirror,
      deviceNo: P,
      pairingLastUsed: {},
      serverMaxOfflineIds: {},
      DatabaseCtor: Database,
      now: Date.now,
    });
    expect(insertSale(r.file)).toBe(encodeOfflineId(P, T_SALES, 1));
  });

  it("n continues from the highest of pairing.json, finished copies and the server's maxima for THIS PC", () => {
    fs.mkdirSync(path.join(dir, "finished"));
    // a finished copy whose sales counter reached 9
    const fin = makeMirror("finished/offline-work-20261010T100000000Z.db");
    const f = new Database(fin);
    f.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = 'sales'`).run(
      encodeOfflineId(P, T_SALES, 9),
    );
    f.close();
    const mirror = makeMirror("mirror-20261011T100000000Z.db");
    const r = createWorkingCopy({
      offlineDir: dir,
      mirrorFile: mirror,
      deviceNo: P,
      pairingLastUsed: { sales: 4, clients: 2 },
      serverMaxOfflineIds: {
        clients: encodeOfflineId(P, T_CLIENTS, 6),
        sales: encodeOfflineId(4, T_SALES, 500), // another PC — ignored
      },
      DatabaseCtor: Database,
      now: Date.now,
    });
    expect(insertSale(r.file)).toBe(encodeOfflineId(P, T_SALES, 10));
    const db = new Database(r.file);
    const cid = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (7, 'Rami', '70123456')`,
        )
        .run().lastInsertRowid,
    );
    db.close();
    expect(cid).toBe(encodeOfflineId(P, T_CLIENTS, 7));
  });

  it("never overwrites an existing working copy (resume instead)", () => {
    const mirror = makeMirror("mirror-20261011T100000000Z.db");
    const r = createWorkingCopy({
      offlineDir: dir,
      mirrorFile: mirror,
      deviceNo: P,
      pairingLastUsed: {},
      serverMaxOfflineIds: {},
      DatabaseCtor: Database,
      now: Date.now,
    });
    insertSale(r.file);
    expect(() =>
      createWorkingCopy({
        offlineDir: dir,
        mirrorFile: mirror,
        deviceNo: P,
        pairingLastUsed: {},
        serverMaxOfflineIds: {},
        DatabaseCtor: Database,
        now: Date.now,
      }),
    ).toThrow(WorkingCopyExistsError);
    // resume: the next sale continues
    expect(insertSale(r.file)).toBe(encodeOfflineId(P, T_SALES, 2));
  });

  it("refuses a copy of another shop or one without identity", () => {
    const mirror = makeMirror("mirror-20261011T100000000Z.db");
    expect(() =>
      createWorkingCopy({
        offlineDir: dir,
        mirrorFile: mirror,
        deviceNo: P,
        tenantId: 8,
        pairingLastUsed: {},
        serverMaxOfflineIds: {},
        DatabaseCtor: Database,
        now: Date.now,
      }),
    ).toThrow(/shop/);
    expect(fs.existsSync(workingCopyPath(dir))).toBe(false);
  });
});

describe("finishWorkingCopy and the second outage", () => {
  it("persists counters, moves the copy to finished/ (newest 3 kept), and a fresh copy continues the ids", () => {
    let lastUsed: Record<string, number> = {};
    for (let outage = 1; outage <= 4; outage++) {
      const mirror = makeMirror(`mirror-2026101${outage}T100000000Z.db`, {
        serverSales: outage + 1,
      });
      const r = createWorkingCopy({
        offlineDir: dir,
        mirrorFile: mirror,
        deviceNo: P,
        pairingLastUsed: lastUsed,
        serverMaxOfflineIds: {},
        DatabaseCtor: Database,
        now: Date.now,
      });
      expect(insertSale(r.file)).toBe(encodeOfflineId(P, T_SALES, outage));
      const counters = readCounters(r.file, P, Database);
      expect(counters.sales).toBe(outage);
      lastUsed = finishWorkingCopy({
        offlineDir: dir,
        deviceNo: P,
        previousLastUsed: lastUsed,
        DatabaseCtor: Database,
        now: () => Date.parse(`2026-10-1${outage}T11:00:00.000Z`),
      });
      expect(lastUsed.sales).toBe(outage);
      expect(fs.existsSync(workingCopyPath(dir))).toBe(false);
    }
    expect(listFinished(dir)).toHaveLength(3);
  });

  it("counters only grow (a lower counter in the copy never lowers pairing.json)", () => {
    const mirror = makeMirror("mirror-20261011T100000000Z.db");
    createWorkingCopy({
      offlineDir: dir,
      mirrorFile: mirror,
      deviceNo: P,
      pairingLastUsed: { sales: 50 },
      serverMaxOfflineIds: {},
      DatabaseCtor: Database,
      now: Date.now,
    });
    const merged = finishWorkingCopy({
      offlineDir: dir,
      deviceNo: P,
      previousLastUsed: { sales: 50, clients: 99 },
      DatabaseCtor: Database,
      now: Date.now,
    });
    expect(merged).toMatchObject({ sales: 50, clients: 99 });
  });
});
