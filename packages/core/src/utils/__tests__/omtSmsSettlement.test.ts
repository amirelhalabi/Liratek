/**
 * LIRA-370 T005 — the ONE formula for the OMT SMS settlement (rule 14):
 * expected figure, worked-out commission, outstanding estimate.
 *
 * Figures are the test-shop runs of 2026-11-03 (spec "Evidence"):
 *   pay:     owed 776.50, expected commission 4.20, expected 772.30
 *   collect: owed −223.50 (OMT sign), expected commission 6.20, expected −229.70
 *
 * RULE 17 — written before `omtSmsSettlement.ts` existed; the first run
 * failed with "Cannot find module '../omtSmsSettlement'".
 */
import {
  deriveSmsCommission,
  expectedSmsFigure,
  outstandingEstimate,
  owedSharesCollected,
  smsCommissionWeight,
  tickedOwedShares,
  type OwedShareView,
  type SmsScopeRow,
} from "../omtSmsSettlement";

function ledger(id: number, usd: number, lbp = 0): SmsScopeRow {
  return {
    kind: "LEDGER",
    id,
    remaining_usd: usd,
    remaining_lbp: lbp,
    commission_model: null,
    source_provider: null,
    omt_service_type: null,
    expected_commission_usd: 0,
    expected_commission_lbp: 0,
    commission_accounted_usd: 0,
    commission_accounted_lbp: 0,
  };
}

function omt(
  id: number,
  usd: number,
  type: string,
  commission: number,
  extra: Partial<SmsScopeRow> = {},
): SmsScopeRow {
  return {
    kind: "FINANCIAL_SERVICE",
    id,
    remaining_usd: usd,
    remaining_lbp: 0,
    commission_model: 1,
    source_provider: "OMT",
    omt_service_type: type,
    expected_commission_usd: commission,
    expected_commission_lbp: 0,
    commission_accounted_usd: 0,
    commission_accounted_lbp: 0,
    ...extra,
  };
}

/** The test shop's OMT account on 2026-11-03 (we owe OMT). */
const PAY_ROWS: SmsScopeRow[] = [
  ledger(323, 200), // iPick top-up
  ledger(324, 200), // OMT App top-up
  omt(505, 204, "CASH_TO_BUSINESS", 1),
  omt(507, 50.5, "ONLINE_BROKERAGE", 3),
  omt(508, 101, "INTRA", 0.1),
  omt(818, 21, "INTRA", 0.1),
];

/** Same plus the $1,000 Western Union receive (OMT owes us). */
const COLLECT_ROWS: SmsScopeRow[] = [
  ...PAY_ROWS,
  omt(1346, -1000, "WESTERN_UNION", 2),
];

describe("expectedSmsFigure", () => {
  it("pay, all types: 776.50 − 4.20 = 772.30", () => {
    expect(expectedSmsFigure({ rows: PAY_ROWS, currency: "USD" })).toEqual({
      owed: 776.5,
      expectedCommission: 4.2,
      owedSharesIncluded: 0,
      expected: 772.3,
    });
  });

  it("collect, all types: −223.50 − 6.20 = −229.70 (OMT sign)", () => {
    expect(expectedSmsFigure({ rows: COLLECT_ROWS, currency: "USD" })).toEqual({
      owed: -223.5,
      expectedCommission: 6.2,
      owedSharesIncluded: 0,
      expected: -229.7,
    });
  });

  it("Western Union only: every row stays, only its $2 counts → −225.50", () => {
    const f = expectedSmsFigure({
      rows: COLLECT_ROWS,
      currency: "USD",
      coveredTypes: ["WESTERN_UNION"],
    });
    expect(f.owed).toBe(-223.5);
    expect(f.expectedCommission).toBe(2);
    expect(f.expected).toBe(-225.5);
  });

  it("several types (Western Union + Intra)", () => {
    const f = expectedSmsFigure({
      rows: COLLECT_ROWS,
      currency: "USD",
      coveredTypes: ["WESTERN_UNION", "INTRA"],
    });
    expect(f.expectedCommission).toBe(2.2);
    expect(f.expected).toBe(-225.7);
  });

  it("owed shares of ticked types count; others do not", () => {
    const owed: OwedShareView[] = [
      { omt_service_type: "INTRA", currency: "USD", amount: 0.2 },
      { omt_service_type: "CASH_TO_BUSINESS", currency: "USD", amount: 1 },
      { omt_service_type: "ONLINE_BROKERAGE", currency: "USD", amount: 3 },
    ];
    const f = expectedSmsFigure({
      rows: [],
      currency: "USD",
      coveredTypes: ["INTRA", "CASH_TO_BUSINESS"],
      owedShares: owed,
    });
    expect(f).toEqual({
      owed: 0,
      expectedCommission: 0,
      owedSharesIncluded: 1.2,
      expected: -1.2,
    });
  });

  it("a row's commission already accounted for is not counted again", () => {
    const rows = [omt(1, 100, "INTRA", 0.5, { commission_accounted_usd: 0.3 })];
    expect(expectedSmsFigure({ rows, currency: "USD" }).expectedCommission).toBe(0.2);
  });

  it("LBP is computed on its own, in whole LBP", () => {
    const rows: SmsScopeRow[] = [
      {
        ...omt(9, 0, "INTRA", 0),
        remaining_lbp: 900000,
        expected_commission_lbp: 9000.4,
      },
    ];
    expect(expectedSmsFigure({ rows, currency: "LBP" })).toEqual({
      owed: 900000,
      expectedCommission: 9000,
      owedSharesIncluded: 0,
      expected: 891000,
    });
    expect(expectedSmsFigure({ rows, currency: "USD" }).owed).toBe(0);
  });
});

