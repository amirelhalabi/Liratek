/**
 * LIRA-322 — allocateAccountSettlement (contracts/allocator.md).
 *
 * Every row of the contract's spec-example table is a test here, on the
 * test shop's real OMT account: six USD transfers of $152, $101, $101,
 * $101, $21 and $21 (oldest first, $497 owed).
 *
 * Rule 17: written against a stub that throws, run red, then implemented.
 */
import {
  allocateAccountSettlement,
  type AccountSettleAllocInput,
  type AccountSettleAllocResult,
  type AccountSettleAllocRow,
} from "../accountSettleAllocation";

const COUNTER = 28; // OMT counter
const APP = 30; // OMT App

function fs(
  id: number,
  remaining: number,
  created_at: string,
  over: Partial<AccountSettleAllocRow> = {},
): AccountSettleAllocRow {
  return {
    kind: "FINANCIAL_SERVICE",
    id,
    member_supplier_id: COUNTER,
    created_at,
    remaining,
    commission_model1: true,
    cashout_commission: 0,
    ...over,
  };
}

function ledger(
  id: number,
  remaining: number,
  created_at: string,
  over: Partial<AccountSettleAllocRow> = {},
): AccountSettleAllocRow {
  return {
    kind: "LEDGER",
    id,
    member_supplier_id: APP,
    created_at,
    remaining,
    commission_model1: false,
    cashout_commission: 0,
    ...over,
  };
}

/** The six USD transfers, oldest first. */
const SIX: AccountSettleAllocRow[] = [
  fs(1, 152, "2026-10-01 09:00:00"),
  fs(2, 101, "2026-10-01 10:00:00"),
  fs(3, 101, "2026-10-01 11:00:00"),
  fs(4, 101, "2026-10-01 12:00:00"),
  fs(5, 21, "2026-10-01 13:00:00"),
  fs(6, 21, "2026-10-01 14:00:00"),
];
/** OMT App cash-out credit: OMT owes the shop $60. */
const CREDIT_60 = ledger(50, -60, "2026-10-01 08:00:00");

function usd(
  rows: AccountSettleAllocRow[],
  paid: number,
  over: Partial<AccountSettleAllocInput> = {},
): AccountSettleAllocResult {
  return allocateAccountSettlement({
    currency: "USD",
    rows,
    paid,
    commission: 0,
    waive: 0,
    eps: 0.005,
    ...over,
  });
}

const ids = (refs: Array<{ id: number }>) => refs.map((r) => r.id);

/** Σ takes for a row, optionally by source. */
function takenOn(
  r: AccountSettleAllocResult,
  id: number,
  source?: string,
): number {
  return (
    Math.round(
      r.takes
        .filter((t) => t.id === id && (!source || t.source === source))
        .reduce((s, t) => s + t.amount, 0) * 100,
    ) / 100
  );
}

