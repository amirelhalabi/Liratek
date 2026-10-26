/**
 * LIRA-343 — days from rows (data-model "Day"), on the mock's October
 * (quickstart §2). Today = Mon 26 Oct 2026.
 *
 * RULE 17 — written before `utils/settleDays.ts` existed; first run failed
 * with "Cannot find module '../settleDays'".
 */
import {
  buildSettleDays,
  openDaysBefore,
  monthLeft,
  isSettleRowWaiting,
  type SettleDay,
  type SettleDayRow,
} from "../settleDays";

let nextId = 1;
function row(
  shop_day: string,
  usd: number,
  lbp: number,
  covered: { usd?: number; lbp?: number } = {},
  over: Partial<SettleDayRow> = {},
): SettleDayRow {
  const cu = covered.usd ?? 0;
  const cl = covered.lbp ?? 0;
  const rem = (a: number, c: number) =>
    a === 0 ? 0 : Math.sign(a) * (Math.abs(a) - c);
  return {
    shop_day,
    kind: "FINANCIAL_SERVICE",
    id: nextId++,
    amount_usd: usd,
    amount_lbp: lbp,
    covered_usd: cu,
    covered_lbp: cl,
    remaining_usd: rem(usd, cu),
    remaining_lbp: rem(lbp, cl),
    row_scope: "DAY",
    ...over,
  };
}

const TODAY = "2026-10-26";
const OCTOBER: SettleDayRow[] = [
  row("2026-09-30", 30, 0), // older month, open
  row("2026-10-05", 50, 0, { usd: 50 }),
  row("2026-10-13", 0, 400000, { lbp: 400000 }),
  row("2026-10-20", 70, 0, { usd: 70 }),
  // an account credit dated 20 Oct must not open the day
  row("2026-10-20", -8.7, 0, {}, { kind: "LEDGER", row_scope: "ACCOUNT" }),
  row("2026-10-21", 150, 0, { usd: 150 }),
  row("2026-10-21", 127, 0, { usd: 80 }),
  row("2026-10-22", 100, 0, { usd: 100 }),
  row("2026-10-22", 0, 900000),
  row("2026-10-23", 120, 0),
  row("2026-10-24", 95, 0),
  row("2026-10-24", -40, 0), // counter RECEIVE: a day credit
  row("2026-10-25", 200, 0),
  row("2026-10-25", 0, 990000),
  row("2026-10-26", 60, 0), // today
];

function dayOf(days: SettleDay[], d: string): SettleDay {
  const found = days.find((x) => x.day === d);
  if (!found) throw new Error(`no day ${d}`);
  return found;
}

