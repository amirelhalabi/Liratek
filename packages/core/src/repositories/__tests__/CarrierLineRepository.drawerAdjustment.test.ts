/**
 * LIRA-252 (owner decision B) — carrier-line CRUD keeps §0.1's invariant.
 *
 * The production bug this ticket fixes: the MTC drawer read $10,000 against
 * one $500 line, and Alfa read $10,000 with no line at all. Part of the
 * cause (investigation, ticket body): Settings → Carrier Lines create/edit
 * and the Recharge inline quick-update changed a line's `credits` with NO
 * drawer effect at all — `CarrierLineRepository.createLine`/`updateLine`/
 * `updateBalance` only ever touched the `carrier_lines` row.
 *
 * Owner decision B: adding a line, editing its credits, deactivating/
 * archiving or re-activating it now moves the carrier drawer by the SAME
 * delta, posted through the existing checkpoint-adjustment mechanism
 * (`CHECKPOINT_ADJUSTMENT_METHOD`, `moneyPosting.ts`'s `insertPaymentRow`/
 * `applyDrawerDelta`) — not a new transaction type.
 *
 * Proven failing-first (rule 17): every test below was run against the
 * pre-fix repository and failed — `createLine`/`updateBalance`/
 * `toggleActive`/`archive` did not touch `drawer_balances`/`payments` at
 * all, so every "drawer moved by X" assertion read a 0 delta.
 *
 * LIRA-252 WAVE 2 (owner decision 2026-10-02) — re-proven failing-first: a
 * `transactions`/`users` table was added to this file's in-memory schema and
 * the `transactionOf(...)` assertions below were added FIRST. Run against
 * the pre-wave-2 repository (`transactionId: null` always, no
 * `getTransactionRepository().createTransaction(...)` call in
 * `postCarrierDrawerAdjustment`), every one of those new assertions failed —
 * `payments.transaction_id` read null and no `transactions` row existed at
 * all. (Separately, running the wave-2 CODE against this file's PRE-wave-2
 * schema — no `transactions` table yet — threw `DatabaseError: Statement
 * execution failed` from `TransactionRepository.createTransaction`'s INSERT,
 * which is the other, accepted failing-first shape per this ticket's own
 * instructions.) The fix wires the real transaction row — see
 * `CarrierLineRepository.postCarrierDrawerAdjustment`'s wave-2 doc comment.
 */