describe("allocateAccountSettlement — contract table (USD, $152/$101/$101/$101/$21/$21)", () => {
  it("paid 300 → 152 and 101 close; 101 partial (47 applied, 54 left); 197 still owed", () => {
    const r = usd(SIX, 300);
    expect(ids(r.closed)).toEqual([1, 2]);
    expect(r.partial).toEqual({
      kind: "FINANCIAL_SERVICE",
      id: 3,
      applied: 47,
      remaining: 54,
    });
    expect(ids(r.untouched)).toEqual([4, 5, 6]);
    expect(r.remaining_after).toBe(197);
    expect(r.extra).toBe(0);
    expect(r.direction_from_rows).toBe("PAY");
    expect(takenOn(r, 1, "PAYMENT")).toBe(152);
    expect(takenOn(r, 2, "PAYMENT")).toBe(101);
    expect(takenOn(r, 3, "PAYMENT")).toBe(47);
  });

  it("paid 497 → all six close", () => {
    const r = usd(SIX, 497);
    expect(ids(r.closed)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.partial).toBeNull();
    expect(r.untouched).toEqual([]);
    expect(r.remaining_after).toBe(0);
    expect(r.extra).toBe(0);
  });

  it("paid 507.11 → all six close, 10.11 extra", () => {
    const r = usd(SIX, 507.11);
    expect(ids(r.closed)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.partial).toBeNull();
    expect(r.remaining_after).toBe(0);
    expect(r.extra).toBe(10.11);
  });

  // Owner 2026-10-15 (replaces FR-013a): the gross is paid in full; the
  // commission covers nothing (the repository credits it to the account).
  it("paid 497 + commission 0.70 → all six close, nothing extra, money only", () => {
    const r = usd(SIX, 497, { commission: 0.7 });
    expect(ids(r.closed)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.partial).toBeNull();
    expect(r.remaining_after).toBe(0);
    expect(r.extra).toBe(0);
    expect(r.commission_without_closed_model1).toBe(false);
    expect(takenOn(r, 1, "COMMISSION")).toBe(0);
    expect(takenOn(r, 1, "PAYMENT")).toBe(152);
    expect(takenOn(r, 6, "PAYMENT")).toBe(21);
  });

  it("paid 496.30, no commission → first five close; the newest 21 is part-paid 20.30, 0.70 left", () => {
    const r = usd(SIX, 496.3);
    expect(ids(r.closed)).toEqual([1, 2, 3, 4, 5]);
    expect(r.partial).toEqual({
      kind: "FINANCIAL_SERVICE",
      id: 6,
      applied: 20.3,
      remaining: 0.7,
    });
    expect(r.remaining_after).toBe(0.7);
    expect(r.extra).toBe(0);
  });

  it("credit −60 added, paid 100 → credit and 152 close; next 101 partial (8 applied, 93 left); 337 owed", () => {
    const r = usd([...SIX, CREDIT_60], 100);
    expect(ids(r.closed)).toEqual([50, 1]);
    expect(r.partial).toEqual({
      kind: "FINANCIAL_SERVICE",
      id: 2,
      applied: 8,
      remaining: 93,
    });
    expect(ids(r.untouched)).toEqual([3, 4, 5, 6]);
    expect(r.remaining_after).toBe(337);
    expect(r.extra).toBe(0);
    expect(takenOn(r, 1, "NETTING")).toBe(60);
    expect(takenOn(r, 50, "NETTING")).toBe(60);
    expect(takenOn(r, 1, "PAYMENT")).toBe(92);
    expect(takenOn(r, 2, "PAYMENT")).toBe(8);
  });

  it("credit −60 added, paid 437 → everything closes", () => {
    const r = usd([...SIX, CREDIT_60], 437);
    expect(ids(r.closed)).toEqual([50, 1, 2, 3, 4, 5, 6]);
    expect(r.partial).toBeNull();
    expect(r.untouched).toEqual([]);
    expect(r.remaining_after).toBe(0);
    expect(r.extra).toBe(0);
  });

  it("paid 0.50 → nothing closes; the oldest 152 is part-paid by 0.50; 496.50 owed", () => {
    const r = usd(SIX, 0.5);
    expect(r.closed).toEqual([]);
    expect(r.partial).toEqual({
      kind: "FINANCIAL_SERVICE",
      id: 1,
      applied: 0.5,
      remaining: 151.5,
    });
    expect(r.remaining_after).toBe(496.5);
    expect(r.extra).toBe(0);
  });
});

describe("allocateAccountSettlement — ordering", () => {
  it("same created_at: FINANCIAL_SERVICE before LEDGER, then by id", () => {
    const t = "2026-10-01 09:00:00";
    const rows = [
      ledger(1, 10, t),
      fs(9, 10, t),
      fs(4, 10, t),
      ledger(2, 10, t),
    ];
    const r = usd(rows, 25);
    // Order: FS 4, FS 9, LEDGER 1, LEDGER 2
    expect(r.closed.map((c) => `${c.kind}:${c.id}`)).toEqual([
      "FINANCIAL_SERVICE:4",
      "FINANCIAL_SERVICE:9",
    ]);
    expect(r.partial).toMatchObject({ kind: "LEDGER", id: 1, applied: 5 });
    expect(r.untouched.map((c) => `${c.kind}:${c.id}`)).toEqual(["LEDGER:2"]);
  });

  it("sorts rows passed out of order by created_at string", () => {
    const r = usd([SIX[3], SIX[0], SIX[5], SIX[2], SIX[1], SIX[4]], 300);
    expect(ids(r.closed)).toEqual([1, 2]);
    expect(r.partial).toMatchObject({ id: 3, applied: 47 });
  });

  it("compares created_at as a string, never as a parsed Date", () => {
    // As text ' ' (0x20) < 'T' (0x54), so the space-separated row is older,
    // although a Date parse of the ISO one would put it first.
    const r = usd(
      [
        fs(1, 10, "2026-10-01T08:00:00Z"),
        fs(2, 10, "2026-10-01 09:00:00"),
      ],
      10,
    );
    expect(ids(r.closed)).toEqual([2]);
    expect(ids(r.untouched)).toEqual([1]);
  });
});

