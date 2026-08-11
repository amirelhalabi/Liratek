/**
 * SessionPaymentService — session-basket CASH SPLIT guard (Primary Cash Drawer
 * plan §3 Phase D / owner decision #7, docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md).
 *
 * This is BRAND NEW behavior with no prior coverage: when a session basket
 * contains a primary-system (shop_base_system) financial-service item, every
 * drawer-affecting IN/OUT cash-family leg of the basket's single pooled
 * payment must split pro-rata between the primary cash drawer (PCD,
 * `OMT_System`/`Whish_System`) and General — the FS item's share of the
 * basket total to the PCD, the remainder to General, per currency, with the
 * rounding remainder landing in General (never lost).
 *
 * This is the one seam (CLAUDE.md rule 18 / plan §3 Phase D) where the layer
 * that knows WHAT was sold (the session basket) is not the layer that decides
 * WHERE the cash goes (SessionPaymentService/SessionPaymentRepository) — so
 * every case here is proved against the real repository query
 * (`getSessionCashSplitContext`) and the real pro-rata function
 * (`splitCashLegByItemShare`), not a stubbed ratio.
 *
 * The sibling file `packages/core/src/repositories/__tests__/SessionPaymentService.basket.test.ts`
 * predates this feature and its fixture DB has no `financial_services` /
 * `system_settings` tables, so the split path there silently degrades to
 * "no PCD split, everything to General" (the fail-soft branch in
 * `getSessionCashSplitContext`) and is never exercised. This file adds those
 * tables so the split is actually driven end to end.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OPEN QUESTION 6b (plan open item 6b, UNVERIFIED — grep "OPEN QUESTION 6b"
 * to find every assertion in this file that rests on it):
 *
 *   The split assumes a session basket's linked FS-item amount
 *   (`customer_session_transactions.amount_usd`/`amount_lbp`) for a SEND
 *   ALREADY INCLUDES the customer fee (principal + fee), matching the
 *   convention `FinancialServiceRepository`/§8.3 uses elsewhere ("the
 *   frontend pre-nets, so `sentAmount` is already the true principal").
 *   If the cart instead links the FS item at its fee-EXCLUSIVE principal
 *   only, the split mechanism itself stays correct but its ratio INPUT is
 *   wrong — every expected PCD/General number below would need to be
 *   re-derived once the owner confirms the actual cart-construction
 *   convention against the frontend basket-item code.
 *
 *   Separately, `getSessionCashSplitContext`'s SQL has no `service_type`
 *   filter — any FS row (SEND, RECEIVE, or BILL) whose provider matches
 *   `shop_base_system` counts toward the primary-system subtotal, not just
 *   SEND/RECEIVE. This file asserts that as CURRENT behavior, not as a
 *   confirmed-intended one (plan §6 item 6b, second sentence).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Runs against an in-memory SQLite DB injected via the connection test hook
 * (globalThis.__LIRATEK_TEST_DB__). DebtService and VoucherRepository are
 * mocked; every other repository the service resolves (including
 * SettingsRepository, for `shop_base_system`) uses the real test DB. The
 * `payment_methods` table is intentionally omitted so `paymentMethodToDrawerName`
 * / `isDrawerAffectingMethod` fall back to the hardcoded map (CASH → General,
 * CUSTOMER_ACCOUNT / GIFT_CARD → non-drawer) — same choice the sibling file
 * makes, for the same reason.
 */

import Database from "better-sqlite3";

// ─── Mock DebtService (addCredit — used only for OUT-on-account store credit) ──
const mockAddCredit = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: mockAddCredit }),
  resetDebtService: jest.fn(),
}));

// ─── Mock VoucherRepository (redeemByCode — gift-card redemption is a noop here) ─
const mockRedeemByCode = jest.fn();
jest.mock("../../repositories/VoucherRepository", () => ({
  getVoucherRepository: () => ({ redeemByCode: mockRedeemByCode }),
  resetVoucherRepository: jest.fn(),
}));