describe("buildSettleDays — October", () => {
  const days = buildSettleDays(OCTOBER, { today: TODAY, month: "2026-10" });

  it("one entry per calendar day of the month, in order", () => {
    expect(days).toHaveLength(31);
    expect(days[0].day).toBe("2026-10-01");
    expect(days[30].day).toBe("2026-10-31");
    expect(days.map((d) => d.day)).toEqual([...days.map((d) => d.day)].sort());
  });

  it("rows of other months are ignored", () => {
    expect(days.some((d) => d.day === "2026-09-30")).toBe(false);
  });

  it("14 Oct (no rows) is NONE and not selectable", () => {
    const d = dayOf(days, "2026-10-14");
    expect(d.state).toBe("NONE");
    expect(d.selectable).toBe(false);
    expect(d.left_usd).toBe(0);
    expect(d.paid_pct_usd).toBeNull();
    expect(d.currency_state_usd).toBeNull();
  });

  it("settled days are SETTLED and not selectable", () => {
    for (const d of ["2026-10-05", "2026-10-13"]) {
      expect(dayOf(days, d).state).toBe("SETTLED");
      expect(dayOf(days, d).selectable).toBe(false);
    }
    expect(dayOf(days, "2026-10-13").currency_state_lbp).toBe("PAID");
  });

  it("an ACCOUNT row on 20 Oct leaves 20 Oct SETTLED", () => {
    const d = dayOf(days, "2026-10-20");
    expect(d.state).toBe("SETTLED");
    expect(d.left_usd).toBe(0);
    expect(d.owed_usd).toBe(70);
    expect(d.account_marks).toEqual([]);
  });

  it("21 Oct PARTIAL, left $47, paid ≈ 83% of $277", () => {
    const d = dayOf(days, "2026-10-21");
    expect(d.state).toBe("PARTIAL");
    expect(d.left_usd).toBe(47);
    expect(d.owed_usd).toBe(277);
    expect(d.paid_pct_usd).toBeCloseTo(230 / 277, 6);
    expect(d.paid_pct_usd).toBeCloseTo(0.83, 2);
    expect(d.currency_state_usd).toBe("PART");
    expect(d.paid_pct_lbp).toBeNull();
    expect(d.currency_state_lbp).toBeNull();
    expect(d.selectable).toBe(true);
  });

  it("22 Oct PARTIAL: $ PAID, LBP OWED, left 900,000 LBP", () => {
    const d = dayOf(days, "2026-10-22");
    expect(d.state).toBe("PARTIAL");
    expect(d.currency_state_usd).toBe("PAID");
    expect(d.currency_state_lbp).toBe("OWED");
    expect(d.left_usd).toBe(0);
    expect(d.left_lbp).toBe(900000);
    expect(d.paid_pct_usd).toBe(1);
    expect(d.paid_pct_lbp).toBe(0);
  });

  it("24 Oct: the receive nets into left, nothing covered → UNPAID", () => {
    const d = dayOf(days, "2026-10-24");
    expect(d.state).toBe("UNPAID");
    expect(d.left_usd).toBe(55);
    expect(d.owed_usd).toBe(95);
  });

  it("25 Oct (Sunday) UNPAID, left $200 and 990,000 LBP", () => {
    const d = dayOf(days, "2026-10-25");
    expect(d.state).toBe("UNPAID");
    expect(d.left_usd).toBe(200);
    expect(d.left_lbp).toBe(990000);
    expect(d.currency_state_usd).toBe("OWED");
    expect(d.currency_state_lbp).toBe("OWED");
    expect(d.selectable).toBe(true);
  });

  it("today is selectable (day <= today)", () => {
    expect(dayOf(days, TODAY).selectable).toBe(true);
    expect(dayOf(days, TODAY).state).toBe("UNPAID");
  });

  it("month left $482.00 + 1,890,000 LBP (including today's $60)", () => {
    expect(monthLeft(days)).toEqual({ usd: 482, lbp: 1890000 });
  });

  it("waiting_count is 0 without covered types", () => {
    expect(days.every((d) => d.waiting_count === 0)).toBe(true);
  });
});

describe("buildSettleDays — edge cases", () => {
  it("a future day with an open row is not selectable", () => {
    const days = buildSettleDays([row("2026-10-27", 10, 0)], {
      today: TODAY,
      month: "2026-10",
    });
    const d = dayOf(days, "2026-10-27");
    expect(d.state).toBe("UNPAID");
    expect(d.selectable).toBe(false);
  });

  it("days of month are pure calendar math (leap February, December)", () => {
    expect(
      buildSettleDays([], { today: TODAY, month: "2028-02" }),
    ).toHaveLength(29);
    expect(
      buildSettleDays([], { today: TODAY, month: "2026-02" }),
    ).toHaveLength(28);
    const dec = buildSettleDays([], { today: TODAY, month: "2026-12" });
    expect(dec).toHaveLength(31);
    expect(dec[30].day).toBe("2026-12-31");
  });

  it("float dust below the epsilon counts as closed", () => {
    const days = buildSettleDays(
      [
        {
          ...row("2026-10-03", 0.1 + 0.2, 0, { usd: 0.3 }),
          remaining_usd: 0.1 + 0.2 - 0.3,
        },
        { ...row("2026-10-04", 0, 1000, { lbp: 999.7 }), remaining_lbp: 0.3 },
      ],
      { today: TODAY, month: "2026-10" },
    );
    expect(dayOf(days, "2026-10-03").state).toBe("SETTLED");
    expect(dayOf(days, "2026-10-04").state).toBe("SETTLED");
  });

  it("a closed row that never owed anything (owed 0) does not make the day PARTIAL", () => {
    const days = buildSettleDays(
      [row("2026-10-08", 50, 0), row("2026-10-08", 0, 0)],
      { today: TODAY, month: "2026-10" },
    );
    expect(dayOf(days, "2026-10-08").state).toBe("UNPAID");
    const only = buildSettleDays([row("2026-10-09", 0, 0)], {
      today: TODAY,
      month: "2026-10",
    });
    expect(dayOf(only, "2026-10-09").state).toBe("SETTLED");
  });

  it("a covered amount on an open row makes the day PARTIAL", () => {
    const days = buildSettleDays([row("2026-10-07", 0, 500000, { lbp: 1 })], {
      today: TODAY,
      month: "2026-10",
    });
    expect(dayOf(days, "2026-10-07").state).toBe("PARTIAL");
  });

  it("waiting_count counts open FS model-1 OMT rows of an uncovered type only", () => {
    const rows: SettleDayRow[] = [
      row(
        "2026-10-10",
        50,
        0,
        {},
        {
          source_provider: "OMT",
          omt_service_type: "WESTERN_UNION",
          commission_model: 1,
        },
      ),
      row(
        "2026-10-10",
        20,
        0,
        {},
        {
          source_provider: "OMT",
          omt_service_type: "INTRA",
          commission_model: 1,
        },
      ),
      // ledger rows are never waiting, even with provider OMT
      row(
        "2026-10-10",
        10,
        0,
        {},
        {
          kind: "LEDGER",
          source_provider: "OMT",
          omt_service_type: null,
          commission_model: null,
        },
      ),
      // closed rows are never waiting
      row(
        "2026-10-10",
        5,
        0,
        { usd: 5 },
        {
          source_provider: "OMT",
          omt_service_type: "WESTERN_UNION",
          commission_model: 1,
        },
      ),
    ];
    const days = buildSettleDays(rows, {
      today: TODAY,
      month: "2026-10",
      coveredTypes: ["INTRA"],
    });
    expect(dayOf(days, "2026-10-10").waiting_count).toBe(1);
  });
});

