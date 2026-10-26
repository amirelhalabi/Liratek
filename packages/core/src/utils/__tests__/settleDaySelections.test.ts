/**
 * LIRA-343 (US2) — the ONE payload builder for settling picked days
 * (rule 22): picked days → `selections`, plus the totals the sheet shows
 * and the stale-check figure the server recomputes.
 *
 * RULE 17 — written before `utils/settleDaySelections.ts` existed; first run
 * failed with "Cannot find module '../settleDaySelections'".
 */
import { buildDaySelections } from "../settleDaySelections";
import type { SettleDayRow } from "../settleDays";

function open(
  id: number,
  shop_day: string,
  usd: number,
  lbp = 0,
  over: Partial<SettleDayRow> = {},
): SettleDayRow {
  return {
    shop_day,
    kind: "FINANCIAL_SERVICE",
    id,
    amount_usd: usd,
    amount_lbp: lbp,
    covered_usd: 0,
    covered_lbp: 0,
    remaining_usd: usd,
    remaining_lbp: lbp,
    row_scope: "DAY",
    ...over,
  };
}

// The open queue: 21 Oct part-paid row, 23–25 Oct, today's row, and an
// $8.70 OMT credit (account row, dated today).
const QUEUE: SettleDayRow[] = [
  open(410, "2026-10-21", 127, 0, { covered_usd: 80, remaining_usd: 47 }),
  open(421, "2026-10-23", 120),
  open(425, "2026-10-24", 95),
  open(426, "2026-10-24", -40),
  open(430, "2026-10-25", 200),
  open(431, "2026-10-25", 0, 990000),
  open(440, "2026-10-26", 60),
  open(9001, "2026-10-26", -8.7, 0, { kind: "LEDGER", row_scope: "ACCOUNT" }),
];
const PICKED = ["2026-10-23", "2026-10-24", "2026-10-25"];

