/**
 * LIRA-335 T002 — the one derivation of a checkpoint difference's status
 * (data-model.md "Derived values"). Pure: core and the timeline both read
 * status from this function, never recompute it (rule 14).
 *
 * Rule 17: written before `utils/checkpointDifference.ts` existed; the first
 * run failed with "Cannot find module '../checkpointDifference'".
 */
import {
  describeCheckpointDifference,
  isOpenCheckpointDifference,
} from "../checkpointDifference";

describe("describeCheckpointDifference", () => {
  it("an Over with nothing resolved is OPEN for its whole amount", () => {
    expect(
      describeCheckpointDifference({
        amount: 50,
        resolved: 0,
        closed: false,
        currencyCode: "USD",
      }),
    ).toEqual({ direction: "OVER", abs: 50, open: 50, status: "OPEN" });
  });

  it("a Short with nothing resolved is OPEN, direction SHORT, abs positive", () => {
    expect(
      describeCheckpointDifference({
        amount: -20,
        resolved: 0,
        closed: false,
        currencyCode: "USD",
      }),
    ).toEqual({ direction: "SHORT", abs: 20, open: 20, status: "OPEN" });
  });

  it("part resolved is PARTLY_RESOLVED with the remainder open", () => {
    expect(
      describeCheckpointDifference({
        amount: -20,
        resolved: 12,
        closed: false,
        currencyCode: "USD",
      }),
    ).toEqual({
      direction: "SHORT",
      abs: 20,
      open: 8,
      status: "PARTLY_RESOLVED",
    });
  });

  it("fully resolved is RESOLVED with nothing open", () => {
    const d = describeCheckpointDifference({
      amount: 50,
      resolved: 50,
      closed: false,
      currencyCode: "USD",
    });
    expect(d.status).toBe("RESOLVED");
    expect(d.open).toBe(0);
  });

  it("a closed Short with a remainder is CLOSED, keeping the open amount", () => {
    expect(
      describeCheckpointDifference({
        amount: -20,
        resolved: 12,
        closed: true,
        currencyCode: "USD",
      }),
    ).toEqual({ direction: "SHORT", abs: 20, open: 8, status: "CLOSED" });
  });

  it("a closed Over is CLOSED with direction OVER", () => {
    expect(
      describeCheckpointDifference({
        amount: 15,
        resolved: 0,
        closed: true,
        currencyCode: "USD",
      }),
    ).toEqual({ direction: "OVER", abs: 15, open: 15, status: "CLOSED" });
  });

  it("closed and then fully resolved reads RESOLVED (resolution wins over closed)", () => {
    expect(
      describeCheckpointDifference({
        amount: -20,
        resolved: 20,
        closed: true,
        currencyCode: "USD",
      }).status,
    ).toBe("RESOLVED");
  });

  it("resolved above the difference is clamped: open never below zero", () => {
    const d = describeCheckpointDifference({
      amount: 50,
      resolved: 70,
      closed: false,
      currencyCode: "USD",
    });
    expect(d.open).toBe(0);
    expect(d.status).toBe("RESOLVED");
  });

  it("USD: one cent or less left open counts as zero; more than a cent does not", () => {
    expect(
      describeCheckpointDifference({
        amount: 50,
        resolved: 49.995,
        closed: false,
        currencyCode: "USD",
      }).status,
    ).toBe("RESOLVED");
    expect(
      describeCheckpointDifference({
        amount: 50,
        resolved: 49.98,
        closed: false,
        currencyCode: "USD",
      }).status,
    ).toBe("PARTLY_RESOLVED");
  });

  it("LBP: one LBP or less left open counts as zero; more does not", () => {
    expect(
      describeCheckpointDifference({
        amount: -900_000,
        resolved: 899_999,
        closed: false,
        currencyCode: "LBP",
      }).status,
    ).toBe("RESOLVED");
    expect(
      describeCheckpointDifference({
        amount: -900_000,
        resolved: 899_990,
        closed: false,
        currencyCode: "LBP",
      }).status,
    ).toBe("PARTLY_RESOLVED");
  });
});

describe("isOpenCheckpointDifference", () => {
  it("is true for OPEN and PARTLY_RESOLVED only", () => {
    expect(isOpenCheckpointDifference({ status: "OPEN" })).toBe(true);
    expect(isOpenCheckpointDifference({ status: "PARTLY_RESOLVED" })).toBe(
      true,
    );
    expect(isOpenCheckpointDifference({ status: "RESOLVED" })).toBe(false);
    expect(isOpenCheckpointDifference({ status: "CLOSED" })).toBe(false);
  });
});