describe("allocateAccountSettlement — LBP", () => {
  it("900,000 and 450,000 owed, paid 1,000,000 → 900,000 closes, 450,000 part-paid 100,000", () => {
    const r = allocateAccountSettlement({
      currency: "LBP",
      rows: [
        fs(1, 900000, "2026-10-01 09:00:00"),
        fs(2, 450000, "2026-10-01 10:00:00"),
      ],
      paid: 1000000,
      commission: 0,
      waive: 0,
      eps: 0.5,
    });
    expect(ids(r.closed)).toEqual([1]);
    expect(r.partial).toEqual({
      kind: "FINANCIAL_SERVICE",
      id: 2,
      applied: 100000,
      remaining: 350000,
    });
    expect(r.remaining_after).toBe(350000);
    expect(r.extra).toBe(0);
  });

  it("rounds takes to whole LBP", () => {
    const r = allocateAccountSettlement({
      currency: "LBP",
      rows: [fs(1, 900000, "2026-10-01 09:00:00")],
      paid: 100000.4,
      commission: 0,
      waive: 0,
      eps: 0.5,
    });
    expect(r.partial).toMatchObject({ applied: 100000, remaining: 800000 });
    for (const t of r.takes) expect(Number.isInteger(t.amount)).toBe(true);
  });
});

describe("allocateAccountSettlement — COLLECT (OMT owes the shop)", () => {
  it("credits −40 and −20, paid −60 → both close, nothing extra", () => {
    const r = usd(
      [ledger(1, -40, "2026-10-01 09:00:00"), ledger(2, -20, "2026-10-01 10:00:00")],
      -60,
    );
    expect(ids(r.closed)).toEqual([1, 2]);
    expect(r.partial).toBeNull();
    expect(r.extra).toBe(0);
    expect(r.remaining_after).toBe(0);
    expect(r.direction_from_rows).toBe("COLLECT");
    expect(takenOn(r, 1, "PAYMENT")).toBe(40);
    expect(takenOn(r, 2, "PAYMENT")).toBe(20);
  });

  it("a waive takes the direction's sign: credit −40, received 38, waive 2 → closes", () => {
    const r = usd([ledger(1, -40, "2026-10-01 09:00:00")], -38, { waive: 2 });
    expect(ids(r.closed)).toEqual([1]);
    expect(r.extra).toBe(0);
    expect(takenOn(r, 1, "WAIVE")).toBe(2);
    expect(takenOn(r, 1, "PAYMENT")).toBe(38);
  });

  it("debts and credits that cancel exactly → direction NONE, all close by netting", () => {
    const r = usd([fs(1, 60, "2026-10-01 09:00:00"), CREDIT_60], 0);
    expect(r.direction_from_rows).toBe("NONE");
    expect(ids(r.closed)).toEqual([50, 1]);
    expect(r.remaining_after).toBe(0);
  });
});

describe("allocateAccountSettlement — sources", () => {
  it("waive first, then money; the commission is never a source", () => {
    const r = usd(SIX, 300, { commission: 0.7, waive: 2 });
    expect(takenOn(r, 1, "COMMISSION")).toBe(0);
    expect(takenOn(r, 1, "WAIVE")).toBe(2);
    expect(takenOn(r, 1, "PAYMENT")).toBe(150);
    // A partial row carries PAYMENT coverage only.
    expect(r.partial).toMatchObject({ id: 3, applied: 49 });
    expect(r.takes.filter((t) => t.id === 3).map((t) => t.source)).toEqual([
      "PAYMENT",
    ]);
  });

  it("Σ non-netting takes = budget − extra", () => {
    const r = usd(SIX, 507.11, { commission: 0.7 });
    const applied = r.takes
      .filter((t) => t.source !== "NETTING")
      .reduce((s, t) => s + t.amount, 0);
    expect(Math.round(applied * 100) / 100).toBe(497);
    // The commission is not part of the budget, so it is never extra either.
    expect(r.extra).toBe(10.11);
  });
});