describe("buildDaySelections", () => {
  it("picked 23–25 Oct: their DAY rows, oldest first as given; account rows never selected", () => {
    const r = buildDaySelections(QUEUE, { pickedDays: PICKED });
    expect(r.selections).toEqual([
      { kind: "FINANCIAL_SERVICE", id: 421 },
      { kind: "FINANCIAL_SERVICE", id: 425 },
      { kind: "FINANCIAL_SERVICE", id: 426 },
      { kind: "FINANCIAL_SERVICE", id: 430 },
      { kind: "FINANCIAL_SERVICE", id: 431 },
    ]);
    expect(r.owed).toEqual({ usd: 375, lbp: 990000 });
    expect(r.account_credit).toEqual({ usd: -8.7, lbp: 0 });
  });

  it("an ACCOUNT row is never selected, even when its day is picked", () => {
    const r = buildDaySelections(QUEUE, {
      pickedDays: new Set(["2026-10-26"]),
    });
    expect(r.selections).toEqual([{ kind: "FINANCIAL_SERVICE", id: 440 }]);
  });

  it("default credit: 8.70 used → prefill 366.30 when owed 375", () => {
    const r = buildDaySelections(QUEUE, { pickedDays: PICKED });
    expect(r.credit_used).toEqual({ usd: 8.7, lbp: 0 });
    expect(r.prefill).toEqual({ usd: 366.3, lbp: 990000 });
    expect(r.expected_owed).toEqual({ usd: 366.3, lbp: 990000 });
  });

  it("explicit creditUsed 0 → prefill 375 (LBP still defaults)", () => {
    const r = buildDaySelections(QUEUE, {
      pickedDays: PICKED,
      creditUsed: { usd: 0 },
    });
    expect(r.credit_used).toEqual({ usd: 0, lbp: 0 });
    expect(r.prefill).toEqual({ usd: 375, lbp: 990000 });
    // the stale check still counts every account row
    expect(r.expected_owed).toEqual({ usd: 366.3, lbp: 990000 });
  });

  it("an unticked row is left out of selections and totals", () => {
    const r = buildDaySelections(QUEUE, {
      pickedDays: PICKED,
      untickedRows: new Set(["FINANCIAL_SERVICE:430"]),
    });
    expect(r.selections.map((s) => s.id)).toEqual([421, 425, 426, 431]);
    expect(r.owed.usd).toBe(175);
    expect(r.prefill.usd).toBe(166.3);
  });

  it("the credit used never exceeds what the picked days owe", () => {
    const r = buildDaySelections(QUEUE, { pickedDays: ["2026-10-24"] });
    expect(r.owed.usd).toBe(55);
    expect(r.credit_used.usd).toBe(8.7);
    const small = buildDaySelections(
      [
        open(1, "2026-10-24", 5),
        ...QUEUE.filter((q) => q.row_scope === "ACCOUNT"),
      ],
      { pickedDays: ["2026-10-24"] },
    );
    expect(small.credit_used.usd).toBe(5);
    expect(small.prefill.usd).toBe(0);
  });

  it("OMT pays: owed −100, credit 8.70 → prefill −108.70", () => {
    const rows: SettleDayRow[] = [
      open(1, "2026-10-20", -100),
      open(2, "2026-10-26", -8.7, 0, { kind: "LEDGER", row_scope: "ACCOUNT" }),
    ];
    const r = buildDaySelections(rows, { pickedDays: ["2026-10-20"] });
    expect(r.owed.usd).toBe(-100);
    expect(r.credit_used.usd).toBe(8.7);
    expect(r.prefill.usd).toBe(-108.7);
    expect(r.expected_owed.usd).toBe(-108.7);
  });

  it("a positive account row (shop owes OMT back) reduces the credit", () => {
    const rows: SettleDayRow[] = [
      open(1, "2026-10-23", 100),
      open(2, "2026-10-26", -10, 0, { kind: "LEDGER", row_scope: "ACCOUNT" }),
      open(3, "2026-10-26", 4, 0, { kind: "LEDGER", row_scope: "ACCOUNT" }),
    ];
    const r = buildDaySelections(rows, { pickedDays: ["2026-10-23"] });
    expect(r.account_credit.usd).toBe(-6);
    expect(r.credit_used.usd).toBe(6);
    expect(r.prefill.usd).toBe(94);
    expect(r.expected_owed.usd).toBe(94);
  });

  it("rows waiting for their statement type are left out", () => {
    const rows: SettleDayRow[] = [
      open(1, "2026-10-23", 100, 0, {
        source_provider: "OMT",
        omt_service_type: "WESTERN_UNION",
        commission_model: 1,
      }),
      open(2, "2026-10-23", 30, 0, {
        source_provider: "OMT",
        omt_service_type: "INTRA",
        commission_model: 1,
      }),
    ];
    const r = buildDaySelections(rows, {
      pickedDays: ["2026-10-23"],
      coveredTypes: ["INTRA"],
    });
    expect(r.selections).toEqual([{ kind: "FINANCIAL_SERVICE", id: 2 }]);
    expect(r.owed.usd).toBe(30);
  });

  it("nothing picked → no selections, owed 0", () => {
    const r = buildDaySelections(QUEUE, { pickedDays: [] });
    expect(r.selections).toEqual([]);
    expect(r.owed).toEqual({ usd: 0, lbp: 0 });
  });

  // Wave 2: with nothing owed in a currency the default uses NO credit, so
  // the sheet never pre-fills "collect the whole credit from OMT".
  it("nothing picked → default credit_used 0 per currency, prefill 0", () => {
    const r = buildDaySelections(QUEUE, { pickedDays: [] });
    expect(r.credit_used).toEqual({ usd: 0, lbp: 0 });
    expect(r.prefill).toEqual({ usd: 0, lbp: 0 });
    // the stale check still counts every account row
    expect(r.expected_owed).toEqual({ usd: -8.7, lbp: 0 });
  });

  it("an LBP credit with only $ picked: LBP default credit_used 0, prefill 0", () => {
    const rows: SettleDayRow[] = [
      open(1, "2026-10-23", 100),
      open(2, "2026-10-26", 0, -50000, { kind: "LEDGER", row_scope: "ACCOUNT" }),
    ];
    const r = buildDaySelections(rows, { pickedDays: ["2026-10-23"] });
    expect(r.credit_used).toEqual({ usd: 0, lbp: 0 });
    expect(r.prefill).toEqual({ usd: 100, lbp: 0 });
    expect(r.expected_owed).toEqual({ usd: 100, lbp: -50000 });
  });
});
