/**
 * LotoService.checkAndRecordMonthlyFee — rule 27 (dual-transport day
 * hazard). "First Monday of the month" used to be read off `new Date()`,
 * the MACHINE's own clock. On desktop that's the shop's real day; on the
 * Fly backend (UTC, 3h behind Beirut) the window 00:00-03:00 Beirut still
 * reads as the PREVIOUS UTC day, so on the first Monday of a month the
 * server would compute Sunday and silently skip the auto-record.
 *
 * The fix derives `today` from `clientDay()` (`utils/requestDay.ts`) — the
 * request's own local day when the tenant-context scope carries one (see
 * `runWithTenant(tenantId, fn, { clientDay })` in `db/tenantContext.ts`),
 * falling back to the machine's own day otherwise (desktop, unchanged).
 * Day-of-week is computed in UTC from the plain `YYYY-MM-DD` string
 * (`new Date(`${day}T00:00:00Z`).getUTCDay()`), never with local Date
 * getters, which would reintroduce the exact same class of bug.
 *
 * Real-database suite (in-memory SQLite), mirroring
 * LotoService.checkpoint.test.ts's setup — only the two tables this method
 * actually touches (`loto_settings`, `loto_monthly_fees`) are created.
 */
import Database from "better-sqlite3";
import LotoTicketRepository from "../../repositories/LotoTicketRepository.js";
import LotoSettingsRepository from "../../repositories/LotoSettingsRepository.js";
import LotoMonthlyFeeRepository from "../../repositories/LotoMonthlyFeeRepository.js";
import LotoCheckpointRepository from "../../repositories/LotoCheckpointRepository.js";
import LotoCashPrizeRepository from "../../repositories/LotoCashPrizeRepository.js";
import LotoService from "../LotoService.js";
import { runWithTenant } from "../../db/tenantContext.js";

describe("LotoService.checkAndRecordMonthlyFee", () => {
  let db: Database.Database;
  let service: LotoService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE loto_settings (
        tenant_id INTEGER NOT NULL DEFAULT 1,
        key_name TEXT NOT NULL,
        value TEXT NOT NULL,
        description TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, key_name)
      );

      CREATE TABLE loto_monthly_fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        fee_amount REAL DEFAULT 0,
        fee_month TEXT,
        fee_year INTEGER,
        recorded_date TEXT,
        is_paid INTEGER DEFAULT 0,
        paid_date TEXT,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Mirrors the migration's seeded defaults (index.ts v47/v~131).
    db.prepare(
      `INSERT INTO loto_settings (tenant_id, key_name, value, description)
       VALUES
         (1, 'commission_rate', '0.0445', 'Commission rate (4.45%)'),
         (1, 'monthly_fee_amount', '1400000', 'Monthly machine fee in LBP'),
         (1, 'auto_record_monthly_fee', '1', 'Enable/disable auto-recording of monthly fee')`,
    ).run();

    const ticketRepo = new LotoTicketRepository(db);
    const settingsRepo = new LotoSettingsRepository(db);
    const monthlyFeeRepo = new LotoMonthlyFeeRepository(db);
    const checkpointRepo = new LotoCheckpointRepository(db);
    const cashPrizeRepo = new LotoCashPrizeRepository(db);
    service = new LotoService(
      ticketRepo,
      settingsRepo,
      monthlyFeeRepo,
      checkpointRepo,
      cashPrizeRepo,
    );
  });

  afterEach(() => {
    db.close();
  });

  /**
   * The sharpest case: 2030-05-06 is a Monday (verified: `new
   * Date("2030-05-06T00:00:00Z").getUTCDay() === 1`) in the first week of
   * the month — the auto-record must fire off the CONTEXT's clientDay, not
   * whatever the real machine day happens to be when the suite runs.
   *
   * Rule-17 note (discharged 2026-09-14): reverted `checkAndRecordMonthlyFee`
   * to the pre-fix `const today = new Date(); const isMonday = today.getDay()
   * === 1; const isFirstWeek = today.getDate() <= 7;` expression (ignoring
   * `clientDay()` entirely) and ran
   * `npx jest --config jest.config.cjs --roots "<rootDir>/src/services" --testPathPatterns "monthlyFeeAutoRecord"`.
   * This test failed:
   *   expect(received).toBe(expected)
   *   Expected: true
   *   Received: false
   * (the suite ran on the real machine day, 2026-09-14 — a Monday, but day
   * 14, outside the first week — so the pre-fix code's `isFirstWeek` was
   * false and it skipped the record regardless of the `clientDay: "2030-05-
   * 06"` override). Restored from a copy kept outside the repo; `git diff
   * --stat -- src/services/LotoService.ts` printed nothing afterward.
   */
  it("records the fee off the context's clientDay — first Monday of the month", () => {
    const result = runWithTenant(1, () => service.checkAndRecordMonthlyFee(), {
      clientDay: "2030-05-06",
    });

    expect(result.recorded).toBe(true);
    expect(result.fee?.fee_month).toBe("05");
    expect(result.fee?.fee_year).toBe(2030);
    expect(result.fee?.fee_amount).toBe(1400000);
  });

  it("does not record when clientDay is a Monday but NOT in the first week", () => {
    // 2030-05-13 is a Monday (dow 1) but day-of-month 13 > 7.
    const result = runWithTenant(1, () => service.checkAndRecordMonthlyFee(), {
      clientDay: "2030-05-13",
    });

    expect(result.recorded).toBe(false);
  });

  it("does not record when clientDay is in the first week but NOT a Monday", () => {
    // 2030-05-07 is a Tuesday (dow 2), day-of-month 7 <= 7.
    const result = runWithTenant(1, () => service.checkAndRecordMonthlyFee(), {
      clientDay: "2030-05-07",
    });

    expect(result.recorded).toBe(false);
  });

  it("does not double-record for a month already recorded", () => {
    runWithTenant(1, () => service.checkAndRecordMonthlyFee(), {
      clientDay: "2030-05-06",
    });

    const second = runWithTenant(1, () => service.checkAndRecordMonthlyFee(), {
      clientDay: "2030-05-06",
    });

    expect(second.recorded).toBe(false);
  });

  it("skips entirely when auto-record is disabled, regardless of clientDay", () => {
    db.prepare(
      `UPDATE loto_settings SET value = '0' WHERE tenant_id = 1 AND key_name = 'auto_record_monthly_fee'`,
    ).run();

    const result = runWithTenant(1, () => service.checkAndRecordMonthlyFee(), {
      clientDay: "2030-05-06",
    });

    expect(result.recorded).toBe(false);
  });
});
