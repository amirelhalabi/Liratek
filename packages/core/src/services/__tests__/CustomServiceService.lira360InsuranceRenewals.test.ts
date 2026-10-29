/**
 * LIRA-360 — the service hands the repository's candidates to the one pure
 * rule and passes "Won't renew" through with the actor it was given.
 *
 * RULE 17 — written before either service method existed.
 */
import { CustomServiceService } from "../CustomServiceService";
import type { CustomServiceRepository } from "../../repositories/CustomServiceRepository";
import type { InsuranceRenewalCandidate } from "../../utils/insuranceRenewal";

function candidate(
  over: Partial<InsuranceRenewalCandidate>,
): InsuranceRenewalCandidate {
  return {
    id: 1,
    client_id: null,
    client_name: "Ali",
    phone_number: "70123456",
    description: "Car insurance",
    insurance_type: "COMPULSORY",
    sale_day: "2025-11-03",
    renewal_dismissed_at: null,
    ...over,
  };
}

describe("CustomServiceService — insurance renewals", () => {
  const getInsuranceRenewalCandidates = jest.fn();
  const dismissInsuranceRenewal = jest.fn();
  const repo = {
    getInsuranceRenewalCandidates,
    dismissInsuranceRenewal,
  } as unknown as CustomServiceRepository;
  const service = new CustomServiceService(repo);

  beforeEach(() => jest.clearAllMocks());

  it("lists due insurances for the given day, without money fields", () => {
    getInsuranceRenewalCandidates.mockReturnValue([
      candidate({ id: 1, sale_day: "2025-11-03" }),
      candidate({ id: 2, sale_day: "2025-12-20", phone_number: "71999999" }),
    ]);
    const out = service.getInsuranceRenewals("2026-10-29");
    expect(out.map((r) => [r.id, r.days_left])).toEqual([[1, 5]]);
    expect(Object.keys(out[0])).not.toEqual(
      expect.arrayContaining(["price_usd", "cost_usd", "profit_usd"]),
    );
  });

  it("passes the dismissal and actor to the repository", () => {
    dismissInsuranceRenewal.mockReturnValue({ success: true });
    expect(service.dismissInsuranceRenewal(7, "rana")).toEqual({
      success: true,
    });
    expect(dismissInsuranceRenewal).toHaveBeenCalledWith(7, "rana");
  });
});
