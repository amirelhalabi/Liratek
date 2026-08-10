/**
 * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 2 — characterization
 * test for `FinancialServiceRepository.mapDrawerName`.
 *
 * Discipline (CLAUDE.md rule 17's mirror-image, per the task brief): this is
 * a BEHAVIOUR-NEUTRAL refactor, not a bugfix, so the failing-first proof does
 * NOT apply. Instead:
 *
 *   1. This file is written and run FIRST, against the pre-phase-2 hardcoded
 *      switch. It must pass unmodified.
 *   2. `mapDrawerName` is then switched to read `service_providers` via
 *      `ServiceProviderRepository.getByCode()`, keeping the switch as the
 *      offline/missing-row fallback (same shape as
 *      `paymentMethodToDrawerName()` in `utils/payments.ts`).
 *   3. This file is run AGAIN, byte-for-byte unchanged. If any expectation
 *      here needed editing to pass, the refactor changed behaviour — that
 *      would be a bug, not a green light to update the test.
 *
 * `describe.each` below runs the SAME 9-provider + 1-unknown assertion set
 * against three DB shapes that must all resolve identically both before and
 * after the switch:
 *   - "seeded"  — service_providers exists and is seeded exactly like the
 *     migration seeds it (proves table-driven resolution once wired).
 *   - "missing" — service_providers table does not exist at all (proves the
 *     offline fallback: `.prepare()` throws, mapDrawerName must catch it).
 *   - "empty"   — service_providers table exists but has zero rows (proves
 *     the missing-row fallback: `getByCode()` resolves `undefined`, no
 *     exception, mapDrawerName must still fall through to the switch).
 *
 * `mapDrawerName` is private — accessed via `as any`, the established
 * pattern in this codebase for characterizing an internal method without
 * routing through a full `createTransaction()` round trip.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import type { CreateFinancialServiceData } from "../FinancialServiceRepository";
import { resetServiceProviderRepository } from "../ServiceProviderRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── Mock DB connection (mirrors FinancialServiceRepository.forPartnerDebtDrawer.test.ts) ───

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
    clearDb: () => {
      _db = null;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setDb, clearDb } = jest.requireMock("../../db/connection") as {
  setDb: (db: Database.Database) => void;
  clearDb: () => void;
};

const SERVICE_PROVIDERS_SCHEMA = `
  CREATE TABLE service_providers (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id          INTEGER,
    code               TEXT NOT NULL,
    label              TEXT NOT NULL,
    drawer_name        TEXT NOT NULL,
    is_system_provider INTEGER NOT NULL DEFAULT 0,
    is_active          INTEGER NOT NULL DEFAULT 1,
    is_system          INTEGER NOT NULL DEFAULT 0,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, code)
  );
`;

// Exactly the migration v153 / create_db.sql seed — see
// packages/core/src/db/migrations/index.ts (version 153) and
// electron-app/create_db.sql's "9b. Service Providers" section.
const SEED_ROWS: [string, string, string, number, number][] = [
  ["OMT", "OMT", "OMT_System", 1, 0],
  ["WHISH", "Whish", "Whish_System", 1, 1],
  ["BOB", "BOB", "General", 0, 2],
  ["OTHER", "Other", "General", 0, 3],
  ["iPick", "iPick", "iPick", 0, 4],
  ["Katsh", "Katsh", "Katsh", 0, 5],
  ["WHISH_APP", "Whish App", "Whish_App", 0, 6],
  ["OMT_APP", "OMT App", "OMT_App", 0, 7],
  ["BINANCE", "Binance", "Binance", 0, 8],
];

function seedServiceProviders(db: Database.Database): void {
  const stmt = db.prepare(
    `INSERT INTO service_providers (tenant_id, code, label, drawer_name, is_system_provider, is_active, is_system, sort_order)
     VALUES (1, ?, ?, ?, ?, 1, 1, ?)`,
  );
  for (const [code, label, drawerName, isSystemProvider, sortOrder] of SEED_ROWS) {
    stmt.run(code, label, drawerName, isSystemProvider, sortOrder);
  }
}

// The 9 real provider codes plus one code that will never be seeded/known —
// exercises the "unknown/absent provider" branch (task requirement).
const PROVIDERS: CreateFinancialServiceData["provider"][] = [
  "OMT",
  "WHISH",
  "BOB",
  "OTHER",
  "iPick",
  "Katsh",
  "WHISH_APP",
  "OMT_APP",
  "BINANCE",
];
const UNKNOWN_PROVIDER = "SYRIA";

const EXPECTED_DRAWER: Record<string, string> = {
  OMT: "OMT_System",
  WHISH: "Whish_System",
  BOB: "General",
  OTHER: "General",
  iPick: "iPick",
  Katsh: "Katsh",
  WHISH_APP: "Whish_App",
  OMT_APP: "OMT_App",
  BINANCE: "Binance",
  SYRIA: "General", // unknown/absent provider must still fall to General
};

/** Invoke the private `mapDrawerName` method without a full createTransaction() round trip. */
function mapDrawerName(
  repo: FinancialServiceRepository,
  provider: string,
): string {
  return (repo as unknown as { mapDrawerName: (p: string) => string }).mapDrawerName(
    provider,
  );
}