import {
  SessionPaymentService,
  resetSessionPaymentService,
  splitCashLegByItemShare,
} from "../SessionPaymentService";
import { resetCustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetSalesRepository } from "../../repositories/SalesRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema ──────────────────────────────────────────────────────────
// Superset of the sibling file's fixture PLUS `system_settings` (shop_base_system)
// and `financial_services` (provider) — the two tables `getSessionCashSplitContext`
// needs to resolve a real (non-zero) split ratio.

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone_number    TEXT,
      notes           TEXT,
      whatsapp_opt_in INTEGER DEFAULT 0,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE customer_sessions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name  TEXT,
      customer_phone TEXT,
      customer_notes TEXT,
      user_id        INTEGER,
      started_at     TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at      TEXT,
      started_by     TEXT NOT NULL,
      closed_by      TEXT,
      is_active      INTEGER NOT NULL DEFAULT 1,
      tenant_id      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             INTEGER NOT NULL,
      transaction_type       TEXT NOT NULL,
      transaction_id         INTEGER NOT NULL,
      unified_transaction_id INTEGER,
      amount_usd             REAL NOT NULL DEFAULT 0,
      amount_lbp             REAL NOT NULL DEFAULT 0,
      profit_usd             REAL NOT NULL DEFAULT 0,
      profit_lbp             REAL NOT NULL DEFAULT 0,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      user_id      INTEGER NOT NULL DEFAULT 1,
      amount_usd   REAL NOT NULL DEFAULT 0,
      amount_lbp   REAL NOT NULL DEFAULT 0,
      tenant_id    INTEGER NOT NULL DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sales (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id              INTEGER,
      total_amount_usd       REAL,
      discount_usd           REAL DEFAULT 0,
      final_amount_usd       REAL,
      paid_usd               REAL DEFAULT 0,
      paid_lbp               REAL DEFAULT 0,
      change_given_usd       REAL DEFAULT 0,
      change_given_lbp       REAL DEFAULT 0,
      exchange_rate_snapshot REAL,
      drawer_name            TEXT DEFAULT 'General',
      status                 TEXT DEFAULT 'completed',
      note                   TEXT,
      tenant_id              INTEGER NOT NULL DEFAULT 1,
      created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at             DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      tenant_id      INTEGER NOT NULL DEFAULT 1,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id     INTEGER NOT NULL DEFAULT 1,
      drawer_name   TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance       REAL NOT NULL DEFAULT 0,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       REAL,
      amount_lbp       REAL,
      transaction_id   INTEGER,
      due_date         TEXT,
      note             TEXT,
      tenant_id        INTEGER NOT NULL DEFAULT 1,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by       INTEGER,
      session_id       INTEGER
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    -- NEW vs. the sibling fixture: shop_base_system, read by
    -- SessionPaymentRepository.resolveBaseSystem() via SettingsRepository.
    CREATE TABLE system_settings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER NOT NULL DEFAULT 1,
      key_name   TEXT NOT NULL,
      value      TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, key_name)
    );
    INSERT INTO system_settings (tenant_id, key_name, value) VALUES (1, 'shop_base_system', 'OMT');

    -- NEW vs. the sibling fixture: the FS rows getSessionCashSplitContext joins
    -- on to derive the primary-system subtotal (only 'provider' is read).
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER NOT NULL DEFAULT 1,
      provider     TEXT NOT NULL,
      service_type TEXT,
      amount       REAL,
      currency     TEXT DEFAULT 'USD',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    -- Seed the General drawer (cash) at zero so deltas are easy to read.
    -- OMT_System/Whish_System are deliberately NOT pre-seeded — applyDrawerDelta
    -- upserts the row on first touch, so an assertion of 0 on an untouched PCD
    -- also proves the split branch never even created the row.
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 0);
    INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 0);
  `);

  return db;
}

// ─── Test fixtures ─────────────────────────────────────────────────────────────

/** Create a session with a resolvable client (matched by phone). */
function seedSessionWithClient(
  db: Database.Database,
  opts: { name: string; phone: string },
): { sessionId: number; clientId: number } {
  const clientId = Number(
    db
      .prepare("INSERT INTO clients (full_name, phone_number) VALUES (?, ?)")
      .run(opts.name, opts.phone).lastInsertRowid,
  );
  const sessionId = Number(
    db
      .prepare(
        "INSERT INTO customer_sessions (customer_name, customer_phone, started_by) VALUES (?, ?, 'admin')",
      )
      .run(opts.name, opts.phone).lastInsertRowid,
  );
  return { sessionId, clientId };
}

/** Set (or change) the shop's primary system read by resolveBaseSystem(). */
function setShopBaseSystem(
  db: Database.Database,
  baseSystem: "OMT" | "WHISH",
): void {
  db.prepare(
    "UPDATE system_settings SET value = ? WHERE tenant_id = 1 AND key_name = 'shop_base_system'",
  ).run(baseSystem);
}

/**
 * Link a financial-service basket item to the session: a `financial_services`
 * row (provider is the ONLY column the split query reads) + its unified
 * `transactions` row (source_table = 'financial_services') + the
 * `customer_session_transactions` link carrying the basket-line amount.
 *
 * `amountUsd`/`amountLbp` is exactly the value `getSessionCashSplitContext`
 * treats as this item's contribution — see OPEN QUESTION 6b at the top of
 * this file for what that value is assumed to represent for a SEND.
 */
function seedSessionFsItem(
  db: Database.Database,
  sessionId: number,
  opts: {
    provider: string;
    serviceType?: "SEND" | "RECEIVE" | "BILL";
    amountUsd?: number;
    amountLbp?: number;
  },
): { fsId: number; txnId: number } {
  const amountUsd = opts.amountUsd ?? 0;
  const amountLbp = opts.amountLbp ?? 0;
  const fsId = Number(
    db
      .prepare(
        "INSERT INTO financial_services (provider, service_type, amount, currency) VALUES (?, ?, ?, ?)",
      )
      .run(
        opts.provider,
        opts.serviceType ?? "SEND",
        amountLbp > 0 ? amountLbp : amountUsd,
        amountLbp > 0 ? "LBP" : "USD",
      ).lastInsertRowid,
  );
  const txnId = Number(
    db
      .prepare(
        "INSERT INTO transactions (type, source_table, source_id, amount_usd, amount_lbp) VALUES ('FINANCIAL_SERVICE', 'financial_services', ?, ?, ?)",
      )
      .run(fsId, amountUsd, amountLbp).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp) VALUES (?, 'financial_service', ?, ?, ?, ?)",
  ).run(sessionId, fsId, txnId, amountUsd, amountLbp);
  return { fsId, txnId };
}

/** A non-FS basket item (e.g. an accessory sale / custom service): counts
 *  toward the basket total but never toward the primary-system subtotal. */
function seedSessionNonSaleItem(
  db: Database.Database,
  sessionId: number,
  amountUsd = 0,
  amountLbp = 0,
): number {
  const txnId = Number(
    db
      .prepare(
        "INSERT INTO transactions (type, source_table, source_id, amount_usd, amount_lbp) VALUES ('CUSTOM_SERVICE', 'custom_services', 0, ?, ?)",
      )
      .run(amountUsd, amountLbp).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO customer_session_transactions (session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp) VALUES (?, 'custom_service', 0, ?, ?, ?)",
  ).run(sessionId, txnId, amountUsd, amountLbp);
  return txnId;
}

// ─── Read helpers ───────────────────────────────────────────────────────────────

function drawerBalance(
  db: Database.Database,
  drawerName: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawerName, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function paymentRows(db: Database.Database): Array<{
  session_id: number | null;
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
}> {
  return db
    .prepare(
      "SELECT session_id, method, drawer_name, currency_code, amount FROM payments ORDER BY id ASC",
    )
    .all() as Array<{
    session_id: number | null;
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
  }>;
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

describe("SessionPaymentService.recordBasketPayment — primary-cash-drawer basket split (Phase D)", () => {
  let db: Database.Database;
  let service: SessionPaymentService;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);

    resetCustomerSessionRepository();
    resetClientRepository();
    resetSalesRepository();
    resetSessionPaymentRepository();
    resetSettingsRepository();
    resetSessionPaymentService();

    mockAddCredit.mockClear();
    mockRedeemByCode.mockClear();

    service = new SessionPaymentService();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
    resetTenantContext();
  });

  // ===========================================================================
  // TASK A — the worked example the implementer traced by hand
  // ===========================================================================
  describe("[Task A] worked example", () => {
    it("100 USD OMT SEND (fee 5) + 20 USD accessory, one 125 USD cash leg -> PCD 105 / General 20", () => {
      const { sessionId } = seedSessionWithClient(db, {
        name: "Worked Example",
        phone: "700",
      });

      // OPEN QUESTION 6b: 105 = principal 100 + fee 5 -- the FS item is linked
      // to the basket at the fee-INCLUDED amount (see the file-level note).
      seedSessionFsItem(db, sessionId, {
        provider: "OMT",
        serviceType: "SEND",
        amountUsd: 105,
      });
      seedSessionNonSaleItem(db, sessionId, 20); // 20 USD accessory, non-FS

      service.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 125, direction: "IN" }, // 125 = 105 + 20
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // basketTotalUsd = 125 (105 + 20); primarySystemUsd = 105 (the OMT SEND item)
      // ratio = 105 / 125 = 0.84
      // totalUnits = 12500 cents; pcdUnits = round(12500 * 0.84) = round(10500) = 10500 -> $105.00
      // generalUnits = 12500 - 10500 = 2000 -> $20.00 (remainder, exact here — no rounding drama)
      expect(drawerBalance(db, "OMT_System", "USD")).toBe(105);
      expect(drawerBalance(db, "General", "USD")).toBe(20);

      // Conservation (Task B, restated here): the single 125 leg reconciles exactly.
      expect(
        drawerBalance(db, "OMT_System", "USD") +
          drawerBalance(db, "General", "USD"),
      ).toBe(125);
    });
  });

  // ===========================================================================
  // TASK B — the conservation property, prominent + a non-terminating ratio
  // ===========================================================================
  describe("[Task B] conservation property — pcdAmount + generalAmount === amount, EXACTLY", () => {
    it.each([
      [125, 0.84, "USD"], // the worked example's ratio
      [10, 1 / 3, "USD"], // non-terminating ratio (thirds)
      [7, 1 / 3, "USD"], // non-terminating ratio, does not divide evenly into cents
      [1_000_000, 1 / 3, "LBP"], // non-terminating ratio, LBP whole units
      [33.33, 2 / 3, "USD"],
      [0.01, 0.5, "USD"], // one cent, half
      [100, 1, "USD"], // ratio 1 -> everything to PCD
      [100, 0, "USD"], // ratio 0 -> everything to General
    ])(
      "amount=%p ratio=%p currency=%p reconciles to EXACTLY the input amount",
      (amount, ratio, currency) => {
        const { pcdAmount, generalAmount } = splitCashLegByItemShare(
          amount,
          ratio,
          currency,
        );
        expect(pcdAmount).toBeGreaterThanOrEqual(0);
        expect(generalAmount).toBeGreaterThanOrEqual(0);
        // Exact re-add (the function itself works in integer minor units —
        // cents for USD, whole units for LBP — precisely so this never has a
        // floating-point remainder to paper over with toBeCloseTo).
        expect(pcdAmount + generalAmount).toBe(amount);
      },
    );

    it("thirds ratio (USD): the rounding remainder lands in General, no cent is lost", () => {
      // 10.00 USD @ ratio 1/3: totalUnits = 1000 cents; pcdUnits = round(1000/3)
      // = round(333.33..) = 333 -> $3.33; generalUnits = 1000 - 333 = 667 -> $6.67.
      // 3.33 + 6.67 = 10.00 exactly (remainder of $0.01 vs. the "true" $3.333...
      // landed in General, per plan Phase D's explicit rule).
      const { pcdAmount, generalAmount } = splitCashLegByItemShare(
        10,
        1 / 3,
        "USD",
      );
      expect(pcdAmount).toBe(3.33);
      expect(generalAmount).toBe(6.67);
      expect(pcdAmount + generalAmount).toBe(10);
    });

    it("two-thirds ratio (USD): rounds UP to the nearest cent — truncating would short the cash drawer", () => {
      // rule 17: proven failing-first 2026-07-31 — changing `pcdUnits =
      // Math.round(...)` to `Math.floor(...)` reads pcdAmount 6.66 /
      // generalAmount 3.34 instead of 6.67 / 3.33.
      //
      // This case exists because the 1/3 cases above CANNOT see a truncation
      // bug: round(333.33) and floor(333.33) are both 333. Only a ratio whose
      // scaled product has a fractional part >= 0.5 distinguishes them.
      // 10.00 USD @ ratio 2/3: totalUnits = 1000; pcdUnits = round(666.66..)
      // = 667 -> $6.67; generalUnits = 1000 - 667 = 333 -> $3.33.
      // Conservation still holds under truncation (General absorbs whatever
      // the PCD does not take), so a conservation-only assertion is blind to
      // this — the exact share must be asserted.
      const { pcdAmount, generalAmount } = splitCashLegByItemShare(
        10,
        2 / 3,
        "USD",
      );
      expect(pcdAmount).toBe(6.67);
      expect(generalAmount).toBe(3.33);
      expect(pcdAmount + generalAmount).toBe(10);
    });

    it("two-thirds ratio (LBP): rounds UP to the nearest whole lira", () => {
      // rule 17: proven failing-first 2026-07-31 — with Math.floor, pcdAmount
      // reads 666666 / generalAmount 333334 instead of 666667 / 333333.
      // 1,000,000 LBP @ ratio 2/3: pcdUnits = round(666666.66..) = 666667;
      // generalUnits = 1,000,000 - 666,667 = 333,333.
      const { pcdAmount, generalAmount } = splitCashLegByItemShare(
        1_000_000,
        2 / 3,
        "LBP",
      );
      expect(pcdAmount).toBe(666667);
      expect(generalAmount).toBe(333333);
      expect(pcdAmount + generalAmount).toBe(1_000_000);
    });

    it("thirds ratio (LBP, whole units — no sub-unit in this codebase): remainder lands in General", () => {
      // 1,000,000 LBP @ ratio 1/3: totalUnits = 1,000,000 (scale 1);
      // pcdUnits = round(1000000/3) = round(333333.33..) = 333333;
      // generalUnits = 1000000 - 333333 = 666667. Sum = 1,000,000 exactly.
      const { pcdAmount, generalAmount } = splitCashLegByItemShare(
        1_000_000,
        1 / 3,
        "LBP",
      );
      expect(pcdAmount).toBe(333333);
      expect(generalAmount).toBe(666667);
      expect(pcdAmount + generalAmount).toBe(1_000_000);
    });

    it("integration: a non-terminating (thirds) basket ratio reconciles exactly at the drawer level", () => {
      const { sessionId } = seedSessionWithClient(db, {
        name: "Thirds Integration",
        phone: "701",
      });
      seedSessionFsItem(db, sessionId, { provider: "OMT", amountUsd: 10 });
      seedSessionNonSaleItem(db, sessionId, 20); // basket total 30 -> ratio = 10/30 = 1/3

      service.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 7, direction: "IN" }, // not the full basket — part is on account elsewhere in a real flow
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // totalUnits = 700 cents; pcdUnits = round(700 * 1/3) = round(233.33..) = 233 -> $2.33
      // generalUnits = 700 - 233 = 467 -> $4.67. 2.33 + 4.67 = 7.00 exactly.
      const pcd = drawerBalance(db, "OMT_System", "USD");
      const general = drawerBalance(db, "General", "USD");
      expect(pcd).toBe(2.33);
      expect(general).toBe(4.67);
      // THE conservation property, asserted against real posted balances, not
      // just the pure function: PCD delta + General delta === the leg amount.
      expect(Math.round((pcd + general) * 100) / 100).toBe(7);
    });
  });

  // ===========================================================================
  // TASK C — coverage matrix
  // ===========================================================================
  describe("[Task C] coverage matrix", () => {
    it("no primary-system FS item anywhere in the basket -> all cash stays in General", () => {
      const { sessionId } = seedSessionWithClient(db, {
        name: "No FS Item",
        phone: "702",
      });
      seedSessionNonSaleItem(db, sessionId, 50); // pure non-FS basket

      service.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 50, direction: "IN" },
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // primarySystemUsd = 0 (no FS row at all) -> ratio 0 -> everything General.
      expect(drawerBalance(db, "General", "USD")).toBe(50);
      expect(drawerBalance(db, "OMT_System", "USD")).toBe(0);
    });

    it("an FS item IS present but on the SECONDARY provider (not shop_base_system) -> still all General", () => {
      const { sessionId } = seedSessionWithClient(db, {
        name: "Secondary Provider FS",
        phone: "703",
      });
      // shop_base_system stays 'OMT' (fixture default) — this FS item runs on
      // WHISH, the secondary/THROUGH system here, so it must NOT count.
      seedSessionFsItem(db, sessionId, { provider: "WHISH", amountUsd: 40 });
      seedSessionNonSaleItem(db, sessionId, 10);

      service.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 50, direction: "IN" },
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // primarySystemUsd = 0 (fs.provider 'WHISH' != baseSystem 'OMT') -> ratio 0.
      expect(drawerBalance(db, "General", "USD")).toBe(50);
      expect(drawerBalance(db, "OMT_System", "USD")).toBe(0);
    });

    it("the basket is ONLY a primary-system FS item -> all cash goes to the PCD", () => {
      const { sessionId } = seedSessionWithClient(db, {
        name: "Only FS Item",
        phone: "704",
      });
      seedSessionFsItem(db, sessionId, { provider: "OMT", amountUsd: 80 });

      service.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 80, direction: "IN" },
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // ratio = 80/80 = 1 -> pcdUnits = totalUnits, generalUnits = 0.
      expect(drawerBalance(db, "OMT_System", "USD")).toBe(80);
      expect(drawerBalance(db, "General", "USD")).toBe(0);
    });

    it("mixed basket, SEVERAL cash legs (split payment) -> each leg splits independently at the same ratio", () => {
      const { sessionId } = seedSessionWithClient(db, {
        name: "Split Payment Legs",
        phone: "705",
      });
      seedSessionFsItem(db, sessionId, { provider: "OMT", amountUsd: 60 });
      seedSessionNonSaleItem(db, sessionId, 40); // basket total 100 -> ratio 0.6

      service.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 40, direction: "IN" },
          { method: "CASH", currencyCode: "USD", amount: 60, direction: "IN" },
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // leg1: 40 * 0.6 = 24 pcd / 16 general
      // leg2: 60 * 0.6 = 36 pcd / 24 general
      // totals: pcd = 24 + 36 = 60; general = 16 + 24 = 40
      expect(drawerBalance(db, "OMT_System", "USD")).toBe(60);
      expect(drawerBalance(db, "General", "USD")).toBe(40);

      // Two cash legs, each split in two -> 4 payments rows, no more, no fewer.
      expect(paymentRows(db)).toHaveLength(4);
    });

    it("CUSTOMER_ACCOUNT and GIFT_CARD legs are UNTOUCHED by the split, even when ratio > 0", () => {
      const { sessionId } = seedSessionWithClient(db, {
        name: "Non Cash Legs",
        phone: "706",
      });
      // Basket is entirely a primary-system FS item -> ratio would be 1 for
      // any cash-family leg, but neither leg below is cash-family.
      seedSessionFsItem(db, sessionId, { provider: "OMT", amountUsd: 100 });

      service.recordBasketPayment(sessionId, {
        legs: [
          {
            method: "CUSTOMER_ACCOUNT",
            currencyCode: "USD",
            amount: 60,
            direction: "IN",
          },
          {
            method: "GIFT_CARD",
            currencyCode: "USD",
            amount: 40,
            direction: "IN",
            voucherCode: "GC-NONCASH",
          },
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // Neither leg is cash-family — the split branch (and any drawer) is
      // never reached, regardless of how high the ratio is.
      expect(drawerBalance(db, "OMT_System", "USD")).toBe(0);
      expect(drawerBalance(db, "General", "USD")).toBe(0);
      expect(paymentRows(db)).toHaveLength(0); // CUSTOMER_ACCOUNT/GIFT_CARD never write a payments row
      expect(mockRedeemByCode).toHaveBeenCalledTimes(1);
    });

    // ── CLAUDE.md rule 16: flow branches consume IN legs only ────────────────
    it("[rule 16] a CASH OUT (change) leg splits and posts EXACTLY ONCE — no double counting alongside the IN leg", () => {
      const { sessionId } = seedSessionWithClient(db, {
        name: "Change Given",
        phone: "707",
      });
      seedSessionFsItem(db, sessionId, { provider: "OMT", amountUsd: 50 });
      seedSessionNonSaleItem(db, sessionId, 50); // basket total 100 -> ratio 0.5

      service.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 150, direction: "IN" }, // customer hands $150
          { method: "CASH", currencyCode: "USD", amount: 50, direction: "OUT" }, // $50 change back
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // IN leg:  150 * 0.5 = 75 pcd / 75 general (both credited)
      // OUT leg:  50 * 0.5 = 25 pcd / 25 general (both DEBITED — posted once each)
      // net PCD     = 75 - 25 = 50
      // net General = 75 - 25 = 50
      // net total kept by the shop = 100 = the basket total (150 in - 50 change)
      expect(drawerBalance(db, "OMT_System", "USD")).toBe(50);
      expect(drawerBalance(db, "General", "USD")).toBe(50);

      // Exactly 4 payments rows total: 2 for the IN leg's split (pcd + general)
      // + 2 for the OUT leg's split (pcd + general) — if a flow-specific branch
      // additionally iterated a separate `returnLegs` array (rule 16's named
      // trap), this would be 6 rows and the OUT amount would be debited twice.
      const pays = paymentRows(db);
      expect(pays).toHaveLength(4);
      const outRows = pays.filter((p) => p.amount < 0);
      expect(outRows).toHaveLength(2);
      expect(outRows.map((p) => p.amount).sort((a, b) => a - b)).toEqual([
        -25, -25,
      ]);
    });

    it("symmetric by primary system (decision #3): WHISH primary routes to Whish_System, not OMT_System", () => {
      setShopBaseSystem(db, "WHISH");
      const { sessionId } = seedSessionWithClient(db, {
        name: "Whish Primary",
        phone: "710",
      });
      seedSessionFsItem(db, sessionId, { provider: "WHISH", amountUsd: 90 });
      seedSessionNonSaleItem(db, sessionId, 10); // basket total 100 -> ratio 0.9

      service.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 100, direction: "IN" },
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // ratio = 90/100 = 0.9 -> pcdUnits = round(10000 * 0.9) = 9000 -> $90.00
      expect(drawerBalance(db, "Whish_System", "USD")).toBe(90);
      expect(drawerBalance(db, "General", "USD")).toBe(10);
      // The OMT drawer is never touched under a WHISH-primary shop.
      expect(drawerBalance(db, "OMT_System", "USD")).toBe(0);
    });
  });

  // ===========================================================================
  // TASK D — OPEN QUESTION 6b, made explicit and greppable
  // ===========================================================================
  describe("[Task D] OPEN QUESTION 6b — session cart fee convention (UNVERIFIED assumption)", () => {
    it("[OPEN QUESTION 6b] assumes the linked FS cart amount ALREADY INCLUDES the fee (100 principal + 5 fee is linked as 105)", () => {
      const { sessionId } = seedSessionWithClient(db, {
        name: "Fee Convention",
        phone: "708",
      });
      // OPEN QUESTION 6b: 105 = principal 100 + fee 5. This is the file's core
      // assumption about how the frontend constructs the basket line for an FS
      // SEND. If the cart instead links the item at the fee-EXCLUSIVE 100, a
      // customer basket that still collects $105 cash overall would compute a
      // DIFFERENT ratio (100/100 if no line ever carries the fee, or 100/105
      // if the fee shows up as a separate non-primary line) than the one
      // asserted below — re-derive every number in this file if that's confirmed.
      seedSessionFsItem(db, sessionId, {
        provider: "OMT",
        serviceType: "SEND",
        amountUsd: 105,
      });

      service.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 105, direction: "IN" },
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // Under the fee-included convention: ratio = 105/105 = 1 -> all 105 to PCD.
      expect(drawerBalance(db, "OMT_System", "USD")).toBe(105);
      expect(drawerBalance(db, "General", "USD")).toBe(0);
    });

    it("[OPEN QUESTION 6b] a BILL-type primary-system FS row (not SEND/RECEIVE) ALSO counts toward the primary-system subtotal", () => {
      const { sessionId } = seedSessionWithClient(db, {
        name: "Bill Payment Row",
        phone: "709",
      });
      // getSessionCashSplitContext's SQL has no `service_type` filter — SEND,
      // RECEIVE, and BILL all count as long as provider === baseSystem. The
      // plan flags this as unconfirmed-intended (open item 6b, 2nd sentence),
      // not a defect; this test pins the CURRENT behavior so a future change
      // to add a service_type filter shows up here, not as a silent surprise.
      seedSessionFsItem(db, sessionId, {
        provider: "OMT",
        serviceType: "BILL",
        amountUsd: 30,
      });
      seedSessionNonSaleItem(db, sessionId, 70); // basket total 100 -> ratio 0.3

      service.recordBasketPayment(sessionId, {
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 100, direction: "IN" },
        ],
        exchangeRate: 90000,
        userId: 1,
      });

      // ratio = 30/100 = 0.3 -> pcdUnits = round(10000 * 0.3) = 3000 -> $30.00
      expect(drawerBalance(db, "OMT_System", "USD")).toBe(30);
      expect(drawerBalance(db, "General", "USD")).toBe(70);
    });
  });
});