describe("allocateAccountSettlement — commission allocation", () => {
  it("over every closed model-1 row, in proportion to what each owed, largest remainder to the cent", () => {
    const r = usd(SIX, 497, { commission: 0.7 });
    // 70 cents over weights 152/101/101/101/21/21 (Σ 497):
    // floors 21,14,14,14,2,2 = 67; the 3 leftover cents go to the largest
    // fractions (rows 5, 6: .958; row 1: .408).
    expect(r.commission_alloc).toEqual([
      { id: 1, amount: 0.22 },
      { id: 2, amount: 0.14 },
      { id: 3, amount: 0.14 },
      { id: 4, amount: 0.14 },
      { id: 5, amount: 0.03 },
      { id: 6, amount: 0.03 },
    ]);
    const sum = r.commission_alloc.reduce((s, a) => s + a.amount, 0);
    expect(Math.round(sum * 100)).toBe(70);
  });

  it("three closed model-1 rows, one non-model-1 row: only the model-1 rows share it", () => {
    const rows = [
      fs(1, 152, "2026-10-01 09:00:00"),
      fs(2, 101, "2026-10-01 10:00:00"),
      fs(3, 21, "2026-10-01 11:00:00"),
      fs(4, 50, "2026-10-01 12:00:00", { commission_model1: false }),
    ];
    const r = usd(rows, 324, { commission: 0.7 });
    expect(ids(r.closed)).toEqual([1, 2, 3, 4]);
    // 70 cents over 152/101/21 (Σ 274): 38.83, 25.80, 5.36 → floors 68,
    // leftover 2 cents to rows 1 (.83) and 2 (.80).
    expect(r.commission_alloc).toEqual([
      { id: 1, amount: 0.39 },
      { id: 2, amount: 0.26 },
      { id: 3, amount: 0.05 },
    ]);
  });

  it("weights are what each row owed BEFORE this settlement (its remaining)", () => {
    const rows = [
      fs(1, 50, "2026-10-01 09:00:00"), // part-paid earlier: 50 of 152 left
      fs(2, 50, "2026-10-01 10:00:00"),
    ];
    const r = usd(rows, 100, { commission: 1 });
    expect(r.commission_alloc).toEqual([
      { id: 1, amount: 0.5 },
      { id: 2, amount: 0.5 },
    ]);
  });

  it("commission with no model-1 row closing → empty allocation and the refusal flag", () => {
    const r = usd(SIX, 0, { commission: 0.7 });
    expect(r.closed).toEqual([]);
    expect(r.partial).toBeNull();
    expect(r.commission_alloc).toEqual([]);
    expect(r.commission_without_closed_model1).toBe(true);
  });

  it("commission where only non-model-1 rows close → the refusal flag", () => {
    const r = usd(
      [fs(1, 10, "2026-10-01 09:00:00", { commission_model1: false })],
      10,
      { commission: 0.7 },
    );
    expect(ids(r.closed)).toEqual([1]);
    expect(r.commission_without_closed_model1).toBe(true);
    expect(r.commission_alloc).toEqual([]);
  });

  it("no commission → no flag, no allocation", () => {
    const r = usd(SIX, 497);
    expect(r.commission_without_closed_model1).toBe(false);
    expect(r.commission_alloc).toEqual([]);
  });
});

