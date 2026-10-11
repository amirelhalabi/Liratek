/**
 * LIRA-306 T117 — the desktop boot decision (FR-007, FR-008, FR-008a; plan
 * diagram B). Pure: the inputs are what main.ts reads from disk (pairing.json,
 * the working copy's and the copies' `offline_copy_meta`), the output names
 * the mode, the ONE file to open, the shop (tenant) id and which of today's
 * start-up steps run.
 */
import path from "node:path";
import { decideBoot, type BootInputs, type CopyInfo } from "../bootDecision";
import type { PairingFile } from "../pairingStore";

const DIR = path.join("/", "Users", "x", "AppData", "LiraTek", "offline");
const APP_VERSION = 210;

function pairing(over: Partial<PairingFile> = {}): PairingFile {
  return {
    tenantId: 7,
    shopSlug: "cornertech",
    shopName: "Corner Tech",
    serverUrl: "https://api.liratek.shop",
    deviceNo: 3,
    deviceKeyEncrypted: "ZW5j",
    mode: "standby",
    lastSeq: 0,
    lastUsedIds: {},
    serverSchemaVersion: APP_VERSION,
    serverMaxSeq: 0,
    serverMaxOfflineIds: {},
    lastPeriod: null,
    ...over,
  };
}

function copy(over: Partial<CopyInfo> = {}): CopyInfo {
  return {
    file: path.join(DIR, "mirror-20261011T100000Z.db"),
    copyId: "11111111-1111-4111-8111-111111111111",
    tenantId: 7,
    schemaVersion: APP_VERSION,
    builtAt: "2026-10-11T10:00:00.000Z",
    ...over,
  };
}

function inputs(over: Partial<BootInputs> = {}): BootInputs {
  return {
    offlineDir: DIR,
    pairing: pairing(),
    workingCopy: null,
    mirrors: [copy()],
    appSchemaVersion: APP_VERSION,
    now: new Date("2026-10-11T10:03:00.000Z"),
    ...over,
  };
}

const ALL_PAIRED_STEPS_OFF = {
  resolveStandalonePath: false,
  dbPathRollback: false,
  sqlCipherKey: false,
  runMigrations: false,
  seedAdmin: false,
  seedPresets: false,
  hourlyBackup: false,
  licenseSync: false,
  autoUpdateCheck: false,
  lotoMonthlyFee: false,
  sessionDbCleanup: false,
};

describe("decideBoot — never paired", () => {
  it("standalone: today's app, every step on, no file chosen here (resolveDatabasePath decides)", () => {
    const d = decideBoot(inputs({ pairing: null, mirrors: [] }));
    expect(d.mode).toBe("standalone");
    expect(d.dbFile).toBeNull();
    expect(d.tenantId).toBe(1);
    expect(Object.values(d.steps).every((v) => v === true)).toBe(true);
  });

  it("standalone even if stray offline files exist (they are not read without a pairing)", () => {
    const d = decideBoot(
      inputs({
        pairing: null,
        workingCopy: copy({ file: path.join(DIR, "offline-work.db") }),
      }),
    );
    expect(d.mode).toBe("standalone");
  });
});

