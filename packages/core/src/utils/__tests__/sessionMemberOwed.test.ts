import { allocateBasketMemberOwed } from "../sessionMemberOwed";

const RATE = 89_000;

describe("allocateBasketMemberOwed (LIRA-304, OMT first)", () => {
  it("whole basket on account: each item owes its own amount", () => {
    expect(
      allocateBasketMemberOwed({
        outstandingUsd: 101,
        outstandingLbp: 200_000,
        members: [
          { id: 1, amountUsd: 101, amountLbp: 0, isPrimary: true },
          { id: 3, amountUsd: 0, amountLbp: 200_000, isPrimary: false },
        ],
        rate: RATE,
      }),
    ).toEqual([
      { id: 3, owedUsd: 0, owedLbp: 200_000 },
      { id: 1, owedUsd: 101, owedLbp: 0 },
    ]);
  });

  it("partly paid: the debt lands on non-primary items first", () => {
    const r = allocateBasketMemberOwed({
      outstandingUsd: 40,
      outstandingLbp: 0,
      members: [
        { id: 1, amountUsd: 100, amountLbp: 0, isPrimary: true },
        { id: 2, amountUsd: 30, amountLbp: 0, isPrimary: false },
      ],
      rate: RATE,
    });
    expect(r.find((m) => m.id === 2)!.owedUsd).toBe(30);
    expect(r.find((m) => m.id === 1)!.owedUsd).toBe(10);
  });

  it("a USD debt on an LBP-priced item is carried by value", () => {
    const r = allocateBasketMemberOwed({
      outstandingUsd: 2,
      outstandingLbp: 0,
      members: [{ id: 5, amountUsd: 0, amountLbp: 200_000, isPrimary: false }],
      rate: RATE,
    });
    expect(r).toEqual([{ id: 5, owedUsd: 2, owedLbp: 0 }]);
  });

  it("never loses a unit", () => {
    const r = allocateBasketMemberOwed({
      outstandingUsd: 50,
      outstandingLbp: 0,
      members: [{ id: 1, amountUsd: 40, amountLbp: 0, isPrimary: true }],
      rate: RATE,
    });
    expect(r[0].owedUsd).toBe(50);
  });
});
