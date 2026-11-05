/**
 * LIRA-371 — DebtService.addRepayment re-lists its fields one by one, so the
 * schema's `cashDrawer` must be threaded to DebtRepository as `cash_drawer`
 * (rule 23, third leg of the key diff). Absent stays absent (SC-001).
 */
import { DebtService } from "../DebtService.js";
import type { DebtRepository } from "../../repositories/DebtRepository.js";
import { addRepaymentSchema } from "../../validators/debt.js";

function serviceWith(addRepayment: jest.Mock): DebtService {
  const repo = { addRepayment } as unknown as DebtRepository;
  return new DebtService(repo);
}

describe("LIRA-371 DebtService.addRepayment — cash drawer choice", () => {
  it("hands cashDrawer GENERAL to the repository as cash_drawer", () => {
    const addRepayment = jest.fn().mockReturnValue({ id: 5 });
    const input = addRepaymentSchema.parse({
      clientId: 7,
      amountUSD: 200,
      amountLBP: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 200 }],
      cashDrawer: "GENERAL",
    });
    serviceWith(addRepayment).addRepayment({ ...input, userId: 1 });
    expect(addRepayment).toHaveBeenCalledWith(
      expect.objectContaining({ cash_drawer: "GENERAL" }),
    );
  });

  it("absent stays absent", () => {
    const addRepayment = jest.fn().mockReturnValue({ id: 5 });
    const input = addRepaymentSchema.parse({
      clientId: 7,
      amountUSD: 200,
      amountLBP: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 200 }],
    });
    serviceWith(addRepayment).addRepayment({ ...input, userId: 1 });
    expect("cash_drawer" in addRepayment.mock.calls[0][0]).toBe(false);
  });
});
