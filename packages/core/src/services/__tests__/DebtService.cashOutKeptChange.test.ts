/**
 * DebtService.cashOut re-lists its fields one by one, so a new schema key is
 * dropped here unless it is threaded explicitly (rule 23 — the third leg of
 * the key diff: schema ↔ preload ↔ what the service forwards). Proves the
 * kept-change claim and the tender rate reach DebtRepository.cashOutCredit.
 *
 * Not proven failing-first (rule 17): written after the forwarding was added.
 */

import { DebtService } from "../DebtService.js";
import type { DebtRepository } from "../../repositories/DebtRepository.js";
import { debtCashOutSchema } from "../../validators/debt.js";

describe("DebtService.cashOut — kept change pass-through", () => {
  it("forwards the schema's keptChangeUSD/keptChangeLBP and tender_exchange_rate to the repository", () => {
    const cashOutCredit = jest.fn().mockReturnValue({ id: 9 });
    const repo = {
      getClientBalance: () => ({ balance_usd: -101.12, balance_lbp: 0 }),
      cashOutCredit,
    } as unknown as DebtRepository;
    const service = new DebtService(repo);

    // Field names come from the shared schema (rule 24).
    const input = debtCashOutSchema.parse({
      clientId: 4,
      amountUSD: 101.12,
      amountLBP: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 101 }],
      tender_exchange_rate: 89_000,
      keptChangeUSD: 0.12,
      keptChangeLBP: 0,
    });
    const result = service.cashOut({ ...input, userId: 1 });

    expect(result).toEqual({ success: true, id: 9 });
    expect(cashOutCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 4,
        amount_usd: 101.12,
        tender_exchange_rate: 89_000,
        kept_change_usd: 0.12,
        kept_change_lbp: 0,
      }),
    );
  });
});
