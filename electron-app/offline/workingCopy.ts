/**
 * LIRA-306 — the PC's working copy `offline-work.db` (FR-008, FR-008a,
 * FR-012; data-model "Id layout").
 *
 * go-offline: the newest verified copy is copied (never opened for writing
 * in place), stamped with the PC number, and `sqlite_sequence` is seeded for
 * EVERY `OFFLINE_ID_TABLES` table so the next row gets
 * `P·10¹² + T·10⁹ + (lastUsed + 1)`, where lastUsed is the highest of:
 * pairing.json's counters, the finished copies' sequences, and the server's
 * per-table maximum for THIS PC from check-in. An existing working copy is
 * never overwritten (resume instead).
 *
 * finishing: the counters are merged into pairing.json (they only grow) and
 * the file moves to `finished/offline-work-<ts>.db` (newest 3 kept), so a
 * second outage on a fresh copy continues the ids.
 */
import fs from "node:fs";
import path from "node:path";
import {
  OFFLINE_ID_FLOOR,
  OFFLINE_ID_TABLES,
  decodeOfflineId,
} from "@liratek/core";
import {
  fileStamp,
  finishedDir,
  listFinished,
  pruneFinished,
  readCopyInfo,
  workingCopyPath,
  type DatabaseCtor,
} from "./offlineFiles";

const TABLE_STRIDE = 1_000_000_000;

export class WorkingCopyExistsError extends Error {
  constructor(file: string) {
    super(
      `A working copy already exists (${path.basename(file)}) — it is resumed, never overwritten`,
    );
    this.name = "WorkingCopyExistsError";
  }
}

/** Per table: the highest counter `n` this PC used, read from a file's sqlite_sequence. */
export function readCounters(
  file: string,
  deviceNo: number,
  Ctor: DatabaseCtor,
): Record<string, number> {
  const db = new Ctor(file, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(`SELECT name, seq FROM sqlite_sequence`)
      .all() as Array<{ name: string; seq: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) {
      const d = decodeOfflineId(r.seq);
      if (!d || d.pc !== deviceNo || d.table !== r.name) continue;
      if (d.n > (out[r.name] ?? 0)) out[r.name] = d.n;
    }
    return out;
  } finally {
    db.close();
  }
}

function maxMerge(
  ...maps: Array<Record<string, number>>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) {
      if (Number.isSafeInteger(v) && v > (out[k] ?? 0)) out[k] = v;
    }
  }
  return out;
}

function serverCounters(
  deviceNo: number,
  server: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [table, id] of Object.entries(server)) {
    const d = decodeOfflineId(id);
    if (d && d.pc === deviceNo && d.table === table)
      out[table] = Math.max(out[table] ?? 0, d.n);
  }
  return out;
}

export interface CreateWorkingCopyInput {
  offlineDir: string;
  mirrorFile: string;
  deviceNo: number;
  /** when given, the copy must belong to this shop */
  tenantId?: number;
  pairingLastUsed: Record<string, number>;
  serverMaxOfflineIds: Record<string, number>;
  DatabaseCtor: DatabaseCtor;
  /** epoch ms */
  now: () => number;
}

export function createWorkingCopy(i: CreateWorkingCopyInput): {
  file: string;
  lastUsed: Record<string, number>;
} {
  const file = workingCopyPath(i.offlineDir);
  if (fs.existsSync(file)) throw new WorkingCopyExistsError(file);
  const info = readCopyInfo(i.mirrorFile, i.DatabaseCtor);
  if (!info)
    throw new Error("The copy has no identity — it cannot be used offline");
  if (i.tenantId !== undefined && info.tenantId !== i.tenantId) {
    throw new Error(
      "The copy belongs to another shop — it cannot be used offline",
    );
  }

  const finished = listFinished(i.offlineDir).map((f) =>
    readCounters(f, i.deviceNo, i.DatabaseCtor),
  );
  const lastUsed = maxMerge(
    i.pairingLastUsed,
    ...finished,
    serverCounters(i.deviceNo, i.serverMaxOfflineIds),
  );

  const part = `${file}.part`;
  fs.rmSync(part, { force: true });
  fs.copyFileSync(i.mirrorFile, part);
  const db = new i.DatabaseCtor(part);
  try {
    db.transaction(() => {
      const existing = new Set(
        (
          db
            .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
            .all() as Array<{ name: string }>
        ).map((r) => r.name),
      );
      const upd = db.prepare(
        `UPDATE sqlite_sequence SET seq = ? WHERE name = ?`,
      );
      const ins = db.prepare(
        `INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`,
      );
      OFFLINE_ID_TABLES.forEach((table, t) => {
        if (!existing.has(table)) return;
        const seq =
          i.deviceNo * OFFLINE_ID_FLOOR +
          t * TABLE_STRIDE +
          (lastUsed[table] ?? 0);
        if (upd.run(seq, table).changes === 0) ins.run(table, seq);
      });
      db.prepare(
        `UPDATE offline_copy_meta SET device_no = ?, opened_at = ?, updated_at = ?`,
      ).run(
        i.deviceNo,
        new Date(i.now()).toISOString(),
        new Date(i.now()).toISOString(),
      );
    })();
    db.pragma("journal_mode = WAL");
  } finally {
    db.close();
  }
  // WAL side files of the .part copy are checkpointed on close; rename the main file.
  fs.renameSync(part, file);
  return { file, lastUsed };
}

export interface FinishWorkingCopyInput {
  offlineDir: string;
  deviceNo: number;
  previousLastUsed: Record<string, number>;
  DatabaseCtor: DatabaseCtor;
  now: () => number;
}

/**
 * Merge the working copy's counters into the saved ones and move the file to
 * `finished/` (newest 3 kept). Returns the merged counters for pairing.json.
 * The caller has closed its connection to the working copy.
 */
export function finishWorkingCopy(
  i: FinishWorkingCopyInput,
): Record<string, number> {
  const file = workingCopyPath(i.offlineDir);
  if (!fs.existsSync(file)) return { ...i.previousLastUsed };
  const merged = maxMerge(
    i.previousLastUsed,
    readCounters(file, i.deviceNo, i.DatabaseCtor),
  );
  const dest = path.join(
    finishedDir(i.offlineDir),
    `offline-work-${fileStamp(i.now())}.db`,
  );
  fs.mkdirSync(finishedDir(i.offlineDir), { recursive: true });
  fs.renameSync(file, dest);
  for (const side of ["-wal", "-shm"]) {
    if (fs.existsSync(file + side)) fs.renameSync(file + side, dest + side);
  }
  pruneFinished(i.offlineDir);
  return merged;
}
