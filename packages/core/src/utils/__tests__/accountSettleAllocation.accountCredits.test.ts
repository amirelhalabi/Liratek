/**
 * LIRA-343 — allocateAccountSettlement with account credits (research R5
 * "Update", contracts/settle-account-days.md "Owner acceptance tables").
 *
 * The user sets `credit_used`; the payment never moves it (owner
 * 2026-10-26). Rule 17: written against the types-only change (no
 * behaviour), run red, then implemented.
 */
import {
  allocateAccountSettlement,
  type AccountSettleAllocInput,
  type AccountSettleAllocResult,
  type AccountSettleAllocRow,
} from "../accountSettleAllocation";

const COUNTER = 28;
const APP = 30;

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
    member_supplier_id: COUNTER,
    created_at,
    remaining,
    commission_model1: false,
    cashout_commission: 0,
    ...over,
  };
}

/** Owner's picked days 23–25 Oct: $375 owed after the $40 receive. */
const SHOP_ROWS: AccountSettleAllocRow[] = [
  fs(421, 120, "2026-10-23 10:00:00"),
  fs(427, 95, "2026-10-24 09:00:00"),
  fs(429, -40, "2026-10-24 15:00:00"),
  fs(430, 200, "2026-10-25 11:00:00"),
];
/** The open account credit: OMT owes the shop $8.70. */
const ACCOUNT_CREDIT = ledger(900, -8.7, "2026-10-20 12:00:00");

/** Owner's OMT-pays days: two receives, $100 owed to the shop. */
const OMT_ROWS: AccountSettleAllocRow[] = [
  fs(501, -60, "2026-10-23 10:00:00"),
  fs(502, -40, "2026-10-24 10:00:00"),
];

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

/** Every input row lands in exactly one of closed / partial / untouched / account_partial. */
function expectEveryRowClassifiedOnce(
  r: AccountSettleAllocResult,
  input: AccountSettleAllocRow[],
): void {
  const seen = [
    ...r.closed,
    ...r.untouched,
    ...(r.partial ? [r.partial] : []),
    ...(r.account_partial ? [r.account_partial] : []),
  ].map((x) => `${x.kind}:${x.id}`);
  expect([...seen].sort()).toEqual(
    input.map((x) => `${x.kind}:${x.id}`).sort(),
  );
}