describe("FinancialServiceRepository.mapDrawerName — provider-taxonomy characterization (plan §5b phase 2)", () => {
  afterEach(() => {
    clearDb();
    resetServiceProviderRepository();
    resetTenantContext();
  });

  describe.each([
    {
      label: "seeded (service_providers exists, seeded exactly like the migration)",
      buildDb: () => {
        const db = new Database(":memory:");
        db.exec(SERVICE_PROVIDERS_SCHEMA);
        seedServiceProviders(db);
        return db;
      },
    },
    {
      label: "missing (service_providers table does not exist)",
      buildDb: () => new Database(":memory:"),
    },
    {
      label: "empty (service_providers table exists, zero rows)",
      buildDb: () => {
        const db = new Database(":memory:");
        db.exec(SERVICE_PROVIDERS_SCHEMA);
        return db;
      },
    },
  ])("$label", ({ buildDb }) => {
    it.each([...PROVIDERS, UNKNOWN_PROVIDER])(
      "resolves provider %s to its expected drawer",
      (provider) => {
        setDb(buildDb());
        initFixedTenantContext(1);
        const repo = new FinancialServiceRepository();

        expect(mapDrawerName(repo, provider)).toBe(EXPECTED_DRAWER[provider]);
      },
    );
  });

  it("resolves all 9 known providers + 1 unknown in a single pass (belt-and-suspenders — same assertions, one test)", () => {
    setDb((() => {
      const db = new Database(":memory:");
      db.exec(SERVICE_PROVIDERS_SCHEMA);
      seedServiceProviders(db);
      return db;
    })());
    initFixedTenantContext(1);
    const repo = new FinancialServiceRepository();

    for (const provider of [...PROVIDERS, UNKNOWN_PROVIDER]) {
      expect(mapDrawerName(repo, provider)).toBe(EXPECTED_DRAWER[provider]);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Added AFTER the phase-2 switch (not part of the before/after-unchanged
  // characterization set above — this one can only pass once mapDrawerName
  // actually reads the table). The "seeded" cases above are consistent with
  // BOTH "reads the table" and "always falls to the switch" because the
  // seed intentionally mirrors the switch's own values. This test seeds a
  // DELIBERATELY DIVERGENT drawer_name and asserts it wins over the
  // hardcoded switch, proving the table is genuinely being read, not just
  // coincidentally agreeing with the fallback.
  // ═══════════════════════════════════════════════════════════════════════
  it("(post-switch proof) a row whose drawer_name diverges from the hardcoded switch is honored — proves genuine table-driven resolution", () => {
    const db = new Database(":memory:");
    db.exec(SERVICE_PROVIDERS_SCHEMA);
    db.prepare(
      `INSERT INTO service_providers (tenant_id, code, label, drawer_name, is_system_provider, is_active, is_system, sort_order)
       VALUES (1, 'OMT', 'OMT', 'Some_Other_Drawer', 1, 1, 1, 0)`,
    ).run();
    setDb(db);
    initFixedTenantContext(1);
    const repo = new FinancialServiceRepository();

    // The hardcoded switch would say "OMT_System" — the seeded row must win.
    expect(mapDrawerName(repo, "OMT")).toBe("Some_Other_Drawer");
    expect(mapDrawerName(repo, "OMT")).not.toBe("OMT_System");
  });
});
