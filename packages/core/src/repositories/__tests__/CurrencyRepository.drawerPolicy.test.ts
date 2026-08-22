/**
 * CurrencyRepository — drawer currency POLICY (plan:
 * docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md)
 *
 * Two invariants, both money-visibility invariants:
 *
 * 1. **General is unrestricted.** Its currency set is DERIVED (every active
 *    currency, plus anything it still holds), never read from
 *    `currency_drawers`. The Exchange module deposits any currency into
 *    General, so treating that table as a closed allowlist made the app
 *    contradict itself — an EUR exchange put EUR in General while a manual
 *    EUR cash-in was rejected as "not enabled for the General drawer".
 *    Provider drawers (Binance/Katsh/...) keep their real allowlist — the
 *    `Binance` assertion below is the guard that this did NOT open every
 *    drawer (owner decision D1).
 *
 * 2. **`currency_drawers` is no longer the sole drawer registry.** It used to
 *    be, which made deleting a drawer's allowlist rows delete the DRAWER from
 *    Settings/Opening. The registry is now unioned with `drawer_balances` and
 *    `UNRESTRICTED_DRAWERS`.
 *
 * Rule 17 — proven against the pre-fix code. On the old implementation:
 *   - "General offers EUR" fails (raw table read returns only USD, LBP),
 *   - "still holds a deactivated currency" fails (old query filtered
 *     `is_active = 1` with no balance escape hatch),
 *   - both registry tests fail (General vanishes once its rows are gone).
 * The `Binance` and `Loto` assertions pass before AND after — they exist to
 * catch an over-broad fix, so they must not be "improved" into failing ones.
 *
 * The fixture mirrors the owner's live DB (2026-08-22): General = USD,LBP
 * holding 1,100,000 LBP; Katsh = USD,LBP holding 2,957,925 LBP; EUR active
 * but linked only to the `exchange` module; Loto seeded with an allowlist but
 * no balances at all.
 */

import Database from "better-sqlite3";