describe("LIRA-343 owner table — shop pays ($375 owed, account credit $8.70)", () => {
  const allInput = [...SHOP_ROWS, ACCOUNT_CREDIT];

  it("credit 8.70 + paid 366.30 → all debts closed, credit fully used, no extra", () => {
    const r = usd(SHOP_ROWS, 366.3, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 8.7,
    });
    expect(ids(r.closed).sort()).toEqual([421, 427, 429, 430, 900]);
    expect(r.partial).toBeNull();
    expect(r.account_partial).toBeNull();
    expect(r.untouched).toEqual([]);
    expect(r.extra).toBe(0);
    expect(r.remaining_after).toBe(0);
    expect(r.account_credit_applied).toBe(8.7);
    expect(r.credit_used_too_high).toBeUndefined();
    // The credit covers the OLDEST debt, as NETTING on both sides.
    expect(takenOn(r, 900, "NETTING")).toBe(8.7);
    expect(takenOn(r, 421, "NETTING")).toBe(48.7); // 40 day credit + 8.70
    expect(takenOn(r, 421, "PAYMENT")).toBe(71.3);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("credit 5.00 + paid 370 → all debts closed, credit 3.70 left", () => {
    const r = usd(SHOP_ROWS, 370, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 5,
    });
    expect(ids(r.closed).sort()).toEqual([421, 427, 429, 430]);
    expect(r.partial).toBeNull();
    expect(r.account_partial).toEqual({
      kind: "LEDGER",
      id: 900,
      applied: 5,
      remaining: -3.7,
    });
    expect(r.extra).toBe(0);
    expect(r.account_credit_applied).toBe(5);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("credit 0 + paid 375 → all debts closed, credit untouched", () => {
    const r = usd(SHOP_ROWS, 375, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 0,
    });
    expect(ids(r.closed).sort()).toEqual([421, 427, 429, 430]);
    expect(ids(r.untouched)).toEqual([900]);
    expect(r.account_partial).toBeNull();
    expect(r.extra).toBe(0);
    expect(r.account_credit_applied).toBe(0);
    expect(takenOn(r, 900)).toBe(0);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("credit 8.70 + paid 300 → #430 part-paid, 66.30 left; credit used", () => {
    const r = usd(SHOP_ROWS, 300, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 8.7,
    });
    expect(ids(r.closed).sort()).toEqual([421, 427, 429, 900]);
    expect(r.partial).toEqual({
      kind: "FINANCIAL_SERVICE",
      id: 430,
      applied: 133.7,
      remaining: 66.3,
    });
    expect(r.account_partial).toBeNull();
    expect(r.remaining_after).toBe(66.3);
    expect(r.extra).toBe(0);
    expect(r.account_credit_applied).toBe(8.7);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("credit 0 + paid 380 → all closed, extra 5.00, credit untouched (account credit never makes extra)", () => {
    const r = usd(SHOP_ROWS, 380, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 0,
    });
    expect(ids(r.closed).sort()).toEqual([421, 427, 429, 430]);
    expect(ids(r.untouched)).toEqual([900]);
    expect(r.extra).toBe(5);
    expect(r.account_credit_applied).toBe(0);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("credit 9.00 → refused: more than the credit (flag, nothing of it applied)", () => {
    const r = usd(SHOP_ROWS, 366, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 9,
    });
    expect(r.credit_used_too_high).toBe(true);
    expect(r.account_credit_applied).toBe(0);
    expect(takenOn(r, 900)).toBe(0);
    expect(ids(r.untouched)).toContain(900);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("credit 5.00 + paid 300 → a debt part-paid AND the credit part-used (two separate fields)", () => {
    const r = usd(SHOP_ROWS, 300, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 5,
    });
    expect(r.partial).toEqual({
      kind: "FINANCIAL_SERVICE",
      id: 430,
      applied: 130,
      remaining: 70,
    });
    expect(r.account_partial).toEqual({
      kind: "LEDGER",
      id: 900,
      applied: 5,
      remaining: -3.7,
    });
    expect(r.extra).toBe(0);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("credit more than what is owed → refused even if the credit is larger", () => {
    const big = ledger(901, -500, "2026-10-20 12:00:00");
    const r = usd(SHOP_ROWS, 0, { account_credits: [big], credit_used: 376 });
    expect(r.credit_used_too_high).toBe(true);
    const ok = usd(SHOP_ROWS, 0, { account_credits: [big], credit_used: 375 });
    expect(ok.credit_used_too_high).toBeUndefined();
    expect(ok.remaining_after).toBe(0);
    expect(ok.extra).toBe(0);
    expect(ok.account_partial).toEqual({
      kind: "LEDGER",
      id: 901,
      applied: 375,
      remaining: -125,
    });
    expectEveryRowClassifiedOnce(r, [...SHOP_ROWS, big]);
    expectEveryRowClassifiedOnce(ok, [...SHOP_ROWS, big]);
  });

  it("several account credits are used oldest first", () => {
    const older = ledger(910, -3, "2026-10-01 08:00:00");
    const newer = ledger(911, -10, "2026-10-21 08:00:00");
    const r = usd(SHOP_ROWS, 370, {
      account_credits: [newer, older],
      credit_used: 5,
    });
    expect(takenOn(r, 910, "NETTING")).toBe(3);
    expect(takenOn(r, 911, "NETTING")).toBe(2);
    expect(r.account_partial).toMatchObject({ id: 911, remaining: -8 });
    expectEveryRowClassifiedOnce(r, [...SHOP_ROWS, older, newer]);
  });
});

describe("LIRA-343 owner table — OMT pays ($100 owed to the shop, account credit $8.70)", () => {
  const allInput = [...OMT_ROWS, ACCOUNT_CREDIT];

  it("credit 8.70 + received 108.70 → all closed", () => {
    const r = usd(OMT_ROWS, -108.7, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 8.7,
    });
    expect(ids(r.closed).sort()).toEqual([501, 502, 900]);
    expect(r.extra).toBe(0);
    expect(r.account_credit_applied).toBe(8.7);
    expect(takenOn(r, 900, "PAYMENT")).toBe(8.7);
    expect(r.direction_from_rows).toBe("COLLECT");
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("credit 4.00 + received 104 → day credits closed, credit 4.70 left", () => {
    const r = usd(OMT_ROWS, -104, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 4,
    });
    expect(ids(r.closed).sort()).toEqual([501, 502]);
    expect(r.account_partial).toEqual({
      kind: "LEDGER",
      id: 900,
      applied: 4,
      remaining: -4.7,
    });
    expect(r.extra).toBe(0);
    expect(r.account_credit_applied).toBe(4);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("credit 0 + received 100 → day credits closed, credit untouched", () => {
    const r = usd(OMT_ROWS, -100, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 0,
    });
    expect(ids(r.closed).sort()).toEqual([501, 502]);
    expect(ids(r.untouched)).toEqual([900]);
    expect(r.extra).toBe(0);
    expect(r.account_credit_applied).toBe(0);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("received beyond day credits + credit_used is extra; the credit is never used past credit_used", () => {
    const r = usd(OMT_ROWS, -106, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 4,
    });
    expect(takenOn(r, 900)).toBe(4);
    expect(r.extra).toBe(-2);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("received less than day credits + credit_used → only what the money reaches", () => {
    const r = usd(OMT_ROWS, -102, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 4,
    });
    expect(r.account_credit_applied).toBe(2);
    expect(r.extra).toBe(0);
    expectEveryRowClassifiedOnce(r, allInput);
  });

  it("credit 9.00 → refused: more than the open account credit", () => {
    const r = usd(OMT_ROWS, -109, {
      account_credits: [ACCOUNT_CREDIT],
      credit_used: 9,
    });
    expect(r.credit_used_too_high).toBe(true);
    expect(takenOn(r, 900)).toBe(0);
    expectEveryRowClassifiedOnce(r, allInput);
  });
});

describe("LIRA-343 positive account rows (shop owes OMT at account level)", () => {
  it("net against negative account rows first (NETTING on both sides)", () => {
    const owe = ledger(920, 3, "2026-10-22 08:00:00");
    const r = usd(SHOP_ROWS, 375, {
      account_credits: [ACCOUNT_CREDIT, owe],
      credit_used: 0,
    });
    expect(takenOn(r, 920, "NETTING")).toBe(3);
    expect(takenOn(r, 900, "NETTING")).toBe(3);
    expect(ids(r.closed)).toContain(920);
    expect(r.account_partial).toMatchObject({
      id: 900,
      remaining: -5.7,
    });
    // Only 5.70 of credit is left to use now.
    const tooHigh = usd(SHOP_ROWS, 369, {
      account_credits: [ACCOUNT_CREDIT, owe],
      credit_used: 6,
    });
    expect(tooHigh.credit_used_too_high).toBe(true);
    expectEveryRowClassifiedOnce(r, [...SHOP_ROWS, ACCOUNT_CREDIT, owe]);
    expectEveryRowClassifiedOnce(tooHigh, [...SHOP_ROWS, ACCOUNT_CREDIT, owe]);
  });

  it("left-over positive account rows are debts in scope, after the day debts", () => {
    const owe = ledger(921, 10, "2026-10-01 08:00:00"); // older, still last
    const r = usd(SHOP_ROWS, 380, { account_credits: [owe] });
    expect(ids(r.closed).sort()).toEqual([421, 427, 429, 430]);
    // `partial` covers day rows only; a part-covered account row (either
    // sign) is reported in `account_partial`.
    expect(r.partial).toBeNull();
    expect(r.account_partial).toEqual({
      kind: "LEDGER",
      id: 921,
      applied: 5,
      remaining: 5,
    });
    expect(r.remaining_after).toBe(5);
    expect(r.extra).toBe(0);
    expectEveryRowClassifiedOnce(r, [...SHOP_ROWS, owe]);
  });

  it("a part-netted positive account row and a part-paid day debt are both reported", () => {
    const owe = ledger(921, 10, "2026-10-01 08:00:00");
    const cr = ledger(900, -3, "2026-10-20 12:00:00");
    const r = usd(SHOP_ROWS, 300, { account_credits: [owe, cr] });
    expect(takenOn(r, 921, "NETTING")).toBe(3);
    expect(r.partial).toEqual({
      kind: "FINANCIAL_SERVICE",
      id: 430,
      applied: 125,
      remaining: 75,
    });
    expect(r.account_partial).toEqual({
      kind: "LEDGER",
      id: 921,
      applied: 3,
      remaining: 7,
    });
    expect(r.remaining_after).toBe(82);
    expectEveryRowClassifiedOnce(r, [...SHOP_ROWS, owe, cr]);
  });

  it("open day credits net against a positive account row (OMT pays)", () => {
    const owe = ledger(922, 10, "2026-10-22 08:00:00");
    const r = usd(OMT_ROWS, -90, { account_credits: [owe] });
    expect(takenOn(r, 922, "NETTING")).toBe(10);
    expect(ids(r.closed).sort()).toEqual([501, 502, 922]);
    expect(r.extra).toBe(0);
    expect(r.remaining_after).toBe(0);
    expectEveryRowClassifiedOnce(r, [...OMT_ROWS, owe]);
  });
});

describe("LIRA-343 regression — no account credits = LIRA-322 output", () => {
  it("the LIRA-322 fixture (six transfers + −60 credit, paid 100, commission 0.70) is unchanged", () => {
    const SIX: AccountSettleAllocRow[] = [
      fs(1, 152, "2026-10-01 09:00:00"),
      fs(2, 101, "2026-10-01 10:00:00"),
      fs(3, 101, "2026-10-01 11:00:00"),
      fs(4, 101, "2026-10-01 12:00:00"),
      fs(5, 21, "2026-10-01 13:00:00"),
      fs(6, 21, "2026-10-01 14:00:00"),
    ];
    const CREDIT_60 = ledger(50, -60, "2026-10-01 08:00:00", {
      member_supplier_id: APP,
      cashout_commission: 1.25,
    });
    const input = {
      currency: "USD" as const,
      rows: [...SIX, CREDIT_60],
      paid: 100,
      commission: 0.7,
      waive: 0,
      eps: 0.005,
    };
    // Captured from the pre-LIRA-343 build (dist, 2026-10-26) before any
    // behaviour change, plus the two new always-present keys.
    const expected = {
      takes: [
        {
          kind: "FINANCIAL_SERVICE",
          id: 1,
          member_supplier_id: 28,
          source: "NETTING",
          amount: 60,
        },
        {
          kind: "LEDGER",
          id: 50,
          member_supplier_id: 30,
          source: "NETTING",
          amount: 60,
        },
        {
          kind: "FINANCIAL_SERVICE",
          id: 1,
          member_supplier_id: 28,
          source: "PAYMENT",
          amount: 92,
        },
        {
          kind: "FINANCIAL_SERVICE",
          id: 2,
          member_supplier_id: 28,
          source: "PAYMENT",
          amount: 8,
        },
      ],
      closed: [
        { kind: "LEDGER", id: 50 },
        { kind: "FINANCIAL_SERVICE", id: 1 },
      ],
      partial: { kind: "FINANCIAL_SERVICE", id: 2, applied: 8, remaining: 93 },
      untouched: [
        { kind: "FINANCIAL_SERVICE", id: 3 },
        { kind: "FINANCIAL_SERVICE", id: 4 },
        { kind: "FINANCIAL_SERVICE", id: 5 },
        { kind: "FINANCIAL_SERVICE", id: 6 },
      ],
      netting_pairs: [{ credit_member: 30, debit_member: 28, amount: 60 }],
      extra: 0,
      remaining_after: 337,
      commission_alloc: [{ id: 1, amount: 0.7 }],
      commission_without_closed_model1: false,
      cashout_commission_recognised: 1.25,
      direction_from_rows: "PAY",
      account_credit_applied: 0,
      account_partial: null,
    };
    expect(allocateAccountSettlement(input)).toStrictEqual(expected);
    expect(
      allocateAccountSettlement({
        ...input,
        account_credits: [],
        credit_used: 0,
      }),
    ).toStrictEqual(expected);
  });
});