import Database from "better-sqlite3";
import {
  CarrierLineRepository,
  resetCarrierLineRepository,
} from "../CarrierLineRepository.js";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository.js";
import { CHECKPOINT_ADJUSTMENT_METHOD } from "../../constants/checkpointAdjustment.js";
import { TRANSACTION_TYPES } from "../../constants/transactionTypes.js";

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
      days_owed           INTEGER NOT NULL DEFAULT 0,
      notes               TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      is_primary          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE carrier_line_movements (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                     INTEGER,
      carrier_line_id               INTEGER NOT NULL,
      transaction_id                INTEGER,
      credits_delta                 REAL NOT NULL DEFAULT 0,
      validity_days_delta           INTEGER NOT NULL DEFAULT 0,
      previous_validity_expires_at  TEXT,
      days_owed_delta               INTEGER NOT NULL DEFAULT 0,
      previous_days_owed            INTEGER NOT NULL DEFAULT 0,
      reason                        TEXT NOT NULL,
      is_reversed                   INTEGER NOT NULL DEFAULT 0,
      created_at                    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at                    DATETIME DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER DEFAULT 1,
      username   TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE transactions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER,
      type           TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table   TEXT NOT NULL,
      source_id      INTEGER NOT NULL,
      user_id        INTEGER NOT NULL,
      amount_usd     REAL NOT NULL DEFAULT 0,
      amount_lbp     REAL NOT NULL DEFAULT 0,
      exchange_rate  REAL,
      client_id      INTEGER,
      client_name    TEXT,
      client_phone   TEXT,
      reverses_id    INTEGER,
      profit_usd     REAL NOT NULL DEFAULT 0,
      profit_lbp     REAL NOT NULL DEFAULT 0,
      summary        TEXT,
      metadata_json  TEXT,
      device_id      TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("CarrierLineRepository — carrier-line CRUD keeps the §0.1 drawer invariant (LIRA-252)", () => {
  let db: Database.Database;
  let repo: CarrierLineRepository;

  const balanceOf = (drawer: string, code = "USD"): number =>
    (
      db
        .prepare(
          `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = 1`,
        )
        .get(drawer, code) as { balance: number } | undefined
    )?.balance ?? 0;

  const paymentsCount = (drawer: string): number =>
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM payments WHERE drawer_name = ? AND method = ?`,
        )
        .get(drawer, CHECKPOINT_ADJUSTMENT_METHOD) as { n: number }
    ).n;

  /** The most recently posted CARRIER_LINE_ADJUSTMENT transaction, joined
   *  through the LATEST payments row for `drawer`/`method` — lets each test
   *  assert the link (payments.transaction_id -> transactions.id) plus the
   *  transaction's own shape, without hand-rolling the join per test. */
  const latestAdjustmentTransaction = (
    drawer: string,
  ):
    | {
        id: number;
        type: string;
        source_table: string;
        source_id: number;
        amount_usd: number;
        profit_usd: number;
        metadata_json: string | null;
      }
    | undefined => {
    const payment = db
      .prepare(
        `SELECT transaction_id FROM payments
         WHERE drawer_name = ? AND method = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(drawer, CHECKPOINT_ADJUSTMENT_METHOD) as
      | { transaction_id: number | null }
      | undefined;
    if (!payment || payment.transaction_id === null) return undefined;
    return db
      .prepare(
        `SELECT id, type, source_table, source_id, amount_usd, profit_usd, metadata_json
         FROM transactions WHERE id = ?`,
      )
      .get(payment.transaction_id) as
      | {
          id: number;
          type: string;
          source_table: string;
          source_id: number;
          amount_usd: number;
          profit_usd: number;
          metadata_json: string | null;
        }
      | undefined;
  };

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
    repo = new CarrierLineRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetCarrierLineRepository();
    resetCarrierLineMovementRepository();
  });

  it("createLine with a non-zero starting balance credits the carrier drawer by the SAME amount", () => {
    const line = repo.createLine(
      { carrier: "mtc", phone_number: "03111111", credits: 500 },
      7,
    );

    expect(balanceOf("MTC")).toBe(500);
    expect(balanceOf("MTC")).toBe(repo.getCarrierCreditsSum("mtc"));
    expect(paymentsCount("MTC")).toBe(1);
    const row = db
      .prepare(`SELECT created_by, transaction_id FROM payments WHERE drawer_name = 'MTC'`)
      .get() as { created_by: number | null; transaction_id: number | null };
    expect(row.created_by).toBe(7);
    expect(row.transaction_id).not.toBeNull();
    expect(line.credits).toBe(500);

    const txn = latestAdjustmentTransaction("MTC")!;
    expect(txn).toBeDefined();
    expect(txn.type).toBe(TRANSACTION_TYPES.CARRIER_LINE_ADJUSTMENT);
    expect(txn.source_table).toBe("carrier_lines");
    expect(txn.source_id).toBe(line.id);
    expect(txn.amount_usd).toBe(500);
    expect(txn.profit_usd).toBe(0);
    const metadata = JSON.parse(txn.metadata_json!);
    expect(metadata.reason).toBe("created");
    expect(metadata.is_auto).toBe(false);
  });

  it("createLine with the default zero balance touches the drawer not at all", () => {
    repo.createLine({ carrier: "alfa", phone_number: "70999999" }, 7);

    expect(balanceOf("Alfa")).toBe(0);
    expect(paymentsCount("Alfa")).toBe(0);
  });

  it("updateBalance (Recharge inline quick-update) moves the drawer by the credits delta", () => {
    const line = repo.createLine(
      { carrier: "mtc", phone_number: "03111111", credits: 40 },
      1,
    );
    const drawerAfterCreate = balanceOf("MTC");

    repo.updateBalance(line.id, { credits: 65 }, 2);

    expect(balanceOf("MTC") - drawerAfterCreate).toBeCloseTo(25, 6);
    expect(balanceOf("MTC")).toBeCloseTo(repo.getCarrierCreditsSum("mtc"), 6);

    const txn = latestAdjustmentTransaction("MTC")!;
    expect(txn.source_id).toBe(line.id);
    expect(txn.amount_usd).toBeCloseTo(25, 6);
    expect(JSON.parse(txn.metadata_json!).reason).toBe("quick-update");
  });

  it("updateLineAndSyncDrawer (Settings edit form) moves the drawer by the credits delta, both directions", () => {
    const line = repo.createLine(
      { carrier: "alfa", phone_number: "70999999", credits: 100 },
      1,
    );

    repo.updateLineAndSyncDrawer(line.id, { credits: 60 }, 3);
    expect(balanceOf("Alfa")).toBeCloseTo(60, 6);
    expect(balanceOf("Alfa")).toBeCloseTo(repo.getCarrierCreditsSum("alfa"), 6);
    let txn = latestAdjustmentTransaction("Alfa")!;
    expect(txn.amount_usd).toBeCloseTo(-40, 6);
    expect(JSON.parse(txn.metadata_json!).reason).toBe("edited");

    repo.updateLineAndSyncDrawer(line.id, { credits: 90 }, 3);
    expect(balanceOf("Alfa")).toBeCloseTo(90, 6);
    expect(balanceOf("Alfa")).toBeCloseTo(repo.getCarrierCreditsSum("alfa"), 6);
    txn = latestAdjustmentTransaction("Alfa")!;
    expect(txn.amount_usd).toBeCloseTo(30, 6);
    expect(txn.source_id).toBe(line.id);
  });

  it("updateLineAndSyncDrawer touches neither drawer nor payments when credits is not part of the edit", () => {
    const line = repo.createLine(
      { carrier: "mtc", phone_number: "03111111", credits: 40 },
      1,
    );
    repo.updateLineAndSyncDrawer(line.id, { label: "Front counter" }, 1);

    expect(balanceOf("MTC")).toBe(40);
    expect(paymentsCount("MTC")).toBe(1); // only the createLine posting
  });

  it("toggleActive deactivation removes the line's credits from the drawer; reactivation restores them", () => {
    const line = repo.createLine(
      { carrier: "mtc", phone_number: "03111111", credits: 75 },
      1,
    );
    expect(balanceOf("MTC")).toBe(75);

    repo.toggleActive(line.id, 4); // deactivate
    expect(balanceOf("MTC")).toBe(0);
    expect(repo.getCarrierCreditsSum("mtc")).toBe(0);
    let txn = latestAdjustmentTransaction("MTC")!;
    expect(txn.amount_usd).toBe(-75);
    expect(JSON.parse(txn.metadata_json!).reason).toBe("deactivated");

    repo.toggleActive(line.id, 4); // reactivate
    expect(balanceOf("MTC")).toBe(75);
    expect(repo.getCarrierCreditsSum("mtc")).toBe(75);
    txn = latestAdjustmentTransaction("MTC")!;
    expect(txn.amount_usd).toBe(75);
    expect(JSON.parse(txn.metadata_json!).reason).toBe("reactivated");
  });

  it("archive removes the line's credits from the drawer exactly once (idempotent on an already-inactive line)", () => {
    const line = repo.createLine(
      { carrier: "alfa", phone_number: "70999999", credits: 50 },
      1,
    );

    repo.archive(line.id, 5);
    expect(balanceOf("Alfa")).toBe(0);
    const txn = latestAdjustmentTransaction("Alfa")!;
    expect(txn.amount_usd).toBe(-50);
    expect(JSON.parse(txn.metadata_json!).reason).toBe("archived");
    const txnCountAfterFirstArchive = db
      .prepare(`SELECT COUNT(*) AS n FROM transactions`)
      .get() as { n: number };

    // Archiving an already-archived line must not subtract a second time —
    // and must not post a second (zero-delta) adjustment transaction either.
    repo.archive(line.id, 5);
    expect(balanceOf("Alfa")).toBe(0);
    const txnCountAfterSecondArchive = db
      .prepare(`SELECT COUNT(*) AS n FROM transactions`)
      .get() as { n: number };
    expect(txnCountAfterSecondArchive.n).toBe(txnCountAfterFirstArchive.n);
  });

  it("two lines on the same carrier: deactivating one leaves the other's credits in the drawer", () => {
    const a = repo.createLine(
      { carrier: "mtc", phone_number: "03111111", credits: 40 },
      1,
    );
    repo.createLine({ carrier: "mtc", phone_number: "03222222", credits: 15 }, 1);
    expect(balanceOf("MTC")).toBe(55);

    repo.archive(a.id, 1);
    expect(balanceOf("MTC")).toBe(15);
    expect(balanceOf("MTC")).toBe(repo.getCarrierCreditsSum("mtc"));
  });

  /**
   * WAVE 3 (owner decision 2026-10-02): the old "backward-compat" fallback —
   * a null userId silently posting the payment/drawer pair while skipping
   * the transaction row — is gone. Proven failing-first: this exact scenario
   * used to be this suite's own
   * "a null userId ... still posts the payment/drawer pair but skips the
   * transaction row — no NOT NULL crash" test (see git history/diff on this
   * file), which asserted NO throw and `transactionId === null` — i.e. it
   * PASSED against the pre-wave-3 repository. `postCarrierDrawerAdjustment`
   * now throws instead for every one of the 5 public methods below, and nothing
   * is posted to `payments`/`drawer_balances` when it does (the throw fires
   * before any INSERT).
   */
  describe("WAVE 3 — a non-zero delta with no actor throws instead of silently degrading", () => {
    const expectNoActorThrow = (fn: () => unknown, phoneNumber: string) => {
      expect(fn).toThrow(
        `'s credits without an actor — every manual drawer-moving edit must be attributable`,
      );
      expect(fn).toThrow(phoneNumber);
    };

    it("createLine with a non-zero starting balance and no userId throws, and posts nothing", () => {
      expect(() =>
        repo.createLine(
          { carrier: "mtc", phone_number: "03111111", credits: 20 },
          null,
        ),
      ).toThrow(
        "Cannot adjust MTC line 03111111's credits without an actor — every manual drawer-moving edit must be attributable",
      );
      expect(balanceOf("MTC")).toBe(0);
      expect(paymentsCount("MTC")).toBe(0);
      const txnCount = db
        .prepare(`SELECT COUNT(*) AS n FROM transactions`)
        .get() as { n: number };
      expect(txnCount.n).toBe(0);
    });

    it("updateBalance with a real credits delta and no userId throws", () => {
      const line = repo.createLine(
        { carrier: "mtc", phone_number: "03111111", credits: 40 },
        1,
      );
      expectNoActorThrow(
        () => repo.updateBalance(line.id, { credits: 65 }),
        "03111111",
      );
    });

    it("updateLineAndSyncDrawer with a real credits delta and no userId throws", () => {
      const line = repo.createLine(
        { carrier: "alfa", phone_number: "70999999", credits: 100 },
        1,
      );
      expectNoActorThrow(
        () => repo.updateLineAndSyncDrawer(line.id, { credits: 60 }, null),
        "70999999",
      );
    });

    it("toggleActive on a line holding non-zero credits and no userId throws", () => {
      const line = repo.createLine(
        { carrier: "mtc", phone_number: "03111111", credits: 75 },
        1,
      );
      expectNoActorThrow(() => repo.toggleActive(line.id), "03111111");
    });

    it("archive on a line holding non-zero credits and no userId throws", () => {
      const line = repo.createLine(
        { carrier: "alfa", phone_number: "70999999", credits: 50 },
        1,
      );
      expectNoActorThrow(() => repo.archive(line.id), "70999999");
    });

    it("zero-delta calls still need no actor — createLine with no credits, archive/toggleActive on a zero-credit line", () => {
      const line = repo.createLine(
        { carrier: "mtc", phone_number: "03111111" },
        null,
      );
      expect(() => repo.toggleActive(line.id)).not.toThrow();
      expect(() => repo.toggleActive(line.id)).not.toThrow();
      expect(() => repo.archive(line.id)).not.toThrow();
    });
  });

  it("applyMovement (the money-path entry point) does NOT double-post a drawer adjustment of its own", () => {
    // Sales/buy-backs/line-use already post their OWN drawer legs around an
    // applyMovement call (RechargeRepository §0.1 comments) — this new
    // manual-edit mechanism must never ALSO fire for that path, or every
    // sale would move the MTC/Alfa drawer twice.
    const line = repo.createLine(
      { carrier: "mtc", phone_number: "03111111", credits: 40 },
      1,
    );
    const drawerBeforeMovement = balanceOf("MTC");
    const paymentsBeforeMovement = paymentsCount("MTC");

    repo.applyMovement({
      carrierLineId: line.id,
      creditsDelta: -10,
      validityDaysDelta: 0,
      reason: "CREDIT_SALE",
      transactionId: null,
    });

    expect(balanceOf("MTC")).toBe(drawerBeforeMovement);
    expect(paymentsCount("MTC")).toBe(paymentsBeforeMovement);
  });
});
