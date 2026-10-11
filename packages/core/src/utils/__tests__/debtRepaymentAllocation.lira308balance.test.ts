/**
 * LIRA-308 owner answer 2 (2026-10-11) — a client with a manual / imported /
 * opening debt (a balance no listed item accounts for) gets that part as
 * its OWN tickable line, "Earlier balance (no items)", so "all ticked on
 * open" is the whole balance.
 *
 * The line is a `kind: "balance"` allocation item (`earlierBalanceItem`):
 *  - ticked, it is paid in the ticked order — after cash-drawer items, and
 *    as the OLDEST of the rest (decision 4);
 *  - ticked ALONE, its money pays no listed item and moves nothing into a
 *    primary cash drawer (a UI-only line would have let the server's
 *    "rest in today's order" and "OMT drawer first" steps pay an unticked
 *    transfer with it);
 *  - unticked, it keeps today's place: the implicit remainder after every
 *    item — so a no-target repayment / write-off is unchanged.
 */
import {
  allocateRepayment,
  planRepaymentTargets,
  earlierBalanceItem,
  EARLIER_BALANCE_REF,
  type AllocationItem,
} from "../debtRepaymentAllocation";

const RATE = 89_000;

const LOTO: AllocationItem = {
  kind: "charge",
  id: 11,
  rowId: 11,
  createdAt: "2026-10-01 09:00:00",
  openUsd: 20,
  openLbp: 0,
  routingCap: null,
};
const TRANSFER: AllocationItem = {
  kind: "charge",
  id: 12,
  rowId: 12,
  createdAt: "2026-10-05 09:00:00",
  openUsd: 101,
  openLbp: 0,
  routingCap: { usd: 101, lbp: 0 },
};
const BALANCE = earlierBalanceItem({ usd: 30, lbp: 0 });

function usd(amount: number) {
  return {
    reductionUsd: amount,
    reductionLbp: 0,
    appliedUsd: amount,
    appliedLbp: 0,
    cashUsd: amount,
    cashLbp: 0,
    rate: RATE,
  };
}

const cov = (
  r: {
    coverage: Array<{ kind: string; id: number; usd: number; lbp: number }>;
  },
  it: { kind: string; id: number },
) =>
  r.coverage.find((c) => c.kind === it.kind && c.id === it.id) ?? {
    usd: 0,
    lbp: 0,
  };

describe("LIRA-308 answer 2 — the earlier-balance line", () => {
  it("is a 'balance' item with the uncovered amount", () => {
    expect(BALANCE).toMatchObject({
      kind: EARLIER_BALANCE_REF.kind,
      id: EARLIER_BALANCE_REF.id,
      openUsd: 30,
      openLbp: 0,
      routingCap: null,
    });
  });

  it("ticked alone, $30 cash: pays the balance, no listed item, nothing routed", () => {
    const r = allocateRepayment({
      items: [LOTO, TRANSFER, BALANCE],
      targets: [EARLIER_BALANCE_REF],
      ...usd(30),
    });
    expect(cov(r, BALANCE).usd).toBeCloseTo(30, 2);
    expect(cov(r, TRANSFER).usd).toBe(0);
    expect(cov(r, LOTO).usd).toBe(0);
    expect(r.routedUsd).toBe(0);
  });

  it("ticked with a newer charge, partial $40: the balance (oldest) first, then the charge", () => {
    const r = allocateRepayment({
      items: [LOTO, BALANCE],
      targets: [{ kind: "charge", id: LOTO.id }, EARLIER_BALANCE_REF],
      ...usd(40),
    });
    expect(cov(r, BALANCE).usd).toBeCloseTo(30, 2);
    expect(cov(r, LOTO).usd).toBeCloseTo(10, 2);
  });

  it("ticked with a cash-drawer transfer: the transfer still comes first", () => {
    const r = allocateRepayment({
      items: [TRANSFER, BALANCE],
      targets: [EARLIER_BALANCE_REF, { kind: "charge", id: TRANSFER.id }],
      ...usd(110),
    });
    expect(cov(r, TRANSFER).usd).toBeCloseTo(101, 2);
    expect(cov(r, BALANCE).usd).toBeCloseTo(9, 2);
  });

  it("unchanged — no targets: the balance is the remainder after every item", () => {
    const r = allocateRepayment({
      items: [LOTO, BALANCE],
      ...usd(20),
    });
    expect(cov(r, LOTO).usd).toBeCloseTo(20, 2);
    expect(cov(r, BALANCE).usd).toBe(0);
  });

  it("an amount above the ticked charge reaches the unticked balance as an auto target; the server agrees", () => {
    const plan = planRepaymentTargets({
      items: [LOTO, BALANCE],
      ticked: [{ kind: "charge", id: LOTO.id }],
      reductionUsd: 35,
      reductionLbp: 0,
      rate: RATE,
    });
    expect(plan.targets).toEqual([
      { kind: "charge", id: LOTO.id },
      { ...EARLIER_BALANCE_REF, auto: true },
    ]);
    expect(cov(plan, BALANCE).usd).toBeCloseTo(15, 2);
    const server = allocateRepayment({
      items: [LOTO, BALANCE],
      targets: plan.targets,
      ...usd(35),
    });
    expect(server.coverage).toEqual(plan.coverage);
  });
});
