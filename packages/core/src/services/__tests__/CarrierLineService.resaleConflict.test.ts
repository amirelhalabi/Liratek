/**
 * LIRA-309 (FR-005, reverse direction) — a shop line may not take the number
 * of a line the shop holds for sale while that line is still in stock.
 *
 * Written before the guard; first run failed (the service created the line:
 * `result.success` was true and `createLine` was called).
 */
import { CarrierLineService } from "../CarrierLineService.js";
import type { CarrierLineRepository } from "../../repositories/CarrierLineRepository.js";
import type { CarrierLineMovementRepository } from "../../repositories/CarrierLineMovementRepository.js";
import type { CarrierLineOwedDeliveryRepository } from "../../repositories/CarrierLineOwedDeliveryRepository.js";
import type { ResaleLineRepository } from "../../repositories/ResaleLineRepository.js";

function makeService(unsoldNumbers: string[]) {
  const line = { id: 3, carrier: "mtc", phone_number: "03111111", is_active: 0 };
  const repo = {
    createLine: jest.fn().mockReturnValue({ ...line, id: 4 }),
    updateLineAndSyncDrawer: jest.fn().mockReturnValue(line),
    toggleActive: jest.fn().mockReturnValue({ ...line, is_active: 1 }),
    getById: jest.fn().mockReturnValue(line),
  } as unknown as CarrierLineRepository;
  const resaleRepo = {
    listLines: jest
      .fn()
      .mockReturnValue(unsoldNumbers.map((n) => ({ phone_number: n }))),
  } as unknown as ResaleLineRepository;
  const service = new CarrierLineService(
    repo,
    {} as CarrierLineMovementRepository,
    {} as CarrierLineOwedDeliveryRepository,
    resaleRepo,
  );
  return { service, repo };
}

const REFUSAL = {
  success: false,
  error: "This number is already one of your lines.",
};

describe("CarrierLineService — number of a for-sale line (LIRA-309)", () => {
  it("refuses to create a shop line with an unsold for-sale line's number", () => {
    const { service, repo } = makeService(["03555101"]);
    const result = service.create({ carrier: "mtc", phone_number: "+961 3 555 101" });
    expect(result).toEqual(REFUSAL);
    expect(repo.createLine).not.toHaveBeenCalled();
  });

  it("refuses to change a shop line's number to an unsold for-sale line's number", () => {
    const { service, repo } = makeService(["03555101"]);
    const result = service.update(3, { phone_number: "03 555 101" });
    expect(result).toEqual(REFUSAL);
    expect(repo.updateLineAndSyncDrawer).not.toHaveBeenCalled();
  });

  it("refuses to reactivate a shop line whose number is now a for-sale line", () => {
    const { service, repo } = makeService(["03111111"]);
    const result = service.toggleActive(3);
    expect(result).toEqual(REFUSAL);
    expect(repo.toggleActive).not.toHaveBeenCalled();
  });

  it("still saves an edit that keeps the line's own number (credits only)", () => {
    // The Carrier Lines edit form always sends the current number; an
    // existing overlap must not lock the owner out of editing credits.
    const { service, repo } = makeService(["03111111"]);
    const result = service.update(3, { phone_number: "03111111", credits: 20 });
    expect(result.success).toBe(true);
    expect(repo.updateLineAndSyncDrawer).toHaveBeenCalled();
  });

  it("still creates a shop line with a number nobody else uses", () => {
    const { service, repo } = makeService(["03555101"]);
    expect(service.create({ carrier: "mtc", phone_number: "03999999" }).success).toBe(true);
    expect(repo.createLine).toHaveBeenCalled();
  });
});
