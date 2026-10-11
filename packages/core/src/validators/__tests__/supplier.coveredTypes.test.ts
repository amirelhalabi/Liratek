/**
 * LIRA-256 — the shared covered-types schema, and the key on both settle
 * schemas. Zod strips unknown keys silently (rule 23), so these tests prove
 * the key SURVIVES parsing — otherwise the guard would never see it.
 *
 * RULE 17 — run before the schema existed: failed (`omtCoveredTypesSchema`
 * undefined; `covered_omt_service_types` stripped from both settle parses).
 */
import {
  omtCoveredTypesSchema,
  supplierSettleSchema,
  supplierSettleAccountSchema,
} from "../supplier.js";
import { createFinancialServiceSchema } from "../financial.js";
import { OMT_SERVICE_TYPES } from "../../utils/omtFees.js";

const settleFixture = {
  supplier_id: 1,
  financial_service_ids: [1],
  amount_usd: 10,
  amount_lbp: 0,
  commission_usd: 0,
  commission_lbp: 0,
};
const settleAccountFixture = {
  account_supplier_id: 1,
  direction: "PAY" as const,
  selections: [{ kind: "FINANCIAL_SERVICE" as const, id: 1 }],
  amount_usd: 10,
  amount_lbp: 0,
  commission_usd: 0,
  commission_lbp: 0,
};

describe("omtCoveredTypesSchema", () => {
  it("accepts every OMT type and UNSPECIFIED", () => {
    expect(
      omtCoveredTypesSchema.safeParse([...OMT_SERVICE_TYPES, "UNSPECIFIED"])
        .success,
    ).toBe(true);
    for (const t of OMT_SERVICE_TYPES)
      expect(omtCoveredTypesSchema.safeParse([t]).success).toBe(true);
  });
  it("rejects an empty list and unknown values", () => {
    expect(omtCoveredTypesSchema.safeParse([]).success).toBe(false);
    expect(omtCoveredTypesSchema.safeParse(["BOGUS"]).success).toBe(false);
  });
});

describe.each([
  ["supplierSettleSchema", supplierSettleSchema, settleFixture],
  [
    "supplierSettleAccountSchema",
    supplierSettleAccountSchema,
    settleAccountFixture,
  ],
] as const)("%s", (_name, schema, fixture) => {
  it("keeps covered_omt_service_types (not stripped)", () => {
    const r = schema.safeParse({
      ...fixture,
      covered_omt_service_types: ["INTRA"],
    });
    expect(r.success).toBe(true);
    expect(
      (r as { data: Record<string, unknown> }).data.covered_omt_service_types,
    ).toEqual(["INTRA"]);
  });
  it("still parses without it (absent = all types)", () => {
    const r = schema.safeParse(fixture);
    expect(r.success).toBe(true);
    expect("covered_omt_service_types" in (r as { data: object }).data).toBe(
      false,
    );
  });
  it("rejects [] and BOGUS", () => {
    expect(
      schema.safeParse({ ...fixture, covered_omt_service_types: [] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...fixture, covered_omt_service_types: ["BOGUS"] })
        .success,
    ).toBe(false);
  });
});

describe("createFinancialServiceSchema still accepts every OMT_SERVICE_TYPES value", () => {
  for (const omtServiceType of OMT_SERVICE_TYPES) {
    it(omtServiceType, () => {
      const r = createFinancialServiceSchema.safeParse({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        paidByMethod: "CASH",
        omtServiceType,
        omtFee: 1,
      });
      expect(r.success).toBe(true);
    });
  }
});
