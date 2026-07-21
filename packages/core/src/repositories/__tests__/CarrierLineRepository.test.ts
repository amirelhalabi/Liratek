/**
 * LIRA W6.a — CarrierLineRepository.
 *
 * NOTE: written but NOT run by default — core jest requires the Node-ABI
 * dance (`cd packages/core && npm rebuild better-sqlite3 && npx jest
 * CarrierLineRepository && npm run rebuild:native` from the repo root
 * afterward to restore the Electron ABI). This workstream (W6) ran it once
 * itself (single-agent run, ABI dance permitted) — see the final report.
 *
 * Covers:
 *  - createLine() inserts a tenant-scoped row with sane defaults
 *    (credits=0, label/validity/notes null) and returns it.
 *  - getActiveByCarrier() scopes to one carrier, active only, ordered.
 *  - getAllActive() spans every carrier, active only.
 *  - getAllIncludingInactive() includes archived rows (admin listing).
 *  - updateLine() / updateBalance() patch only the given fields.
 *  - archive() / toggleActive() flip is_active.
 */

import Database from "better-sqlite3";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      carrier             TEXT NOT NULL CHECK(carrier IN ('alfa','mtc')),
      phone_number        TEXT NOT NULL,
      label               TEXT,
      credits             REAL NOT NULL DEFAULT 0,
      validity_expires_at TEXT,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("CarrierLineRepository (LIRA W6.a)", () => {
  let db: Database.Database;
  let repo: CarrierLineRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetCarrierLineRepository();
    repo = new CarrierLineRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetCarrierLineRepository();
  });

  it("createLine() writes a row with defaults and returns it", () => {
    const row = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.carrier).toBe("mtc");
    expect(row.phone_number).toBe("03111111");
    expect(row.label).toBeNull();
    expect(row.credits).toBe(0);
    expect(row.validity_expires_at).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.is_active).toBe(1);
  });

  it("createLine() accepts explicit credits/label/validity/notes", () => {
    const row = repo.createLine({
      carrier: "alfa",
      phone_number: "70222222",
      label: "Shop Line 1",
      credits: 12.5,
      validity_expires_at: "2026-08-01",
      notes: "kept in the drawer",
    });
    expect(row.label).toBe("Shop Line 1");
    expect(row.credits).toBe(12.5);
    expect(row.validity_expires_at).toBe("2026-08-01");
    expect(row.notes).toBe("kept in the drawer");
  });

  it("getActiveByCarrier() scopes to one carrier, active only", () => {
    repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    repo.createLine({ carrier: "alfa", phone_number: "70222222" });
    const inactive = repo.createLine({
      carrier: "mtc",
      phone_number: "03333333",
    });
    repo.archive(inactive.id);

    const mtcLines = repo.getActiveByCarrier("mtc");
    expect(mtcLines).toHaveLength(1);
    expect(mtcLines[0]!.phone_number).toBe("03111111");

    const alfaLines = repo.getActiveByCarrier("alfa");
    expect(alfaLines).toHaveLength(1);
    expect(alfaLines[0]!.phone_number).toBe("70222222");
  });

  it("getAllActive() spans every carrier, active only", () => {
    repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    repo.createLine({ carrier: "alfa", phone_number: "70222222" });
    const inactive = repo.createLine({
      carrier: "mtc",
      phone_number: "03333333",
    });
    repo.archive(inactive.id);

    const all = repo.getAllActive();
    expect(all).toHaveLength(2);
    expect(all.every((l) => l.is_active === 1)).toBe(true);
  });

  it("getAllIncludingInactive() includes archived rows", () => {
    repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    const archived = repo.createLine({
      carrier: "mtc",
      phone_number: "03333333",
    });
    repo.archive(archived.id);

    const all = repo.getAllIncludingInactive();
    expect(all).toHaveLength(2);
    expect(all.some((l) => l.is_active === 0)).toBe(true);
  });

  it("updateLine() patches only the given fields", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 5,
    });
    const updated = repo.updateLine(line.id, { label: "Renamed" });
    expect(updated!.label).toBe("Renamed");
    expect(updated!.credits).toBe(5); // untouched
    expect(updated!.phone_number).toBe("03111111"); // untouched
  });

  it("updateBalance() sets credits and/or validity_expires_at only", () => {
    const line = repo.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 5,
      label: "Line A",
    });
    const updated = repo.updateBalance(line.id, {
      credits: 20,
      validity_expires_at: "2026-09-01",
    });
    expect(updated!.credits).toBe(20);
    expect(updated!.validity_expires_at).toBe("2026-09-01");
    expect(updated!.label).toBe("Line A"); // untouched
  });

  it("archive() sets is_active = 0", () => {
    const line = repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    const archived = repo.archive(line.id);
    expect(archived!.is_active).toBe(0);
  });

  it("toggleActive() flips is_active both ways", () => {
    const line = repo.createLine({ carrier: "mtc", phone_number: "03111111" });
    const off = repo.toggleActive(line.id);
    expect(off!.is_active).toBe(0);
    const on = repo.toggleActive(line.id);
    expect(on!.is_active).toBe(1);
  });

  it("returns null from updateLine()/archive() for a nonexistent id", () => {
    expect(repo.updateLine(9999, { label: "x" })).toBeNull();
    expect(repo.archive(9999)).toBeNull();
  });
});
