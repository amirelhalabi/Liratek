/**
 * FinancialService.addTransaction — structured error envelope.
 *
 * Pins the by-hand fix recorded in the plan's §8bis "cross-agent seam gaps"
 * list: `addTransaction`'s catch used to collapse EVERY thrown error to a bare
 * `{ success: false, error: string }`, discarding `code`/`details`. A caller
 * that switches on `result.code` (never a message string — message matching is
 * how error handling silently rots) then sees `undefined` and falls through to
 * a generic failure, with nothing else in the stack failing to reveal it.
 *
 * The specific flow that motivated the fix — the RECEIVE insufficient-funds
 * recovery panel — is GONE (owner reversed decision #11 on 2026-08-01: no
 * drawer operation is ever blocked, negatives are surfaced in the transfer UI
 * instead). The envelope property it exposed is NOT gone and is still
 * load-bearing: `FinancialServiceRepository` throws a typed `BusinessRuleError`
 * when a FOR-partner transaction is attempted on the secondary SYSTEM provider,
 * and both transports must carry that `code` through unchanged (rule 19c).
 *
 * Uses a hand-rolled fake repository (constructor injection) instead of a real
 * DB, because the property under test lives entirely in the service's catch
 * block, not in any repository SQL — an in-memory DB would only add unrelated
 * surface area.
 */

import { FinancialService } from "../FinancialService";
import type { FinancialServiceRepository } from "../../repositories/FinancialServiceRepository.js";
import { DatabaseError } from "../../utils/errors.js";

function fakeRepoThatThrows(error: unknown): FinancialServiceRepository {
  return {
    createTransaction: jest.fn(() => {
      throw error;
    }),
  } as unknown as FinancialServiceRepository;
}

describe("FinancialService.addTransaction — preserves AppError code/details (rule: never collapse to a bare string)", () => {
  it("returns the AppError's code AND its full details payload, not just a message", () => {
    // DatabaseError is an AppError that carries a `details` object, so it
    // exercises BOTH fields the collapsing catch used to destroy. (The
    // original subject here was InsufficientDrawerFundsError; that class was
    // deleted when the owner reversed the no-overdraw rule — the envelope
    // contract it proved is what actually needed guarding, not the class.)
    const details = { code: "DUPLICATE_PHONE" } as const;
    const thrown = new DatabaseError("client phone already exists", details);
    const service = new FinancialService(fakeRepoThatThrows(thrown));

    const result = service.addTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 1,
      cashoutMethod: "CASH",
    });

    expect(result.success).toBe(false);
    // Callers switch on `result.code`, NEVER a message-string match — this is
    // the field a collapsing catch destroys.
    expect(result.code).toBe("DATABASE_ERROR");
    expect(result.details).toEqual(details);
    expect(result.error).toBe("client phone already exists");
  });

  it("carries code/details for ANY AppError subclass, not just one type (proves the branch is isAppError(), not a special-cased type check)", () => {
    // Reuses the same AppError machinery via a different constructor
    // (BusinessRuleError) to confirm the fix isn't narrowly special-cased to
    // the one error class this feature happens to need.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessRuleError } = require("../../utils/errors.js") as {
      BusinessRuleError: new (message: string) => Error & {
        code: string;
      };
    };
    const thrown = new BusinessRuleError("some other business rule failed");
    const service = new FinancialService(fakeRepoThatThrows(thrown));

    const result = service.addTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 10,
      currency: "USD",
      commission: 0,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("BUSINESS_RULE_ERROR");
    expect(result.error).toBe("some other business rule failed");
  });

  it("does NOT fabricate a code for a plain (non-AppError) Error — only real AppErrors get one", () => {
    const service = new FinancialService(
      fakeRepoThatThrows(new Error("unexpected failure")),
    );

    const result = service.addTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 10,
      currency: "USD",
      commission: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("unexpected failure");
    expect(result.code).toBeUndefined();
    expect(result.details).toBeUndefined();
  });
});