import { CurrencyRepository } from "../CurrencyRepository";
import { runWithTenant } from "../../db/tenantContext";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'Tenant One', 'tenant-one');

    CREATE TABLE currencies (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER REFERENCES tenants(id),
      code           TEXT NOT NULL,
      name           TEXT NOT NULL,
      symbol         TEXT NOT NULL DEFAULT '',
      decimal_places INTEGER NOT NULL DEFAULT 2,
      is_active      BOOLEAN DEFAULT 1,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, code)
    );

    CREATE TABLE currency_drawers (
      tenant_id     INTEGER REFERENCES tenants(id),
      currency_code TEXT NOT NULL,
      drawer_name   TEXT NOT NULL,
      PRIMARY KEY (tenant_id, currency_code, drawer_name)
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER REFERENCES tenants(id),
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    -- Active currencies (mirrors the live DB) + one deactivated.
    INSERT INTO currencies (tenant_id, code, name, symbol, decimal_places, is_active) VALUES
      (1, 'USD',  'US Dollar',      '$',    2, 1),
      (1, 'LBP',  'Lebanese Pound', 'LBP',  0, 1),
      (1, 'EUR',  'Euro',           '€',    2, 1),
      (1, 'USDT', 'Tether USD',     'USDT', 2, 1),
      (1, 'GBP',  'Pound Sterling', '£',    2, 0);

    INSERT INTO currency_drawers (tenant_id, currency_code, drawer_name) VALUES
      (1, 'USD', 'General'),  (1, 'LBP', 'General'),
      (1, 'USD', 'Katsh'),    (1, 'LBP', 'Katsh'),
      (1, 'USDT', 'Binance'),
      -- Loto: allowlist rows but NEVER any balance row. The only proof that
      -- the registry still needs its currency_drawers half.
      (1, 'USD', 'Loto'),     (1, 'LBP', 'Loto');

    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES
      (1, 'General', 'LBP',  1100000),
      (1, 'General', 'USD',  0),
      (1, 'Katsh',   'LBP',  2957925),
      (1, 'Binance', 'USDT', 0);
  `);
  return db;
}

describe("CurrencyRepository — drawer currency policy", () => {
  let db: Database.Database;
  let repo: CurrencyRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    repo = new CurrencyRepository();
  });

  afterEach(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  // ─── 1. General is unrestricted ─────────────────────────────────────────

  it("General offers every ACTIVE currency, not just its currency_drawers rows", () => {
    const codes = runWithTenant(1, () => repo.getCurrenciesForDrawer("General"));

    // The whole point: EUR/USDT are active but have no General row.
    expect(codes).toEqual(["EUR", "LBP", "USD", "USDT"]);
  });

  it("General's FULL entities match the same derived set (this is what the top-up picker reads)", () => {
    const entities = runWithTenant(1, () =>
      repo.getFullCurrenciesForDrawer("General"),
    );

    expect(entities.map((c) => c.code)).toEqual(["EUR", "LBP", "USD", "USDT"]);
    // The picker renders symbols, so the entity shape must survive.
    expect(entities.find((c) => c.code === "EUR")?.symbol).toBe("€");
  });

  it("keeps a DEACTIVATED currency visible while the drawer still holds it", () => {
    // GBP is inactive and absent from every allowlist — but real cash.
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'General', 'GBP', 250)`,
    ).run();

    const codes = runWithTenant(1, () => repo.getCurrenciesForDrawer("General"));
    expect(codes).toContain("GBP");
  });

  it("does NOT resurrect a deactivated currency whose balance is zero", () => {
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'General', 'GBP', 0)`,
    ).run();

    const codes = runWithTenant(1, () => repo.getCurrenciesForDrawer("General"));
    expect(codes).not.toContain("GBP");
  });

  // ─── 2. Provider drawers stay restricted (decision D1) ──────────────────

  it("Binance still returns exactly USDT — the fix did not open every drawer", () => {
    const codes = runWithTenant(1, () => repo.getCurrenciesForDrawer("Binance"));
    expect(codes).toEqual(["USDT"]);
  });

  it("Katsh still returns exactly its allowlist", () => {
    const codes = runWithTenant(1, () => repo.getCurrenciesForDrawer("Katsh"));
    expect(codes).toEqual(["LBP", "USD"]);
  });

  it("getAllDrawerCurrencies derives General but leaves provider drawers alone", () => {
    const all = runWithTenant(1, () => repo.getAllDrawerCurrencies());

    expect(all["General"]).toEqual(["EUR", "LBP", "USD", "USDT"]);
    expect(all["Binance"]).toEqual(["USDT"]);
    expect(all["Katsh"]).toEqual(["LBP", "USD"]);
  });

  // ─── 3. The drawer registry survives an empty allowlist ─────────────────

  it("General stays registered even with ZERO currency_drawers rows", () => {
    db.prepare(
      `DELETE FROM currency_drawers WHERE drawer_name = 'General' AND tenant_id = 1`,
    ).run();

    const names = runWithTenant(1, () => repo.getConfiguredDrawerNames());
    const all = runWithTenant(1, () => repo.getAllDrawerCurrencies());

    expect(names).toContain("General");
    expect(Object.keys(all)).toContain("General");
    // ...and it still reports its derived set, not an empty list.
    expect(all["General"]).toEqual(["EUR", "LBP", "USD", "USDT"]);
  });

  it("a drawer holding money stays registered even with ZERO allowlist rows", () => {
    db.prepare(
      `DELETE FROM currency_drawers WHERE drawer_name = 'Katsh' AND tenant_id = 1`,
    ).run();

    const names = runWithTenant(1, () => repo.getConfiguredDrawerNames());
    expect(names).toContain("Katsh"); // kept alive by its 2,957,925 LBP row
  });

  it("Loto — allowlist rows but no balances — proves the registry needs BOTH halves", () => {
    const names = runWithTenant(1, () => repo.getConfiguredDrawerNames());
    expect(names).toContain("Loto");
  });

  // ─── 4. The "fact" read the Layer 2 guard depends on ────────────────────

  it("getNonZeroBalancesForDrawer reports held money and skips zero rows", () => {
    const held = runWithTenant(1, () =>
      repo.getNonZeroBalancesForDrawer("Katsh"),
    );
    expect(held).toEqual([{ currency_code: "LBP", balance: 2957925 }]);

    const general = runWithTenant(1, () =>
      repo.getNonZeroBalancesForDrawer("General"),
    );
    // General's USD row is 0 and must not be reported.
    expect(general).toEqual([{ currency_code: "LBP", balance: 1100000 }]);
  });

  it("treats a NEGATIVE balance as held money (the PCD may go negative)", () => {
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, 'OMT_System', 'USD', -500)`,
    ).run();

    const held = runWithTenant(1, () =>
      repo.getNonZeroBalancesForDrawer("OMT_System"),
    );
    expect(held).toEqual([{ currency_code: "USD", balance: -500 }]);
  });
});
