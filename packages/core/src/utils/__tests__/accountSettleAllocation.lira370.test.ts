/**
 * LIRA-370 T010/T017 — the allocator with `commission_covers` (the OMT
 * account, owner 2026-11-03): the commission closes rows together with the
 * money, and is split as profit over the in-scope commission-carrying
 * transfers of the ticked types — each its outstanding estimate first, the
 * extra in proportion to those estimates (research R2/R3).
 *
 * Without the flag the output must be exactly today's (Whish and every
 * other caller).
 *
 * RULE 17 — written before the allocator change; the first run is recorded
 * in tasks.md T010/T017.
 */
import {
  allocateAccountSettlement,
  type AccountSettleAllocInput,
  type AccountSettleAllocRow,
} from "../accountSettleAllocation";

const OMT = 28;
const IPICK = 26;
const APP = 30;

function row(
  kind: "FINANCIAL_SERVICE" | "LEDGER",
  id: number,
  remaining: number,
  created_at: string,
  extra: Partial<AccountSettleAllocRow> = {},
): AccountSettleAllocRow {
  return {
    kind,
    id,
    member_supplier_id: kind === "LEDGER" ? IPICK : OMT,
    created_at,
    remaining,
    commission_model1: kind === "FINANCIAL_SERVICE",
    cashout_commission: 0,
    ...extra,
  };
}

/** The test shop on 2026-11-03: we owe OMT 776.50, expected commission 4.20. */
const PAY_ROWS: AccountSettleAllocRow[] = [
  row("LEDGER", 323, 200, "2026-10-16 08:00:00"),
  row("LEDGER", 324, 200, "2026-10-16 08:05:00", { member_supplier_id: APP }),
  row("FINANCIAL_SERVICE", 505, 204, "2026-10-16 09:00:00", { commission_estimate: 1 }),
  row("FINANCIAL_SERVICE", 507, 50.5, "2026-10-16 09:10:00", { commission_estimate: 3 }),
  row("FINANCIAL_SERVICE", 508, 101, "2026-10-16 09:20:00", { commission_estimate: 0.1 }),
  row("FINANCIAL_SERVICE", 818, 21, "2026-10-26 09:00:00", { commission_estimate: 0.1 }),
];

const base = (over: Partial<AccountSettleAllocInput>): AccountSettleAllocInput => ({
  currency: "USD",
  rows: PAY_ROWS,
  paid: 762.3,
  commission: 14.2,
  waive: 0,
  eps: 0.005,
  ...over,
});

const allocSum = (a: Array<{ amount: number }>) =>
  Math.round(a.reduce((s, x) => s + x.amount, 0) * 100) / 100;

