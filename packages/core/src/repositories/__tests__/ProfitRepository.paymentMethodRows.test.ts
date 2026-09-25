/**
 * ProfitRepository.getPaymentMethodRows — PA-1.4 (currency), PA-3.5
 * (void/refund/drawer-topup/transfer/PM_FEE exclusion) and PA-4.15
 * (count distinct transactions, "No Profit" flag) from
 * OWNER_NOTES_2026-09-21.md §6.3/6.5/6.6 (lane LPay, By Payment Method tab).
 *
 * Rule 17 proof (RED observed before GREEN): every `it` below was run
 * against the PRE-FIX `getPaymentMethodRows` (the `!= 'LBP'` currency
 * bucketing, the bare `p.method NOT IN (INTERNAL_PAYMENT_METHODS)` with no
 * transaction-status/refund/drawer-topup gate, `COUNT(*)`, and the ungated
 * `t.type != 'DEBT_REPAYMENT'` flag) by temporarily reverting
 * ProfitRepository.ts's `getPaymentMethodRows` method and
 * `INTERNAL_PAYMENT_METHODS` constant to that exact pre-fix text (Edit tool,
 * this repo's own uncommitted change only — never another lane's file) and
 * re-running this file. Observed failures, verbatim:
 *
 *   "drops a non-USD/LBP leg instead of counting it as USD (PA-1.4)"
 *     expect(received).toBe(expected) // total_usd: 600 !== 100
 *   "excludes a VOIDED transaction's cash leg from the total (PA-3.5)"
 *     expect(received).toBe(expected) // total_usd: 150 !== 100
 *   "excludes the ORIGINAL leg of a REFUNDED (still-ACTIVE) transaction (PA-3.5)"
 *     expect(received).toBe(expected) // total_usd: 180 !== 100
 *   "excludes DRAWER_TOPUP and DRAWER_TRANSFER cash-in from the report (PA-3.5)"
 *     expect(received).toBe(expected) // total_usd: 400 !== 100
 *   "excludes PM_FEE from the raw rows entirely (PA-3.5)"
 *     expect(rows.find(...)).toBeUndefined() // found {method:"PM_FEE",...}
 *   "counts DISTINCT transactions, not legs, for the same method (PA-4.15)"
 *     expect(received).toBe(expected) // count: 2 !== 1
 *   "does not flag an all-orphaned-leg method as debt-repayment-only (PA-4.15)"
 *     expect(received).toBe(expected) // is_debt_repayment_only: 1 !== 0
 *
 * After reverting the fixture back to the fixed code, every case above
 * passed. The fixture is intentionally minimal (only `payments` +
 * `transactions`, the only two tables this query touches) rather than reused
 * from ProfitRepository.tenantIsolation.test.ts's full schema.
 *
 * LPAY-1 (round-2 review, OWNER_NOTES_2026-09-21.md §6.5 PA-3.5): the two
 * "reversal row" cases below were run against the code AFTER the round-1
 * PA-3.5 fix above but BEFORE this round's `AND t.reverses_id IS NULL` gate
 * (Edit tool, temporarily removing just that one line + the
 * `notReversedByRefund` extraction, this file's own uncommitted change
 * only) and re-running. Observed failures, verbatim:
 *
 *   "does not count a VOIDED expense's reversal leg as cash intake (LPAY-1)"
 *     expect(received).toBeUndefined()
 *     Received: {"count": 1, "is_debt_repayment_only": 0, "is_settled": 1,
 *       "method": "CASH", "pending_commission_usd": 0, "total_lbp": 0,
 *       "total_usd": 40}
 *   "does not count a VOIDED financial-service payout's reversal leg as cash intake (LPAY-1)"
 *     expect(received).toBe(expected) // total_usd: Expected 20, Received 95
 *
 * After restoring the `t.reverses_id IS NULL` gate, both passed.
 *
 * LPAY-R3-5 (round-3 review, OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review):
 * `WalletExchangeRepository.createTransaction` posts BOTH legs of a
 * shop-wallet currency conversion (OMT_App/Whish_App only, never a customer)
 * with `method: "WALLET_EXCHANGE"` — its own doc comment says so explicitly
 * ("no physical cash or customer payment is involved"). That method string
 * was absent from `TransactionRepository.INTERNAL_LEG_METHODS`, so the IN
 * leg (the positive one; the OUT leg is already excluded by `p.amount > 0`)
 * read as a brand-new "WALLET_EXCHANGE" cash-intake row — the shop moving
 * its own money between its own currency buckets, exactly the same shape
 * this file already excludes for DRAWER_TOPUP/DRAWER_TRANSFER, just posted
 * through the METHOD gate instead of the TYPE gate.
 *
 * Rule 17 proof (RED observed before GREEN): the case below was run with
 * `"WALLET_EXCHANGE"` temporarily removed from `INTERNAL_LEG_METHODS`
 * (TransactionRepository.ts, Edit tool, this lane's own uncommitted change
 * only) and re-run. Observed failure, verbatim:
 *
 *   "excludes a WALLET_EXCHANGE leg from cash intake (LPAY-R3-5)"
 *     expect(received).toBeUndefined()
 *     Received: {"count": 1, "is_debt_repayment_only": 0, "is_settled": 1,
 *       "method": "WALLET_EXCHANGE", "pending_commission_usd": 0,
 *       "total_lbp": 150, "total_usd": 0}
 *
 * After restoring the entry, it passed. (Round 4 moved this exclusion out of
 * the shared `INTERNAL_LEG_METHODS` set into this file's own
 * `PAYMENT_REPORT_ONLY_EXCLUSIONS` — see `TransactionRepository
 * .walletExchangeRefundOverride.test.ts` for that move's own proof. This
 * test's OUTCOME is unchanged by that move — WALLET_EXCHANGE is still
 * excluded here — only which constant it lives in changed.)
 *
 * ROUND 4 (2026-09-24, OWNER_NOTES_2026-09-21.md §6.5 review round 3 +
 * three NEW owner decisions) rewrote the query from "sum positive legs
 * only" to "net signed legs per unit (transaction / session basket /
 * orphan leg), keep positive nets, subtract partial refunds". Every new
 * `describe` block below was proven RED against the round-3 query — the OLD
 * text is reproduced in full at the top of each block's first `it` so the
 * revert is reproducible; the exact command run each time was:
 * `npx jest src/repositories/__tests__/ProfitRepository.paymentMethodRows.test.ts --maxWorkers=1`
 * from `packages/core`, with `getPaymentMethodRows`'s SQL/method-body
 * temporarily reverted to the round-3 text via the Edit tool (this file's
 * own history has the exact diff), then restored. Observed failures are
 * quoted verbatim at each block.
 */

