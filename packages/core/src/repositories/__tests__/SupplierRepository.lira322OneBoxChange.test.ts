/**
 * LIRA-322 one-box follow-up (owner 2026-10-15) — the Settle Account sheet
 * now has ONE payment box for $ and LBP. Its change (OUT) legs are sent in
 * the section of the currency that was OVERPAID (`assignChangeLegs`,
 * frontend/src/features/suppliers/utils/accountSettleMath.ts); when both
 * are overpaid, each leg fills its own currency's section first and the
 * rest crosses into the other. This file sends the EXACT payloads the
 * sheet's jest cases assert (AccountSettleSheet.lira322Currency.test.tsx)
 * to the real repository, so the frontend's attribution rule is proven
 * against the server's per-section checks (`_planAmountFirstSection`,
 * `_resolveSettlementLegs`: change ≤ extra, legs vs allocation agree).
 *
 * Account: six USD transfers ($497) + one 900,000 LBP send. Rate 89,000.
 * Assertions are deltas (rule 15). Written with the frontend change — the
 * server code is unchanged, so these are acceptance checks of payloads,
 * not failing-first guards.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  type SettleAccountRequest,
} from "../SupplierRepository";
import {
  buildDb,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  resetAll,
  seedOmtSend,
  type CurrencyPair,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

const RATE = 89000;

describe("LIRA-322 one box — change legs in the overpaid currency's section", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    acc = omtAccount(db);
    for (const d of ["OMT_System", "General"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
    [152, 101, 101, 101, 21, 21].forEach((amount, i) =>
      seedOmtSend(db, acc.omtId, {
        amount,
        created_at: `2026-10-01 0${i + 1}:00:00`,
      }),
    );
    seedOmtSend(db, acc.omtId, {
      amount: 900000,
      currency: "LBP",
      created_at: "2026-10-01 00:30:00",
    });
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const leg = (currency_code: "USD" | "LBP", amount: number, out = false) => ({
    method: "CASH",
    currency_code,
    amount,
    ...(out ? { direction: "OUT" as const } : {}),
  });

  function queueOwed(): CurrencyPair {
    const q = repo.getAccountUnsettled(acc.omtId);
    return {
      usd: q.reduce((s, r) => s + r.remaining_usd, 0),
      lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
    };
  }

  function settle(per_currency: SettleAccountRequest["per_currency"]): void {
    repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency,
      expected_owed: queueOwed(),
      exchange_rate: RATE,
      created_by: 1,
    });
  }

  function accountTotal(): CurrencyPair {
    const parts = [acc.omtId, acc.appId, acc.ipickId].map((m) =>
      memberBalance(db, m),
    );
    return {
      usd: parts.reduce((s, p) => s + p.usd, 0),
      lbp: parts.reduce((s, p) => s + p.lbp, 0),
    };
  }

  it("$600 + LBP cleared: $103 USD change in the USD section; LBP untouched", () => {
    const d0 = drawerTotals(db);
    settle({
      USD: {
        direction: "PAY",
        payments: [leg("USD", 600), leg("USD", 103, true)],
      },
    });
    const d1 = drawerTotals(db);
    expect(d1.usd - d0.usd).toBeCloseTo(-497, 6);
    expect(d1.lbp - d0.lbp).toBe(0);
    expect(queueOwed().usd).toBeCloseTo(0, 6);
    expect(queueOwed().lbp).toBe(900000);
  });

  it("only LBP overpaid, change handed back in $: the $1 OUT leg in the LBP section is accepted and nets to 0 at the rate", () => {
    const d0 = drawerTotals(db);
    const a0 = accountTotal();
    settle({
      USD: { direction: "PAY", payments: [leg("USD", 497)] },
      LBP: {
        direction: "PAY",
        payments: [leg("LBP", 989000), leg("USD", 1, true)],
      },
    });
    const d1 = drawerTotals(db);
    expect(d1.usd - d0.usd).toBeCloseTo(-496, 6);
    expect(d1.lbp - d0.lbp).toBe(-989000);
    // Every transfer is closed; what is left on the account is the
    // overpay/change pair, which is worth nothing at the rate.
    const a1 = accountTotal();
    expect(a1.usd - a0.usd + (a1.lbp - a0.lbp) / RATE).toBeCloseTo(
      -(497 + 900000 / RATE),
      6,
    );
    expect(
      repo
        .getAccountUnsettled(acc.omtId)
        .filter((r) => r.kind === "FINANCIAL_SERVICE"),
    ).toEqual([]);
  });

  it("both overpaid, change in each currency: each leg in its own section closes everything with nothing left", () => {
    const d0 = drawerTotals(db);
    settle({
      USD: {
        direction: "PAY",
        payments: [leg("USD", 500), leg("USD", 3, true)],
      },
      LBP: {
        direction: "PAY",
        payments: [leg("LBP", 989000), leg("LBP", 89000, true)],
      },
    });
    const d1 = drawerTotals(db);
    expect(d1.usd - d0.usd).toBeCloseTo(-497, 6);
    expect(d1.lbp - d0.lbp).toBe(-900000);
    expect(repo.getAccountUnsettled(acc.omtId)).toEqual([]);
  });

  it("both overpaid, all change in $ ($4): $3 in the USD section and the $1 overflow in the LBP section is accepted", () => {
    const d0 = drawerTotals(db);
    settle({
      USD: {
        direction: "PAY",
        payments: [leg("USD", 500), leg("USD", 3, true)],
      },
      LBP: {
        direction: "PAY",
        payments: [leg("LBP", 989000), leg("USD", 1, true)],
      },
    });
    const d1 = drawerTotals(db);
    expect(d1.usd - d0.usd).toBeCloseTo(-496, 6);
    expect(d1.lbp - d0.lbp).toBe(-989000);
    expect(
      repo
        .getAccountUnsettled(acc.omtId)
        .filter((r) => r.kind === "FINANCIAL_SERVICE"),
    ).toEqual([]);
  });

  it("why the rule exists: the same $4 change all in the USD section is NOT refused — it silently leaves $1 of USD unpaid", () => {
    settle({
      USD: {
        direction: "PAY",
        payments: [leg("USD", 500), leg("USD", 4, true)],
      },
      LBP: { direction: "PAY", payments: [leg("LBP", 989000)] },
    });
    // The USD section counts 500 − 4 = $496 toward $497: one transfer stays
    // part-paid, netted against the LBP overpay. `assignChangeLegs` never
    // sends this shape.
    expect(queueOwed().usd).toBeCloseTo(1, 6);
  });
});
