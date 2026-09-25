/**
 * LPAY-V3 (OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review, round 3) — a prior
 * round of this lane added `"WALLET_EXCHANGE"` to the SHARED, exported
 * `TransactionRepository.INTERNAL_LEG_METHODS` set so the Profits "By
 * Payment" report would stop counting a wallet-exchange leg as customer cash
 * intake. That set is NOT report-only, though — `isInternalLegJs` (built
 * from it) also feeds `isOverridableLeg`, which gates
 * `_validateRefundLegOverride`/`_reversePayments` (the LIRA-078
 * refund-tender-override feature) — a genuinely different, money-moving
 * consumer of the same constant. This lane's money invariant is
 * reporting-only: no non-report code path may change behaviour. The fix
 * moves `"WALLET_EXCHANGE"` OUT of the shared set into `ProfitRepository`'s
 * own report-only exclusion list (`PAYMENT_REPORT_ONLY_EXCLUSIONS`).
 *
 * RULE-17 PROVENANCE — what was ACTUALLY run, not inferred:
 *
 * The reviewer's framing was "a refund override on a WALLET_EXCHANGE is now
 * REJECTED where it used to be ACCEPTED" (implying this fix should turn a
 * throw into a success). That was checked directly, twice, by toggling ONLY
 * the `"WALLET_EXCHANGE"` line in `INTERNAL_LEG_METHODS` and re-running the
 * "with a real payment_methods table" case below (`--maxWorkers=1`) against
 * each state:
 *
 *   - WALLET_EXCHANGE PRESENT in the shared set (tree as found): threw
 *     `DatabaseError: Refund method override: USD totals do not match the
 *     original payment — original 0, refund legs total 100`
 *   - WALLET_EXCHANGE REMOVED from the shared set (HEAD's shape): threw the
 *     EXACT SAME message, verbatim, at the same line.
 *
 * Reason (verified by reading, not guessed): `isOverridableLeg(p)` is
 * `!isInternalLegJs(p) && isDrawerAffectingMethod(p.method)`. In the
 * production shape (a real, seeded `payment_methods` table — TenantRepository
 * .seedPaymentMethods never writes a "WALLET_EXCHANGE" row),
 * `isDrawerAffectingMethod("WALLET_EXCHANGE")` resolves to `false` on its
 * OWN, independent of `INTERNAL_LEG_METHODS`, via the "code not in
 * `payment_methods` AND not in `CANONICAL_METHODS`" branch
 * (`utils/payments.ts`'s `UNREGISTERED_METHOD_IS_DRAWER_AFFECTING = false`)
 * — so `isOverridableLeg` is `false` for a WALLET_EXCHANGE leg EITHER WAY,
 * and `_overridableNetByCurrency` excludes it from `originalNet` in both
 * code states. **This specific path shows no observable regression in the
 * shape the running app actually uses** — the two tests below pin that
 * invariance so it stays true.
 *
 * The fix is still made (see the file header above) because `isInternalLegJs`
 * has OTHER direct consumers that are NOT gated by `isDrawerAffectingMethod`
 * — `getCustomerFacingLegs` (service receipts) and `customerCashLegSql` (the
 * D1 cash-flow report) both read `INTERNAL_LEG_METHODS` membership straight,
 * so THEY would have silently changed behaviour for a WALLET_EXCHANGE leg
 * had the entry stayed in the shared set. That is a real blast-radius
 * concern even though the refund-override path itself, checked here,
 * happens not to be affected — the shared-tree protocol for this lane is
 * "move it to the report-owned list regardless," not "only if a live bug is
 * found," and this file exists to make sure that move never regresses this
 * ADJACENT path either.
 */

import Database from "better-sqlite3";
import {
  TransactionRepository,
  resetTransactionRepository,
  type RefundLegOverride,
} from "../TransactionRepository.js";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const SCHEMA = `
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('OMT_App', 'LBP', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'USD', 0);
    INSERT INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('General', 'LBP', 0);

    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      session_id INTEGER,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      covered_usd REAL NOT NULL DEFAULT 0,
      covered_lbp REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE wallet_exchanges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      tenant_id INTEGER DEFAULT 1
    );
    INSERT INTO wallet_exchanges (id) VALUES (1);

    CREATE TABLE payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      affects_drawer INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- Same codes TenantRepository.seedPaymentMethods actually seeds — note
    -- there is deliberately NO "WALLET_EXCHANGE" row, matching production.
    INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, is_active, is_system) VALUES
      ('CASH', 'Cash', 'General', 1, 1, 1),
      ('OMT', 'OMT Wallet', 'OMT_App', 1, 1, 0),
      ('WHISH', 'Whish Wallet', 'Whish_App', 1, 1, 0),
      ('BINANCE', 'Binance', 'Binance', 1, 1, 0),
      ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 1, 1),
      ('GIFT_CARD', 'Gift Card / Voucher', 'General', 0, 1, 1);
`;

