/**
 * LIRA-304 T010 — the ONE calculation that decides, for a debt repayment,
 * which items it pays (coverage) and how much cash goes to the primary
 * system's cash drawer (routing). The repayment modal's preview and the
 * server posting both call it (research D8), so these cases are the
 * quickstart table.
 *
 * Owner rules (spec FR-001, FR-004, FR-008, FR-009; research D3):
 *  - coverage: ticked items first (oldest first among them), the rest in
 *    today's order (sales first, then charges oldest first), same currency;
 *  - routing: a ticked primary-system transfer's share goes to its drawer, a
 *    ticked item of any other kind does not; whatever is left goes to the
 *    drawer first ("OMT drawer first");
 *  - routing never exceeds a transfer's remaining cap, nor the cash applied.
 */
import {
  allocateRepayment,
  type AllocationItem,
} from "../debtRepaymentAllocation";

const RATE = 89_000;

function items(over: { omtCap?: number; omtOpen?: number } = {}): AllocationItem[] {
  return [
    {
      kind: "member",
      id: 1,
      rowId: 50,
      createdAt: "2026-10-10 18:44:47",
      openUsd: over.omtOpen ?? 101,
      openLbp: 0,
      routingCap: { usd: over.omtCap ?? 101, lbp: 0 },
    },
    {
      kind: "sale",
      id: 110,
      rowId: 110,
      createdAt: "2026-10-10 18:44:47",
      openUsd: 14,
      openLbp: 0,
    },
    {
      kind: "member",
      id: 3,
      rowId: 50,
      createdAt: "2026-10-10 18:44:47",
      openUsd: 0,
      openLbp: 200_000,
    },
  ];
}

