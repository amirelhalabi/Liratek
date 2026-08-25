/**
 * TransactionService.refundTransaction — LIRA-143 phase 5 forwarding test.
 *
 * `TransactionService.refundTransaction` is a thin pass-through to
 * `TransactionRepository.refundTransaction` (rule 13 — services orchestrate,
 * repositories do the real work). This guards that the newly-added
 * `refundUnitExtras` option rides through the service UNCHANGED, alongside
 * the pre-existing `refundLegs` option — the repository itself already
 * validates/applies `refundUnitExtras`
 * (`TransactionRepository.productUnitsReversal.test.ts` covers that layer).
 */

import { TransactionService } from "../TransactionService.js";
import type { TransactionRepository } from "../../repositories/TransactionRepository.js";

describe("TransactionService.refundTransaction — refundUnitExtras forwarding", () => {
  function buildService() {
    const repo = {
      refundTransaction: jest.fn().mockReturnValue(42),
    } as unknown as TransactionRepository;
    const service = new TransactionService(repo);
    return { service, repo };
  }

  it("forwards refundUnitExtras verbatim alongside refundLegs to the repository", () => {
    const { service, repo } = buildService();
    const refundLegs = [
      { method: "CASH", currencyCode: "USD" as const, amount: 10 },
    ];
    const refundUnitExtras = [
      { unit_id: 5, is_defective: true, warranty_override_until: null },
    ];

    const result = service.refundTransaction(1, 7, {
      refundLegs,
      refundUnitExtras,
    });

    expect(repo.refundTransaction).toHaveBeenCalledWith(1, 7, {
      refundLegs,
      refundUnitExtras,
    });
    expect(result).toBe(42);
  });

  it("still works with no opts at all (pre-existing default-reversal behavior, byte-identical)", () => {
    const { service, repo } = buildService();

    service.refundTransaction(1, 7);

    expect(repo.refundTransaction).toHaveBeenCalledWith(1, 7, undefined);
  });

  it("forwards refundLegs alone with refundUnitExtras left undefined", () => {
    const { service, repo } = buildService();
    const refundLegs = [
      { method: "CASH", currencyCode: "USD" as const, amount: 10 },
    ];

    service.refundTransaction(1, 7, { refundLegs });

    expect(repo.refundTransaction).toHaveBeenCalledWith(1, 7, {
      refundLegs,
      refundUnitExtras: undefined,
    });
  });
});