describe("allocateAccountSettlement — cash-out commission", () => {
  const rows = [
    ledger(1, -40, "2026-10-01 09:00:00", { cashout_commission: 0.4 }),
    ledger(2, -20, "2026-10-01 10:00:00", { cashout_commission: 0.2 }),
    fs(3, 30, "2026-10-01 11:00:00"),
  ];

  it("a credit only part-netted is not recognised", () => {
    const r = usd(rows, 0);
    expect(ids(r.closed)).toEqual([3]);
    expect(r.partial).toEqual({
      kind: "LEDGER",
      id: 1,
      applied: 30,
      remaining: -10,
    });
    expect(r.cashout_commission_recognised).toBe(0);
  });

  it("counts only the credit rows that close", () => {
    const r = usd(rows, -10);
    expect(ids(r.closed)).toEqual([1, 3]);
    expect(ids(r.untouched)).toEqual([2]);
    expect(r.cashout_commission_recognised).toBe(0.4);
    const all = usd(rows, -30);
    expect(all.cashout_commission_recognised).toBe(0.6);
  });
});

describe("allocateAccountSettlement — netting pairs", () => {
  it("a credit on member 30 netted against a debt on member 28 → one pair", () => {
    const r = usd([fs(1, 152, "2026-10-01 09:00:00"), CREDIT_60], 0);
    expect(r.netting_pairs).toEqual([
      { credit_member: APP, debit_member: COUNTER, amount: 60 },
    ]);
  });

  it("same-member netting → no pair", () => {
    const r = usd(
      [
        fs(1, 152, "2026-10-01 09:00:00"),
        ledger(2, -60, "2026-10-01 08:00:00", { member_supplier_id: COUNTER }),
      ],
      0,
    );
    expect(r.netting_pairs).toEqual([]);
    expect(takenOn(r, 1, "NETTING")).toBe(60);
  });

  it("aggregates by member pair across rows", () => {
    const r = usd(
      [
        fs(1, 20, "2026-10-01 09:00:00"),
        fs(2, 20, "2026-10-01 10:00:00"),
        ledger(3, -30, "2026-10-01 08:00:00"),
        ledger(4, -5, "2026-10-01 08:30:00", { member_supplier_id: COUNTER }),
      ],
      0,
    );
    // Credits oldest first (30 on APP, then 5 on COUNTER) against debts
    // oldest first (20, then 20, both COUNTER): APP→COUNTER 30, COUNTER
    // self 5 (no pair).
    expect(r.netting_pairs).toEqual([
      { credit_member: APP, debit_member: COUNTER, amount: 30 },
    ]);
    expect(r.remaining_after).toBe(5);
  });
});

describe("allocateAccountSettlement — tolerance", () => {
  it("a row already within eps closes without a take", () => {
    const r = usd([fs(7, 0.004, "2026-10-01 08:00:00"), SIX[0]], 0);
    expect(ids(r.closed)).toEqual([7]);
    expect(ids(r.untouched)).toEqual([1]);
    expect(r.takes).toEqual([]);
  });
});

// Owner decision 2026-10-15 (replaces FR-013a): "Pay the amount in full;
// don't let the commission amount affect the payment leg amount." Only
// money (and a waive) covers rows; the commission is booked on the account
// as a credit by the repository and only drives the profit allocation.
describe("allocateAccountSettlement — commission never covers rows (owner 2026-10-15)", () => {
  it("paid 497 + commission 0.70 → all six close, nothing extra, no COMMISSION takes; profit still allocated", () => {
    const r = usd(SIX, 497, { commission: 0.7 });
    expect(ids(r.closed)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.extra).toBe(0);
    expect(r.remaining_after).toBe(0);
    expect(r.takes.filter((t) => t.source === "COMMISSION")).toEqual([]);
    expect(
      Math.round(r.commission_alloc.reduce((s, a) => s + a.amount, 0) * 100),
    ).toBe(70);
  });

  it("paid 496.30 + commission 0.70 → the newest 21 stays part-paid 20.30 (commission is not money)", () => {
    const r = usd(SIX, 496.3, { commission: 0.7 });
    expect(ids(r.closed)).toEqual([1, 2, 3, 4, 5]);
    expect(r.partial).toEqual({
      kind: "FINANCIAL_SERVICE",
      id: 6,
      applied: 20.3,
      remaining: 0.7,
    });
    expect(r.extra).toBe(0);
  });

  it("paid 0 + commission 0.70 → nothing is covered at all", () => {
    const r = usd(SIX, 0, { commission: 0.7 });
    expect(r.takes).toEqual([]);
    expect(r.partial).toBeNull();
    expect(r.remaining_after).toBe(497);
    expect(r.commission_without_closed_model1).toBe(true);
  });
});