function usdOnly(amount: number) {
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

const cov = (r: ReturnType<typeof allocateRepayment>, kind: string, id: number) =>
  r.coverage.find((c) => c.kind === kind && c.id === id) ?? { usd: 0, lbp: 0 };

describe("allocateRepayment — coverage", () => {
  it("nothing ticked, full settlement: everything paid, OMT share routed", () => {
    const r = allocateRepayment({
      items: items(),
      reductionUsd: 115,
      reductionLbp: 200_000,
      appliedUsd: 115,
      appliedLbp: 200_000,
      cashUsd: 115,
      cashLbp: 200_000,
      rate: RATE,
    });
    expect(cov(r, "sale", 110).usd).toBeCloseTo(14, 2);
    expect(cov(r, "member", 1).usd).toBeCloseTo(101, 2);
    expect(cov(r, "member", 3).lbp).toBe(200_000);
    expect(r.routedUsd).toBeCloseTo(101, 2);
    expect(r.routedLbp).toBe(0);
  });

  it("nothing ticked, $50: sales first for coverage, OMT drawer first for cash", () => {
    const r = allocateRepayment({ items: items(), ...usdOnly(50) });
    expect(cov(r, "sale", 110).usd).toBeCloseTo(14, 2);
    expect(cov(r, "member", 1).usd).toBeCloseTo(36, 2);
    expect(r.routedUsd).toBeCloseTo(50, 2);
  });

  it("tick OMT, $50: the OMT pays first and all $50 is routed", () => {
    const r = allocateRepayment({
      items: items(),
      targets: [{ kind: "member", id: 1 }],
      ...usdOnly(50),
    });
    expect(cov(r, "member", 1).usd).toBeCloseTo(50, 2);
    expect(cov(r, "sale", 110).usd).toBe(0);
    expect(r.routedUsd).toBeCloseTo(50, 2);
  });

  it("tick OMT, $120: OMT paid in full ($101 routed), $19 in today's order, not routed", () => {
    const r = allocateRepayment({
      items: items(),
      targets: [{ kind: "member", id: 1 }],
      ...usdOnly(120),
    });
    expect(cov(r, "member", 1).usd).toBeCloseTo(101, 2);
    expect(cov(r, "sale", 110).usd).toBeCloseTo(14, 2);
    expect(r.routedUsd).toBeCloseTo(101, 2);
  });

  it("tick the cable, $14: nothing goes to the OMT drawer", () => {
    const r = allocateRepayment({
      items: items(),
      targets: [{ kind: "sale", id: 110 }],
      ...usdOnly(14),
    });
    expect(cov(r, "sale", 110).usd).toBeCloseTo(14, 2);
    expect(r.routedUsd).toBe(0);
  });

  it("tick the cable, $60: cable $14 stays, the $46 left goes OMT drawer first", () => {
    const r = allocateRepayment({
      items: items(),
      targets: [{ kind: "sale", id: 110 }],
      ...usdOnly(60),
    });
    expect(cov(r, "sale", 110).usd).toBeCloseTo(14, 2);
    expect(cov(r, "member", 1).usd).toBeCloseTo(46, 2);
    expect(r.routedUsd).toBeCloseTo(46, 2);
  });

  it("after a $50 no-tick payment, ticking OMT and paying $65 routes only the $51 cap", () => {
    const r = allocateRepayment({
      items: items({ omtOpen: 65, omtCap: 51 }).filter((i) => i.kind !== "sale"),
      targets: [{ kind: "member", id: 1 }],
      ...usdOnly(65),
    });
    expect(cov(r, "member", 1).usd).toBeCloseTo(65, 2);
    expect(r.routedUsd).toBeCloseTo(51, 2);
  });

  it("several ticked items are paid oldest first among themselves", () => {
    const list: AllocationItem[] = [
      { kind: "charge", id: 9, rowId: 9, createdAt: "2026-10-02", openUsd: 30, openLbp: 0 },
      { kind: "charge", id: 8, rowId: 8, createdAt: "2026-10-01", openUsd: 30, openLbp: 0 },
      { kind: "charge", id: 7, rowId: 7, createdAt: "2026-09-30", openUsd: 30, openLbp: 0 },
    ];
    const r = allocateRepayment({
      items: list,
      targets: [
        { kind: "charge", id: 9 },
        { kind: "charge", id: 8 },
      ],
      ...usdOnly(40),
    });
    expect(cov(r, "charge", 8).usd).toBeCloseTo(30, 2);
    expect(cov(r, "charge", 9).usd).toBeCloseTo(10, 2);
    expect(cov(r, "charge", 7).usd).toBe(0);
  });

  it("coverage never crosses currencies: an LBP item is not paid from a USD reduction", () => {
    const r = allocateRepayment({
      items: items(),
      targets: [{ kind: "member", id: 3 }],
      ...usdOnly(10),
    });
    expect(cov(r, "member", 3).lbp).toBe(0);
    // The $10 falls through to today's order.
    expect(cov(r, "sale", 110).usd).toBeCloseTo(10, 2);
  });
});

describe("allocateRepayment — routing", () => {
  it("LBP cash for a USD OMT debt goes in as LBP, valued at the repayment's rate", () => {
    const r = allocateRepayment({
      items: items().filter((i) => i.id === 1),
      reductionUsd: 101,
      reductionLbp: 0,
      appliedUsd: 0,
      appliedLbp: 8_989_000,
      cashUsd: 0,
      cashLbp: 8_989_000,
      rate: RATE,
    });
    expect(cov(r, "member", 1).usd).toBeCloseTo(101, 2);
    expect(r.routedLbp).toBe(8_989_000);
    expect(r.routedUsd).toBe(0);
    expect(r.routing).toEqual([
      expect.objectContaining({
        kind: "member",
        id: 1,
        debtCurrency: "USD",
        value: 101,
        tenderCurrency: "LBP",
        tenderAmount: 8_989_000,
      }),
    ]);
  });

  it("an LBP-denominated transfer's cap is kept in LBP", () => {
    const r = allocateRepayment({
      items: [
        {
          kind: "charge",
          id: 20,
          rowId: 20,
          createdAt: "2026-10-01",
          openUsd: 0,
          openLbp: 9_000_000,
          routingCap: { usd: 0, lbp: 9_000_000 },
        },
      ],
      reductionUsd: 0,
      reductionLbp: 4_450_000,
      appliedUsd: 50,
      appliedLbp: 0,
      cashUsd: 50,
      cashLbp: 0,
      rate: RATE,
    });
    expect(r.routedUsd).toBeCloseTo(50, 2);
    expect(r.routing[0]).toEqual(
      expect.objectContaining({ debtCurrency: "LBP", value: 4_450_000 }),
    );
  });

  it("items without a routing cap (secondary system, wallet apps) are never routed", () => {
    const r = allocateRepayment({
      items: [
        { kind: "charge", id: 30, rowId: 30, createdAt: "2026-10-01", openUsd: 50, openLbp: 0 },
      ],
      ...usdOnly(50),
    });
    expect(cov(r, "charge", 30).usd).toBeCloseTo(50, 2);
    expect(r.routedUsd).toBe(0);
  });

  it("no cash (paid from a wallet) → nothing routed", () => {
    const r = allocateRepayment({
      items: items(),
      reductionUsd: 50,
      reductionLbp: 0,
      appliedUsd: 50,
      appliedLbp: 0,
      cashUsd: 0,
      cashLbp: 0,
      rate: RATE,
    });
    expect(r.routedUsd).toBe(0);
    expect(cov(r, "member", 1).usd).toBeCloseTo(36, 2);
  });

  it("routing never exceeds the cash applied", () => {
    const r = allocateRepayment({
      items: items(),
      reductionUsd: 115,
      reductionLbp: 0,
      appliedUsd: 115,
      appliedLbp: 0,
      cashUsd: 40,
      cashLbp: 0,
      rate: RATE,
    });
    expect(r.routedUsd).toBeCloseTo(40, 2);
  });
});