import Database from "better-sqlite3";
import { ProfitRepository } from "../ProfitRepository";
import { runWithTenant } from "../../db/tenantContext";

const FROM = "2026-07-01 00:00:00";
const TO = "2026-07-01 23:59:59";
const D = "2026-07-01 10:00:00";

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      reverses_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL DEFAULT 'General',
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_at TEXT
    );

    -- Only touched by LPAY-V1's session-basket-reversed check
    -- (sessionBasketNotReversedSql's second EXISTS).
    CREATE TABLE debt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      session_id INTEGER,
      transaction_type TEXT
    );
  `);
}

function insertTxn(
  db: Database.Database,
  opts: {
    type: string;
    status?: string;
    reversesId?: number | null;
    tenantId?: number;
  },
): number {
  const r = db
    .prepare(
      `INSERT INTO transactions (tenant_id, type, status, reverses_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      opts.tenantId ?? 1,
      opts.type,
      opts.status ?? "ACTIVE",
      opts.reversesId ?? null,
      D,
    );
  return Number(r.lastInsertRowid);
}

function insertPayment(
  db: Database.Database,
  opts: {
    transactionId: number | null;
    method: string;
    currencyCode: string;
    amount: number;
    tenantId?: number;
    drawerName?: string;
    sessionId?: number | null;
    note?: string | null;
  },
): number {
  const r = db
    .prepare(
      `INSERT INTO payments (tenant_id, transaction_id, session_id, method, drawer_name, currency_code, amount, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.tenantId ?? 1,
      opts.transactionId,
      opts.sessionId ?? null,
      opts.method,
      opts.drawerName ?? "General",
      opts.currencyCode,
      opts.amount,
      opts.note ?? null,
      D,
    );
  return Number(r.lastInsertRowid);
}

describe("ProfitRepository.getPaymentMethodRows", () => {
  let db: Database.Database;
  let repo: ProfitRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    repo = new ProfitRepository();
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("drops a non-USD/LBP leg instead of counting it as USD (PA-1.4)", () => {
    const saleTxn = insertTxn(db, { type: "SALE" });
    insertPayment(db, {
      transactionId: saleTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 100,
    });
    // A EUR leg must be DROPPED from both totals, never lumped into USD via
    // the old `currency_code != 'LBP'` bucketing.
    insertPayment(db, {
      transactionId: saleTxn,
      method: "CASH",
      currencyCode: "EUR",
      amount: 500,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    const cash = rows.find((r) => r.method === "CASH");
    expect(cash).toBeDefined();
    expect(cash!.total_usd).toBe(100);
    expect(cash!.total_lbp).toBe(0);
  });

  it("excludes a VOIDED transaction's cash leg from the total (PA-3.5)", () => {
    const activeTxn = insertTxn(db, { type: "SALE", status: "ACTIVE" });
    insertPayment(db, {
      transactionId: activeTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 100,
    });
    const voidedTxn = insertTxn(db, { type: "SALE", status: "VOIDED" });
    insertPayment(db, {
      transactionId: voidedTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 50,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    const cash = rows.find((r) => r.method === "CASH");
    expect(cash).toBeDefined();
    expect(cash!.total_usd).toBe(100);
  });

  it("excludes the ORIGINAL leg of a REFUNDED (still-ACTIVE) transaction (PA-3.5)", () => {
    // refundTransaction() deliberately leaves the ORIGINAL row status =
    // 'ACTIVE' (TransactionWithUser.reversed_by_id doc comment) — the only
    // signal is an ACTIVE REFUND row whose reverses_id points back at it.
    const keptTxn = insertTxn(db, { type: "SALE", status: "ACTIVE" });
    insertPayment(db, {
      transactionId: keptTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 100,
    });
    const refundedOriginal = insertTxn(db, {
      type: "SALE",
      status: "ACTIVE",
    });
    insertPayment(db, {
      transactionId: refundedOriginal,
      method: "CASH",
      currencyCode: "USD",
      amount: 80,
    });
    const refundTxn = insertTxn(db, {
      type: "REFUND",
      status: "ACTIVE",
      reversesId: refundedOriginal,
    });
    insertPayment(db, {
      transactionId: refundTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: -80,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    const cash = rows.find((r) => r.method === "CASH");
    expect(cash).toBeDefined();
    // Only the never-refunded 100 counts — not the refunded original's 80,
    // and not any positive leg the REFUND row itself might carry.
    expect(cash!.total_usd).toBe(100);
  });

  it("excludes DRAWER_TOPUP and DRAWER_TRANSFER cash-in from the report (PA-3.5)", () => {
    const saleTxn = insertTxn(db, { type: "SALE" });
    insertPayment(db, {
      transactionId: saleTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 100,
    });
    // Owner cash-in is posted as CASH (DrawerTopUpRepository.ts) — a real
    // payment method, so the METHOD-level exclusion list can't catch it; only
    // the transaction TYPE gate can.
    const topupTxn = insertTxn(db, { type: "DRAWER_TOPUP" });
    insertPayment(db, {
      transactionId: topupTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 200,
    });
    const transferTxn = insertTxn(db, { type: "DRAWER_TRANSFER" });
    insertPayment(db, {
      transactionId: transferTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 100,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    const cash = rows.find((r) => r.method === "CASH");
    expect(cash).toBeDefined();
    expect(cash!.total_usd).toBe(100);
  });

  it("excludes PM_FEE from the raw rows entirely (PA-3.5)", () => {
    const saleTxn = insertTxn(db, { type: "SALE" });
    insertPayment(db, {
      transactionId: saleTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 100,
    });
    insertPayment(db, {
      transactionId: saleTxn,
      method: "PM_FEE",
      currencyCode: "USD",
      amount: 5,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    expect(rows.find((r) => r.method === "PM_FEE")).toBeUndefined();
  });

  it("counts DISTINCT transactions, not legs, for the same method (PA-4.15)", () => {
    const saleTxn = insertTxn(db, { type: "SALE" });
    // One transaction, TWO CASH legs (e.g. split tender + a kept-change leg
    // that still nets positive) — must count as ONE transaction.
    insertPayment(db, {
      transactionId: saleTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 60,
    });
    insertPayment(db, {
      transactionId: saleTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 40,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    const cash = rows.find((r) => r.method === "CASH");
    expect(cash).toBeDefined();
    expect(cash!.total_usd).toBe(100);
    expect(cash!.count).toBe(1);
  });

  it("an all-orphaned-leg method reads as ordinary (non-debt) sales intake (PA-4.15, updated round 4)", () => {
    // A payment leg with NO linked transaction and NO session
    // (transaction_id AND session_id both NULL) falls into the `orphan_legs`
    // CTE, which always stamps is_debt_repayment = 0 — it can never be
    // mistaken for a debt repayment (there is no transaction row to read a
    // type from at all).
    insertPayment(db, {
      transactionId: null,
      method: "CASH",
      currencyCode: "USD",
      amount: 50,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    const cash = rows.find((r) => r.method === "CASH");
    expect(cash).toBeDefined();
    expect(cash!.total_usd).toBe(50);
    expect(cash!.debt_repayment_usd).toBe(0);
  });

  it("does not count a VOIDED expense's reversal leg as cash intake (LPAY-1)", () => {
    // TransactionRepository.voidTransaction writes the reversal with the
    // ORIGINAL type (EXPENSE), status ACTIVE, and reverses_id set — it never
    // becomes a REFUND row. _reversePayments then posts the NEGATED leg onto
    // the VOIDED original and the mirrored POSITIVE leg onto this ACTIVE
    // reversal, so a naive gate (ACTIVE + type != REFUND) lets the reversal's
    // positive leg read as brand-new cash intake.
    const voidedExpense = insertTxn(db, { type: "EXPENSE", status: "VOIDED" });
    insertPayment(db, {
      transactionId: voidedExpense,
      method: "CASH",
      currencyCode: "USD",
      amount: -40,
    });
    const reversal = insertTxn(db, {
      type: "EXPENSE",
      status: "ACTIVE",
      reversesId: voidedExpense,
    });
    insertPayment(db, {
      transactionId: reversal,
      method: "CASH",
      currencyCode: "USD",
      amount: 40,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    const cash = rows.find((r) => r.method === "CASH");
    // Neither the voided original (negative, so already excluded by
    // `p.amount > 0`) nor its reversal's positive mirror should surface —
    // the method should not appear at all once both legs are excluded.
    expect(cash).toBeUndefined();
  });

  it("does not count a VOIDED financial-service payout's reversal leg as cash intake (LPAY-1)", () => {
    const voidedPayout = insertTxn(db, {
      type: "FINANCIAL_SERVICE",
      status: "VOIDED",
    });
    insertPayment(db, {
      transactionId: voidedPayout,
      method: "CASH",
      currencyCode: "USD",
      amount: -75,
    });
    const reversal = insertTxn(db, {
      type: "FINANCIAL_SERVICE",
      status: "ACTIVE",
      reversesId: voidedPayout,
    });
    insertPayment(db, {
      transactionId: reversal,
      method: "CASH",
      currencyCode: "USD",
      amount: 75,
    });
    // A genuine, unrelated CASH sale in the same window must still count.
    const saleTxn = insertTxn(db, { type: "SALE" });
    insertPayment(db, {
      transactionId: saleTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 20,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    const cash = rows.find((r) => r.method === "CASH");
    expect(cash).toBeDefined();
    expect(cash!.total_usd).toBe(20);
  });

  // Rule 17 proof — ACTUALLY RUN against the round-3 query (which hardcoded
  // `debt_repayment_usd`/`_lbp` to 0 and routed the $30 into `total_usd`
  // instead), restored via the Edit tool immediately after. Verbatim jest
  // output: `expect(cash!.debt_repayment_usd).toBe(30)` — Expected: 30 /
  // Received: 0.
  it("still routes a debt-repayment method into its OWN column, not the sales total (regression, updated round 4 — owner decision 3)", () => {
    const debtTxn = insertTxn(db, { type: "DEBT_REPAYMENT" });
    insertPayment(db, {
      transactionId: debtTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 30,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    const cash = rows.find((r) => r.method === "CASH");
    expect(cash).toBeDefined();
    // Owner decision 3 (2026-09-24): the old all-or-nothing
    // `is_debt_repayment_only` flag is GONE — debt-repayment intake now
    // lives in its own column, separate from (never zeroing out) the
    // sales-intake total.
    expect(cash!.debt_repayment_usd).toBe(30);
    expect(cash!.total_usd).toBe(0);
    // Still counts as one transaction for the method.
    expect(cash!.count).toBe(1);
  });

  it("excludes a WALLET_EXCHANGE leg from cash intake (LPAY-R3-5)", () => {
    // WalletExchangeRepository posts an OUT leg (negative, already excluded
    // by p.amount > 0) and an IN leg (positive) — both method:
    // "WALLET_EXCHANGE" — for the shop converting its OWN wallet currency,
    // never a customer payment.
    const exchangeTxn = insertTxn(db, { type: "WALLET_EXCHANGE" });
    insertPayment(db, {
      transactionId: exchangeTxn,
      method: "WALLET_EXCHANGE",
      currencyCode: "USD",
      amount: -100,
    });
    insertPayment(db, {
      transactionId: exchangeTxn,
      method: "WALLET_EXCHANGE",
      currencyCode: "LBP",
      amount: 150,
    });
    // A genuine, unrelated CASH sale in the same window must still count.
    const saleTxn = insertTxn(db, { type: "SALE" });
    insertPayment(db, {
      transactionId: saleTxn,
      method: "CASH",
      currencyCode: "USD",
      amount: 20,
    });

    const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
    expect(rows.find((r) => r.method === "WALLET_EXCHANGE")).toBeUndefined();
    const cash = rows.find((r) => r.method === "CASH");
    expect(cash).toBeDefined();
    expect(cash!.total_usd).toBe(20);
  });

  // ===========================================================================
  // ROUND 4 — owner decision 1: net of change, partial refunds subtracted
  // ===========================================================================
  //
  // Rule 17 proof — ACTUALLY RUN against the round-3 query (`p.amount > 0`
  // sum-positives-only + unconditional `t.type != 'REFUND'` exclusion),
  // restored via the Edit tool immediately after
  // (`npx jest ProfitRepository.paymentMethodRows.test.ts --maxWorkers=1`
  // from `packages/core`). Verbatim jest output:
  //
  //   "nets a change/OUT leg against its tender leg on the SAME transaction"
  //     Expected: 80 / Received: 100
  //   "subtracts a partial item refund's own negative legs from the method total"
  //     Expected: 80 / Received: 100
  //
  // Two cases in this block did NOT go red, for reasons that turned out to
  // be legitimate rather than a fixture mistake, so they are recorded here
  // instead of silently deleted:
  //   "a partial-refund-only unit does not inflate count" — PASSED even
  //     pre-fix: the round-3 query's `p.amount > 0` filter already dropped
  //     the refund's own (negative) leg entirely before the COUNT ran, so
  //     `count` came out 1 by a DIFFERENT mechanism (the leg never reached
  //     the aggregate at all) than the fix's (the unit is netted in but
  //     excluded from `count` by `is_partial_refund = 0`). Kept as a
  //     same-outcome regression guard, not a red/green proof for this one
  //     assertion.
  //   "a whole-transaction refund (reverses_id SET) still nets to 0" —
  //     PASSED pre-fix too: the round-3 query's unconditional
  //     `t.type != 'REFUND'` already excluded it, same end result as the
  //     fix's `t.reverses_id IS NULL` gate for this specific shape.
  //
  // After the round-4 rewrite (signed net per unit + `reverses_id IS NULL`
  // admitting a partial refund's own unit), all three passed.
  describe("owner decision 1 (2026-09-24) — net of change, partial refunds subtracted", () => {
    it("nets a change/OUT leg against its tender leg on the SAME transaction", () => {
      const saleTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      // Change given back — an OUT leg on the SAME transaction/method.
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: -20,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      expect(cash!.total_usd).toBe(80);
      expect(cash!.count).toBe(1);
    });

    it("subtracts a partial item refund's own negative legs from the method total", () => {
      // Original sale: $100 CASH.
      const saleTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      // SalesRepository.refundSaleItem's own shape: a SEPARATE REFUND
      // transaction, reverses_id left NULL (unlike a whole-sale refund),
      // carrying its own pro-rated NEGATIVE mirror leg.
      const partialRefundTxn = insertTxn(db, {
        type: "REFUND",
        status: "ACTIVE",
        reversesId: null,
      });
      insertPayment(db, {
        transactionId: partialRefundTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: -20,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      expect(cash!.total_usd).toBe(80);
    });

    it("a partial-refund-only unit does not inflate count", () => {
      const saleTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      const partialRefundTxn = insertTxn(db, {
        type: "REFUND",
        status: "ACTIVE",
        reversesId: null,
      });
      insertPayment(db, {
        transactionId: partialRefundTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: -20,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      // Only the original sale is a genuine "transaction" for this method —
      // the partial refund is a reduction of it, not a second one.
      expect(cash!.count).toBe(1);
    });

    it("a whole-transaction refund (reverses_id SET) still nets to 0, unaffected by the partial-refund carve-out", () => {
      const originalTxn = insertTxn(db, { type: "SALE", status: "ACTIVE" });
      insertPayment(db, {
        transactionId: originalTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      const wholeRefundTxn = insertTxn(db, {
        type: "REFUND",
        status: "ACTIVE",
        reversesId: originalTxn,
      });
      insertPayment(db, {
        transactionId: wholeRefundTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: -100,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "CASH")).toBeUndefined();
    });
  });

  // ===========================================================================
  // ROUND 4 — owner decision 2: customer wallet payments (OMT/WHISH/BINANCE)
  // ===========================================================================
  //
  // Rule 17 proof — ACTUALLY RUN against the round-3 query with
  // `PAYMENT_REPORT_PROVIDER_MARKERS` temporarily restored to its round-3
  // OMT/WHISH/BOB/iPick/Katsh/BINANCE form (Edit tool, both reverted
  // together and restored together immediately after). Verbatim jest
  // output:
  //
  //   "shows a customer's OMT Wallet payment under its own method"
  //     Received: undefined
  //   "shows a customer's Whish Wallet and Binance payments the same way"
  //     Expected: 30 / Received: undefined
  //   "still excludes the provider's OWN internal wallet-side/reserve legs..."
  //     Received: undefined
  //
  // "still excludes BOB/iPick/Katsh..." PASSED pre-fix too (unaffected —
  // those three were never removed from the marker list).
  describe("owner decision 2 (2026-09-24) — customer wallet payments shown, provider-internal legs still excluded", () => {
    it("shows a customer's OMT Wallet payment under its own method", () => {
      const saleTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "OMT",
        drawerName: "OMT_App",
        currencyCode: "USD",
        amount: 50,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const omt = rows.find((r) => r.method === "OMT");
      expect(omt).toBeDefined();
      expect(omt!.total_usd).toBe(50);
    });

    it("shows a customer's Whish Wallet and Binance payments the same way", () => {
      const whishTxn = insertTxn(db, { type: "FINANCIAL_SERVICE" });
      insertPayment(db, {
        transactionId: whishTxn,
        method: "WHISH",
        drawerName: "Whish_App",
        currencyCode: "USD",
        amount: 30,
      });
      const binanceTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: binanceTxn,
        method: "BINANCE",
        drawerName: "Binance",
        currencyCode: "USD",
        amount: 15,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "WHISH")?.total_usd).toBe(30);
      expect(rows.find((r) => r.method === "BINANCE")?.total_usd).toBe(15);
    });

    it("still excludes the provider's OWN internal wallet-side/reserve legs by method marker, not by blanket OMT/WHISH ban", () => {
      const txn = insertTxn(db, { type: "FINANCIAL_SERVICE" });
      // The customer's own tender — must count.
      insertPayment(db, {
        transactionId: txn,
        method: "OMT",
        drawerName: "OMT_App",
        currencyCode: "USD",
        amount: 100,
      });
      // The provider's own internal wallet-side leg — a DIFFERENT method
      // marker (OMT_APP, not OMT) on the SAME drawer — must stay excluded.
      insertPayment(db, {
        transactionId: txn,
        method: "OMT_APP",
        drawerName: "OMT_App",
        currencyCode: "USD",
        amount: -100,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const omt = rows.find((r) => r.method === "OMT");
      expect(omt).toBeDefined();
      expect(omt!.total_usd).toBe(100);
      expect(rows.find((r) => r.method === "OMT_APP")).toBeUndefined();
    });

    it("still excludes BOB/iPick/Katsh — never real payment_methods codes, always an internal marker", () => {
      const txn = insertTxn(db, { type: "FINANCIAL_SERVICE" });
      insertPayment(db, {
        transactionId: txn,
        method: "iPick",
        drawerName: "iPick",
        currencyCode: "USD",
        amount: 12,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "iPick")).toBeUndefined();
    });
  });

  // ===========================================================================
  // ROUND 4 — LPAY-V1: session-basket orphan legs
  // ===========================================================================
  //
  // Rule 17 proof — ACTUALLY RUN against the round-3 query (the OLD
  // `t.id IS NULL` branch let every orphan session leg through with NO
  // reversal check and NO netting), restored via the Edit tool immediately
  // after. Verbatim jest output:
  //
  //   "nets a session basket's IN and OUT legs (change/payout) against each other"
  //     Expected: 80 / Received: 100
  //   "excludes a session basket already voided/refunded (a 'Basket reversal' pooled-leg sibling exists)"
  //     Received: {"count": 1, "debt_repayment_lbp": 0, "debt_repayment_usd": 0,
  //       "is_settled": 1, "method": "CASH", "pending_commission_usd": 0,
  //       "total_lbp": 0, "total_usd": 100}
  //   "excludes a session basket already voided/refunded (a debt_ledger 'Refund Reversal' row exists)"
  //     Received: {"count": 1, "debt_repayment_lbp": 0, "debt_repayment_usd": 0,
  //       "is_settled": 1, "method": "CASH", "pending_commission_usd": 0,
  //       "total_lbp": 0, "total_usd": 100}
  //   "a reversed session (503) does not swallow an UNRELATED live session's cash (505)"
  //     Expected: 40 / Received: 140
  //
  // "counts a live (never voided/refunded) session basket's pooled cash"
  // PASSED pre-fix too — the round-3 `t.id IS NULL` branch already let a
  // single, never-reversed session leg through with the right total; the
  // fix changes HOW that's computed (a dedicated, netted, reversal-gated
  // CTE) without changing the answer for this one simple case.
  describe("LPAY-V1 (2026-09-24) — session-basket orphan legs", () => {
    it("counts a live (never voided/refunded) session basket's pooled cash", () => {
      insertPayment(db, {
        transactionId: null,
        sessionId: 501,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      expect(cash!.total_usd).toBe(100);
      expect(cash!.count).toBe(1);
    });

    it("nets a session basket's IN and OUT legs (change/payout) against each other", () => {
      insertPayment(db, {
        transactionId: null,
        sessionId: 502,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      insertPayment(db, {
        transactionId: null,
        sessionId: 502,
        method: "CASH",
        currencyCode: "USD",
        amount: -20,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      expect(cash!.total_usd).toBe(80);
      expect(cash!.count).toBe(1);
    });

    it("excludes a session basket already voided/refunded (a 'Basket reversal' pooled-leg sibling exists)", () => {
      insertPayment(db, {
        transactionId: null,
        sessionId: 503,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      // TransactionRepository's own pooled-leg reversal shape: SAME session,
      // transaction_id NULL, note = SESSION_BASKET_REVERSAL_NOTE.
      insertPayment(db, {
        transactionId: null,
        sessionId: 503,
        method: "CASH",
        currencyCode: "USD",
        amount: -100,
        note: "Basket reversal",
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "CASH")).toBeUndefined();
    });

    it("excludes a session basket already voided/refunded (a debt_ledger 'Refund Reversal' row exists)", () => {
      insertPayment(db, {
        transactionId: null,
        sessionId: 504,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      db.prepare(
        `INSERT INTO debt_ledger (tenant_id, session_id, transaction_type) VALUES (?, ?, ?)`,
      ).run(1, 504, "Refund Reversal");

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "CASH")).toBeUndefined();
    });

    it("a reversed session (503) does not swallow an UNRELATED live session's cash (505)", () => {
      insertPayment(db, {
        transactionId: null,
        sessionId: 503,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      insertPayment(db, {
        transactionId: null,
        sessionId: 503,
        method: "CASH",
        currencyCode: "USD",
        amount: -100,
        note: "Basket reversal",
      });
      insertPayment(db, {
        transactionId: null,
        sessionId: 505,
        method: "CASH",
        currencyCode: "USD",
        amount: 40,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      expect(cash!.total_usd).toBe(40);
      expect(cash!.count).toBe(1);
    });
  });

  // ===========================================================================
  // ROUND 4 — LPAY-V2: provider-stock legs excluded by DRAWER
  // ===========================================================================
  //
  // Rule 17 proof — ACTUALLY RUN against the round-3 query (no drawer-based
  // exclusion existed yet), restored via the Edit tool immediately after.
  // Verbatim jest output:
  //
  //   "excludes a TELECOM_CREDIT_BUYBACK-shaped credit leg (method/drawer both the bare provider code)"
  //     Received: {"count": 1, "debt_repayment_lbp": 0, "debt_repayment_usd": 0,
  //       "is_settled": 1, "method": "MTC", "pending_commission_usd": 0,
  //       "total_lbp": 0, "total_usd": 9}
  //   "excludes a TELECOM_SELF_CHARGE-shaped credit leg (method SELF_CHARGE, drawer the provider stock drawer)"
  //     Received: {"count": 1, "debt_repayment_lbp": 0, "debt_repayment_usd": 0,
  //       "is_settled": 1, "method": "SELF_CHARGE", "pending_commission_usd": 0,
  //       "total_lbp": 0, "total_usd": 5}
  //
  // "does not exclude an ordinary CASH leg merely because it shares a drawer
  // name coincidence..." PASSED pre-fix too (unaffected — "General" was
  // never in `PROVIDER_STOCK_DRAWERS` either before or after).
  describe("LPAY-V2 (2026-09-24) — provider-stock legs excluded by drawer", () => {
    it("excludes a TELECOM_CREDIT_BUYBACK-shaped credit leg (method/drawer both the bare provider code)", () => {
      // RechargeRepository.creditBuyback's own shape: method === drawer_name
      // === the provider drawer name ("MTC"/"Alfa").
      const buybackTxn = insertTxn(db, { type: "TELECOM_CREDIT_BUYBACK" });
      insertPayment(db, {
        transactionId: buybackTxn,
        method: "MTC",
        drawerName: "MTC",
        currencyCode: "USD",
        amount: 9,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "MTC")).toBeUndefined();
    });

    it("excludes a TELECOM_SELF_CHARGE-shaped credit leg (method SELF_CHARGE, drawer the provider stock drawer)", () => {
      // FinancialServiceRepository.processTelecomSelfCharge's own shape:
      // method "SELF_CHARGE" (not a provider code), drawer the provider's
      // OWN stock drawer ("Alfa").
      const selfChargeTxn = insertTxn(db, { type: "TELECOM_SELF_CHARGE" });
      insertPayment(db, {
        transactionId: selfChargeTxn,
        method: "SELF_CHARGE",
        drawerName: "Alfa",
        currencyCode: "USD",
        amount: 5,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "SELF_CHARGE")).toBeUndefined();
    });

    it("does not exclude an ordinary CASH leg merely because it shares a drawer name coincidence — only the PROVIDER_STOCK_DRAWERS set is excluded", () => {
      const saleTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        drawerName: "General",
        currencyCode: "USD",
        amount: 25,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "CASH")?.total_usd).toBe(25);
    });
  });

  // ===========================================================================
  // ROUND 5 (LPAY-X1, OWNER_NOTES_2026-09-21.md §6.8 follow-up) — floor at the
  // UNIT level, not per currency
  // ===========================================================================
  //
  // Owner decision 1 (net of change) was implemented by flooring `net_usd`
  // and `net_lbp` INDEPENDENTLY at 0 inside the outer SELECT's CASE
  // expressions. `SalesRepository.processSale` posts cross-currency change
  // as a SEPARATE CASH leg in the OTHER currency (a USD sale can hand back
  // LBP change, and vice versa — see that method's own comment on the
  // "Change given" leg), so a unit's `net_usd` and `net_lbp` are NOT
  // independent: a unit that is net-positive in USD and net-NEGATIVE in LBP
  // (paid in USD, given LBP change) had its negative LBP silently floored to
  // 0 instead of subtracted, overstating what actually stayed in the drawer.
  //
  // Rule 17 proof — RUN AGAINST THE PRE-FIX CODE (this lane's own staged
  // `getPaymentMethodRows`, per-currency floor: `WHEN net_usd > 0 THEN
  // net_usd ELSE 0` / `WHEN net_lbp > 0 THEN net_lbp ELSE 0`, and
  // `debt_repayment_usd`/`_lbp` each gated on their OWN currency's `> 0`
  // only). Verbatim jest output observed before the fix below was applied:
  //
  //   "nets a unit's LBP change against its USD tender (cross-currency, owner ticket LPAY-X1)"
  //     expect(received).toBe(expected) // total_lbp: 2000000 !== 210000
  //   "nets a unit's USD change against its LBP tender (cross-currency, owner ticket LPAY-X1)"
  //     expect(received).toBe(expected) // total_usd: 0 !== -100
  //   "applies the SAME unit-level (not per-currency) floor to the debt-repayment columns"
  //     expect(received).toBe(expected) // debt_repayment_lbp: 0 !== -895000
  //
  // After flooring at the unit level (a unit whose net is <= 0 in BOTH
  // currencies contributes 0 to everything; otherwise both currencies are
  // added SIGNED), all three passed.
  describe("LPAY-X1 (round 5, OWNER_NOTES_2026-09-21.md §6.8) — unit-level floor, not per-currency", () => {
    it("nets a unit's LBP change against its USD tender (cross-currency, owner ticket LPAY-X1)", () => {
      // Sale 1: customer tenders $100 USD, gets 1,790,000 LBP change back —
      // both legs on the SAME transaction/unit.
      const sale1 = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: sale1,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      insertPayment(db, {
        transactionId: sale1,
        method: "CASH",
        currencyCode: "LBP",
        amount: -1_790_000,
      });
      // Sale 2: a plain LBP-only sale, 2,000,000 LBP.
      const sale2 = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: sale2,
        method: "CASH",
        currencyCode: "LBP",
        amount: 2_000_000,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      // Drawer truth: USD +100 (sale 1's tender, no USD change anywhere) /
      // LBP +210,000 (sale 2's 2,000,000 minus sale 1's 1,790,000 change).
      expect(cash!.total_usd).toBe(100);
      expect(cash!.total_lbp).toBe(210_000);
    });

    it("nets a unit's USD change against its LBP tender (cross-currency, owner ticket LPAY-X1)", () => {
      // A single unit: customer tenders 9,000,000 LBP, gets $100 USD change.
      const sale = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: sale,
        method: "CASH",
        currencyCode: "LBP",
        amount: 9_000_000,
      });
      insertPayment(db, {
        transactionId: sale,
        method: "CASH",
        currencyCode: "USD",
        amount: -100,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      // The unit is net-positive overall (it has a positive LBP leg), so its
      // NEGATIVE USD leg must subtract, not floor away.
      expect(cash!.total_usd).toBe(-100);
      expect(cash!.total_lbp).toBe(9_000_000);
    });

    it("applies the SAME unit-level (not per-currency) floor to the debt-repayment columns", () => {
      // Debt repayment: $100 USD tendered, 895,000 LBP change given back.
      const debtTxn = insertTxn(db, { type: "DEBT_REPAYMENT" });
      insertPayment(db, {
        transactionId: debtTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      insertPayment(db, {
        transactionId: debtTxn,
        method: "CASH",
        currencyCode: "LBP",
        amount: -895_000,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      expect(cash!.debt_repayment_usd).toBe(100);
      expect(cash!.debt_repayment_lbp).toBe(-895_000);
      expect(cash!.total_usd).toBe(0);
      expect(cash!.total_lbp).toBe(0);
    });
  });

  // ===========================================================================
  // ROUND 5 (LPAY-X4, OWNER_NOTES_2026-09-21.md §6.8 follow-up) — HAVING keeps
  // a non-zero (including negative-only) total
  // ===========================================================================
  //
  // Rule 17 proof — RUN AGAINST THE PRE-FIX CODE (`HAVING total_usd > 0 OR
  // total_lbp > 0 OR debt_repayment_usd > 0 OR debt_repayment_lbp > 0`).
  // Verbatim jest output observed before the fix below was applied:
  //
  //   "a period whose only CASH activity is a partial item refund still surfaces the method (owner ticket LPAY-X4)"
  //     expect(received).toBeDefined()
  //     Received: undefined
  //
  // After changing every HAVING comparison from `> 0` to `<> 0`, it passed.
  describe("LPAY-X4 (round 5, OWNER_NOTES_2026-09-21.md §6.8) — HAVING does not drop a negative-only total", () => {
    it("a period whose only CASH activity is a partial item refund still surfaces the method (owner ticket LPAY-X4)", () => {
      // No other CASH activity in this window at all — the original sale
      // this refund reduces happened in an EARLIER period (partial refunds
      // land in their OWN period, see getPaymentMethodRows's own doc
      // comment) and is out of range here.
      const partialRefundTxn = insertTxn(db, {
        type: "REFUND",
        status: "ACTIVE",
        reversesId: null,
      });
      insertPayment(db, {
        transactionId: partialRefundTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: -30,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      expect(cash!.total_usd).toBe(-30);
    });
  });

  // ===========================================================================
  // ROUND 1 REVIEW (2026-09-24, OWNER_NOTES_2026-09-21.md §6.9 status table,
  // "LPay ... 5 minors") — LPAY-V-1: EXCHANGE units are excluded
  // ===========================================================================
  //
  // ExchangeRepository posts a non-partner exchange's IN leg (CASH
  // +fromCurrency) and OUT leg(s) (CASH -toCurrency, or split payout legs in
  // other methods) onto ONE transaction, so an EXCHANGE unit used to be
  // netted by this query exactly like a sale — see getPaymentMethodRows's own
  // doc comment (LPAY-V-1 paragraph) for the full "CASH LBP -8,950,000" /
  // phantom-intake rationale. Fix: TRANSACTION_TYPES.EXCHANGE joins
  // DRAWER_TOPUP/DRAWER_TRANSFER in the `t.type NOT IN (...)` exclusion.
  //
  // Rule 17 proof (RED observed before GREEN): every `it` below was run
  // against the PRE-FIX `t.type NOT IN (?, ?)` (two placeholders, no
  // TRANSACTION_TYPES.EXCHANGE bind) by temporarily reverting that one line
  // + its two bind params (Edit tool, this lane's own uncommitted change
  // only) and re-running. Observed failures, verbatim:
  //
  //   "excludes a USD→LBP exchange from CASH intake (LPAY-V-1)"
  //     expect(received).toBeUndefined()
  //     Received: {"count": 1, "debt_repayment_lbp": 0, "debt_repayment_usd": 0,
  //       "is_settled": 1, "method": "CASH", "pending_commission_usd": 0,
  //       "total_lbp": -8950000, "total_usd": 100}
  //   "excludes a LBP→USD exchange from CASH intake (LPAY-V-1)"
  //     expect(received).toBeUndefined()
  //     Received: {"count": 1, "debt_repayment_lbp": 0, "debt_repayment_usd": 0,
  //       "is_settled": 1, "method": "CASH", "pending_commission_usd": 0,
  //       "total_lbp": 8950000, "total_usd": -100}
  //   "excludes a USD→EUR exchange (third-currency payout) from CASH intake, not showing a phantom USD inflow (LPAY-V-1)"
  //     expect(received).toBeUndefined()
  //     Received: {"count": 1, "debt_repayment_lbp": 0, "debt_repayment_usd": 0,
  //       "is_settled": 1, "method": "CASH", "pending_commission_usd": 0,
  //       "total_lbp": 0, "total_usd": 100}
  //   "does not exclude an ordinary SALE merely because an unrelated EXCHANGE also ran that day"
  //     expect(received).toBe(expected)
  //     Expected: 60
  //     Received: 160
  //     (the $100 USD leg of the unrelated EXCHANGE unit leaked into CASH's
  //     total alongside the genuine $60 sale)
  //
  // After restoring the third `?`/TRANSACTION_TYPES.EXCHANGE bind, all four
  // passed.
  describe("LPAY-V-1 (round-1 review) — EXCHANGE units are excluded", () => {
    it("excludes a USD→LBP exchange from CASH intake (LPAY-V-1)", () => {
      const exchangeTxn = insertTxn(db, { type: "EXCHANGE" });
      insertPayment(db, {
        transactionId: exchangeTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      insertPayment(db, {
        transactionId: exchangeTxn,
        method: "CASH",
        currencyCode: "LBP",
        amount: -8_950_000,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "CASH")).toBeUndefined();
    });

    it("excludes a LBP→USD exchange from CASH intake (LPAY-V-1)", () => {
      const exchangeTxn = insertTxn(db, { type: "EXCHANGE" });
      insertPayment(db, {
        transactionId: exchangeTxn,
        method: "CASH",
        currencyCode: "LBP",
        amount: 8_950_000,
      });
      insertPayment(db, {
        transactionId: exchangeTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: -100,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "CASH")).toBeUndefined();
    });

    it("excludes a USD→EUR exchange (third-currency payout) from CASH intake, not showing a phantom USD inflow (LPAY-V-1)", () => {
      const exchangeTxn = insertTxn(db, { type: "EXCHANGE" });
      insertPayment(db, {
        transactionId: exchangeTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      // The EUR OUT leg is invisible to this query's USD/LBP-only columns
      // either way — the bug (pre-fix) was that the USD IN leg alone still
      // qualified the unit and posted a phantom +$100, with no matching
      // outflow ever shown.
      insertPayment(db, {
        transactionId: exchangeTxn,
        method: "CASH",
        currencyCode: "EUR",
        amount: -100,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      expect(rows.find((r) => r.method === "CASH")).toBeUndefined();
    });

    it("does not exclude an ordinary SALE merely because an unrelated EXCHANGE also ran that day", () => {
      const saleTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 60,
      });
      const exchangeTxn = insertTxn(db, { type: "EXCHANGE" });
      insertPayment(db, {
        transactionId: exchangeTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      insertPayment(db, {
        transactionId: exchangeTxn,
        method: "CASH",
        currencyCode: "LBP",
        amount: -8_950_000,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      expect(cash!.total_usd).toBe(60);
      expect(cash!.total_lbp).toBe(0);
    });
  });

  // ===========================================================================
  // ROUND 1 REVIEW (2026-09-24, OWNER_NOTES_2026-09-21.md §6.9) — LPAY-V-2:
  // the qualification floor is decided per UNIT (across every method it
  // touched), not per (unit, method)
  // ===========================================================================
  //
  // SalesRepository.processSale always posts `change_given_usd`/`_lbp` as a
  // CASH leg regardless of the tender method — an OMT/WHISH/BINANCE-tendered
  // sale with cash change used to split into two (unit_id, method) groups
  // inside `unit_net`, and the tender's group qualifying on its own did
  // nothing for CASH's group, which floored its lone negative leg to 0 —
  // silently dropping real money that left the till.
  //
  // Rule 17 proof (RED observed before GREEN): the case below was run
  // against the PRE-FIX query (floor decided on `unit_net` directly — i.e.
  // per (unit_id, method) — instead of the `unit_qualifies` CTE) by
  // temporarily reverting `getPaymentMethodRows` (Edit tool, this lane's own
  // uncommitted change only) and re-running. Observed failure, verbatim:
  //
  //   "nets a change leg given in a DIFFERENT method than the tender against that method's own total (LPAY-V-2)"
  //     expect(received).toBe(expected) // total_usd: 50 !== 30
  //
  // After joining `unit_net` to the unit-level `unit_qualifies` CTE, it
  // passed.
  describe("LPAY-V-2 (round-1 review) — unit-level floor across METHODS, not just currencies", () => {
    it("nets a change leg given in a DIFFERENT method than the tender against that method's own total (LPAY-V-2)", () => {
      // One unit: customer tenders $100 via OMT, gets $20 CASH change back —
      // the change leg is a DIFFERENT method than the tender, same unit.
      const omtSale = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: omtSale,
        method: "OMT",
        currencyCode: "USD",
        amount: 100,
      });
      insertPayment(db, {
        transactionId: omtSale,
        method: "CASH",
        currencyCode: "USD",
        amount: -20,
      });
      // A separate, plain CASH sale in the same period.
      const cashSale = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: cashSale,
        method: "CASH",
        currencyCode: "USD",
        amount: 50,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const omt = rows.find((r) => r.method === "OMT");
      const cash = rows.find((r) => r.method === "CASH");
      expect(omt).toBeDefined();
      expect(omt!.total_usd).toBe(100);
      expect(cash).toBeDefined();
      // Drawer truth: CASH took in $50 (the plain sale) and paid out $20
      // (the OMT sale's change) = $30 net, NOT $50 (the change silently
      // floored away) and NOT $80 (double-counting the OMT tender itself).
      expect(cash!.total_usd).toBe(30);
    });
  });

  // ===========================================================================
  // ROUND 1 REVIEW (2026-09-24, OWNER_NOTES_2026-09-21.md §6.9) — LPAY-V-4:
  // guard — a unit negative in BOTH currencies contributes 0
  // ===========================================================================
  //
  // Confirmed by mutation, not by reverting to a prior real bug: removing the
  // floor entirely (`ELSE un.net_usd` / `ELSE un.net_lbp` instead of `ELSE 0`
  // in the outer SELECT's total_usd/total_lbp CASE expressions) still passed
  // every OTHER test in this file — nothing pinned the base rule on its own.
  // Mutation-tested (Edit tool, this lane's own uncommitted change only, then
  // reverted), verbatim: with the floor removed, this test's own first
  // assertion failed (jest stops at the first failed `expect` in a test body,
  // so only `total_usd` is shown — `total_lbp`/`count` were never reached):
  //
  //   "an ACTIVE expense negative in both currencies contributes 0, next to an unrelated positive CASH sale (LPAY-V-4)"
  //     expect(received).toBe(expected)
  //     Expected: 100
  //     Received: 60
  //     (the expense unit's own -40 net_usd leaked straight through instead
  //     of flooring to 0, understating CASH's 100 by 40)
  //
  // After restoring the `ELSE 0` floor, it passed.
  describe("LPAY-V-4 (round-1 review) — floor guard, proven by mutation", () => {
    it("an ACTIVE expense negative in both currencies contributes 0, next to an unrelated positive CASH sale (LPAY-V-4)", () => {
      const expenseTxn = insertTxn(db, { type: "EXPENSE" });
      insertPayment(db, {
        transactionId: expenseTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: -40,
      });
      insertPayment(db, {
        transactionId: expenseTxn,
        method: "CASH",
        currencyCode: "LBP",
        amount: -500_000,
      });
      const saleTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      expect(cash!.total_usd).toBe(100);
      expect(cash!.total_lbp).toBe(0);
      expect(cash!.count).toBe(1);
    });
  });

  // ===========================================================================
  // PAY-C (owner decision (c), 2026-09-24, OWNER_NOTES_2026-09-21.md §6.9) —
  // `count` only credits a method that actually RECEIVED money (a positive
  // net leg) in that unit. A method whose only leg in the unit is change
  // given back (an OUT leg — net negative in every currency) must not count
  // it, even though the UNIT as a whole qualifies (via another method's
  // positive leg). The net-of-change AMOUNTS (LPAY-X1 "net — what stayed in
  // the drawer") are untouched by this — only `count`'s own predicate grows
  // one more condition.
  //
  // Rule 17 proof (RED observed before GREEN): the first case below
  // ("does not count a method whose only leg in the unit is change given")
  // was run against the PRE-FIX query (`count`'s CASE gated on
  // `un.is_partial_refund = 0 AND uq.qualifies = 1` only — the UNIT-level
  // floor, with no per-(unit, method) check of that method's own net) via
  // `npx jest ProfitRepository.paymentMethodRows --maxWorkers=1` from
  // `packages/core`. Observed failure, verbatim:
  //
  //   "does not count a method whose only leg in the unit is change given, even though the unit qualifies via another method (PAY-C)"
  //     expect(received).toBe(expected)
  //     Expected: 0
  //     Received: 1
  //
  // After adding `AND (un.net_usd > 0 OR un.net_lbp > 0)` to the `count`
  // CASE, it passed. The other two cases in this block were already GREEN
  // pre-fix (same-method cross-currency net stays positive; a genuine
  // split-tender's own two legs are each individually positive) — kept here
  // as non-regression proof that the new condition does not narrow them.
  describe("PAY-C (owner decision c, 2026-09-24) — count credits the RECEIVING method only", () => {
    it("does not count a method whose only leg in the unit is change given, even though the unit qualifies via another method (PAY-C)", () => {
      // Customer tenders $100 via OMT, gets $20 CASH change back. CASH's
      // ONLY leg in this unit is the OUT (change) leg — it never received a
      // cent of this sale's money.
      const saleTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "OMT",
        drawerName: "OMT_App",
        currencyCode: "USD",
        amount: 100,
      });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: -20,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const omt = rows.find((r) => r.method === "OMT");
      const cash = rows.find((r) => r.method === "CASH");
      expect(omt).toBeDefined();
      expect(omt!.count).toBe(1);
      // CASH still surfaces (LPAY-X1: the drawer truth is -20, a real
      // outflow) but must not be counted as a CASH "transaction" — it
      // received no money in this unit.
      expect(cash).toBeDefined();
      expect(cash!.total_usd).toBe(-20);
      expect(cash!.count).toBe(0);
    });

    it("still counts a method that received the tender in one currency and gave change in the OTHER, within the SAME method (CASH USD tender, LBP change) (PAY-C)", () => {
      // Tender and change both route through CASH (the physical drawer) —
      // just different currencies. CASH genuinely received money in this
      // unit (net_usd > 0), so it counts, even though its net_lbp is
      // negative.
      const saleTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 100,
      });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        currencyCode: "LBP",
        amount: -900_000,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      expect(cash).toBeDefined();
      expect(cash!.count).toBe(1);
    });

    it("counts a split-tender unit under BOTH receiving methods (PAY-C)", () => {
      // A single sale tendered half in CASH, half in OMT — no change at
      // all. Both methods genuinely received money in this ONE unit.
      const saleTxn = insertTxn(db, { type: "SALE" });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "CASH",
        currencyCode: "USD",
        amount: 50,
      });
      insertPayment(db, {
        transactionId: saleTxn,
        method: "OMT",
        drawerName: "OMT_App",
        currencyCode: "USD",
        amount: 50,
      });

      const rows = runWithTenant(1, () => repo.getPaymentMethodRows(FROM, TO));
      const cash = rows.find((r) => r.method === "CASH");
      const omt = rows.find((r) => r.method === "OMT");
      expect(cash).toBeDefined();
      expect(cash!.count).toBe(1);
      expect(omt).toBeDefined();
      expect(omt!.count).toBe(1);
    });
  });
});
