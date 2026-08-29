/**
 * Checkpoint × carrier lines (carrier-lines-validity plan, Phase 3 / D2).
 *
 * The checkpoint is the money-count path, and this is where §0.1's sum
 * invariant is BUILT: the operator counts each shop SIM line, the line is
 * written through a `carrier_line_movements` row, and the provider drawer is
 * then set from `getCarrierCreditsSum(carrier)` — the drawer FOLLOWS the
 * lines, never the reverse.
 *
 * What each test pins, and how it was proven failing-first (rule 17):
 *
 *  (a) counted == expected → a ZERO credits delta, NO movement row, and the
 *      stored expiry untouched. Proven by making the skip unconditional
 *      (always calling applyMovement): the movement count went 0 → 1.
 *  (b) a variance moves `carrier_lines.credits` and the provider drawer by
 *      the SAME delta, asserted as a before/after snapshot. Proven by
 *      reverting the drawer override to the client-sent figure and feeding a
 *      deliberately inconsistent drawer amount — line and drawer then landed
 *      on different numbers.
 *  (c) a second checkpoint at the same counted values does not double-apply.
 *  (d) `daily_closing_carrier_lines.counted_credits` equals the provider
 *      drawer's USD row for the SAME closing — nothing in the schema enforces
 *      that duplicate, only the single write path does.
 *  (e) THE EXPIRED-LINE CASE — the one the naive approach gets wrong. Under
 *      spec §5.2 a day-delta was rebased onto `max(today, current_expiry)`, so
 *      on an expired line "counted − stored" days landed N days from TODAY
 *      rather than on the counted date. Proven by swapping `validityExpiresAt`
 *      for the equivalent `validityDaysDelta` in ClosingRepository: the stored
 *      expiry came back as a date years past the counted one. LIRA-157 only
 *      strengthens the case for the absolute form — a positive delta on a line
 *      lapsed past the 5-day grace is now REFUSED, so a count on a burned line
 *      could not be recorded as a delta at all. The absolute variant is
 *      deliberately exempt from that refusal and from the 365-day ceiling.
 *
 * There is deliberately NO create-plus-reverse assertion: CHECKPOINT is in
 * NON_REVERSIBLE_TRANSACTION_TYPES, a re-count is not a reversal, and nothing
 * here nets to zero (see transactionTypes.ts).
 */

