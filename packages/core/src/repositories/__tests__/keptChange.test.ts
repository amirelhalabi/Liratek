/**
 * keptChange.ts — the ONE kept-change check-and-split helper (owner
 * decisions 2026-10-07). Pure unit tests per payer kind, plus the
 * `postPayoutLegs` kept-change extension (in-memory DB).
 *
 * Rule 17: written against a stub `resolveKeptChange` that threw
 * "resolveKeptChange: not implemented" and a `postPayoutLegs` that ignored
 * `keptChange`. Every `resolveKeptChange` case failed on the stub (refusal
 * cases with "Received message: resolveKeptChange: not implemented", i.e.
 * the wrong reason), and both kept-aware `postPayoutLegs` cases failed. The
 * one case that passed pre-change is "without keptChange the same short
 * legs still fail" — a REGRESSION GUARD for existing callers, by design.
 */

import Database from "better-sqlite3";
import {
  resolveKeptChange,
  type ResolveKeptChangeInput,
} from "../keptChange";
import { postPayoutLegs, type ReconciliationLeg } from "../moneyPosting";

const RATE = 90_000;

function leg(
  currencyCode: "USD" | "LBP",
  amount: number,
  extra: Partial<ReconciliationLeg> = {},
): ReconciliationLeg {
  return { method: "CASH", currencyCode, amount, ...extra };
}

const base = { exchangeRate: RATE, context: "TEST" } as const;

describe("resolveKeptChange — customer pays the shop", () => {
  it("exact payment, nothing kept → all zeros", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 10, lbp: 0 },
        inLegs: [leg("USD", 10)],
      }),
    ).toEqual({
      keptUsd: 0,
      keptLbp: 0,
      notReturnedUsd: 0,
      notReturnedLbp: 0,
      costUsd: 0,
      costLbp: 0,
    });
  });

  it("USD: $7 due, $10 paid, $2 returned → $1 kept as profit", () => {
    const r = resolveKeptChange({
      ...base,
      payer: "customer",
      expected: { usd: 7, lbp: 0 },
      inLegs: [leg("USD", 10)],
      outLegs: [leg("USD", 2, { direction: "OUT" })],
      claimedKept: { usd: 1 },
    });
    expect(r.keptUsd).toBe(1);
    expect(r.keptLbp).toBe(0);
    expect(r.costUsd).toBe(0);
  });

  it("LBP: 450,000 due, 500,000 paid, 40,000 returned → 10,000 LBP kept", () => {
    const r = resolveKeptChange({
      ...base,
      payer: "customer",
      expected: { usd: 0, lbp: 450_000 },
      inLegs: [leg("LBP", 500_000)],
      outLegs: [leg("LBP", 40_000, { direction: "OUT" })],
      claimedKept: { lbp: 10_000 },
    });
    expect(r.keptLbp).toBe(10_000);
    expect(r.keptUsd).toBe(0);
  });

  it("cross-currency reconciles at the client-supplied tender rate (rule 27)", () => {
    // LIRA-259 owner scenario: 450,000 LBP card, $6 paid, 10,000 LBP back,
    // till rate 80,000 → $0.25 kept (in the tender currency).
    const input: ResolveKeptChangeInput = {
      ...base,
      payer: "customer",
      tenderExchangeRate: 80_000,
      expected: { usd: 0, lbp: 450_000 },
      inLegs: [leg("USD", 6)],
      outLegs: [leg("LBP", 10_000, { direction: "OUT" })],
      claimedKept: { usd: 0.25 },
    };
    expect(resolveKeptChange(input).keptUsd).toBe(0.25);
    // Same legs at the server's 90,000 rate do not net — proves the tender
    // rate is the one used.
    const { tenderExchangeRate: _drop, ...atServerRate } = input;
    void _drop;
    expect(() => resolveKeptChange(atServerRate)).toThrow(/do not reconcile/);
  });

  it("refusal: a tampered kept far above the real change is rejected", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 7, lbp: 0 },
        inLegs: [leg("USD", 10)],
        outLegs: [leg("USD", 2, { direction: "OUT" })],
        claimedKept: { usd: 5 },
      }),
    ).toThrow(/do not reconcile/);
  });

  it("refusal: a small phantom kept inside the $0.05 reconcile epsilon is still rejected", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 10, lbp: 0 },
        inLegs: [leg("USD", 10)],
        claimedKept: { usd: 0.04 },
      }),
    ).toThrow(/more than the change actually due/);
  });

  it("refusal: an overpay with no OUT leg and no kept claim does not reconcile", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 7, lbp: 0 },
        inLegs: [leg("USD", 10)],
      }),
    ).toThrow(/do not reconcile/);
  });

  it("refusal: FOR-partner transactions cannot keep change", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "customer",
        isForPartner: true,
        expected: { usd: 7, lbp: 0 },
        inLegs: [leg("USD", 10)],
        outLegs: [leg("USD", 2, { direction: "OUT" })],
        claimedKept: { usd: 1 },
      }),
    ).toThrow(/partner/i);
  });

  it("refusal: kept change without any payment legs", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 7, lbp: 0 },
        inLegs: [],
        claimedKept: { usd: 1 },
      }),
    ).toThrow(/payment lines/);
  });

  it("refusal: negative kept", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 7, lbp: 0 },
        inLegs: [leg("USD", 6)],
        claimedKept: { usd: -1 },
      }),
    ).toThrow(/non-negative/);
  });

  it("partner with NO kept passes through (exact amount)", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "customer",
        isForPartner: true,
        expected: { usd: 7, lbp: 0 },
        inLegs: [leg("USD", 7)],
      }).keptUsd,
    ).toBe(0);
  });
});

