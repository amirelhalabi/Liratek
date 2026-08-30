/**
 * CustomServiceService.advanceFulfillmentStatus — LIRA-155 policy-layer
 * tests (D4.2's STRICT/forward-only/single-step transition rule, enforced
 * SERVER-side — the ticket's explicit instruction not to copy
 * maintenance_jobs' `isPaidStatus` gate, which only validates client-side).
 *
 * Drives the service with a stub repository (rule 13's payoff: the policy
 * check is proven with no DB at all) exposing only the two methods this
 * code path touches — `findById` and `updateFulfillmentStatus` — so it is
 * structurally impossible for these tests to reach any payment/drawer/
 * ledger method: the stub simply doesn't have one. That is the "touches NO
 * money" proof for the service layer; CustomServiceRepository.fulfillment.
 * test.ts proves the same thing at the repository/SQL layer against a real
 * in-memory DB.
 *
 * The repository's `updateFulfillmentStatus` is deliberately policy-free
 * (rule 13) — these tests assert it is called ONLY for a legal transition,
 * and NEVER for an illegal one or a missing row.
 */

import type { CustomServiceRepository } from "../../repositories/CustomServiceRepository";
import { CustomServiceService } from "../CustomServiceService";

function makeService(existing: { fulfillment_status: string | null } | null) {
  const findById = jest.fn(() => existing);
  const updateFulfillmentStatus = jest.fn((id: number, status: string) => ({
    ...(existing ?? {}),
    id,
    fulfillment_status: status,
    fulfilled_at: status === "DELIVERED" ? "2026-08-29T00:00:00.000Z" : null,
  }));

  const repo = {
    findById,
    updateFulfillmentStatus,
  } as unknown as CustomServiceRepository;

  return {
    service: new CustomServiceService(repo),
    findById,
    updateFulfillmentStatus,
  };
}

describe("CustomServiceService.advanceFulfillmentStatus", () => {
  it("returns a not-found error and never calls the repository write when the row doesn't exist", () => {
    const { service, updateFulfillmentStatus } = makeService(null);

    const result = service.advanceFulfillmentStatus(1, "ISSUED");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(updateFulfillmentStatus).not.toHaveBeenCalled();
  });

  it("rejects advancing an untracked row (fulfillment_status NULL) and never calls the repository write", () => {
    const { service, updateFulfillmentStatus } = makeService({
      fulfillment_status: null,
    });

    const result = service.advanceFulfillmentStatus(1, "ORDERED");

    expect(result.success).toBe(false);
    expect(updateFulfillmentStatus).not.toHaveBeenCalled();
  });

  it("accepts the single legal forward step and calls the repository write exactly once with (id, to)", () => {
    const { service, updateFulfillmentStatus } = makeService({
      fulfillment_status: "ORDERED",
    });

    const result = service.advanceFulfillmentStatus(7, "ISSUED");

    expect(result.success).toBe(true);
    expect(result.entity?.fulfillment_status).toBe("ISSUED");
    expect(updateFulfillmentStatus).toHaveBeenCalledTimes(1);
    expect(updateFulfillmentStatus).toHaveBeenCalledWith(7, "ISSUED");
  });

  it("rejects a skip (ORDERED -> RECEIVED) and never calls the repository write", () => {
    const { service, updateFulfillmentStatus } = makeService({
      fulfillment_status: "ORDERED",
    });

    const result = service.advanceFulfillmentStatus(7, "RECEIVED");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ORDERED.*RECEIVED/);
    expect(updateFulfillmentStatus).not.toHaveBeenCalled();
  });

  it("rejects stepping backward (RECEIVED -> ISSUED) and never calls the repository write", () => {
    const { service, updateFulfillmentStatus } = makeService({
      fulfillment_status: "RECEIVED",
    });

    const result = service.advanceFulfillmentStatus(7, "ISSUED");

    expect(result.success).toBe(false);
    expect(updateFulfillmentStatus).not.toHaveBeenCalled();
  });

  it("rejects any transition out of the terminal DELIVERED status and never calls the repository write", () => {
    const { service, updateFulfillmentStatus } = makeService({
      fulfillment_status: "DELIVERED",
    });

    for (const to of ["ORDERED", "ISSUED", "RECEIVED", "DELIVERED"] as const) {
      const result = service.advanceFulfillmentStatus(7, to);
      expect(result.success).toBe(false);
    }
    expect(updateFulfillmentStatus).not.toHaveBeenCalled();
  });

  it("reaching DELIVERED via the one legal path (RECEIVED -> DELIVERED) succeeds and the write call carries DELIVERED", () => {
    const { service, updateFulfillmentStatus } = makeService({
      fulfillment_status: "RECEIVED",
    });

    const result = service.advanceFulfillmentStatus(7, "DELIVERED");

    expect(result.success).toBe(true);
    expect(updateFulfillmentStatus).toHaveBeenCalledWith(7, "DELIVERED");
  });
});
