/**
 * LIRA-343 — schema keys for settling by day.
 *
 *  - T003: the calendar read schemas `accountMonthSchema` / `accountDaySchema`.
 *  - T012: `include_account_credits` and `credit_used` on
 *    `supplierSettleAccountSchema` (contracts/settle-account-days.md).
 *
 * Rule 24 — every settle-account field name below is taken from
 * `supplierSettleAccountSchema.shape`, never typed by hand into a payload: a
 * key the schema does not have makes `shapeKey` throw.
 *
 * Rule 17 — written before the schema change and run against it first. The
 * schemas are read through the module namespace so a missing export is an
 * assertion failure, not a compile error that stops the file running.
 */
import { z } from "zod";
import * as supplierValidators from "../supplier.js";
import { supplierSettleAccountSchema } from "../supplier.js";

type SchemaMap = Record<string, z.ZodTypeAny | undefined>;
const exported = supplierValidators as unknown as SchemaMap;

/** A settle-account key, only if the schema really has it (rule 24). */
function shapeKey(name: string): string {
  const keys = Object.keys(supplierSettleAccountSchema.shape);
  if (!keys.includes(name)) {
    throw new Error(`supplierSettleAccountSchema has no key "${name}"`);
  }
  return name;
}

function issuePaths(input: unknown): string[] {
  const r = supplierSettleAccountSchema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => i.path.join("."));
}

const amountFirst = {
  account_supplier_id: 1,
  per_currency: {
    USD: {
      direction: "PAY" as const,
      payments: [{ method: "CASH", currency_code: "USD", amount: 366.3 }],
    },
  },
  expected_owed: { usd: 375, lbp: 0 },
};

const legacy = {
  account_supplier_id: 1,
  direction: "PAY" as const,
  selections: [{ kind: "FINANCIAL_SERVICE" as const, id: 1 }],
  amount_usd: 10,
  amount_lbp: 0,
  commission_usd: 0,
  commission_lbp: 0,
  payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
};

describe("LIRA-343 T003 — calendar read schemas", () => {
  it("accountMonthSchema accepts YYYY-MM and refuses a bad month", () => {
    const schema = exported.accountMonthSchema;
    expect(schema).toBeDefined();
    if (!schema) return;
    expect(schema.safeParse({ month: "2026-10" }).success).toBe(true);
    expect(schema.safeParse({ month: "2026-01" }).success).toBe(true);
    expect(schema.safeParse({ month: "2026-12" }).success).toBe(true);
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-10", "2026-10-01", ""]) {
      expect(schema.safeParse({ month: bad }).success).toBe(false);
    }
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("accountDaySchema accepts YYYY-MM-DD and refuses other shapes", () => {
    const schema = exported.accountDaySchema;
    expect(schema).toBeDefined();
    if (!schema) return;
    expect(schema.safeParse({ day: "2026-10-25" }).success).toBe(true);
    for (const bad of ["2026-10", "2026-10-5", "25/10/2026", ""]) {
      expect(schema.safeParse({ day: bad }).success).toBe(false);
    }
    expect(schema.safeParse({}).success).toBe(false);
  });
});

describe("LIRA-343 T012 — include_account_credits / credit_used", () => {
  it("the schema has both keys", () => {
    const keys = Object.keys(supplierSettleAccountSchema.shape);
    expect(keys).toEqual(
      expect.arrayContaining(["include_account_credits", "credit_used"]),
    );
  });

  it("amount-first: keeps include_account_credits and credit_used", () => {
    const include = shapeKey("include_account_credits");
    const credit = shapeKey("credit_used");
    const input = {
      ...amountFirst,
      [include]: true,
      [credit]: { usd: 8.7, lbp: 0 },
    };
    const r = supplierSettleAccountSchema.safeParse(input);
    expect(r.success).toBe(true);
    if (!r.success) return;
    const data = r.data as Record<string, unknown>;
    expect(data[include]).toBe(true);
    expect(data[credit]).toEqual({ usd: 8.7, lbp: 0 });
  });

  it("amount-first: include_account_credits alone is accepted (credit 0 is a choice)", () => {
    const include = shapeKey("include_account_credits");
    expect(issuePaths({ ...amountFirst, [include]: true })).toEqual([]);
    expect(issuePaths({ ...amountFirst, [include]: false })).toEqual([]);
  });

  it("amount-first: credit_used needs include_account_credits = true", () => {
    const include = shapeKey("include_account_credits");
    const credit = shapeKey("credit_used");
    expect(issuePaths({ ...amountFirst, [credit]: { usd: 5 } })).toContain(credit);
    expect(
      issuePaths({ ...amountFirst, [include]: false, [credit]: { usd: 5 } }),
    ).toContain(credit);
  });

  it("amount-first: credit_used amounts are never negative", () => {
    const include = shapeKey("include_account_credits");
    const credit = shapeKey("credit_used");
    expect(
      issuePaths({ ...amountFirst, [include]: true, [credit]: { usd: -1 } }),
    ).toContain(`${credit}.usd`);
    expect(
      issuePaths({ ...amountFirst, [include]: true, [credit]: { lbp: -1 } }),
    ).toContain(`${credit}.lbp`);
  });

  it("legacy (no per_currency): both keys are refused", () => {
    const include = shapeKey("include_account_credits");
    const credit = shapeKey("credit_used");
    expect(issuePaths(legacy)).toEqual([]);
    expect(issuePaths({ ...legacy, [include]: true })).toContain(include);
    expect(issuePaths({ ...legacy, [include]: false })).toContain(include);
    expect(
      issuePaths({ ...legacy, [include]: true, [credit]: { usd: 1 } }),
    ).toEqual(expect.arrayContaining([include, credit]));
  });
});
