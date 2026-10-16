/**
 * LIRA-306 — which mode the desktop boots into (plan diagram B; FR-007,
 * FR-008, FR-008a; research R14). PURE: main.ts reads pairing.json and the
 * `offline_copy_meta` row of the working copy and of each downloaded copy,
 * then asks this module what to do.
 *
 *   never paired                → standalone (today's app, unchanged)
 *   paired + working copy       → offline (resume — never overwritten), or
 *                                 finishing when that was the mode
 *   paired + ready copy         → standby (newest copy, read-only)
 *   paired + no usable copy     → blocked (standby screen explains why)
 *
 * Paired modes never open the standalone database (`resolveDatabasePath()`,
 * the `db-path.txt` UNC share) and skip migrations, the admin seed, backups,
 * licence sync, the db-path rollback, the SQLCipher key, preset seeding, the
 * loto monthly fee and the DB part of session cleanup — each of those would
 * write a row no event explains (N5) or touch a file that is not this PC's.
 * The shop id comes from the copy, never the hard-coded 1.
 */
import path from "node:path";
import type { PairingFile } from "./pairingStore.js";

export type OfflineMode =
  | "standalone"
  | "standby"
  | "blocked"
  | "offline"
  | "finishing";

/** What main.ts read from one copy's `offline_copy_meta`. */
export interface CopyInfo {
  file: string;
  copyId: string;
  tenantId: number;
  schemaVersion: number;
  builtAt: string;
}

export interface BootInputs {
  /** `<userData>/offline` — every paired-mode file must be inside it */
  offlineDir: string;
  pairing: PairingFile | null;
  workingCopy: CopyInfo | null;
  /** verified copies, newest first */
  mirrors: CopyInfo[];
  appSchemaVersion: number;
  now: Date;
}

export interface BootSteps {
  resolveStandalonePath: boolean;
  dbPathRollback: boolean;
  sqlCipherKey: boolean;
  runMigrations: boolean;
  seedAdmin: boolean;
  seedPresets: boolean;
  hourlyBackup: boolean;
  licenseSync: boolean;
  autoUpdateCheck: boolean;
  lotoMonthlyFee: boolean;
  sessionDbCleanup: boolean;
}

export interface BootDecision {
  mode: OfflineMode;
  /** null = standalone (resolveDatabasePath decides) or no file at all */
  dbFile: string | null;
  readonly: boolean;
  tenantId: number;
  ready: boolean;
  notReadyReason: string | null;
  copyAgeWarning: boolean;
  resumed: boolean;
  steps: BootSteps;
}

const STANDALONE_STEPS: BootSteps = {
  resolveStandalonePath: true,
  dbPathRollback: true,
  sqlCipherKey: true,
  runMigrations: true,
  seedAdmin: true,
  seedPresets: true,
  hourlyBackup: true,
  licenseSync: true,
  autoUpdateCheck: true,
  lotoMonthlyFee: true,
  sessionDbCleanup: true,
};

const PAIRED_STEPS: BootSteps = Object.fromEntries(
  Object.keys(STANDALONE_STEPS).map((k) => [k, false]),
) as unknown as BootSteps;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isUncPath(p: string): boolean {
  return p.startsWith("\\\\") || p.startsWith("//");
}

/** Inside `<userData>/offline`, local, not a share. */
export function isOwnOfflineFile(offlineDir: string, file: string): boolean {
  if (isUncPath(file)) return false;
  const rel = path.relative(path.resolve(offlineDir), path.resolve(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function versionReason(app: number, copy: number): string {
  return `This PC's app (data version ${app}) does not match its copy (version ${copy}) — install the matching update`;
}

export function decideBoot(i: BootInputs): BootDecision {
  if (!i.pairing) {
    return {
      mode: "standalone",
      dbFile: null,
      readonly: false,
      tenantId: 1,
      ready: false,
      notReadyReason: null,
      copyAgeWarning: false,
      resumed: false,
      steps: { ...STANDALONE_STEPS },
    };
  }

  const p = i.pairing;
  const base = {
    tenantId: p.tenantId,
    copyAgeWarning: false,
    resumed: false,
    steps: { ...PAIRED_STEPS },
  };
  const blocked = (reason: string): BootDecision => ({
    ...base,
    mode: "blocked",
    dbFile: null,
    readonly: true,
    ready: false,
    notReadyReason: reason,
  });

  // A working copy always wins (FR-008a): resume it, never overwrite it.
  if (i.workingCopy) {
    const w = i.workingCopy;
    if (!isOwnOfflineFile(i.offlineDir, w.file)) {
      return blocked(
        "The working copy is not in this PC's own folder — it is never opened from a share",
      );
    }
    if (w.tenantId !== p.tenantId) {
      return blocked(
        "The working copy belongs to another shop — it is left untouched",
      );
    }
    if (w.schemaVersion !== i.appSchemaVersion) {
      // R9: waits untouched until the matching app version runs.
      return blocked(versionReason(i.appSchemaVersion, w.schemaVersion));
    }
    return {
      ...base,
      mode: p.mode === "finishing" ? "finishing" : "offline",
      dbFile: w.file,
      readonly: false,
      ready: true,
      notReadyReason: null,
      resumed: true,
    };
  }

  const usable = i.mirrors.filter(
    (m) => isOwnOfflineFile(i.offlineDir, m.file) && m.tenantId === p.tenantId,
  );
  const newest = usable[0];
  if (!newest) {
    return blocked(
      i.mirrors.length === 0
        ? "No copy of the shop on this PC yet — it downloads one while the internet works"
        : "No usable copy of this shop on this PC",
    );
  }
  if (newest.schemaVersion !== i.appSchemaVersion) {
    return blocked(versionReason(i.appSchemaVersion, newest.schemaVersion));
  }

  let ready = true;
  let notReadyReason: string | null = null;
  if (
    p.serverSchemaVersion !== null &&
    p.serverSchemaVersion !== i.appSchemaVersion
  ) {
    ready = false;
    notReadyReason = `The server's data version (${p.serverSchemaVersion}) differs from this PC's app (${i.appSchemaVersion}) — install the update`;
  } else if (p.lastPeriod) {
    const settled = p.lastPeriod.settledAt;
    if (!settled || Date.parse(newest.builtAt) <= Date.parse(settled)) {
      ready = false;
      notReadyReason =
        "Waiting for a fresh copy that includes this PC's last offline work";
    }
  }

  return {
    ...base,
    mode: "standby",
    dbFile: newest.file,
    readonly: true,
    ready,
    notReadyReason,
    copyAgeWarning: i.now.getTime() - Date.parse(newest.builtAt) > DAY_MS,
  };
}
