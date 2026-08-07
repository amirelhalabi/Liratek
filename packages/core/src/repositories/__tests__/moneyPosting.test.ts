/**
 * moneyPosting.ts — reconcileLegs (Payment-Legs Integrity plan, S2 seed of
 * CQ-3's moneyPosting.ts shared helper)
 *
 * Pure unit tests for the hard-reject reconciliation math, isolated from any
 * repository/DB. See FinancialServiceRepository/RechargeRepository wiring
 * tests for the integration-level "rejected atomically" proof.
 */

import Database from "better-sqlite3";
import {
  reconcileLegs,
  expectedTotalIn,
  LEG_RECONCILIATION_EPSILON_USD,
  TENDER_RATE_BAND_PCT,
  assertPartnerIdRequired,
  assertNoCounterPayment,
  assertNoCustomerAccountLeg,
  bookClientDebtCharge,
  resolveStampedExchangeRate,
  type ReconciliationLeg,
} from "../moneyPosting";

const RATE = 90000; // 90,000 LBP per USD

function leg(
  currencyCode: "USD" | "LBP",
  amount: number,
  extra: Partial<ReconciliationLeg> = {},
): ReconciliationLeg {
  return { method: "CASH", currencyCode, amount, ...extra };
}

describe("reconcileLegs", () => {
  describe("no legs → bypass (legacy/scripted callers unaffected)", () => {
    it("does nothing when inLegs is undefined", () => {
      expect(() =>
        reconcileLegs({
          inLegs: undefined,
          expectedTotals: expectedTotalIn(999, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("does nothing when inLegs is an empty array", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [],
          expectedTotals: expectedTotalIn(999, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("does nothing when inLegs is null", () => {
      expect(() =>
        reconcileLegs({
          inLegs: null,
          expectedTotals: expectedTotalIn(50, "LBP"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });
  });

  describe("exact match", () => {
    it("passes on an exact single-currency USD match", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 100)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("passes on an exact single-currency LBP match", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("LBP", 900000)],
          expectedTotals: expectedTotalIn(900000, "LBP"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("passes on a cross-currency single leg converted at the stamped rate", () => {
      // $10 owed, tendered entirely as 900,000 LBP at rate 90,000.
      expect(() =>
        reconcileLegs({
          inLegs: [leg("LBP", 900000)],
          expectedTotals: expectedTotalIn(10, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("passes on mixed-currency legs summing exactly to the expected total", () => {
      // $52 owed: $30 cash + 1,980,000 LBP (=$22 at rate 90,000).
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 30), leg("LBP", 1_980_000)],
          expectedTotals: expectedTotalIn(52, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });
  });

  describe("epsilon edges ($0.05 USD-equivalent)", () => {
    it("passes at exactly $0.049 under", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 99.951)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("passes at exactly $0.049 over", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 100.049)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("throws at exactly $0.051 under", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 99.949)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/do not reconcile/);
    });

    it("throws at exactly $0.051 over", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 100.051)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/do not reconcile/);
    });

    it("epsilon constant is exactly 0.05", () => {
      expect(LEG_RECONCILIATION_EPSILON_USD).toBe(0.05);
    });
  });

  describe("tenderExchangeRate — reconcile at the till's own rate, banded against the server rate", () => {
    it("band constant is exactly 0.10 (±10%)", () => {
      expect(TENDER_RATE_BAND_PCT).toBe(0.1);
    });

    it(
      "owner repro: MTC CREDIT_TRANSFER, 720,000 LBP price, $10 IN, 170,000 LBP OUT — " +
        "THROWS at the server sell rate (90,000)",
      () => {
        // $10 tendered, 170,000 LBP change — the till computed change at its
        // own (buy) rate of 89,000: 720,000/89,000 = $8.09, 10 - 8.09 = $1.91
        // change in USD-equivalent -> 1.91 * 89,000 ~= 170,000 LBP. Reconciling
        // at the STAMPED sell rate (90,000) instead makes the same legs look
        // like they undershoot by ~$0.11 — the exact false-reject this fix
        // kills, reproduced with NO tenderExchangeRate supplied (pre-fix shape).
        expect(() =>
          reconcileLegs({
            inLegs: [leg("USD", 10)],
            outLegs: [leg("LBP", 170_000, { direction: "OUT" })],
            expectedTotals: expectedTotalIn(720_000, "LBP"),
            exchangeRate: 90_000,
            context: "MTC CREDIT_TRANSFER recharge",
          }),
        ).toThrow(/do not reconcile/);
      },
    );

    it("FIXED: the same legs reconcile when tenderExchangeRate (89,000, the till's own rate) is supplied", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 10)],
          outLegs: [leg("LBP", 170_000, { direction: "OUT" })],
          expectedTotals: expectedTotalIn(720_000, "LBP"),
          exchangeRate: 90_000,
          tenderExchangeRate: 89_000,
          context: "MTC CREDIT_TRANSFER recharge",
        }),
      ).not.toThrow();
    });

    it("a genuinely broken payment (dropped OUT leg) STILL throws at the tender rate", () => {
      // Same owner scenario, but the 170,000 LBP change leg never got
      // recorded at all — reconciling at 89,000 must still reject this; the
      // tender rate fixes a rate MISMATCH, not a real leg-dropping bug.
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 10)],
          expectedTotals: expectedTotalIn(720_000, "LBP"),
          exchangeRate: 90_000,
          tenderExchangeRate: 89_000,
          context: "MTC CREDIT_TRANSFER recharge",
        }),
      ).toThrow(/do not reconcile/);
    });

    it("passes at exactly the +10% band boundary (single-currency legs, rate-independent math)", () => {
      // USD-only legs: the chosen rate never enters the arithmetic (division
      // by rate on a zero LBP amount), isolating the band decision itself.
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 100)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: 90_000,
          tenderExchangeRate: 99_000, // exactly +10%
          context: "test",
        }),
      ).not.toThrow();
    });

    it("passes at exactly the -10% band boundary", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 100)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: 90_000,
          tenderExchangeRate: 81_000, // exactly -10%
          context: "test",
        }),
      ).not.toThrow();
    });

    it("REJECTS a tender rate just outside the +10% band with a DISTINCT error (not 'do not reconcile')", () => {
      let message = "";
      expect(() => {
        try {
          reconcileLegs({
            inLegs: [leg("USD", 100)],
            expectedTotals: expectedTotalIn(100, "USD"),
            exchangeRate: 90_000,
            tenderExchangeRate: 99_001, // just over +10%
            context: "test",
          });
        } catch (e) {
          message = (e as Error).message;
          throw e;
        }
      }).toThrow();
      expect(message).not.toMatch(/do not reconcile/);
      expect(message).toMatch(/outside the accepted/);
      expect(message).toContain("99001");
      expect(message).toContain("90000");
    });

    it("REJECTS a wildly implausible tender rate (e.g. 40,000 vs. a 90,000 server rate)", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 10)],
          outLegs: [leg("LBP", 170_000, { direction: "OUT" })],
          expectedTotals: expectedTotalIn(720_000, "LBP"),
          exchangeRate: 90_000,
          tenderExchangeRate: 40_000,
          context: "MTC CREDIT_TRANSFER recharge",
        }),
      ).toThrow(/outside the accepted/);
    });

    it("no tenderExchangeRate at all: reconciles at exchangeRate exactly as before (backward compatible)", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("LBP", 900000)],
          expectedTotals: expectedTotalIn(10, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });
  });

  describe("OUT (change) legs subtract from the total", () => {
    it("passes when IN minus OUT nets to the expected total", () => {
      // Owes $102; customer hands $110, gets $8 change.
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 110)],
          outLegs: [leg("USD", 8, { direction: "OUT" })],
          expectedTotals: expectedTotalIn(102, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("throws when change was recorded but not enough to net to the total", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 110)],
          outLegs: [leg("USD", 2, { direction: "OUT" })], // should have been 8
          expectedTotals: expectedTotalIn(102, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/do not reconcile/);
    });

    it("subtracts a cross-currency OUT leg at the stamped rate", () => {
      // Owes $10; customer hands 1,000,000 LBP (~$11.11), gets 100,000 LBP change back (~$1.11).
      expect(() =>
        reconcileLegs({
          inLegs: [leg("LBP", 1_000_000)],
          outLegs: [leg("LBP", 100_000, { direction: "OUT" })],
          expectedTotals: expectedTotalIn(10, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });
  });

  describe("kept_change reduces what the IN legs need to cover", () => {
    it("passes when the uncovered surplus is justified by kept_change_usd", () => {
      // Owes $100; customer hands $105; shop keeps the $5 instead of
      // returning it (no OUT leg) — kept_change must justify the gap.
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 105)],
          keptChange: { usd: 5 },
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("throws when the surplus is UNjustified (no kept_change, no OUT leg)", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 105)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/do not reconcile/);
    });

    it("kept_change_lbp is converted at the stamped rate", () => {
      // Owes $100; customer hands $100 + 90,000 LBP (~$1 extra), shop keeps
      // the LBP as profit (kept_change_lbp), no OUT leg.
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 100), leg("LBP", 90_000)],
          keptChange: { lbp: 90_000 },
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });
  });

  describe("CUSTOMER_ACCOUNT legs count toward the total (S2 owner decision)", () => {
    it("a CUSTOMER_ACCOUNT leg covering the remainder reconciles", () => {
      // $100 total: $60 cash + $40 on account.
      expect(() =>
        reconcileLegs({
          inLegs: [
            leg("USD", 60),
            leg("USD", 40, { method: "CUSTOMER_ACCOUNT" }),
          ],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("a mixed-currency CUSTOMER_ACCOUNT split (USD + LBP) reconciles at the stamped rate", () => {
      // $10 total: $5 on-account (USD) + 450,000 LBP on-account (=$5 at rate 90,000).
      expect(() =>
        reconcileLegs({
          inLegs: [
            leg("USD", 5, { method: "CUSTOMER_ACCOUNT" }),
            leg("LBP", 450_000, { method: "CUSTOMER_ACCOUNT" }),
          ],
          expectedTotals: expectedTotalIn(10, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).not.toThrow();
    });

    it("walk-in (no CUSTOMER_ACCOUNT leg): full payment required, overage must come back as OUT", () => {
      // Owes $50, walk-in hands $60 cash with no account leg and no change
      // leg recorded — must reject (payment-in-full rule, enforced by the
      // SAME equation, no special-casing).
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 60)],
          expectedTotals: expectedTotalIn(50, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/do not reconcile/);
    });
  });

  describe("mismatch error message", () => {
    it("names expected vs. got per currency", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [leg("USD", 40)],
          expectedTotals: expectedTotalIn(100, "USD"),
          exchangeRate: RATE,
          context: "WHISH_APP SEND",
        }),
      ).toThrow(
        /WHISH_APP SEND: payment legs do not reconcile — expected \$100\.00.*got \$40\.00/,
      );
    });
  });

  describe("unsupported leg currency", () => {
    it("throws a clear error for a non-USD/LBP leg currency", () => {
      expect(() =>
        reconcileLegs({
          inLegs: [
            leg("USD", 10),
            { method: "CASH", currencyCode: "EUR", amount: 5 },
          ],
          expectedTotals: expectedTotalIn(15, "USD"),
          exchangeRate: RATE,
          context: "test",
        }),
      ).toThrow(/not USD or LBP/);
    });
  });

  describe("expectedTotalIn", () => {
    it("buckets a USD amount into { usd, lbp: 0 }", () => {
      expect(expectedTotalIn(25, "USD")).toEqual({ usd: 25, lbp: 0 });
    });

    it("buckets an LBP amount into { usd: 0, lbp }", () => {
      expect(expectedTotalIn(2_250_000, "LBP")).toEqual({
        usd: 0,
        lbp: 2_250_000,
      });
    });

    it("treats a non-LBP currency (e.g. USDT) as the USD bucket", () => {
      expect(expectedTotalIn(20, "USDT")).toEqual({ usd: 20, lbp: 0 });
    });
  });
});

