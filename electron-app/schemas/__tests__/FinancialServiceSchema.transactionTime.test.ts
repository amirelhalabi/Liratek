/**
 * LIRA-165 — `FinancialServiceSchema`'s `transaction_time` used to be a
 * hand-copied, unvalidated `z.string().optional()` (desktop) while the core
 * validator (`createFinancialServiceSchema`, used by REST) enforced a strict
 * `z.string().datetime()`. Same field, two contracts: a garbage string was
 * silently accepted over IPC and would land in `financial_services.created_at`,
 * after which the row falls out of every date-bucketed report (Profits By
 * Date, Closing, Cash Report).
 *
 * Fix: the desktop schema now mirrors core's `transactionTimeSchema`
 * definition (`z.string().datetime().optional()`, validators/common.ts)
 * instead of hand-copying a loose `z.string().optional()`. A literal mirror,
 * not a cast-bridge re-export of the schema OBJECT: embedding an
 * already-built zod-4 schema as a field inside this file's zod-3
 * `z.object({...})` compiles but dies at runtime (`_parse is not a
 * function`) the moment a sibling `.refine()` runs — tried first, caught by
 * `FinancialServiceSchema.feePayments.test.ts` failing with exactly that
 * error, reverted in favor of this literal (see the field's own comment in
 * `../index.ts`).
 *
 * Rule 17 note: this fix is a one-line type swap
 * (`z.string().optional()` -> `z.string().datetime().optional()`) on a field
 * that otherwise behaves identically (both optional). The code fix was
 * already applied when this guard was written, and rule 17 explicitly
 * forbids reverting/toggling finished code to re-derive a red run — so this
 * test is **NOT proven failing-first** by executing the unfixed file. The
 * red behavior is nonetheless on the record: `git show
 * <pre-fix-commit>:electron-app/schemas/index.ts` shows the prior line was
 * bare `z.string().optional()`, which trivially accepts any string
 * (including "not-a-date") — the exact defect this guard pins against going
 * forward.
 */
import { FinancialServiceSchema } from "../index";

const basePayload = {
  provider: "OMT" as const,
  serviceType: "SEND" as const,
  amount: 100,
  currency: "USD",
};

describe("FinancialServiceSchema — transaction_time (LIRA-165)", () => {
  it("rejects a non-ISO garbage transaction_time string", () => {
    const result = FinancialServiceSchema.safeParse({
      ...basePayload,
      transaction_time: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed ISO-8601 transaction_time (the only value the UI ever sends)", () => {
    const result = FinancialServiceSchema.safeParse({
      ...basePayload,
      transaction_time: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("accepts an omitted transaction_time (still optional)", () => {
    const result = FinancialServiceSchema.safeParse({ ...basePayload });
    expect(result.success).toBe(true);
  });
});
