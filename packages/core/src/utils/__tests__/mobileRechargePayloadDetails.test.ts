/**
 * LIRA-329 T019 — the shared Mobile Recharge payload builders carry the
 * informational fields the transaction keeps in its details, and those
 * fields SURVIVE the shared schema (rule 23: Zod strips unknown keys
 * silently, so a builder key the schema lacks would vanish on both
 * transports). Field names are read back from the schema's own parse
 * (rule 24).
 *
 * NOT proven failing-first (rule 17): the builder changes were written
 * before this file.
 */
import { createFinancialServiceSchema } from "../../validators/financial";
import { buildCatalogSalePayload, catalogCartItems } from "../catalogSale";
import {
  buildWalletTransferPayload,
  calculateOmtWhishAppFees,
  transferFeePaidBy,
} from "../walletTransfer";

describe("catalog cart → catalogItems (LIRA-329)", () => {
  const lines = [
    {
      item: {
        key: "alfa-22",
        category: "alfa",
        label: "$22 card",
        subcategory: "Prepaid",
        cost_lbp: 1_900_000,
        sell_lbp: 2_000_000,
      },
      quantity: 2,
    },
    {
      item: {
        key: "alfa-7",
        category: "alfa",
        label: "$7.58",
        cost_lbp: 700_000,
        sell_lbp: 300_000,
      },
      quantity: 1,
      noteSuffix: " [Only Days]",
      onlyDays: true,
      returnedCreditsUsd: 3,
    },
  ];

  it("every line, as picked, survives the shared schema", () => {
    const body = createFinancialServiceSchema.parse(
      buildCatalogSalePayload({
        provider: "Katsh",
        lines,
        paidByMethod: "CASH",
      }),
    );
    expect(body.catalogItems).toEqual([
      {
        key: "alfa-22",
        category: "alfa",
        label: "$22 card",
        quantity: 2,
        unitPrice: 2_000_000,
      },
      {
        key: "alfa-7",
        category: "alfa",
        label: "$7.58",
        quantity: 1,
        unitPrice: 300_000,
        onlyDays: true,
        returnedCreditsUsd: 3,
      },
    ]);
    expect(catalogCartItems(lines)).toEqual(body.catalogItems);
  });

  it("a line without a key sends none (no made-up value)", () => {
    const [first] = catalogCartItems([
      {
        item: { category: "PUBG", label: "60 UC", cost_lbp: 1, sell_lbp: 2 },
        quantity: 1,
      },
    ]);
    expect(first).not.toHaveProperty("key");
  });
});

describe("who pays the fee (LIRA-329)", () => {
  it.each([
    [{ fee: 0, includingFees: false }, undefined],
    [{ fee: 2, includingFees: false }, "SENDER"],
    [{ fee: 2, includingFees: true }, "DEDUCTED"],
    [
      { fee: 2, includingFees: false, feeCollectedSeparately: true },
      "SEPARATELY",
    ],
  ] as const)("%o → %s", (input, expected) => {
    expect(transferFeePaidBy(input)).toBe(expected);
  });

  it("a Whish App cash-out with the fee deducted, and a discount, survive the schema", () => {
    const fees = calculateOmtWhishAppFees({
      activeProvider: "WHISH_APP",
      serviceType: "RECEIVE",
      currency: "USD",
      parsedAmount: 100,
      manualFee: "1",
      includingFees: true,
      discount: 0.5,
    });
    const body = createFinancialServiceSchema.parse(
      buildWalletTransferPayload({
        provider: "WHISH_APP",
        serviceType: "RECEIVE",
        currency: "USD",
        fees,
        includingFees: true,
        client: { name: "Omar", phone: "70333444" },
        paidByMethod: "CASH",
        cashoutMethod: "CASH",
        discount: 0.5,
      }),
    );
    expect(body.feePaidBy).toBe("DEDUCTED");
    expect(body.typedDiscount).toEqual({ amount: 0.5, currency: "USD" });
  });

  it("an OMT App send: the fee is on top, paid by the sender", () => {
    const fees = calculateOmtWhishAppFees({
      activeProvider: "OMT_APP",
      serviceType: "SEND",
      currency: "USD",
      parsedAmount: 100,
      manualFee: "2",
      includingFees: false,
    });
    const body = buildWalletTransferPayload({
      provider: "OMT_APP",
      serviceType: "SEND",
      currency: "USD",
      fees,
      includingFees: false,
      client: { name: "Lina", phone: "03111222" },
      paidByMethod: "CASH",
    });
    expect(body.feePaidBy).toBe("SENDER");
    expect(body).not.toHaveProperty("typedDiscount");
  });
});