/**
 * resolveStampedExchangeRate — owner decision 2026-08-08 (repro: buy 89,000
 * vs. sell 90,000): the non-throwing sibling of resolveReconciliationRate,
 * for stamping `transactions.exchange_rate`. Reuses TENDER_RATE_BAND_PCT but
 * must NEVER throw — an absent or out-of-band tender rate falls back to the
 * server rate silently.
 */
describe("resolveStampedExchangeRate (stamp-only, never throws)", () => {
  it("owner repro: tender 89,000 within band of server 90,000 — tender wins", () => {
    expect(resolveStampedExchangeRate(90_000, 89_000)).toBe(89_000);
  });

  it("tender absent (undefined) falls back to the server rate", () => {
    expect(resolveStampedExchangeRate(90_000, undefined)).toBe(90_000);
  });

  it("tender more than 10% off falls back to the server rate — and does NOT throw", () => {
    expect(() => resolveStampedExchangeRate(90_000, 50_000)).not.toThrow();
    expect(resolveStampedExchangeRate(90_000, 50_000)).toBe(90_000);
  });

  it("passes at exactly the +10% band boundary — tender wins", () => {
    expect(resolveStampedExchangeRate(90_000, 99_000)).toBe(99_000);
  });

  it("passes at exactly the -10% band boundary — tender wins", () => {
    expect(resolveStampedExchangeRate(90_000, 81_000)).toBe(81_000);
  });

  it("falls back just outside the +10% band", () => {
    expect(resolveStampedExchangeRate(90_000, 99_001)).toBe(90_000);
  });

  it("no valid server rate (e.g. 0) — trusts the tender rate as-is, does not throw", () => {
    expect(() => resolveStampedExchangeRate(0, 89_000)).not.toThrow();
    expect(resolveStampedExchangeRate(0, 89_000)).toBe(89_000);
  });

  it("reuses TENDER_RATE_BAND_PCT (0.10) rather than a duplicated threshold", () => {
    expect(TENDER_RATE_BAND_PCT).toBe(0.1);
  });
});

