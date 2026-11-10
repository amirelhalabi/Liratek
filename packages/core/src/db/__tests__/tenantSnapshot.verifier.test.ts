/**
 * LIRA-377 T012 — the step-7 verifier and secret-key predicate exported from
 * `tenantSnapshot.ts` for the shop-restore file checks. Behaviour pinned on a
 * tiny hand-made schema; the full real-schema path stays covered by
 * `tenantSnapshot.test.ts`. Written after the extraction (not proven
 * failing-first — the function existed inline and is unchanged).
 */
import Database from "better-sqlite3";
import {
  isSnapshotSecretSettingKey,
  SNAPSHOT_KEPT_SETTING_KEYS,
  verifyOnlyOwnShop,
} from "../tenantSnapshot.js";

function makeShopFile(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE sales (id INTEGER PRIMARY KEY, tenant_id INTEGER, amount REAL);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE some_global (id INTEGER PRIMARY KEY);
    INSERT INTO tenants (id, name) VALUES (5, 'Shop 5');
    INSERT INTO sales (tenant_id, amount) VALUES (5, 10), (5, 20);
    INSERT INTO schema_migrations (version) VALUES (1);
  `);
  return db;
}

describe("verifyOnlyOwnShop", () => {
  it("passes a file holding only shop 5", () => {
    const db = makeShopFile();
    expect(() => verifyOnlyOwnShop(db, 5)).not.toThrow();
  });

  it("refuses when checked against another shop id", () => {
    const db = makeShopFile();
    expect(() => verifyOnlyOwnShop(db, 6)).toThrow(/sales: 2 row\(s\) of another shop/);
  });

  it("refuses a row of another shop or a NULL tenant_id", () => {
    const db = makeShopFile();
    db.exec(`INSERT INTO sales (tenant_id, amount) VALUES (7, 1), (NULL, 2)`);
    expect(() => verifyOnlyOwnShop(db, 5)).toThrow(/sales: 2 row\(s\) of another shop/);
  });

  it("refuses a tenants table that is not exactly the shop's row", () => {
    const db = makeShopFile();
    db.exec(`INSERT INTO tenants (id, name) VALUES (6, 'Other')`);
    expect(() => verifyOnlyOwnShop(db, 5)).toThrow(/tenants: \[5,6\]/);
  });

  it("refuses rows in a global table that is not allowed", () => {
    const db = makeShopFile();
    db.exec(`INSERT INTO some_global (id) VALUES (1)`);
    expect(() => verifyOnlyOwnShop(db, 5)).toThrow(/some_global: 1 global row\(s\)/);
  });
});

describe("isSnapshotSecretSettingKey", () => {
  it.each(["whatsapp_api_key", "telegram_bot_token", "client_secret", "smtp_password"])(
    "treats %s as a secret",
    (k) => expect(isSnapshotSecretSettingKey(k)).toBe(true),
  );

  it.each(["shop_name", "default_currency"])("does not treat %s as a secret", (k) =>
    expect(isSnapshotSecretSettingKey(k)).toBe(false),
  );

  it("keeps the kept keys (the profits password hash)", () => {
    for (const k of Object.keys(SNAPSHOT_KEPT_SETTING_KEYS)) {
      expect(isSnapshotSecretSettingKey(k)).toBe(false);
    }
  });
});
