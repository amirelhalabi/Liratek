/**
 * LIRA-308 (owner decisions 2026-10-11) — the ticks and the amount stay in
 * step. The ONE allocation (`allocateRepayment`) and its planning helper
 * (`planRepaymentTargets`), shared by the repayment modal and
 * `DebtRepository.addRepayment`:
 *
 *  - decision 4: inside the ticked items, cash-drawer items (open
 *    primary-system transfers) are paid first, then oldest first;
 *  - decision 5: an amount above the ticked sum pays unticked items in the
 *    same order; they are sent as `auto` targets and never take money away
 *    from an item the cashier ticked;
 *  - the no-target order (sales first, then oldest — write-off and legacy
 *    callers) is unchanged.
 *
 * Fixtures deliberately put the NON-primary item first by age, so the old
 * "oldest first among the ticked" order fails these cases.
 */
import {
  allocateRepayment,
  planRepaymentTargets,
  type AllocationItem,
} from "../debtRepaymentAllocation";

const RATE = 89_000;

const OLD_CHARGE: AllocationItem = {
  kind: "charge",
  id: 11,
  rowId: 11,
  createdAt: "2026-10-01 09:00:00",
  openUsd: 20,
  openLbp: 0,
  routingCap: null,
};
const NEW_TRANSFER: AllocationItem = {
  kind: "charge",
  id: 12,
  rowId: 12,
  createdAt: "2026-10-05 09:00:00",
  openUsd: 101,
  openLbp: 0,
  routingCap: { usd: 101, lbp: 0 },
};
const NEWER_CHARGE: AllocationItem = {
  kind: "charge",
  id: 13,
  rowId: 13,
  createdAt: "2026-10-08 09:00:00",
  openUsd: 10,
  openLbp: 0,
  routingCap: null,
};
const OLDEST_SALE: AllocationItem = {
  kind: "sale",
  id: 5,
  rowId: 5,
  createdAt: "2026-09-20 09:00:00",
  openUsd: 14,
  openLbp: 0,
};
const LBP_CHARGE: AllocationItem = {
  kind: "charge",
  id: 14,
  rowId: 14,
  createdAt: "2026-09-25 09:00:00",
  openUsd: 0,
  openLbp: 900_000,
  routingCap: null,
};

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

describe("LIRA-308 decision 4 — inside the ticked items: cash drawer first, then oldest", () => {
  it("older charge + newer OMT transfer ticked, $50 → the transfer is paid (and routed) first", () => {
    const r = allocateRepayment({
      items: [OLD_CHARGE, NEW_TRANSFER],
      targets: [
        { kind: "charge", id: OLD_CHARGE.id },
        { kind: "charge", id: NEW_TRANSFER.id },
      ],
      ...usd(50),
    });
    expect(cov(r, NEW_TRANSFER).usd).toBeCloseTo(50, 2);
    expect(cov(r, OLD_CHARGE).usd).toBe(0);
    expect(r.routedUsd).toBeCloseTo(50, 2);
  });

  it("two non-drawer items ticked: still oldest first", () => {
    const r = allocateRepayment({
      items: [OLD_CHARGE, NEWER_CHARGE],
      targets: [
        { kind: "charge", id: NEWER_CHARGE.id },
        { kind: "charge", id: OLD_CHARGE.id },
      ],
      ...usd(25),
    });
    expect(cov(r, OLD_CHARGE).usd).toBeCloseTo(20, 2);
    expect(cov(r, NEWER_CHARGE).usd).toBeCloseTo(5, 2);
  });
});

describe("LIRA-308 decision 5 — auto targets come after the cashier's ticks", () => {
  it("cashier ticks the newer $10 charge, $15: the auto-ticked older $20 charge gets only the $5 extra", () => {
    const r = allocateRepayment({
      items: [OLD_CHARGE, NEWER_CHARGE],
      targets: [
        { kind: "charge", id: NEWER_CHARGE.id },
        { kind: "charge", id: OLD_CHARGE.id, auto: true },
      ],
      ...usd(15),
    });
    expect(cov(r, NEWER_CHARGE).usd).toBeCloseTo(10, 2);
    expect(cov(r, OLD_CHARGE).usd).toBeCloseTo(5, 2);
  });
});

