/**
 * CurrencyRepository — the COUNT-SHEET set for a drawer
 * (docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md, item 8, decisions
 * D2 + D5).
 *
 * `getCurrenciesForDrawer` (the pre-existing, `drawerPolicy.test.ts`-covered
 * method) answers "what does this drawer ACCEPT / DISPLAY" — for General
 * that is every active currency, which is exactly the item-8 bug: an
 * unrestricted drawer with all 4 shop currencies active offered a count
 * field for every one of them, including two at a permanent zero balance,
 * and double-counted the fourth once `Checkpoint/index.tsx` unioned it in a
 * second time.
 *
 * `getCountableCurrenciesForDrawer` / `getCountableCurrenciesByDrawer` are a
 * DIFFERENT question: "what must the count sheet show" —
 *
 *   base ∪ {currencies holding a NON-ZERO balance}, deduplicated
 *
 * where base = the drawer's real `currency_drawers` allowlist (restricted),
 * or exactly USD + LBP (unrestricted — `UNRESTRICTED_DRAWER_BASE_CURRENCIES`).
 * Money existing is a fact; the allowlist/active-currency set is a display
 * preference; the fact wins, but a drawer is never asked to count a currency
 * it plainly isn't holding just because that currency happens to be active
 * shop-wide.
 *
 * Rule 17 — proven against two sabotaged versions of the pre-fix code (see
 * this session's report for the literal jest output of both runs):
 *   (i)  base returned raw (no non-zero-balance union)      → cases (d),(b) fail
 *   (ii) General's base = derivedCurrencyCodesForDrawer      → case (a) fails
 * The Binance guard (case e) passes on every version — it exists to catch an
 * over-broad fix, so it must never be "improved" into a failing test.
 *
 * The fixture mirrors the live DB shape from the 2026-08-27 handover:
 * General holds USD 2050 / LBP 600,000 with EUR and USDT active but at a
 * ZERO balance; Katsh (restricted, allowlist LBP+USD) holds LBP 2,440,000.
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

    -- Live-DB shape: 4 active shop currencies.
    INSERT INTO currencies (tenant_id, code, name, symbol, decimal_places, is_active) VALUES
      (1, 'USD',  'US Dollar',      '$',    2, 1),
      (1, 'LBP',  'Lebanese Pound', 'LBP',  0, 1),
      (1, 'EUR',  'Euro',           '€',    2, 1),
      (1, 'USDT', 'Tether USD',     'USDT', 2, 1);

    -- General's currency_drawers rows (Phase 1 union) — must NOT affect the
    -- countable base, which for an unrestricted drawer is always the literal
    -- USD/LBP floor regardless of what this table says.
    INSERT INTO currency_drawers (tenant_id, currency_code, drawer_name) VALUES
      (1, 'USD', 'General'), (1, 'LBP', 'General'), (1, 'EUR', 'General'),
      (1, 'USD', 'Katsh'),   (1, 'LBP', 'Katsh'),
      (1, 'USDT', 'Binance'),
      -- restricted drawer whose allowlist OMITS a currency it still holds (D5)
      (1, 'USD', 'OMT_System'),
      (1, 'USD', 'Whish_System');

    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES
      (1, 'General', 'USD',  2050),
      (1, 'General', 'LBP',  600000),
      (1, 'General', 'EUR',  0),
      (1, 'General', 'USDT', 0),
      (1, 'Katsh',   'LBP',  2440000),
      (1, 'Binance', 'USDT', 0),
      -- D5 case: OMT_System's allowlist is USD-only, but it holds LBP.
      (1, 'OMT_System', 'LBP', 2440000),
      -- negative-balance case: Whish_System's allowlist is USD-only, and it
      -- holds a NEGATIVE EUR balance — still money, must still count.
      (1, 'Whish_System', 'EUR', -500),
      -- (g): a drawer with ZERO currency_drawers rows at all.
      (1, 'PettyCash', 'USD', 100),
      -- (h): a drawer_balances row naming a code with NO currencies row.
      (1, 'Mystery', 'XYZ', 75);
  `);
  return db;
}

describe("CurrencyRepository — count-sheet currency set (item 8, D2 + D5)", () => {
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

  // ─── (a) the headline case: General, all 4 active, only USD/LBP non-zero ──

  it("(a) General with all 4 currencies active but only USD/LBP non-zero -> exactly [USD, LBP]", () => {
    const codes = runWithTenant(1, () =>
      repo.getCountableCurrenciesForDrawer("General"),
    );
    expect(codes).toEqual(["USD", "LBP"]);
  });

  // ─── (b) General earns EUR by holding it, then loses it again at zero ─────

  it("(b) General holding EUR 300 -> [USD, LBP, EUR]; spent to 0 -> back to [USD, LBP]", () => {
    db.prepare(
      `UPDATE drawer_balances SET balance = 300
       WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'EUR'`,
    ).run();

    const withEur = runWithTenant(1, () =>
      repo.getCountableCurrenciesForDrawer("General"),
    );
    expect(withEur).toEqual(["USD", "LBP", "EUR"]);

    db.prepare(
      `UPDATE drawer_balances SET balance = 0
       WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'EUR'`,
    ).run();

    const spent = runWithTenant(1, () =>
      repo.getCountableCurrenciesForDrawer("General"),
    );
    expect(spent).toEqual(["USD", "LBP"]);
  });

  // ─── (c) a restricted drawer's allowlist is preserved when it matches ─────

  it("(c) Katsh (restricted, allowlist LBP+USD) holding 2,440,000 LBP -> allowlist preserved", () => {
    const codes = runWithTenant(1, () =>
      repo.getCountableCurrenciesForDrawer("Katsh"),
    );
    expect(codes).toEqual(["LBP", "USD"]);
  });

  // ─── (d) the D5 case: allowlist omits a currency the drawer still holds ───

  it("(d) OMT_System allowlist=[USD] but holds LBP 2,440,000 -> LBP still counts", () => {
    const codes = runWithTenant(1, () =>
      repo.getCountableCurrenciesForDrawer("OMT_System"),
    );
    expect(codes).toEqual(["USD", "LBP"]);
  });

  // ─── (e) anti-over-reach guard: Binance must NOT widen ────────────────────

  it("(e) Binance -> exactly [USDT] — the fix did not widen acceptance scope", () => {
    const codes = runWithTenant(1, () =>
      repo.getCountableCurrenciesForDrawer("Binance"),
    );
    expect(codes).toEqual(["USDT"]);
  });

  // ─── (f) a negative balance is still money ────────────────────────────────

  it("(f) a NEGATIVE balance counts as money (balance != 0, not > 0)", () => {
    const codes = runWithTenant(1, () =>
      repo.getCountableCurrenciesForDrawer("Whish_System"),
    );
    expect(codes).toEqual(["USD", "EUR"]);
  });

  // ─── (g) a drawer with zero currency_drawers rows still appears as a key ──

  it("(g) a drawer present only in drawer_balances (zero currency_drawers rows) still appears as a key", () => {
    const byDrawer = runWithTenant(1, () =>
      repo.getCountableCurrenciesByDrawer(),
    );
    expect(Object.keys(byDrawer)).toContain("PettyCash");
    expect(byDrawer["PettyCash"]).toEqual(["USD"]);
  });

  // ─── (h) a balance-only code with no currencies row is still countable ────

  it("(h) a drawer_balances row naming a code with NO currencies row is still countable", () => {
    const codes = runWithTenant(1, () =>
      repo.getCountableCurrenciesForDrawer("Mystery"),
    );
    expect(codes).toEqual(["XYZ"]);
  });

  // ─── getCountableCurrenciesByDrawer assembles all of the above together ──

  it("getCountableCurrenciesByDrawer returns every drawer's countable set in one call", () => {
    const byDrawer = runWithTenant(1, () =>
      repo.getCountableCurrenciesByDrawer(),
    );

    expect(byDrawer["General"]).toEqual(["USD", "LBP"]);
    expect(byDrawer["Katsh"]).toEqual(["LBP", "USD"]);
    expect(byDrawer["OMT_System"]).toEqual(["USD", "LBP"]);
    expect(byDrawer["Whish_System"]).toEqual(["USD", "EUR"]);
    expect(byDrawer["Binance"]).toEqual(["USDT"]);
    expect(byDrawer["Mystery"]).toEqual(["XYZ"]);
  });
});
