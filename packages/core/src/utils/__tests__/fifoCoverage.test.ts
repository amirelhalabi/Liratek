/**
 * CQ-2 — exhaustive unit tests for the shared FIFO allocator that replaces
 * the five hand-rolled copies (DebtRepository ×2, PartnerRepository,
 * SupplierRepository, SupplierPurchaseRepository). Pure math, no DB.
 */

import { allocateFifo, type FifoOpenRow } from "../fifoCoverage";

function row(id: number | string, outstanding: number): FifoOpenRow {
  return { id, outstanding };
}

describe("allocateFifo", () => {
  describe("exact drain", () => {
    it("consumes every row exactly when budget equals total outstanding", () => {
      const open = [row(1, 10), row(2, 20), row(3, 5)];
      const takes = allocateFifo(open, 35, 0.005);
      expect(takes).toEqual([
        { id: 1, take: 10 },
        { id: 2, take: 20 },
        { id: 3, take: 5 },
      ]);
      const consumed = takes.reduce((s, t) => s + t.take, 0);
      expect(35 - consumed).toBeCloseTo(0, 6);
    });

    it("fully covers a single row whose outstanding equals the budget", () => {
      const takes = allocateFifo([row(1, 42.5)], 42.5, 0.005);
      expect(takes).toEqual([{ id: 1, take: 42.5 }]);
    });
  });

  describe("partial budget", () => {
    it("fully covers earlier rows and partially covers the row where budget runs out", () => {
      const open = [row(1, 10), row(2, 20), row(3, 5)];
      const takes = allocateFifo(open, 25, 0.005);
      expect(takes).toEqual([
        { id: 1, take: 10 },
        { id: 2, take: 15 },
      ]);
      // row 3 untouched — no entry in the result at all
      expect(takes.find((t) => t.id === 3)).toBeUndefined();
    });

    it("covers only the first row when budget is smaller than its outstanding", () => {
      const open = [row(1, 100), row(2, 50)];
      const takes = allocateFifo(open, 30, 0.005);
      expect(takes).toEqual([{ id: 1, take: 30 }]);
    });
  });

  describe("over-budget", () => {
    it("drains every row and leaves the remainder unconsumed", () => {
      const open = [row(1, 10), row(2, 20)];
      const budget = 100;
      const takes = allocateFifo(open, budget, 0.005);
      expect(takes).toEqual([
        { id: 1, take: 10 },
        { id: 2, take: 20 },
      ]);
      const consumed = takes.reduce((s, t) => s + t.take, 0);
      expect(budget - consumed).toBeCloseTo(70, 6);
    });
  });

  describe("epsilon edges", () => {
    it("skips a row whose outstanding is below epsilon without consuming budget", () => {
      const open = [row(1, 0.003), row(2, 10)];
      const takes = allocateFifo(open, 5, 0.005);
      // row 1 skipped entirely (outstanding 0.003 <= epsilon 0.005)
      expect(takes).toEqual([{ id: 2, take: 5 }]);
    });

    it("skips a row whose outstanding is exactly epsilon (boundary is inclusive-skip)", () => {
      const open = [row(1, 0.005), row(2, 10)];
      const takes = allocateFifo(open, 5, 0.005);
      expect(takes).toEqual([{ id: 2, take: 5 }]);
    });

    it("takes a row whose outstanding is just above epsilon", () => {
      const open = [row(1, 0.006)];
      const takes = allocateFifo(open, 5, 0.005);
      expect(takes).toEqual([{ id: 1, take: 0.006 }]);
    });

    it("stops allocation once remaining budget drops to epsilon or below", () => {
      // budget exactly consumes row 1, leaving 0 for row 2 (not even touched)
      const open = [row(1, 10), row(2, 20)];
      const takes = allocateFifo(open, 10, 0.005);
      expect(takes).toEqual([{ id: 1, take: 10 }]);
    });

    it("does not allocate a sub-epsilon leftover to a later row", () => {
      // after row 1 takes 10, remaining = 0.003 (<= epsilon 0.005) — loop
      // must break before even inspecting row 2, regardless of row 2's size
      const open = [row(1, 10), row(2, 20)];
      const takes = allocateFifo(open, 10.003, 0.005);
      expect(takes).toEqual([{ id: 1, take: 10 }]);
    });

    it("returns [] immediately when budget itself is at or below epsilon", () => {
      expect(allocateFifo([row(1, 100)], 0.005, 0.005)).toEqual([]);
      expect(allocateFifo([row(1, 100)], 0.004, 0.005)).toEqual([]);
    });

    it("uses the default epsilon (0.005) when none is passed", () => {
      const takes = allocateFifo([row(1, 0.004), row(2, 10)], 5);
      expect(takes).toEqual([{ id: 2, take: 5 }]);
    });

    it("honors an epsilon of exactly 0 (exact stop / exact skip — supplier-purchase sites)", () => {
      const open = [row(1, 10), row(2, 10)];
      // budget consumes row 1 fully, leaves exactly 0 for row 2 -> stop
      const takes = allocateFifo(open, 10, 0);
      expect(takes).toEqual([{ id: 1, take: 10 }]);
    });

    it("honors a large epsilon (1, LBP tolerance)", () => {
      const open = [row(1, 0.9), row(2, 100)];
      const takes = allocateFifo(open, 50, 1);
      // row 1's outstanding (0.9) is below epsilon 1 -> skipped
      expect(takes).toEqual([{ id: 2, take: 50 }]);
    });
  });

  describe("empty inputs", () => {
    it("returns [] for an empty open array regardless of budget", () => {
      expect(allocateFifo([], 100, 0.005)).toEqual([]);
    });

    it("returns [] for an empty open array with zero budget", () => {
      expect(allocateFifo([], 0, 0.005)).toEqual([]);
    });
  });

  describe("ordering preservation", () => {
    it("returns takes in the same relative order as the input rows", () => {
      const open = [row("c", 5), row("a", 5), row("b", 5)];
      const takes = allocateFifo(open, 15, 0.005);
      expect(takes.map((t) => t.id)).toEqual(["c", "a", "b"]);
    });

    it("preserves order across a mix of taken and skipped rows", () => {
      const open = [row(1, 10), row(2, 0.001), row(3, 20), row(4, 5)];
      const takes = allocateFifo(open, 100, 0.005);
      expect(takes.map((t) => t.id)).toEqual([1, 3, 4]);
    });
  });

  describe("zero/negative guards", () => {
    it("returns [] for zero budget", () => {
      expect(allocateFifo([row(1, 100)], 0, 0.005)).toEqual([]);
    });

    it("returns [] for negative budget", () => {
      expect(allocateFifo([row(1, 100)], -50, 0.005)).toEqual([]);
    });

    it("skips a row with exactly zero outstanding", () => {
      const takes = allocateFifo([row(1, 0), row(2, 10)], 10, 0.005);
      expect(takes).toEqual([{ id: 2, take: 10 }]);
    });

    it("skips a row with negative outstanding (defensive — bad upstream data) without throwing", () => {
      const takes = allocateFifo([row(1, -5), row(2, 10)], 10, 0.005);
      expect(takes).toEqual([{ id: 2, take: 10 }]);
    });

    it("does not mutate the input array", () => {
      const open = [row(1, 10), row(2, 20)];
      const snapshot = JSON.parse(JSON.stringify(open));
      allocateFifo(open, 15, 0.005);
      expect(open).toEqual(snapshot);
    });
  });

  describe("string ids (partner/supplier tables can key on non-numeric ids in principle)", () => {
    it("passes string ids through unchanged", () => {
      const takes = allocateFifo([row("row-a", 10)], 10, 0.005);
      expect(takes).toEqual([{ id: "row-a", take: 10 }]);
    });
  });
});
