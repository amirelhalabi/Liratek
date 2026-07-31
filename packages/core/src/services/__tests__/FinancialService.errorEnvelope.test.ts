/**
 * FinancialService.addTransaction — structured error envelope (Primary Cash
 * Drawer plan §8.5).
 *
 * Pins the by-hand fix recorded in the plan's §8bis "cross-agent seam gaps"
 * list: `FinancialService.ts`'s `addTransaction` catch used to collapse EVERY
 * thrown error to a bare `{ success: false, error: string }`, discarding
 * `code`/`details`. That silently disabled the entire owner-requested RECEIVE
 * insufficient-funds recovery flow (decision #11) over BOTH transports — the
 * Services page (`index.tsx`) switches on `result.code ===
 * "INSUFFICIENT_DRAWER_FUNDS"`, never a message string, so a lost `code`
 * means the "move remaining from General" panel never renders, with no
 * failure anywhere else in the stack to catch it. Per the task brief: "It is
 * a one-line regression away from silently disabling the whole feature
 * again" — this file is that one line's guard.
 *
 * Uses a hand-rolled fake repository (constructor injection —
 * `new FinancialService(fakeRepo)`) instead of a real DB, because the
 * property under test lives entirely in the service's catch block, not in
 * any repository SQL — an in-memory DB would only add unrelated surface
 * area. `InsufficientDrawerFundsError` is used verbatim (not re-implemented)
 * so this test moves in lockstep with the real error shape.
 */

import { FinancialService } from "../FinancialService";
import type { FinancialServiceRepository } from "../../repositories/FinancialServiceRepository.js";
import {
  InsufficientDrawerFundsError,
  type InsufficientDrawerFundsDetails,
} from "../../utils/errors.js";

function fakeRepoThatThrows(error: unknown): FinancialServiceRepository {
  return {
    createTransaction: jest.fn(() => {
      throw error;
    }),
  } as unknown as FinancialServiceRepository;
}

describe("FinancialService.addTransaction — preserves AppError code/details (rule: never collapse to a bare string)", () => {
  it("returns code === 'INSUFFICIENT_DRAWER_FUNDS' and the full details payload, not just a message", () => {
    const details: InsufficientDrawerFundsDetails = {
      drawer: "OMT_System",
      shortfall: { USD: 35 },
      available: { USD: 65 },
      required: { USD: 100 },
    };
    const thrown = new InsufficientDrawerFundsError(
      "Insufficient funds in OMT_System to complete this payout",
      details,
    );
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
    // The Services page (index.tsx) switches on `result.code`, NEVER a
    // message-string match — this is the field a collapsing catch destroys.
    expect(result.code).toBe("INSUFFICIENT_DRAWER_FUNDS");
    expect(result.details).toEqual(details);
    expect(result.error).toBe(
      "Insufficient funds in OMT_System to complete this payout",
    );
  });

  it("carries code/details for ANY AppError subclass, not just InsufficientDrawerFundsError (proves the branch is isAppError(), not a special-cased type check)", () => {
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