function drawer(db: Database.Database, name: string, ccy = "USD"): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
    )
    .get(name, ccy) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/** Mirrors `WalletExchangeRepository.createTransaction`'s own shape exactly:
 *  ONE transaction, TWO legs both posted with method "WALLET_EXCHANGE" to
 *  the SAME wallet drawer — OUT leg in the source currency, IN leg in the
 *  destination currency. USD -> LBP, $100 -> 8,900,000 LBP @ 89,000. */
function insertWalletExchangeTxn(db: Database.Database): number {
  const txn = db
    .prepare(
      `INSERT INTO transactions (type, source_table, source_id, user_id, amount_usd, amount_lbp, summary)
       VALUES ('WALLET_EXCHANGE', 'wallet_exchanges', 1, 1, -100, 8900000, 'OMT App Exchange: $100.00 -> 8,900,000 LBP')`,
    )
    .run();
  const txnId = Number(txn.lastInsertRowid);
  db.prepare(
    `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
     VALUES (?, 'WALLET_EXCHANGE', 'OMT_App', 'USD', -100, 'Wallet exchange: USD -> LBP', 1)`,
  ).run(txnId);
  db.prepare(
    `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
     VALUES (?, 'WALLET_EXCHANGE', 'OMT_App', 'LBP', 8900000, 'Wallet exchange: USD -> LBP', 1)`,
  ).run(txnId);
  db.prepare(
    `UPDATE drawer_balances SET balance = balance - 100 WHERE drawer_name = 'OMT_App' AND currency_code = 'USD'`,
  ).run();
  db.prepare(
    `UPDATE drawer_balances SET balance = balance + 8900000 WHERE drawer_name = 'OMT_App' AND currency_code = 'LBP'`,
  ).run();
  return txnId;
}

describe("LPAY-V3 — WALLET_EXCHANGE refund-override parity with git HEAD (production payment_methods shape)", () => {
  let db: Database.Database;
  let txnRepo: TransactionRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA);
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetPaymentMethodRepository();
    txnRepo = new TransactionRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetTransactionRepository();
    resetPaymentMethodRepository();
    resetTenantContext();
  });

  it("a refund-legs override on a WALLET_EXCHANGE txn is rejected as a totals mismatch — byte-identical to HEAD (see file header for the verified A/B toggle)", () => {
    const txnId = insertWalletExchangeTxn(db);
    const refundLegs: RefundLegOverride[] = [
      { method: "CASH", currencyCode: "USD", amount: 100 },
    ];

    // Both WALLET_EXCHANGE legs are excluded from `originalNet` (by
    // `isOverridableLeg`), so the USD side of the override has nothing to
    // match against — same rejection, same wording, whether the entry is
    // IN or OUT of INTERNAL_LEG_METHODS (see file header: verified both
    // ways, identical DatabaseError message).
    expect(() =>
      txnRepo.refundTransaction(txnId, 1, { refundLegs }),
    ).toThrow(
      /Refund method override: USD totals do not match the original payment — original 0, refund legs total 100/,
    );

    // Nothing written, nothing moved — the guard runs before any write.
    expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(-100, 2);
    expect(drawer(db, "OMT_App", "LBP")).toBeCloseTo(8_900_000, 0);
    expect(drawer(db, "General", "USD")).toBeCloseTo(0, 2);
  });

  it("plain refund (no override) still mirrors both WALLET_EXCHANGE legs verbatim — unaffected either way", () => {
    const txnId = insertWalletExchangeTxn(db);
    txnRepo.refundTransaction(txnId, 1);

    // Both legs round-trip back to the pre-exchange baseline — the default
    // (non-override) mirror path never consulted isOverridableLeg at all.
    expect(drawer(db, "OMT_App", "USD")).toBeCloseTo(0, 2);
    expect(drawer(db, "OMT_App", "LBP")).toBeCloseTo(0, 0);
  });
});