/**
 * CQ-4 (COUNTERPARTY_CONSOLIDATION_PLAN.md) — the charge-routing guard trio
 * + bookClientDebtCharge. Pure-logic guard tests below; the repository-level
 * "actually wired into the FOR-partner dispatch" proof lives in
 * FinancialServiceRepository.partner.test.ts (which already has FOR-mode
 * fixtures) — see the counter-payment/CUSTOMER_ACCOUNT rejection tests added
 * there alongside this file. SalesRepository/RechargeRepository/
 * LotoTicketRepository have NO jest-level FOR-partner coverage at all
 * (pre-existing gap — their rejection path is proven only by e2e
 * lira-113/115/116/118), so a guard being wired correctly there is not
 * independently jest-provable this session; these unit tests cover the
 * shared function's own logic, which every one of the 4 repos now delegates
 * to verbatim.
 */
describe("assertPartnerIdRequired (CQ-4 guard 1 — counterparty-required)", () => {
  it("throws the exact original message when partnerId is falsy", () => {
    expect(() => assertPartnerIdRequired(undefined)).toThrow(
      'partnerId is required when partnerMode is "FOR"',
    );
    expect(() => assertPartnerIdRequired(null)).toThrow(
      'partnerId is required when partnerMode is "FOR"',
    );
    expect(() => assertPartnerIdRequired(0)).toThrow(
      'partnerId is required when partnerMode is "FOR"',
    );
  });

  it("does not throw when partnerId is a real id", () => {
    expect(() => assertPartnerIdRequired(7)).not.toThrow();
  });
});