describe("resolveKeptChange — payout (shop hands money to a customer)", () => {
  it("USD: $101.12 owed, $101 handed → $0.12 kept as profit", () => {
    const r = resolveKeptChange({
      ...base,
      payer: "payout",
      owed: 101.12,
      owedCurrency: "USD",
      payoutLegs: [leg("USD", 101)],
      claimedKept: { usd: 0.12 },
    });
    expect(r.keptUsd).toBe(0.12);
    expect(r.keptLbp).toBe(0);
  });

  it("LBP: 1,234,567 owed, 1,200,000 handed → 34,567 LBP kept", () => {
    const r = resolveKeptChange({
      ...base,
      payer: "payout",
      owed: 1_234_567,
      owedCurrency: "LBP",
      payoutLegs: [leg("LBP", 1_200_000)],
      claimedKept: { lbp: 34_567 },
    });
    expect(r.keptLbp).toBe(34_567);
    expect(r.keptUsd).toBe(0);
  });

  it("exact payout, nothing kept → zeros", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 50,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 50)],
      }).keptUsd,
    ).toBe(0);
  });

  it("cross-currency payout legs convert at the tender rate", () => {
    const input: ResolveKeptChangeInput = {
      ...base,
      payer: "payout",
      tenderExchangeRate: 100_000,
      owed: 101.12,
      owedCurrency: "USD",
      payoutLegs: [leg("USD", 100), leg("LBP", 100_000)],
      claimedKept: { usd: 0.12 },
    };
    expect(resolveKeptChange(input).keptUsd).toBe(0.12);
    // At 90,000 the 100,000 LBP is $1.11 → only $0.01 short, so a $0.12
    // claim is more than the real shortfall.
    const { tenderExchangeRate: _drop, ...atServerRate } = input;
    void _drop;
    expect(() => resolveKeptChange(atServerRate)).toThrow();
  });

  it("cap boundary: $0.99 kept is accepted", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 100.99,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 100)],
        claimedKept: { usd: 0.99 },
      }).keptUsd,
    ).toBe(0.99);
  });

  it("refusal: kept exactly at the $1 cap is rejected", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 101,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 100)],
        claimedKept: { usd: 1 },
      }),
    ).toThrow(/under \$1/);
  });

  it("refusal: kept above the cap is rejected", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 151.5,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 150)],
        claimedKept: { usd: 1.5 },
      }),
    ).toThrow(/under \$1/);
  });

  it("LBP cap boundary: 99,999 accepted, 100,000 rejected", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 1_099_999,
        owedCurrency: "LBP",
        payoutLegs: [leg("LBP", 1_000_000)],
        claimedKept: { lbp: 99_999 },
      }).keptLbp,
    ).toBe(99_999);
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 1_100_000,
        owedCurrency: "LBP",
        payoutLegs: [leg("LBP", 1_000_000)],
        claimedKept: { lbp: 100_000 },
      }),
    ).toThrow(/under 100,000 LBP/);
  });

  it("refusal: kept in the other currency than the payout", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 101.12,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 101)],
        claimedKept: { lbp: 10_000 },
      }),
    ).toThrow(/payout currency \(USD\)/);
  });

  it("refusal: FOR-partner payouts cannot keep change", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        isForPartner: true,
        owed: 101.12,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 101)],
        claimedKept: { usd: 0.12 },
      }),
    ).toThrow(/partner/i);
  });

  it("refusal: a payout never carries OUT (change) legs — even with nothing kept", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 50,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 60)],
        outLegs: [leg("USD", 10, { direction: "OUT" })],
      }),
    ).toThrow(/OUT/);
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 50,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 60), leg("USD", 10, { direction: "OUT" })],
      }),
    ).toThrow(/OUT/);
  });

  it("refusal: tampered kept larger than the shortfall (outside epsilon)", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 101.12,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 101)],
        claimedKept: { usd: 0.5 },
      }),
    ).toThrow(/do not reconcile/);
  });

  it("refusal: tampered kept slightly above the shortfall (inside the $0.05 epsilon)", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 101.12,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 101)],
        claimedKept: { usd: 0.15 },
      }),
    ).toThrow(/more than the amount left unpaid/);
  });

  it("refusal: kept claimed on a payout already paid in full", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 101,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 101)],
        claimedKept: { usd: 0.03 },
      }),
    ).toThrow(/already cover/);
  });

  it("refusal: kept with no payout legs (the fallback pays the full amount)", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 101.12,
        owedCurrency: "USD",
        payoutLegs: [],
        claimedKept: { usd: 0.12 },
      }),
    ).toThrow(/payment lines/);
  });
});