describe("deriveSmsCommission", () => {
  const pay = { owed: 776.5, expectedCommission: 4.2, owedSharesIncluded: 0, currency: "USD" as const };
  const collect = { owed: -223.5, expectedCommission: 6.2, owedSharesIncluded: 0, currency: "USD" as const };

  it("SMS 762.30 → 14.20 = 4.20 expected + 10.00 extra", () => {
    expect(deriveSmsCommission({ ...pay, sms: 762.3 })).toEqual({
      commission: 14.2,
      expectedPart: 4.2,
      extraPart: 10,
      lessThanExpected: false,
      shortOfExpected: 0,
      omtAsksMore: false,
      difference: 0,
    });
  });

  it("SMS = expected (untouched box) → exactly the expected 4.20", () => {
    const d = deriveSmsCommission({ ...pay, sms: 772.3 });
    expect(d.commission).toBe(4.2);
    expect(d.extraPart).toBe(0);
    expect(d.lessThanExpected).toBe(false);
  });

  it("SMS 774.50 → 2.00, less than expected by 2.20, no warning", () => {
    const d = deriveSmsCommission({ ...pay, sms: 774.5 });
    expect(d).toMatchObject({
      commission: 2,
      expectedPart: 2,
      extraPart: 0,
      lessThanExpected: true,
      shortOfExpected: 2.2,
      omtAsksMore: false,
    });
  });

  it("SMS 776.50 (= owed) → 0, no warning", () => {
    expect(deriveSmsCommission({ ...pay, sms: 776.5 })).toMatchObject({
      commission: 0,
      omtAsksMore: false,
      difference: 0,
    });
  });

  it("SMS 790 → OMT asks 13.50 more, commission 0", () => {
    expect(deriveSmsCommission({ ...pay, sms: 790 })).toMatchObject({
      commission: 0,
      expectedPart: 0,
      extraPart: 0,
      omtAsksMore: true,
      difference: 13.5,
      shortOfExpected: 4.2,
    });
  });

  it("collect SMS −249.70 → 26.20 = 6.20 + 20.00", () => {
    expect(deriveSmsCommission({ ...collect, sms: -249.7 })).toMatchObject({
      commission: 26.2,
      expectedPart: 6.2,
      extraPart: 20,
      omtAsksMore: false,
    });
  });

  it("collect SMS −210 → OMT pays 13.50 less, commission 0", () => {
    expect(deriveSmsCommission({ ...collect, sms: -210 })).toMatchObject({
      commission: 0,
      omtAsksMore: true,
      difference: 13.5,
    });
  });

  it("owed shares are part of the expected part", () => {
    const d = deriveSmsCommission({
      owed: 0,
      expectedCommission: 0,
      owedSharesIncluded: 1.2,
      currency: "USD",
      sms: -1.2,
    });
    expect(d).toMatchObject({ commission: 1.2, expectedPart: 1.2, extraPart: 0 });
  });

  it("cents are exact (no 14.199999…)", () => {
    expect(deriveSmsCommission({ ...pay, sms: 762.3 }).commission).toBe(14.2);
    expect(
      deriveSmsCommission({ owed: 0.3, expectedCommission: 0.1, owedSharesIncluded: 0, currency: "USD", sms: 0.1 })
        .commission,
    ).toBe(0.2);
  });
});

describe("outstandingEstimate", () => {
  it("estimate − accounted, never below 0, per currency", () => {
    const r = omt(1, 10, "INTRA", 0.5, { commission_accounted_usd: 0.2 });
    expect(outstandingEstimate(r, "USD")).toBe(0.3);
    expect(outstandingEstimate({ ...r, commission_accounted_usd: 0.9 }, "USD")).toBe(0);
    expect(outstandingEstimate(r, "LBP")).toBe(0);
  });

  it("model-0 and non-transfer rows carry no outstanding estimate", () => {
    expect(outstandingEstimate(omt(1, 10, "INTRA", 0.5, { commission_model: 0 }), "USD")).toBe(0);
    expect(outstandingEstimate(ledger(1, 10), "USD")).toBe(0);
  });
});

describe("shared SMS helpers (server + sheet, rule 14)", () => {
  it("smsCommissionWeight: ticked type → its outstanding estimate; else 0", () => {
    const r = omt(1, 10, "INTRA", 0.5, { commission_accounted_usd: 0.2 });
    expect(smsCommissionWeight(r, "USD", ["INTRA"])).toEqual({ commission_ticked: true, commission_estimate: 0.3 });
    expect(smsCommissionWeight(r, "USD", ["WESTERN_UNION"])).toEqual({ commission_ticked: false, commission_estimate: 0 });
    expect(smsCommissionWeight(r, "USD", undefined).commission_ticked).toBe(true);
  });

  it("owed shares: ticked + currency, then collected whole, oldest first, within the commission", () => {
    const shares: OwedShareView[] = [
      { omt_service_type: "INTRA", currency: "USD", amount: 0.2 },
      { omt_service_type: "CASH_TO_BUSINESS", currency: "USD", amount: 1 },
      { omt_service_type: "INTRA", currency: "LBP", amount: 9000 },
    ];
    const ticked = tickedOwedShares(shares, "USD", ["INTRA", "CASH_TO_BUSINESS"]);
    expect(ticked).toHaveLength(2);
    expect(owedSharesCollected(ticked, 1.3, "USD")).toEqual({ collected: ticked, split: 0.1 });
    expect(owedSharesCollected(ticked, 0.9, "USD")).toEqual({ collected: [ticked[0]], split: 0.7 });
    expect(owedSharesCollected(ticked, 0.1, "USD")).toEqual({ collected: [], split: 0.1 });
  });
});
