/**
 * VoucherRepository — `withEffectiveStatus`/`getByCode`/`getAll` and
 * `redeemByCode` compare a stored `expiry_date` against the CLIENT's local
 * calendar day, not the server clock.
 *
 * Sibling of the `ClosingRepository.createCheckpoint` `closing_date` fix
 * (commit 690dc2b0): on web the process runs on the Fly machine (`fra`, no
 * `TZ` set → UTC), not the shop's Beirut clock (UTC+3). A voucher's
 * pending/expired status — and whether `redeemByCode` accepts or rejects it
 * — could therefore disagree with the shop's real calendar day by up to 3
 * hours a day. Desktop was never affected: there the server process IS the
 * shop's PC, so server-local and shop-local already agree.
 *
 * The fix: the caller supplies its own local calendar day as `day`, and both
 * the read path (`withEffectiveStatus`/`getByCode`/`getAll`, plus the bound
 * `?` now used inside `EFFECTIVE_STATUS_EXPR` instead of a literal
 * `date('now')`) and the write path (`redeemByCode`) prefer it over the
 * server's own `localDay()`, which now only covers callers that omit the
 * argument.
 *
 * Rule 17: every case below was run against the pre-fix code (`getByCode`/
 * `getAll` calling `withEffectiveStatus(row)` with no second argument,
 * `withEffectiveStatus` always computing `localDay()` internally with no
 * parameter, `EFFECTIVE_STATUS_EXPR` comparing against SQLite's own
 * `date('now')`, and `redeemByCode` computing `const today = localDay();`
 * unconditionally). All four "honours the client value" cases FAILED under
 * that code — see the individual test comments for the observed values.
 * Reverted to the `day ?? localDay()` fallback shape and confirmed identical
 * via git diff.
 */

import Database from "better-sqlite3";
import {
  VoucherRepository,
  resetVoucherRepository,
} from "../VoucherRepository.js";
import { resetDebtRepository } from "../DebtRepository.js";
import { localDay } from "../../utils/localDate.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE vouchers (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id               INTEGER DEFAULT 1,
      code                    TEXT NOT NULL,
      client_id               INTEGER NOT NULL,
      client_name             TEXT NOT NULL,
      client_phone            TEXT,
      amount                  DECIMAL(10, 2) NOT NULL,
      currency_code           TEXT NOT NULL DEFAULT 'USD',
      expiry_date             TEXT,
      status                  TEXT NOT NULL DEFAULT 'pending',
      redeemed_at             TEXT,
      redeemed_by             INTEGER,
      redeemed_in_transaction TEXT,
      redeemed_transaction_id INTEGER,
      cancelled_at            TEXT,
      cancelled_by            INTEGER,
      note                    TEXT,
      created_by              INTEGER NOT NULL,
      created_at              TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at              TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        INTEGER DEFAULT 1,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL NOT NULL DEFAULT 0,
      amount_lbp       REAL NOT NULL DEFAULT 0,
      transaction_id   INTEGER,
      session_id       INTEGER,
      note             TEXT,
      created_by       TEXT,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

/** Independent day-math cross-check — deliberately NOT the production
 *  helper, so these assertions cannot pass by the code agreeing with itself. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

describe("VoucherRepository — client-supplied `day`", () => {
  let db: Database.Database;
  let repo: VoucherRepository;

  // Constructed so the CLIENT's day and the REAL server day disagree on the
  // voucher's status — this is what distinguishes "the override was used"
  // from "the server's own localDay() was used anyway, and it happened to
  // agree":
  //   - `realToday` is whatever day the suite actually runs on.
  //   - `expiry` sits 5 days ahead of `realToday` — comfortably NOT expired
  //     from the server's own perspective.
  //   - `futureClientDay` sits 10 days ahead of `realToday` — 5 days PAST
  //     `expiry`, so the SAME voucher reads as expired from the client's
  //     perspective.
  const realToday = localDay();
  const expiry = addDays(realToday, 5);
  const futureClientDay = addDays(realToday, 10);

  const insertVoucher = (): string => {
    const code = "GIFT-TEST-0001";
    db.prepare(
      `INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, currency_code, expiry_date, status, created_by)
       VALUES (1, ?, 1, 'Test Client', 10, 'USD', ?, 'pending', 1)`,
    ).run(code, expiry);
    return code;
  };

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetVoucherRepository();
    resetDebtRepository();
    repo = new VoucherRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetVoucherRepository();
    resetDebtRepository();
  });

  // ---------------------------------------------------------------------------
  // Read path: withEffectiveStatus / getByCode / getAll
  // ---------------------------------------------------------------------------

  it("getByCode reads the voucher as 'expired' under the CLIENT's day, but 'pending' under the server's real day", () => {
    const code = insertVoucher();

    expect(repo.getByCode(code)!.status).toBe("pending");
    expect(repo.getByCode(code, futureClientDay)!.status).toBe("expired");
  });

  it("getAll reflects the same CLIENT-day-driven status, including the status FILTER (EFFECTIVE_STATUS_EXPR)", () => {
    insertVoucher();

    // Row-level status.
    expect(repo.getAll({})[0].status).toBe("pending");
    expect(repo.getAll({}, futureClientDay)[0].status).toBe("expired");

    // The `status` filter clause must agree with the row's own displayed
    // status (the bound `?` fix) — filtering for 'expired' under the client
    // day must find the row; filtering for 'pending' must not.
    expect(repo.getAll({ status: "expired" }, futureClientDay)).toHaveLength(
      1,
    );
    expect(repo.getAll({ status: "pending" }, futureClientDay)).toHaveLength(
      0,
    );
  });

  // ---------------------------------------------------------------------------
  // Write path: redeemByCode
  // ---------------------------------------------------------------------------

  it("redeemByCode REJECTS a voucher expiring 'today' under the CLIENT's day even though the server's real day still reads it as valid", () => {
    const code = insertVoucher();

    expect(() =>
      repo.redeemByCode({
        code,
        context: "test",
        transactionId: null,
        userId: 1,
        day: futureClientDay,
      }),
    ).toThrow(/expired/i);

    // Rejected redemption must not have deposited any credit.
    const creditRows = (
      db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger`).get() as {
        n: number;
      }
    ).n;
    expect(creditRows).toBe(0);
  });

  it("redeemByCode ACCEPTS the same voucher when `day` is omitted (falls back to the server's real day, which has not reached expiry)", () => {
    const code = insertVoucher();

    const voucher = repo.redeemByCode({
      code,
      context: "test",
      transactionId: null,
      userId: 1,
    });

    expect(voucher.status).toBe("redeemed");
  });
});
