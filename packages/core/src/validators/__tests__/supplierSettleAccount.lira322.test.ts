/**
 * LIRA-322 — supplierSettleAccountSchema, additive amount-first payload
 * (contracts/settle-account.md). `per_currency` selects the amount-first
 * path; without it the legacy whole-row payload is required exactly as
 * before.
 *
 * Refusal tests assert the issue PATH, so they cannot pass for the wrong
 * reason (today's schema refuses a per_currency payload only because the
 * legacy keys are missing).
 *
 * Rule 17: run against the unchanged schema first.
 */
import { supplierSettleAccountSchema } from "../supplier.js";

const USD_CASH = { method: "CASH", currency_code: "USD", amount: 497 };

const amountFirst = {
  account_supplier_id: 1,
  per_currency: {
    USD: { direction: "PAY" as const, payments: [USD_CASH] },
  },
  expected_owed: { usd: 497, lbp: 900000 },
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

function issuePaths(input: unknown): string[] {
  const r = supplierSettleAccountSchema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => i.path.join("."));
}

describe("supplierSettleAccountSchema — amount-first (per_currency)", () => {
  it("parses per_currency.USD with no direction / amount_* / selections, keeping every new key", () => {
    const r = supplierSettleAccountSchema.safeParse(amountFirst);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.per_currency).toEqual(amountFirst.per_currency);
    expect(r.data.expected_owed).toEqual({ usd: 497, lbp: 900000 });
    expect(r.data.direction).toBeUndefined();
    expect(r.data.selections).toBeUndefined();
  });

  it("keeps commission and waive on a section, and accepts both sections with opposite directions", () => {
    const r = supplierSettleAccountSchema.safeParse({
      ...amountFirst,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ ...USD_CASH, amount: 496.3 }],
          commission: 0.7,
          waive: 0,
        },
        LBP: {
          direction: "COLLECT",
          payments: [{ method: "CASH", currency_code: "LBP", amount: 2000000 }],
        },
      },
      selections: [{ kind: "LEDGER", id: 9 }],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.per_currency?.USD?.commission).toBe(0.7);
    expect(r.data.per_currency?.LBP?.direction).toBe("COLLECT");
    expect(r.data.selections).toEqual([{ kind: "LEDGER", id: 9 }]);
  });

  it("refuses per_currency: {} (at least one section)", () => {
    expect(issuePaths({ ...amountFirst, per_currency: {} })).toEqual([
      "per_currency",
    ]);
  });

  // Rule 24 rewrite (LIRA-359, owner decision 2026-10-29): a box may now be
  // paid in the other currency, so the schema accepts it; the OMT account
  // still refuses it on the server (SupplierRepository.lira359…).
  it("accepts an IN leg in LBP inside the USD section (LIRA-359)", () => {
    expect(
      issuePaths({
        ...amountFirst,
        per_currency: {
          USD: {
            direction: "PAY",
            payments: [{ method: "CASH", currency_code: "LBP", amount: 1 }],
          },
        },
      }),
    ).toEqual([]);
  });

  it("refuses a leg that is neither USD nor LBP (LIRA-359)", () => {
    expect(
      issuePaths({
        ...amountFirst,
        per_currency: {
          USD: {
            direction: "PAY",
            payments: [{ method: "CASH", currency_code: "EUR", amount: 1 }],
          },
        },
      }),
    ).toEqual(["per_currency.USD.payments.0.currency_code"]);
  });

  it("accepts an IN leg in USD inside the LBP section (explicit direction IN too; LIRA-359)", () => {
    expect(
      issuePaths({
        ...amountFirst,
        per_currency: {
          LBP: {
            direction: "PAY",
            payments: [
              { method: "CASH", currency_code: "LBP", amount: 900000 },
              { method: "CASH", currency_code: "USD", amount: 1, direction: "IN" },
            ],
          },
        },
      }),
    ).toEqual([]);
  });

  it("accepts an OUT (change) leg in LBP inside the USD section", () => {
    const r = supplierSettleAccountSchema.safeParse({
      ...amountFirst,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [
            { ...USD_CASH, amount: 500 },
            {
              method: "CASH",
              currency_code: "LBP",
              amount: 268500,
              direction: "OUT",
            },
          ],
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ["direction", { direction: "PAY" }],
    ["amount_usd", { amount_usd: 497 }],
    ["amount_lbp", { amount_lbp: 0 }],
    ["surplus_usd", { surplus_usd: 1 }],
    ["surplus_lbp", { surplus_lbp: 1 }],
    ["discount", { discount: { amount_usd: 1, amount_lbp: 0 } }],
    // Lead decision 2026-10-15 (Phase 3): the amount-first commission is
    // per_currency.*.commission; the legacy keys are refused next to it.
    ["commission_usd", { commission_usd: 0.7 }],
    ["commission_lbp", { commission_lbp: 0 }],
  ])("refuses per_currency together with the legacy key %s", (key, extra) => {
    expect(issuePaths({ ...amountFirst, ...extra })).toEqual([key]);
  });

  it("requires expected_owed on the amount-first path (FR-021)", () => {
    const payload: Record<string, unknown> = { ...amountFirst };
    delete payload.expected_owed;
    expect(issuePaths(payload)).toEqual(["expected_owed"]);
  });

  it.each([
    ["commission", { commission: -0.01 }],
    ["waive", { waive: -1 }],
  ])("refuses a negative section %s", (key, extra) => {
    expect(
      issuePaths({
        ...amountFirst,
        per_currency: {
          USD: { direction: "PAY", payments: [USD_CASH], ...extra },
        },
      }),
    ).toEqual([`per_currency.USD.${key}`]);
  });

  it("refuses an unknown section direction", () => {
    expect(
      issuePaths({
        ...amountFirst,
        per_currency: { USD: { direction: "RECEIVE", payments: [USD_CASH] } },
      }),
    ).toEqual(["per_currency.USD.direction"]);
  });
});

describe("supplierSettleAccountSchema — legacy payload unchanged", () => {
  it("today's sheet payload still parses to itself", () => {
    const r = supplierSettleAccountSchema.safeParse(legacy);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual(legacy);
  });

  it.each([
    "direction",
    "selections",
    "amount_usd",
    "amount_lbp",
    "commission_usd",
    "commission_lbp",
  ])("without per_currency, %s is still required", (key) => {
    const payload: Record<string, unknown> = { ...legacy };
    delete payload[key];
    expect(issuePaths(payload)).toEqual([key]);
  });

  it("without per_currency, an empty selections list is still refused", () => {
    expect(issuePaths({ ...legacy, selections: [] })).toEqual(["selections"]);
  });

  it("still exposes .shape (read by the backend and frontend key tests)", () => {
    const keys = Object.keys(supplierSettleAccountSchema.shape);
    expect(keys).toEqual(
      expect.arrayContaining([
        "account_supplier_id",
        "direction",
        "selections",
        "covered_omt_service_types",
        "per_currency",
        "expected_owed",
      ]),
    );
  });
});
