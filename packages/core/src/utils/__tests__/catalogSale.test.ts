/**
 * LIRA-302 — the shared Katsh / iPick catalog cart payload (web + phone).
 * Field names come from the schema: every output is parsed through
 * createFinancialServiceSchema (rule 24).
 */
import { createFinancialServiceSchema } from "../../validators/financial";
import {
  buildCatalogSalePayload,
  catalogCartNote,
  catalogCartTotals,
  formatCatalogItemName,
  usdForLbp,
  type CatalogItem,
} from "../catalogSale";

const alfa: CatalogItem = { category: "Alfa", label: "$22 card", subcategory: "alfa", cost_lbp: 1_900_000, sell_lbp: 2_000_000 };
const pubg: CatalogItem = { category: "PUBG", label: "60 UC", subcategory: "", cost_lbp: 80_000, sell_lbp: 100_000 };

describe("catalog cart wording", () => {
  it("names an item as 'category: label (subcategory)'", () => {
    expect(formatCatalogItemName(alfa)).toBe("Alfa: $22 card (alfa)");
    expect(formatCatalogItemName(pubg)).toBe("PUBG: 60 UC");
  });

  it("lists every line, with xN only above one and an optional suffix", () => {
    expect(
      catalogCartNote([
        { item: alfa, quantity: 2 },
        { item: pubg, quantity: 1, suffix: " [Only Days]" },
      ]),
    ).toBe("Alfa: $22 card (alfa) x2, PUBG: 60 UC [Only Days]");
  });
});

describe("usdForLbp", () => {
  it("divides by the rate and rounds to the cent like the web sheet", () => {
    expect(usdForLbp(4_100_000, 89_000)).toBe(46.07); // 46.0674…
    expect(usdForLbp(89_000, 89_000)).toBe(1);
    expect(usdForLbp(44_500, 89_000)).toBe(0.5);
  });
  it("refuses a missing rate", () => {
    expect(() => usdForLbp(1000, 0)).toThrow();
  });
});

describe("buildCatalogSalePayload", () => {
  const lines = [
    { item: alfa, quantity: 2 },
    { item: pubg, quantity: 1 },
  ];

  it("books the whole cart as one LBP SEND with gross cost and margin", () => {
    expect(catalogCartTotals(lines)).toEqual({ price: 4_100_000, cost: 3_880_000 });
    const body = createFinancialServiceSchema.parse(
      buildCatalogSalePayload({
        provider: "Katsh",
        lines,
        paidByMethod: "CUSTOMER_ACCOUNT",
        payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 4_100_000 }],
        client: { id: 7, name: "Hassan" },
      }),
    );
    expect(body).toMatchObject({
      provider: "Katsh",
      serviceType: "SEND",
      currency: "LBP",
      amount: 4_100_000,
      cost: 3_880_000,
      commission: 220_000,
      paidByMethod: "CUSTOMER_ACCOUNT",
      checkoutTotal: { usd: 0, lbp: 4_100_000 },
      clientId: 7,
      clientName: "Hassan",
      note: "Alfa: $22 card (alfa) x2, PUBG: 60 UC",
    });
    expect(body.tender_exchange_rate).toBeUndefined();
  });

  it("sends the tender rate with a USD leg", () => {
    const usd = usdForLbp(4_100_000, 89_000);
    const body = createFinancialServiceSchema.parse(
      buildCatalogSalePayload({
        provider: "iPick",
        lines,
        paidByMethod: "WHISH",
        payments: [{ method: "WHISH", currencyCode: "USD", amount: usd }],
        tenderExchangeRate: 89_000,
      }),
    );
    expect(body.tender_exchange_rate).toBe(89_000);
    expect(body.payments).toEqual([{ method: "WHISH", currencyCode: "USD", amount: 46.07 }]);
    expect(body.clientId).toBeUndefined();
  });

  it("without legs sends no checkout total and no rate", () => {
    const p = buildCatalogSalePayload({ provider: "Katsh", lines, paidByMethod: "CASH", tenderExchangeRate: 89_000 });
    expect(p.checkoutTotal).toBeUndefined();
    expect(p.tender_exchange_rate).toBeUndefined();
  });

  it("never reports a negative margin", () => {
    const p = buildCatalogSalePayload({
      provider: "Katsh",
      lines: [{ item: { ...pubg, sell_lbp: 50_000 }, quantity: 1 }],
      paidByMethod: "WHISH",
    });
    expect(p.commission).toBe(0);
  });

  it.each([[[]], [[{ item: pubg, quantity: 0 }]], [[{ item: pubg, quantity: 1.5 }]]])(
    "refuses an empty cart or a bad quantity (%j)",
    (bad) => {
      expect(() => buildCatalogSalePayload({ provider: "Katsh", lines: bad, paidByMethod: "WHISH" })).toThrow();
    },
  );
});