describe("decideBoot — paired", () => {
  it("standby: newest copy, read-only, tenant from the COPY, every standalone step off", () => {
    const d = decideBoot(
      inputs({
        mirrors: [
          copy({ tenantId: 7 }),
          copy({ file: path.join(DIR, "mirror-old.db") }),
        ],
      }),
    );
    expect(d.mode).toBe("standby");
    expect(d.dbFile).toBe(path.join(DIR, "mirror-20261011T100000Z.db"));
    expect(d.readonly).toBe(true);
    expect(d.tenantId).toBe(7);
    expect(d.ready).toBe(true);
    expect(d.steps).toEqual(ALL_PAIRED_STEPS_OFF);
  });

  it("blocked on first boot (no copy yet): no file, not ready, says why", () => {
    const d = decideBoot(inputs({ mirrors: [] }));
    expect(d.mode).toBe("blocked");
    expect(d.dbFile).toBeNull();
    expect(d.ready).toBe(false);
    expect(d.notReadyReason).toMatch(/no copy/i);
    expect(d.steps).toEqual(ALL_PAIRED_STEPS_OFF);
    expect(d.tenantId).toBe(7);
  });

  it("version mismatch app ≠ copy → blocked, not ready", () => {
    const d = decideBoot(
      inputs({ mirrors: [copy({ schemaVersion: APP_VERSION - 1 })] }),
    );
    expect(d.mode).toBe("blocked");
    expect(d.ready).toBe(false);
    expect(d.notReadyReason).toMatch(/version/i);
  });

  it("version mismatch app ≠ server's last reported → standby but not ready (copy still shown)", () => {
    const d = decideBoot(
      inputs({ pairing: pairing({ serverSchemaVersion: APP_VERSION + 1 }) }),
    );
    expect(d.ready).toBe(false);
    expect(d.notReadyReason).toMatch(/version/i);
  });

  it("a copy of another shop is never used", () => {
    const d = decideBoot(inputs({ mirrors: [copy({ tenantId: 8 })] }));
    expect(d.mode).toBe("blocked");
    expect(d.dbFile).toBeNull();
    expect(d.ready).toBe(false);
  });

  it("ready requires a copy built after the last offline period settled on the server", () => {
    const open = decideBoot(
      inputs({
        pairing: pairing({
          lastPeriod: {
            finishedAt: "2026-10-11T09:00:00.000Z",
            settledAt: null,
          },
        }),
      }),
    );
    expect(open.ready).toBe(false);
    expect(open.notReadyReason).toMatch(/fresh copy/i);
    const settledAfterCopy = decideBoot(
      inputs({
        pairing: pairing({
          lastPeriod: {
            finishedAt: "2026-10-11T09:00:00.000Z",
            settledAt: "2026-10-11T10:01:00.000Z",
          },
        }),
      }),
    );
    expect(settledAfterCopy.ready).toBe(false);
    const copyAfterSettle = decideBoot(
      inputs({
        pairing: pairing({
          lastPeriod: {
            finishedAt: "2026-10-11T09:00:00.000Z",
            settledAt: "2026-10-11T09:30:00.000Z",
          },
        }),
      }),
    );
    expect(copyAfterSettle.ready).toBe(true);
  });

  it("a copy older than 24 h is still ready, with a warning", () => {
    const d = decideBoot(inputs({ now: new Date("2026-10-12T11:00:00.000Z") }));
    expect(d.ready).toBe(true);
    expect(d.copyAgeWarning).toBe(true);
  });

  it("an existing working copy → offline (resume, never overwritten), tenant from the working copy", () => {
    const work = copy({
      file: path.join(DIR, "offline-work.db"),
      tenantId: 7,
      copyId: "22222222-2222-4222-8222-222222222222",
    });
    const d = decideBoot(
      inputs({ workingCopy: work, pairing: pairing({ mode: "standby" }) }),
    );
    expect(d.mode).toBe("offline");
    expect(d.dbFile).toBe(path.join(DIR, "offline-work.db"));
    expect(d.readonly).toBe(false);
    expect(d.resumed).toBe(true);
    expect(d.steps).toEqual(ALL_PAIRED_STEPS_OFF);
  });

  it("an existing working copy with mode finishing → finishing on the same file", () => {
    const work = copy({ file: path.join(DIR, "offline-work.db") });
    const d = decideBoot(
      inputs({ workingCopy: work, pairing: pairing({ mode: "finishing" }) }),
    );
    expect(d.mode).toBe("finishing");
    expect(d.dbFile).toBe(path.join(DIR, "offline-work.db"));
  });

  it("a working copy left by another app version waits untouched → blocked, file not opened", () => {
    const work = copy({
      file: path.join(DIR, "offline-work.db"),
      schemaVersion: APP_VERSION - 1,
    });
    const d = decideBoot(inputs({ workingCopy: work }));
    expect(d.mode).toBe("blocked");
    expect(d.dbFile).toBeNull();
    expect(d.notReadyReason).toMatch(/version/i);
  });

  it("never opens a file outside the PC's offline folder, nor a UNC path", () => {
    for (const bad of [
      "\\\\shop-server\\LiraTek\\liratek.db",
      "//shop-server/LiraTek/liratek.db",
      "/Users/x/Documents/LiraTek/liratek.db",
    ]) {
      const d = decideBoot(inputs({ mirrors: [copy({ file: bad })] }));
      expect(d.dbFile).toBeNull();
      expect(d.mode).toBe("blocked");
      const w = decideBoot(inputs({ workingCopy: copy({ file: bad }) }));
      expect(w.dbFile).toBeNull();
      expect(w.mode).toBe("blocked");
    }
  });

  it("the shop id never falls back to 1 in a paired mode", () => {
    for (const d of [
      decideBoot(inputs()),
      decideBoot(inputs({ mirrors: [] })),
      decideBoot(
        inputs({
          workingCopy: copy({ file: path.join(DIR, "offline-work.db") }),
        }),
      ),
    ]) {
      expect(d.tenantId).toBe(7);
    }
  });
});