describe("resolveKeptChange — shop pays an outsider (expenses)", () => {
  it("USD: $7 bill, $10 handed, $2 returned → $1 not returned, cost $8, NO profit", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "shop",
        bill: { usd: 7, lbp: 0 },
        handedLegs: [leg("USD", 10)],
        returnedLegs: [leg("USD", 2, { direction: "OUT" })],
        claimedKept: { usd: 1 },
      }),
    ).toEqual({
      keptUsd: 0,
      keptLbp: 0,
      notReturnedUsd: 1,
      notReturnedLbp: 0,
      costUsd: 8,
      costLbp: 0,
    });
  });

  it("LBP: 450,000 bill, 500,000 handed, nothing returned → cost 500,000", () => {
    const r = resolveKeptChange({
      ...base,
      payer: "shop",
      bill: { usd: 0, lbp: 450_000 },
      handedLegs: [leg("LBP", 500_000)],
      claimedKept: { lbp: 50_000 },
    });
    expect(r.costLbp).toBe(500_000);
    expect(r.notReturnedLbp).toBe(50_000);
    expect(r.keptLbp).toBe(0);
  });

  it("exact payment: cost = bill, nothing extra", () => {
    const r = resolveKeptChange({
      ...base,
      payer: "shop",
      bill: { usd: 7, lbp: 0 },
      handedLegs: [leg("USD", 7)],
    });
    expect(r.costUsd).toBe(7);
    expect(r.notReturnedUsd).toBe(0);
  });

  it("cross-currency change: cost stays per currency (handed − returned)", () => {
    const r = resolveKeptChange({
      ...base,
      payer: "shop",
      bill: { usd: 7, lbp: 0 },
      handedLegs: [leg("USD", 10)],
      returnedLegs: [leg("LBP", 180_000, { direction: "OUT" })],
      claimedKept: { usd: 1 },
    });
    expect(r.costUsd).toBe(10);
    expect(r.costLbp).toBe(-180_000);
    expect(r.notReturnedUsd).toBe(1);
    expect(r.keptUsd).toBe(0);
  });

  it("refusal: tampered not-returned amount", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "shop",
        bill: { usd: 7, lbp: 0 },
        handedLegs: [leg("USD", 10)],
        returnedLegs: [leg("USD", 2, { direction: "OUT" })],
        claimedKept: { usd: 3 },
      }),
    ).toThrow(/do not reconcile/);
  });

  it("refusal: FOR-partner", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "shop",
        isForPartner: true,
        bill: { usd: 7, lbp: 0 },
        handedLegs: [leg("USD", 10)],
        returnedLegs: [leg("USD", 2, { direction: "OUT" })],
        claimedKept: { usd: 1 },
      }),
    ).toThrow(/partner/i);
  });
});