describe("planRepaymentTargets — which unticked items the amount ticks by itself", () => {
  const ITEMS = [OLDEST_SALE, OLD_CHARGE, NEW_TRANSFER];

  it("amount above the ticked sum: the extra goes to the cash-drawer item first, sent as an auto target", () => {
    const plan = planRepaymentTargets({
      items: ITEMS,
      ticked: [{ kind: "charge", id: OLD_CHARGE.id }],
      reductionUsd: 60,
      reductionLbp: 0,
      rate: RATE,
    });
    expect(plan.targets).toEqual([
      { kind: "charge", id: OLD_CHARGE.id },
      { kind: "charge", id: NEW_TRANSFER.id, auto: true },
    ]);
    expect(cov(plan, OLD_CHARGE).usd).toBeCloseTo(20, 2);
    expect(cov(plan, NEW_TRANSFER).usd).toBeCloseTo(40, 2);
    expect(cov(plan, OLDEST_SALE).usd).toBe(0);
  });

  it("the planned targets give the server the same coverage as the plan", () => {
    const plan = planRepaymentTargets({
      items: ITEMS,
      ticked: [{ kind: "charge", id: OLD_CHARGE.id }],
      reductionUsd: 130,
      reductionLbp: 0,
      rate: RATE,
    });
    const server = allocateRepayment({
      items: ITEMS,
      targets: plan.targets,
      ...usd(130),
    });
    expect(server.coverage).toEqual(plan.coverage);
    // $20 ticked + $101 transfer + $9 of the sale.
    expect(cov(plan, OLDEST_SALE).usd).toBeCloseTo(9, 2);
  });

  it("amount below the ticked sum: no auto targets, partial inside the ticked items", () => {
    const plan = planRepaymentTargets({
      items: ITEMS,
      ticked: [
        { kind: "charge", id: OLD_CHARGE.id },
        { kind: "charge", id: NEW_TRANSFER.id },
      ],
      reductionUsd: 110,
      reductionLbp: 0,
      rate: RATE,
    });
    expect(plan.targets).toEqual([
      { kind: "charge", id: OLD_CHARGE.id },
      { kind: "charge", id: NEW_TRANSFER.id },
    ]);
    expect(cov(plan, NEW_TRANSFER).usd).toBeCloseTo(101, 2);
    expect(cov(plan, OLD_CHARGE).usd).toBeCloseTo(9, 2);
  });

  it("decision 9 — an LBP debt follows the same rules in LBP", () => {
    const plan = planRepaymentTargets({
      items: [LBP_CHARGE, OLD_CHARGE],
      ticked: [{ kind: "charge", id: LBP_CHARGE.id }],
      reductionUsd: 0,
      reductionLbp: 500_000,
      rate: RATE,
    });
    expect(plan.targets).toEqual([{ kind: "charge", id: LBP_CHARGE.id }]);
    expect(cov(plan, LBP_CHARGE).lbp).toBe(500_000);
  });

  it("a ticked ref that is not open is ignored, and incoming auto flags are dropped", () => {
    const plan = planRepaymentTargets({
      items: ITEMS,
      ticked: [
        { kind: "charge", id: OLD_CHARGE.id, auto: true },
        { kind: "charge", id: 999 },
      ],
      reductionUsd: 20,
      reductionLbp: 0,
      rate: RATE,
    });
    expect(plan.targets).toEqual([{ kind: "charge", id: OLD_CHARGE.id }]);
  });
});

describe("unchanged — no targets keeps today's order (sales first)", () => {
  it("no ticks, $20: the sale is paid first", () => {
    const r = allocateRepayment({
      items: [OLD_CHARGE, NEW_TRANSFER, OLDEST_SALE],
      ...usd(20),
    });
    expect(cov(r, OLDEST_SALE).usd).toBeCloseTo(14, 2);
    expect(cov(r, OLD_CHARGE).usd).toBeCloseTo(6, 2);
  });
});