import Database from "better-sqlite3";
import {
  ClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository.js";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository.js";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository.js";
import { resetTransactionRepository } from "../TransactionRepository.js";
import { localDay } from "../../utils/localDate.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      username  TEXT
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER DEFAULT 1,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT NOT NULL,
      source_id     INTEGER NOT NULL,
      user_id       INTEGER NOT NULL,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER DEFAULT 1,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE daily_closings (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER DEFAULT 1,
      closing_date        TEXT,
      drawer_name         TEXT,
      opening_balance_usd REAL DEFAULT 0,
      opening_balance_lbp REAL DEFAULT 0,
      physical_usd        REAL DEFAULT 0,
      physical_lbp        REAL DEFAULT 0,
      physical_eur        REAL DEFAULT 0,
      system_expected_usd REAL DEFAULT 0,
      system_expected_lbp REAL DEFAULT 0,
      variance_usd        REAL DEFAULT 0,
      notes               TEXT,
      report_path         TEXT,
      created_by          INTEGER,
      updated_by          INTEGER,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE daily_closing_amounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id       INTEGER DEFAULT 1,
      closing_id      INTEGER NOT NULL,
      drawer_name     TEXT NOT NULL,
      currency_code   TEXT NOT NULL,
      opening_amount  REAL DEFAULT 0,
      physical_amount REAL DEFAULT 0,
      UNIQUE(closing_id, drawer_name, currency_code)
    );

    CREATE TABLE daily_closing_carrier_lines (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER NOT NULL,
      closing_id          INTEGER NOT NULL,
      carrier_line_id     INTEGER NOT NULL,
      expected_credits    REAL NOT NULL DEFAULT 0,
      counted_credits     REAL NOT NULL DEFAULT 0,
      expected_expires_at TEXT,
      counted_expires_at  TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(closing_id, carrier_line_id)
    );

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
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_carrier_lines_one_primary_per_carrier
      ON carrier_lines(tenant_id, carrier)
      WHERE is_primary = 1;

    CREATE TABLE carrier_line_movements (
      id                           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                    INTEGER,
      carrier_line_id              INTEGER NOT NULL,
      transaction_id               INTEGER,
      credits_delta                REAL NOT NULL DEFAULT 0,
      validity_days_delta          INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at TEXT,
      reason                       TEXT NOT NULL,
      is_reversed                  INTEGER NOT NULL DEFAULT 0,
      created_at                   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

/** Independent day-math (not the production helper) for the expiry fixtures. */
function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

describe("ClosingRepository — checkpoint counts carrier credits + validity", () => {
  let db: Database.Database;
  let repo: ClosingRepository;
  let lines: CarrierLineRepository;

  const setBalance = (drawer: string, code: string, balance: number): void => {
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(tenant_id, drawer_name, currency_code)
       DO UPDATE SET balance = excluded.balance`,
    ).run(drawer, code, balance);
  };

  const balanceOf = (drawer: string, code: string): number =>
    (
      db
        .prepare(
          `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = 1`,
        )
        .get(drawer, code) as { balance: number } | undefined
    )?.balance ?? 0;

  const movementCount = (): number =>
    (
      db.prepare(`SELECT COUNT(*) AS n FROM carrier_line_movements`).get() as {
        n: number;
      }
    ).n;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetClosingRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetTransactionRepository();
    repo = new ClosingRepository();
    lines = new CarrierLineRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetClosingRepository();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    resetTransactionRepository();
  });

  // (a) ------------------------------------------------------------------
  it("a count that matches writes a ZERO credits delta, no movement and no expiry change", () => {
    const expiry = shiftDays(localDay(), 30);
    const line = lines.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 40,
      validity_expires_at: expiry,
    });
    setBalance("MTC", "USD", 40);

    const result = repo.createCheckpoint({
      user_id: 1,
      drawer_name: "MTC",
      amounts: [
        {
          drawer_name: "MTC",
          currency_code: "USD",
          expected_amount: 40,
          physical_amount: 40,
        },
      ],
      carrier_lines: [
        {
          carrier_line_id: line.id,
          counted_credits: 40,
          counted_expires_at: expiry,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(movementCount()).toBe(0);

    const after = lines.getById(line.id)!;
    expect(after.credits).toBe(40);
    expect(after.validity_expires_at).toBe(expiry);
    expect(balanceOf("MTC", "USD")).toBe(40);
    // No reconciliation leg either — nothing moved.
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM payments WHERE drawer_name = 'MTC'`,
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
  });

  // (b) ------------------------------------------------------------------
  it("a variance moves the line credits and the provider drawer by the SAME delta", () => {
    const line = lines.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 40,
    });
    setBalance("MTC", "USD", 40);

    const beforeCredits = lines.getById(line.id)!.credits;
    const beforeDrawer = balanceOf("MTC", "USD");

    const result = repo.createCheckpoint({
      user_id: 1,
      drawer_name: "MTC",
      amounts: [
        {
          drawer_name: "MTC",
          currency_code: "USD",
          expected_amount: 40,
          physical_amount: 32.5,
        },
      ],
      carrier_lines: [{ carrier_line_id: line.id, counted_credits: 32.5 }],
    });
    expect(result.success).toBe(true);

    const afterCredits = lines.getById(line.id)!.credits;
    const afterDrawer = balanceOf("MTC", "USD");

    expect(afterCredits - beforeCredits).toBeCloseTo(-7.5, 6);
    expect(afterDrawer - beforeDrawer).toBeCloseTo(-7.5, 6);
    // §0.1's invariant, stated directly.
    expect(afterDrawer).toBeCloseTo(lines.getCarrierCreditsSum("mtc"), 6);

    const movement = db
      .prepare(`SELECT * FROM carrier_line_movements`)
      .get() as {
      credits_delta: number;
      reason: string;
      transaction_id: number;
      validity_days_delta: number;
    };
    expect(movement.reason).toBe("CHECKPOINT");
    expect(movement.credits_delta).toBeCloseTo(-7.5, 6);
    expect(movement.validity_days_delta).toBe(0);
    // The movement rides on THIS checkpoint's transaction.
    const txn = db
      .prepare(`SELECT id, type FROM transactions ORDER BY id DESC LIMIT 1`)
      .get() as { id: number; type: string };
    expect(txn.type).toBe("CHECKPOINT");
    expect(movement.transaction_id).toBe(txn.id);
  });

  // (b2) -----------------------------------------------------------------
  it("the drawer follows the SUM of the carrier's lines, not just the counted one", () => {
    const counted = lines.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 40,
    });
    // §0.5 keeps the schema multi-line-capable; a second line's credits stay
    // part of the drawer even though this checkpoint does not count it.
    lines.createLine({
      carrier: "mtc",
      phone_number: "03222222",
      credits: 15,
    });
    setBalance("MTC", "USD", 55);

    repo.createCheckpoint({
      user_id: 1,
      drawer_name: "MTC",
      amounts: [
        {
          drawer_name: "MTC",
          currency_code: "USD",
          expected_amount: 55,
          // A stale/naive client figure: only the counted line. The server
          // must ignore it and use the sum.
          physical_amount: 30,
        },
      ],
      carrier_lines: [{ carrier_line_id: counted.id, counted_credits: 30 }],
    });

    expect(lines.getCarrierCreditsSum("mtc")).toBeCloseTo(45, 6);
    expect(balanceOf("MTC", "USD")).toBeCloseTo(45, 6);
  });

  // (c) ------------------------------------------------------------------
  it("a second checkpoint at the same counted values does not double-apply", () => {
    const line = lines.createLine({
      carrier: "alfa",
      phone_number: "70999999",
      credits: 100,
    });
    setBalance("Alfa", "USD", 100);

    const payload = {
      user_id: 1,
      drawer_name: "Alfa",
      amounts: [
        {
          drawer_name: "Alfa",
          currency_code: "USD",
          expected_amount: 100,
          physical_amount: 80,
        },
      ],
      carrier_lines: [{ carrier_line_id: line.id, counted_credits: 80 }],
    };

    repo.createCheckpoint(payload);
    expect(lines.getById(line.id)!.credits).toBeCloseTo(80, 6);
    expect(balanceOf("Alfa", "USD")).toBeCloseTo(80, 6);
    expect(movementCount()).toBe(1);

    // Counting the same 80 again is a no-op on both surfaces.
    repo.createCheckpoint(payload);
    expect(lines.getById(line.id)!.credits).toBeCloseTo(80, 6);
    expect(balanceOf("Alfa", "USD")).toBeCloseTo(80, 6);
    expect(movementCount()).toBe(1);
  });

  // (d) ------------------------------------------------------------------
  it("daily_closing_carrier_lines.counted_credits matches the drawer row for that closing", () => {
    const line = lines.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 40,
      validity_expires_at: "2026-01-01",
    });
    setBalance("MTC", "USD", 40);

    const result = repo.createCheckpoint({
      user_id: 1,
      drawer_name: "MTC",
      amounts: [
        {
          drawer_name: "MTC",
          currency_code: "USD",
          expected_amount: 40,
          physical_amount: 61.25,
        },
      ],
      carrier_lines: [
        {
          carrier_line_id: line.id,
          counted_credits: 61.25,
          counted_expires_at: "2026-03-01",
        },
      ],
    });
    const closingId = Number(result.id);

    const snapshot = db
      .prepare(
        `SELECT expected_credits, counted_credits, expected_expires_at, counted_expires_at
           FROM daily_closing_carrier_lines WHERE closing_id = ?`,
      )
      .get(closingId) as {
      expected_credits: number;
      counted_credits: number;
      expected_expires_at: string | null;
      counted_expires_at: string | null;
    };
    const drawerRow = db
      .prepare(
        `SELECT physical_amount FROM daily_closing_amounts
          WHERE closing_id = ? AND drawer_name = 'MTC' AND currency_code = 'USD'`,
      )
      .get(closingId) as { physical_amount: number };

    expect(snapshot.counted_credits).toBeCloseTo(61.25, 6);
    expect(drawerRow.physical_amount).toBeCloseTo(snapshot.counted_credits, 6);
    // expected_* are the PRE-count values, read server-side off the line.
    expect(snapshot.expected_credits).toBeCloseTo(40, 6);
    expect(snapshot.expected_expires_at).toBe("2026-01-01");
    expect(snapshot.counted_expires_at).toBe("2026-03-01");

    // And the timeline read joins it back for history.
    const timeline = repo.getCheckpointTimeline({
      date_from: localDay(),
      date_to: localDay(),
    });
    const record = timeline.find((c) => c.id === closingId)!;
    expect(record.carrier_lines).toHaveLength(1);
    expect(record.carrier_lines[0].phone_number).toBe("03111111");
    expect(record.carrier_lines[0].counted_expires_at).toBe("2026-03-01");
  });

  // (e) ------------------------------------------------------------------
  it("stores the counted expiry VERBATIM on an already-expired line (no rebasing onto today)", () => {
    const expired = "2020-01-01";
    const countedExpiry = shiftDays(localDay(), 45);
    const line = lines.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 10,
      validity_expires_at: expired,
    });
    setBalance("MTC", "USD", 10);

    repo.createCheckpoint({
      user_id: 1,
      drawer_name: "MTC",
      amounts: [
        {
          drawer_name: "MTC",
          currency_code: "USD",
          expected_amount: 10,
          physical_amount: 10,
        },
      ],
      carrier_lines: [
        {
          carrier_line_id: line.id,
          counted_credits: 10,
          counted_expires_at: countedExpiry,
        },
      ],
    });

    const after = lines.getById(line.id)!;
    // A day-delta would have been rebased onto max(today, expiry) = today and
    // landed ~6 years out; the absolute variant lands exactly where counted.
    expect(after.validity_expires_at).toBe(countedExpiry);
    expect(after.credits).toBe(10);

    const movement = db
      .prepare(`SELECT * FROM carrier_line_movements`)
      .get() as {
      credits_delta: number;
      validity_days_delta: number;
      previous_validity_expires_at: string | null;
      reason: string;
    };
    expect(movement.credits_delta).toBe(0);
    expect(movement.reason).toBe("CHECKPOINT");
    // The snapshot is what makes the row auditable; the day figure is only
    // informational on this variant.
    expect(movement.previous_validity_expires_at).toBe(expired);
    expect(movement.validity_days_delta).toBeGreaterThan(0);
  });

  it("a counted date is never cleared by omitting it", () => {
    const expiry = shiftDays(localDay(), 10);
    const line = lines.createLine({
      carrier: "alfa",
      phone_number: "70999999",
      credits: 5,
      validity_expires_at: expiry,
    });
    setBalance("Alfa", "USD", 5);

    repo.createCheckpoint({
      user_id: 1,
      drawer_name: "Alfa",
      amounts: [
        {
          drawer_name: "Alfa",
          currency_code: "USD",
          expected_amount: 5,
          physical_amount: 7,
        },
      ],
      // counted_expires_at omitted — validity was not counted.
      carrier_lines: [{ carrier_line_id: line.id, counted_credits: 7 }],
    });

    const after = lines.getById(line.id)!;
    expect(after.validity_expires_at).toBe(expiry);
    expect(after.credits).toBe(7);
    const snapshot = db
      .prepare(`SELECT counted_expires_at FROM daily_closing_carrier_lines`)
      .get() as { counted_expires_at: string | null };
    expect(snapshot.counted_expires_at).toBeNull();
  });

  it("rejects a count against an archived or unknown line, rolling the whole checkpoint back", () => {
    const line = lines.createLine({
      carrier: "mtc",
      phone_number: "03111111",
      credits: 40,
    });
    lines.archive(line.id);
    setBalance("MTC", "USD", 40);

    const result = repo.createCheckpoint({
      user_id: 1,
      drawer_name: "MTC",
      amounts: [
        {
          drawer_name: "MTC",
          currency_code: "USD",
          expected_amount: 40,
          physical_amount: 10,
        },
      ],
      carrier_lines: [{ carrier_line_id: line.id, counted_credits: 10 }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/archived/i);
    // Nothing partial survived the failure.
    expect(balanceOf("MTC", "USD")).toBe(40);
    expect(movementCount()).toBe(0);
    expect(
      (
        db.prepare(`SELECT COUNT(*) AS n FROM daily_closing_amounts`).get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });

  it("a checkpoint of a non-carrier drawer is byte-for-byte unaffected", () => {
    setBalance("General", "USD", 500);
    setBalance("General", "LBP", 1_000_000);

    const result = repo.createCheckpoint({
      user_id: 1,
      drawer_name: "General",
      amounts: [
        {
          drawer_name: "General",
          currency_code: "USD",
          expected_amount: 500,
          physical_amount: 480,
        },
        {
          drawer_name: "General",
          currency_code: "LBP",
          expected_amount: 1_000_000,
          physical_amount: 1_000_000,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(balanceOf("General", "USD")).toBe(480);
    expect(balanceOf("General", "LBP")).toBe(1_000_000);
    expect(movementCount()).toBe(0);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM daily_closing_carrier_lines`)
          .get() as { n: number }
      ).n,
    ).toBe(0);
  });
});