describe("allocateAccountSettlement — LIRA-370 commission_covers", () => {
  it("SMS 762.30 + commission 14.20 closes every row (one settlement)", () => {
    const r = allocateAccountSettlement(base({ commission_covers: true }));
    expect(r.closed).toHaveLength(6);
    expect(r.partial).toBeNull();
    expect(r.remaining_after).toBe(0);
    expect(r.extra).toBe(0);
    const bySource = (s: string) =>
      Math.round(r.takes.filter((t) => t.source === s).reduce((x, t) => x + t.amount, 0) * 100) / 100;
    expect(bySource("COMMISSION")).toBe(14.2);
    expect(bySource("PAYMENT")).toBe(762.3);
  });

  it("order: waive, then commission, then money (oldest rows take the commission)", () => {
    const r = allocateAccountSettlement(base({ commission_covers: true }));
    const first = r.takes[0];
    expect(first.source).toBe("COMMISSION");
    expect(first.id).toBe(323);
    expect(first.amount).toBe(14.2);
  });

  it("split: each transfer its estimate, the $10 extra in proportion to the estimates", () => {
    const r = allocateAccountSettlement(base({ commission_covers: true }));
    expect(allocSum(r.commission_alloc)).toBe(14.2);
    const by = Object.fromEntries(r.commission_alloc.map((a) => [a.id, a.amount]));
    // estimates 1 / 3 / 0.1 / 0.1 (sum 4.2); extra 10 split 1:3:0.1:0.1
    expect(by[505]).toBeCloseTo(1 + 10 * (1 / 4.2), 2);
    expect(by[507]).toBeCloseTo(3 + 10 * (3 / 4.2), 2);
    expect(by[508]).toBeCloseTo(0.1 + 10 * (0.1 / 4.2), 2);
    expect(by[818]).toBeCloseTo(0.1 + 10 * (0.1 / 4.2), 2);
    expect(r.commission_without_closed_model1).toBe(false);
  });

  it("less than expected: the commission is spread in proportion to the estimates", () => {
    const r = allocateAccountSettlement(
      base({ commission_covers: true, paid: 774.5, commission: 2 }),
    );
    expect(r.closed).toHaveLength(6);
    expect(allocSum(r.commission_alloc)).toBe(2);
    const by = Object.fromEntries(r.commission_alloc.map((a) => [a.id, a.amount]));
    expect(by[507]).toBeCloseTo(2 * (3 / 4.2), 2);
  });

  it("unticked types (estimate 0) take no profit, but still close", () => {
    const rows = PAY_ROWS.map((x) =>
      x.id === 507 || x.id === 505 ? { ...x, commission_estimate: 0 } : x,
    );
    const r = allocateAccountSettlement(
      base({ rows, commission_covers: true, paid: 776.3, commission: 0.2 }),
    );
    expect(r.closed).toHaveLength(6);
    expect(r.commission_alloc.map((a) => a.id).sort()).toEqual([508, 818]);
  });

  it("short money: rows not closed still get their share of the SMS commission", () => {
    const r = allocateAccountSettlement(
      base({ commission_covers: true, paid: 700, commission: 14.2 }),
    );
    expect(r.remaining_after).toBeCloseTo(62.3, 2);
    // The SMS commission is OMT's deduction, whatever the money closes:
    // every ticked transfer in scope takes its part, so no later
    // settlement counts it again (research R3).
    expect(allocSum(r.commission_alloc)).toBe(14.2);
    expect(r.commission_alloc.map((a) => a.id).sort()).toEqual([505, 507, 508, 818]);
  });

  it("collect, receive-only: a Western Union receive (credit row) takes the commission", () => {
    const rows = [
      row("FINANCIAL_SERVICE", 1346, -1000, "2026-11-02 10:00:00", { commission_estimate: 2 }),
    ];
    const r = allocateAccountSettlement(
      base({ rows, commission_covers: true, paid: -1022, commission: 22 }),
    );
    expect(r.direction_from_rows).toBe("COLLECT");
    expect(r.closed).toHaveLength(1);
    expect(r.extra).toBe(0);
    expect(r.commission_without_closed_model1).toBe(false);
    expect(r.commission_alloc).toEqual([{ id: 1346, amount: 22 }]);
  });

  it("collect: money received + commission close the credits, no extra", () => {
    const rows = [
      ...PAY_ROWS,
      row("FINANCIAL_SERVICE", 1346, -1000, "2026-11-02 10:00:00", { commission_estimate: 2 }),
    ];
    const r = allocateAccountSettlement(
      base({ rows, commission_covers: true, paid: -249.7, commission: 26.2 }),
    );
    expect(r.closed).toHaveLength(7);
    expect(r.extra).toBe(0);
    expect(r.remaining_after).toBe(0);
    expect(allocSum(r.commission_alloc)).toBe(26.2);
  });

  it("without the flag: exactly today's output (commission covers nothing)", () => {
    const today = allocateAccountSettlement(base({}));
    const explicitOff = allocateAccountSettlement(base({ commission_covers: false }));
    expect(explicitOff).toEqual(today);
    // today: 762.30 leaves the newest row part-paid by 14.20
    expect(today.partial?.id).toBe(818);
    expect(today.remaining_after).toBeCloseTo(14.2, 2);
    expect(today.takes.some((t) => t.source === "COMMISSION")).toBe(false);
  });

  it("without the flag: a receive-only collect still refuses the commission (Whish unchanged)", () => {
    const rows = [
      row("FINANCIAL_SERVICE", 1346, -1000, "2026-11-02 10:00:00", { commission_estimate: 2 }),
    ];
    const r = allocateAccountSettlement(base({ rows, paid: -1000, commission: 2 }));
    expect(r.commission_without_closed_model1).toBe(true);
  });

  // Owner 2026-11-03: an OMT credit bigger than the picked days flips the
  // SMS settlement to "OMT pays you" — the whole credit is used.
  // RULE 17 — written before the change; first run: credit_used_too_high.
  it("credit 1000 on 776.50 owed: the credit closes the days, OMT pays the rest (SMS −227.70)", () => {
    const credit = row("LEDGER", 900, -1000, "2026-10-27 08:00:00", {
      member_supplier_id: OMT,
      commission_model1: false,
    });
    const r = allocateAccountSettlement(
      base({
        account_credits: [credit],
        credit_used: 1000,
        paid: -227.7,
        commission: 4.2,
        commission_covers: true,
        whole_credit: true,
      }),
    );
    expect(r.credit_used_too_high).toBeUndefined();
    expect(r.closed).toHaveLength(7);
    expect(r.remaining_after).toBe(0);
    expect(r.extra).toBe(0);
    const bySource = (s: string) =>
      Math.round(r.takes.filter((t) => t.source === s).reduce((x, t) => x + t.amount, 0) * 100) / 100;
    expect(bySource("NETTING")).toBe(1553);
    expect(bySource("PAYMENT")).toBe(223.5);
    expect(allocSum(r.commission_alloc)).toBe(4.2);
  });

  it("without whole_credit the credit is still capped at what the days owe (even with commission_covers)", () => {
    const credit = row("LEDGER", 900, -1000, "2026-10-27 08:00:00", {
      member_supplier_id: OMT,
      commission_model1: false,
    });
    const r = allocateAccountSettlement(
      base({ account_credits: [credit], credit_used: 1000, paid: 0, commission: 0, commission_covers: true }),
    );
    expect(r.credit_used_too_high).toBe(true);
  });
});