describe("isSettleRowWaiting", () => {
  const base = row(
    "2026-10-10",
    50,
    0,
    {},
    {
      source_provider: "OMT",
      omt_service_type: null,
      commission_model: 1,
    },
  );
  it("mirrors the server: FS, commission_model 1, type not covered", () => {
    expect(isSettleRowWaiting(base, undefined)).toBe(false);
    expect(isSettleRowWaiting(base, ["INTRA"])).toBe(true);
    expect(isSettleRowWaiting(base, ["UNSPECIFIED"])).toBe(false);
    expect(
      isSettleRowWaiting({ ...base, commission_model: 0 }, ["INTRA"]),
    ).toBe(false);
    expect(
      isSettleRowWaiting({ ...base, source_provider: "WHISH" }, ["INTRA"]),
    ).toBe(false);
    expect(isSettleRowWaiting({ ...base, kind: "LEDGER" }, ["INTRA"])).toBe(
      false,
    );
  });
});

describe("openDaysBefore", () => {
  it("sorted shop days of any month with an open DAY row, before today", () => {
    expect(openDaysBefore(OCTOBER, TODAY)).toEqual([
      "2026-09-30",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });
});

describe("account_marks (T037, FR-016b)", () => {
  const relief = (
    day: string,
    usd: number,
    lbp: number,
    origin: "UNDO" | "VOID",
    ref: string,
    covered: { usd?: number; lbp?: number } = {},
  ): SettleDayRow =>
    row(day, usd, lbp, covered, {
      kind: "LEDGER",
      row_scope: "ACCOUNT",
      relief_origin: origin,
      relief_ref: ref,
    });

  it("an open undo / void account row puts a mark on its shop day, per currency, without changing state", () => {
    const rows: SettleDayRow[] = [
      row("2026-10-26", 50, 0, { usd: 50 }),
      relief("2026-10-26", 8.7, 0, "UNDO", "#12"),
      relief("2026-10-26", 0, 450000, "UNDO", "#12"),
      relief("2026-10-18", -35, 0, "VOID", "#440"),
      // closed relief row: no mark
      relief("2026-10-19", 10, 0, "UNDO", "#9", { usd: 10 }),
      // plain account credit (no origin): no mark
      row("2026-10-20", -5, 0, {}, { kind: "LEDGER", row_scope: "ACCOUNT" }),
    ];
    const days = buildSettleDays(rows, { today: TODAY, month: "2026-10" });
    const at = (d: string) => days.find((x) => x.day === d) as SettleDay;
    expect(at("2026-10-26").account_marks).toEqual([
      { origin: "UNDO", ref: "#12", currency: "USD", amount: 8.7 },
      { origin: "UNDO", ref: "#12", currency: "LBP", amount: 450000 },
    ]);
    expect(at("2026-10-26").state).toBe("SETTLED");
    expect(at("2026-10-18").account_marks).toEqual([
      { origin: "VOID", ref: "#440", currency: "USD", amount: 35 },
    ]);
    // A mark alone never makes a day active or selectable.
    expect(at("2026-10-18").state).toBe("NONE");
    expect(at("2026-10-18").selectable).toBe(false);
    expect(at("2026-10-19").account_marks).toEqual([]);
    expect(at("2026-10-20").account_marks).toEqual([]);
  });
});