describe("postPayoutLegs — optional keptChange (default 0, existing callers unchanged)", () => {
  function createDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER, session_id INTEGER, method TEXT,
        drawer_name TEXT, currency_code TEXT, amount REAL, note TEXT,
        created_by INTEGER, tenant_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE drawer_balances (
        tenant_id INTEGER, drawer_name TEXT, currency_code TEXT,
        balance REAL, updated_at DATETIME,
        UNIQUE (tenant_id, drawer_name, currency_code)
      );
    `);
    return db;
  }
  const common = {
    payoutAmount: 101.12,
    currency: "USD",
    exchangeRate: RATE,
    context: "TEST payout",
    txnId: 1,
    tenantId: 1,
    resolveDrawer: () => "General",
    note: "payout",
  };

  it("a validated kept $0.12 lets $101 settle $101.12 owed; only $101 leaves the drawer", () => {
    const db = createDb();
    postPayoutLegs({
      ...common,
      db,
      legs: [leg("USD", 101)],
      keptChange: { usd: 0.12 },
    });
    const bal = db
      .prepare(`SELECT balance FROM drawer_balances WHERE drawer_name='General'`)
      .get() as { balance: number };
    expect(bal.balance).toBe(-101);
  });

  it("without keptChange the same short legs still fail (unchanged behaviour)", () => {
    const db = createDb();
    expect(() =>
      postPayoutLegs({ ...common, db, legs: [leg("USD", 101)] }),
    ).toThrow(/do not reconcile/);
  });

  it("refusal: kept with no legs (the fallback posts the full amount)", () => {
    const db = createDb();
    expect(() =>
      postPayoutLegs({ ...common, db, legs: [], keptChange: { usd: 0.12 } }),
    ).toThrow(/payout lines/);
  });
});

/**
 * Funding rule (2026-10-07, after the sessions agent's finding; revised the
 * same day by the owner to any DRAWER method — cash or wallet): kept change
 * must be REAL drawer money the shop is holding back — never a slice of the
 * customer's own account debt / store credit / gift card overpay, and never
 * on a payout handed over through a non-drawer method.
 *
 * Rule 17: written before the fix and run against the unchanged helper —
 * every "refuses" case failed with "Received function did not throw"; the
 * "allows" cases pass pre-change by design (regression guards).
 */
describe("resolveKeptChange — kept change must be funded by cash", () => {
  const acct = (amount: number, extra: Partial<ReconciliationLeg> = {}) =>
    leg("USD", amount, { method: "CUSTOMER_ACCOUNT", ...extra });

  it("customer refuses: $15 charged to the customer's account against $10 due, $5 kept", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 10, lbp: 0 },
        inLegs: [acct(15)],
        claimedKept: { usd: 5 },
      }),
    ).toThrow(/^Change can only be kept from cash or wallet money\./);
  });

  it("customer refuses: account $15 + cash $5 against $10, $5 cash back, $5 kept (reconciles on paper)", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 10, lbp: 0 },
        inLegs: [acct(15), leg("USD", 5)],
        outLegs: [leg("USD", 5, { direction: "OUT" })],
        claimedKept: { usd: 5 },
      }),
    ).toThrow(/cash/);
  });

  it("customer refuses: a gift-card overpay kept as profit", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 10, lbp: 0 },
        inLegs: [leg("USD", 12, { method: "GIFT_CARD" })],
        claimedKept: { usd: 2 },
      }),
    ).toThrow(/cash/);
  });

  // Owner decision 2026-10-07 (revised): wallet money is drawer money, so a
  // wallet overpay IS keepable. This case used to assert a refusal under the
  // first CASH-only rule; rewritten (rule 24), not deleted.
  it("customer allows: a wallet (WHISH) overpay kept as profit — drawer money", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 10, lbp: 0 },
        inLegs: [leg("USD", 12, { method: "WHISH" })],
        claimedKept: { usd: 2 },
      }).keptUsd,
    ).toBe(2);
  });

  it("customer allows: WHISH $25 for $20, $3 cash back, $2 kept", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 20, lbp: 0 },
        inLegs: [leg("USD", 25, { method: "WHISH" })],
        outLegs: [leg("USD", 3, { direction: "OUT" })],
        claimedKept: { usd: 2 },
      }).keptUsd,
    ).toBe(2);
  });

  it("customer refuses: account $15 + WHISH $5 against $10, $5 cash back, $5 kept", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 10, lbp: 0 },
        inLegs: [acct(15), leg("USD", 5, { method: "WHISH" })],
        outLegs: [leg("USD", 5, { direction: "OUT" })],
        claimedKept: { usd: 5 },
      }),
    ).toThrow(/^Change can only be kept from cash or wallet money\./);
  });

  it("customer allows: account $8 + cash $5 against $10, $1 cash back, $2 kept (all from the cash)", () => {
    const r = resolveKeptChange({
      ...base,
      payer: "customer",
      expected: { usd: 10, lbp: 0 },
      inLegs: [acct(8), leg("USD", 5)],
      outLegs: [leg("USD", 1, { direction: "OUT" })],
      claimedKept: { usd: 2 },
    });
    expect(r.keptUsd).toBe(2);
  });

  it("customer allows: cash $20 against $10, $5 credited back to the account, $5 kept", () => {
    const r = resolveKeptChange({
      ...base,
      payer: "customer",
      expected: { usd: 10, lbp: 0 },
      inLegs: [leg("USD", 20)],
      outLegs: [acct(5, { direction: "OUT" })],
      claimedKept: { usd: 5 },
    });
    expect(r.keptUsd).toBe(5);
  });

  it("customer allows: an exact account payment with nothing kept (no new restriction without kept)", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "customer",
        expected: { usd: 10, lbp: 0 },
        inLegs: [acct(10)],
      }).keptUsd,
    ).toBe(0);
  });

  // The two wallet cases below asserted refusals under the first CASH-only
  // rule; rewritten (rule 24) for the drawer-method rule, with the refusal
  // now pinned on non-drawer methods instead.
  it("shop allows: change 'not returned' on a bill paid from a wallet", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "shop",
        bill: { usd: 18, lbp: 0 },
        handedLegs: [leg("USD", 20, { method: "WHISH" })],
        claimedKept: { usd: 2 },
      }).notReturnedUsd,
    ).toBe(2);
  });

  it("shop allows: change not returned while the returned part came back to a wallet", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "shop",
        bill: { usd: 15, lbp: 0 },
        handedLegs: [leg("USD", 20)],
        returnedLegs: [leg("USD", 3, { method: "WHISH", direction: "OUT" })],
        claimedKept: { usd: 2 },
      }).notReturnedUsd,
    ).toBe(2);
  });

  it("shop refuses: change 'not returned' on a bill charged to an account", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "shop",
        bill: { usd: 18, lbp: 0 },
        handedLegs: [acct(20)],
        claimedKept: { usd: 2 },
      }),
    ).toThrow(/^Change not returned only applies to cash or wallet money\./);
  });

  it("shop refuses: change not returned while the returned part went to an account", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "shop",
        bill: { usd: 15, lbp: 0 },
        handedLegs: [leg("USD", 20)],
        returnedLegs: [acct(3, { direction: "OUT" })],
        claimedKept: { usd: 2 },
      }),
    ).toThrow(/wallet/);
  });

  it("payout refuses: kept change on a payout charged to the customer's account", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 10,
        owedCurrency: "USD",
        payoutLegs: [acct(9.5)],
        claimedKept: { usd: 0.5 },
      }),
    ).toThrow(/^Change can only be kept on a cash or wallet payout\./);
  });

  it("payout allows: a wallet (WHISH) payout $0.50 short keeps $0.50", () => {
    expect(
      resolveKeptChange({
        ...base,
        payer: "payout",
        owed: 10,
        owedCurrency: "USD",
        payoutLegs: [leg("USD", 9.5, { method: "WHISH" })],
        claimedKept: { usd: 0.5 },
      }).keptUsd,
    ).toBe(0.5);
  });
});

/**
 * Cashier-facing wording: every refusal opens with one plain sentence; the
 * technical detail follows in parentheses (still carrying the substrings
 * older tests match). Rule 17: run before the wording change — every case
 * failed on the `^` anchor (messages began with "TEST: ").
 */
describe("resolveKeptChange — refusals open with a plain sentence", () => {
  const cases: Array<[string, ResolveKeptChangeInput, RegExp, RegExp]> = [
    [
      "legs don't add up",
      { ...base, payer: "customer", expected: { usd: 7, lbp: 0 }, inLegs: [leg("USD", 10)] },
      /^The payment doesn't add up to the total\./,
      /\(TEST: payment legs do not reconcile — /,
    ],
    [
      "kept above the change due",
      { ...base, payer: "customer", expected: { usd: 10, lbp: 0 }, inLegs: [leg("USD", 10)], claimedKept: { usd: 0.04 } },
      /^The change kept is more than the change due\./,
      /more than the change actually due/,
    ],
    [
      "partner",
      { ...base, payer: "customer", isForPartner: true, expected: { usd: 7, lbp: 0 }, inLegs: [leg("USD", 10)], claimedKept: { usd: 3 } },
      /^Keeping change isn't allowed on a partner transaction\./,
      /partner transaction cannot keep change/,
    ],
    [
      "negative kept",
      { ...base, payer: "customer", expected: { usd: 7, lbp: 0 }, inLegs: [leg("USD", 10)], claimedKept: { usd: -1 } },
      /^The kept change amount isn't valid\./,
      /non-negative/,
    ],
    [
      "nothing to keep from",
      { ...base, payer: "customer", expected: { usd: 7, lbp: 0 }, inLegs: [], claimedKept: { usd: 1 } },
      /^There is no payment to keep change from\./,
      /nothing to keep it from/,
    ],
    [
      "payout cap",
      { ...base, payer: "payout", owed: 10, owedCurrency: "USD", payoutLegs: [leg("USD", 8)], claimedKept: { usd: 2 } },
      /^You can only keep less than \$1 of change on a payout\./,
      /small leftover/,
    ],
    [
      "payout OUT leg",
      { ...base, payer: "payout", owed: 10, owedCurrency: "USD", payoutLegs: [leg("USD", 10)], outLegs: [leg("USD", 1, { direction: "OUT" })] },
      /^A payout can't include change given back\./,
      /payout cannot carry change \(OUT\) legs/,
    ],
    [
      "payout other currency",
      { ...base, payer: "payout", owed: 10, owedCurrency: "USD", payoutLegs: [leg("USD", 9.5)], claimedKept: { lbp: 1000 } },
      /^Change must be kept in the payout's currency \(USD\)\./,
      /payout currency \(USD\)/,
    ],
    [
      "payout already covered",
      { ...base, payer: "payout", owed: 10, owedCurrency: "USD", payoutLegs: [leg("USD", 10)], claimedKept: { usd: 0.5 } },
      /^There is no change to keep — the payout is already paid in full\./,
      /already cover/,
    ],
    [
      "shop not returned above due",
      { ...base, payer: "shop", bill: { usd: 20, lbp: 0 }, handedLegs: [leg("USD", 20)], claimedKept: { usd: 0.04 } },
      /^The change not returned is more than the change due\./,
      /change not returned is more than the change actually due/,
    ],
  ];

  it.each(cases)("%s", (_label, input, plain, detail) => {
    let message = "";
    try {
      resolveKeptChange(input);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(plain);
    expect(message).toMatch(detail);
  });
});