describe("assertNoCounterPayment (CQ-4 guard 2 — counter-payment rejection)", () => {
  it("reproduces each of the 4 existing per-module messages byte-identical", () => {
    expect(() => assertNoCounterPayment(true, "sale")).toThrow(
      "A partner sale takes no counter payment — the full amount goes on the partner's tab",
    );
    expect(() => assertNoCounterPayment(true, "recharge")).toThrow(
      "A partner recharge takes no counter payment — the full amount goes on the partner's tab",
    );
    expect(() => assertNoCounterPayment(true, "loto ticket")).toThrow(
      "A partner loto ticket takes no counter payment — the full amount goes on the partner's tab",
    );
    expect(() => assertNoCounterPayment(true, "financial service")).toThrow(
      "A partner financial service takes no counter payment — the full amount goes on the partner's tab",
    );
  });

  it("every message satisfies the e2e substring/regex assertions (lira-113/115/116/118/119)", () => {
    for (const context of [
      "sale",
      "recharge",
      "loto ticket",
      "financial service",
    ]) {
      let message = "";
      try {
        assertNoCounterPayment(true, context);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain("no counter payment");
      expect(message).toMatch(/no counter payment/i);
    }
  });

  it("does not throw when there is no counter payment", () => {
    expect(() => assertNoCounterPayment(false, "sale")).not.toThrow();
  });
});

describe("assertNoCustomerAccountLeg (CQ-4 guard 3 — mutual exclusivity)", () => {
  it("throws the caller-supplied message when a CUSTOMER_ACCOUNT leg is present", () => {
    expect(() =>
      assertNoCustomerAccountLeg(
        true,
        "Cannot combine a partner FOR-sale with a CUSTOMER_ACCOUNT payment leg",
      ),
    ).toThrow(
      "Cannot combine a partner FOR-sale with a CUSTOMER_ACCOUNT payment leg",
    );
  });

  it("does not throw when there is no CUSTOMER_ACCOUNT leg", () => {
    expect(() => assertNoCustomerAccountLeg(false, "unused")).not.toThrow();
  });
});

describe("bookClientDebtCharge (CQ-4 — the client-kind consolidation)", () => {
  function createDebtLedgerDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE debt_ledger (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id        INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        amount_usd       DECIMAL(10, 2),
        amount_lbp       DECIMAL(15, 2),
        transaction_id   INTEGER,
        due_date         TEXT,
        note             TEXT,
        created_by       INTEGER,
        tenant_id        INTEGER,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    return db;
  }

  it("writes amount_usd/amount_lbp/created_by exactly as passed — including explicit null (Sales' shape)", () => {
    const db = createDebtLedgerDb();
    bookClientDebtCharge(db, {
      clientId: 1,
      transactionType: "Sale Debt",
      amountUsd: 25.5,
      amountLbp: null,
      transactionId: 99,
      note: "Sale #1",
      createdBy: null,
      tenantId: 1,
    });
    const row = db
      .prepare(`SELECT * FROM debt_ledger WHERE transaction_id = ?`)
      .get(99) as Record<string, unknown>;
    expect(row.transaction_type).toBe("Sale Debt");
    expect(row.amount_usd).toBe(25.5);
    expect(row.amount_lbp).toBeNull();
    expect(row.created_by).toBeNull();
    expect(row.tenant_id).toBe(1);
  });

  it("writes dual-currency amounts + created_by when both are supplied (Recharge/FS/CustomService/Loto shape)", () => {
    const db = createDebtLedgerDb();
    bookClientDebtCharge(db, {
      clientId: 2,
      transactionType: "Recharge Debt",
      amountUsd: 10,
      amountLbp: 450000,
      transactionId: 100,
      note: "Recharge debt",
      createdBy: 5,
      tenantId: 1,
    });
    const row = db
      .prepare(`SELECT * FROM debt_ledger WHERE transaction_id = ?`)
      .get(100) as Record<string, unknown>;
    expect(row.amount_usd).toBe(10);
    expect(row.amount_lbp).toBe(450000);
    expect(row.created_by).toBe(5);
  });

  it("stamps a due_date 30 days out (every migrated call site used this exact window)", () => {
    const db = createDebtLedgerDb();
    bookClientDebtCharge(db, {
      clientId: 1,
      transactionType: "Maintenance Debt",
      amountUsd: 5,
      transactionId: 101,
      tenantId: 1,
    });
    const row = db
      .prepare(
        `SELECT due_date, created_at FROM debt_ledger WHERE transaction_id = ?`,
      )
      .get(101) as { due_date: string; created_at: string };
    const dueDate = new Date(row.due_date);
    const createdAt = new Date(row.created_at);
    const diffDays =
      (dueDate.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(30, 0);
  });
});
