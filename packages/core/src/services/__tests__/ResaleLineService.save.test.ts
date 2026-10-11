/**
 * LIRA-309 (C13) — saving a for-sale line's details.
 *
 * Written before `ResaleLineService` existed; first run failed with
 * "Cannot find module '../ResaleLineService.js'".
 */
import { ResaleLineService } from "../ResaleLineService.js";
import type { ResaleLineRepository } from "../../repositories/ResaleLineRepository.js";
import type { CarrierLineRepository } from "../../repositories/CarrierLineRepository.js";

function makeRepos(opts: {
  product?: { id: number; barcode: string | null; category: string | null } | null;
  shopLines?: Array<{ phone_number: string }>;
}) {
  const upsertDetails = jest.fn().mockImplementation((productId, data) => ({
    id: 1,
    tenant_id: 1,
    product_id: productId,
    carrier: data.carrier,
    credits: data.credits ?? 0,
    validity_expires_at: data.validityExpiresAt ?? null,
    created_at: "",
    updated_at: "",
  }));
  const resaleRepo = {
    getLineProduct: jest.fn().mockReturnValue(opts.product ?? null),
    upsertDetails,
    listLines: jest.fn().mockReturnValue([]),
  } as unknown as ResaleLineRepository;
  const carrierRepo = {
    getAllActive: jest.fn().mockReturnValue(opts.shopLines ?? []),
  } as unknown as CarrierLineRepository;
  return { resaleRepo, carrierRepo, upsertDetails };
}

describe("ResaleLineService.saveDetails (LIRA-309)", () => {
  it("saves carrier, credit and expiry for a lines-category product", () => {
    const { resaleRepo, carrierRepo, upsertDetails } = makeRepos({
      product: { id: 7, barcode: "03555101", category: "Phone Lines" },
    });
    const service = new ResaleLineService(resaleRepo, carrierRepo);
    const result = service.saveDetails({
      product_id: 7,
      carrier: "mtc",
      credits: 3,
      validity_expires_at: "2026-10-20",
    });
    expect(result.success).toBe(true);
    expect(upsertDetails).toHaveBeenCalledWith(7, {
      carrier: "mtc",
      credits: 3,
      validityExpiresAt: "2026-10-20",
    });
  });

  it("refuses a number that is already an active shop line, however it is typed", () => {
    const { resaleRepo, carrierRepo, upsertDetails } = makeRepos({
      product: { id: 7, barcode: "03555101", category: "Phone Lines" },
      shopLines: [{ phone_number: "+961 3 555 101" }],
    });
    const service = new ResaleLineService(resaleRepo, carrierRepo);
    const result = service.saveDetails({ product_id: 7, carrier: "mtc" });
    expect(result).toEqual({
      success: false,
      error: "This number is already one of your lines.",
    });
    expect(upsertDetails).not.toHaveBeenCalled();
  });

  it("refuses a product that is not in a lines category", () => {
    const { resaleRepo, carrierRepo, upsertDetails } = makeRepos({
      product: { id: 8, barcode: "123", category: "Cables" },
    });
    const service = new ResaleLineService(resaleRepo, carrierRepo);
    const result = service.saveDetails({ product_id: 8, carrier: "mtc" });
    expect(result.success).toBe(false);
    expect(upsertDetails).not.toHaveBeenCalled();
  });

  it("refuses a missing product", () => {
    const { resaleRepo, carrierRepo } = makeRepos({ product: null });
    const service = new ResaleLineService(resaleRepo, carrierRepo);
    expect(service.saveDetails({ product_id: 9, carrier: "alfa" }).success).toBe(false);
  });
});
