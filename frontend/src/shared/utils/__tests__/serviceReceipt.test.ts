/**
 * Unit tests for the service-transaction receipt builder (RCP-2,
 * docs/plans/done_plans/RECEIPTS_PLAN.md). Pure function → tested directly across the
 * shapes the advisor flagged: SEND, RECEIVE/cash-out, card-grid item, split
 * payment, LBP-only. Guards the two rules that matter most: it prints
 * customer-facing detail (fee/legs/change) and NEVER cost/price/profit.
 */

import {
  buildServiceReceiptText,
  type ServiceReceiptInput,
} from "../serviceReceipt";

const SHOP = { name: "Corner Tech", phone: "76 000 000", location: "Beirut" };

function build(over: Partial<ServiceReceiptInput>): string {
  return buildServiceReceiptText({
    shop: SHOP,
    txn: {
      id: 501,
      type: "FINANCIAL_SERVICE",
      summary: null,
      note: null,
      client_name: null,
      client_phone: null,
      created_at: "2026-07-13T10:00:00Z",
      metadata: {},
      ...over.txn,
    },
    legs: over.legs ?? [],
    ...(over.operator ? { operator: over.operator } : {}),
    ...(over.shop ? { shop: over.shop } : {}),
  });
}

describe("buildServiceReceiptText", () => {
  it("renders shop header, service line, amount and fee (customer-facing)", () => {
    const r = build({
      txn: {
        id: 501,
        type: "FINANCIAL_SERVICE",
        summary: null,
        note: null,
        client_name: "Sami",
        client_phone: "70111222",
        created_at: "2026-07-13T10:00:00Z",
        metadata: {
          provider: "OMT",
          service_type: "SEND",
          amount: 100,
          currency: "USD",
          commission: 2,
        },
      },
      legs: [
        { method: "CASH", currency_code: "USD", amount: 102, direction: "IN" },
      ],
    });
    expect(r).toContain("Corner Tech");
    expect(r).toContain("Service: OMT SEND");
    expect(r).toContain("Sami 70111222");
    expect(r).toContain("Amount:");
    expect(r).toContain("$100.00");
    expect(r).toContain("Fee:");
    expect(r).toContain("$2.00");
    expect(r).toContain("Paid (CASH):");
    expect(r).toContain("$102.00");
  });

  it("NEVER leaks cost/price/profit onto the receipt", () => {
    const r = build({
      txn: {
        id: 502,
        type: "FINANCIAL_SERVICE",
        summary: null,
        note: null,
        client_name: null,
        client_phone: null,
        created_at: "2026-07-13T10:00:00Z",
        metadata: {
          provider: "Katsh",
          service_type: "SEND",
          amount: 100,
          currency: "USD",
          commission: 5,
          cost: 90, // must not appear
          price: 100, // must not appear
        },
      },
    });
    expect(r).not.toContain("90");
    expect(r.toLowerCase()).not.toContain("cost");
    expect(r.toLowerCase()).not.toContain("profit");
    expect(r.toLowerCase()).not.toContain("price");
  });

  it("shows a card-grid item's category/subcategory from the note, title-cased", () => {
    const r = build({
      txn: {
        id: 503,
        type: "FINANCIAL_SERVICE",
        summary: null,
        note: "alfa: 50000 Card (mtc)",
        client_name: null,
        client_phone: null,
        created_at: "2026-07-13T10:00:00Z",
        metadata: {
          provider: "Katsh",
          service_type: "SEND",
          amount: 500000,
          currency: "LBP",
          item_key: "alfa-50000",
        },
      },
    });
    expect(r).toContain("Item: Alfa: 50000 Card (Mtc)");
    expect(r).toContain("500,000 LBP");
  });

  it("renders a RECEIVE/cash-out with the change (paid-to-customer) leg", () => {
    const r = build({
      txn: {
        id: 504,
        type: "FINANCIAL_SERVICE",
        summary: null,
        note: null,
        client_name: null,
        client_phone: null,
        created_at: "2026-07-13T10:00:00Z",
        metadata: {
          provider: "OMT",
          service_type: "RECEIVE",
          amount: 50,
          currency: "USD",
          commission: 0,
        },
      },
      legs: [
        { method: "CASH", currency_code: "USD", amount: 50, direction: "OUT" },
      ],
    });
    expect(r).toContain("Service: OMT RECEIVE");
    expect(r).toContain("Change:");
    expect(r).toContain("$50.00");
  });

  it("renders a split payment (two IN legs, USD + LBP)", () => {
    const r = build({
      txn: {
        id: 505,
        type: "FINANCIAL_SERVICE",
        summary: null,
        note: null,
        client_name: null,
        client_phone: null,
        created_at: "2026-07-13T10:00:00Z",
        metadata: {
          provider: "Katsh",
          service_type: "SEND",
          amount: 60,
          currency: "USD",
        },
      },
      legs: [
        { method: "CASH", currency_code: "USD", amount: 40, direction: "IN" },
        {
          method: "OMT",
          currency_code: "LBP",
          amount: 1_800_000,
          direction: "IN",
        },
      ],
    });
    expect(r).toContain("Paid (CASH):");
    expect(r).toContain("$40.00");
    expect(r).toContain("Paid (OMT):");
    expect(r).toContain("1,800,000 LBP");
  });

  it("prints the LBP price charged, not the dollar face-value amount, for a RECHARGE", () => {
    // Owner repro (2026-07-21): MTC Credits "$6" package priced at 720,000
    // LBP. metadata.amount (6) is the dollar face value of the credits
    // package (RechargeRepository's describeRechargeAmount) — completely
    // unrelated to metadata.currency ("LBP", the currency of what the
    // customer actually paid, in metadata.price). Pairing amount+currency
    // printed the nonsensical "6 LBP" instead of "720,000 LBP".
    const r = build({
      txn: {
        id: 507,
        type: "RECHARGE",
        summary: null,
        note: null,
        client_name: null,
        client_phone: null,
        created_at: "2026-07-21T14:00:00Z",
        metadata: {
          provider: "MTC",
          type: "CREDIT_TRANSFER",
          amount: 6,
          cost: 5,
          price: 720000,
          currency: "LBP",
        },
      },
      legs: [
        { method: "CASH", currency_code: "USD", amount: 10, direction: "IN" },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 170000,
          direction: "OUT",
        },
      ],
    });
    expect(r).toContain("Service: MTC Credits $6");
    expect(r).toContain("720,000 LBP");
    expect(r).not.toContain("6 LBP");
    expect(r.indexOf("Credits $6")).toBeLessThan(r.indexOf("720,000 LBP"));
  });

  // LIRA-176 phase 8b (item 8) — maintenance parts lines, "option 4":
  // parts are always USD, never converted, and print PRICE ONLY (no cost,
  // no margin — the receipt must never leak the shop's cost, same guard as
  // "NEVER leaks cost/price/profit" above).
  it("prints MAINTENANCE parts lines (price only), quantity shown only when > 1", () => {
    const r = build({
      txn: {
        id: 601,
        type: "MAINTENANCE",
        summary: null,
        note: "Cracked screen replacement",
        client_name: "Sami",
        client_phone: "70111222",
        created_at: "2026-09-01T10:00:00Z",
        metadata: {
          final_amount: 100,
          currency: "USD",
          parts_price_usd: 55,
          parts: [
            { name: "Screen Assembly", quantity: 1, unit_price_usd: 40 },
            { name: "Screw Kit", quantity: 3, unit_price_usd: 5 },
          ],
        },
      },
      legs: [
        { method: "CASH", currency_code: "USD", amount: 155, direction: "IN" },
      ],
    });
    // Single-unit part reads as a plain name — no "x1" suffix.
    expect(r).toContain("Screen Assembly");
    expect(r).not.toContain("Screen Assembly x1");
    expect(r).toContain("$40.00");
    // Multi-unit part shows "Name xN" and the LINE total (5 x 3 = 15), not
    // the unit price.
    expect(r).toContain("Screw Kit x3");
    expect(r).toContain("$15.00");
    // Price only — no cost/margin ever leaks onto a customer receipt.
    expect(r.toLowerCase()).not.toContain("cost");
    expect(r.toLowerCase()).not.toContain("margin");
  });

  it("a MAINTENANCE receipt with no metadata.parts is byte-identical whether the key is absent or an empty array", () => {
    const baseTxn = {
      id: 602,
      type: "MAINTENANCE",
      summary: null,
      note: "Battery swap",
      client_name: null,
      client_phone: null,
      created_at: "2026-09-01T10:00:00Z",
    };
    const legs = [
      { method: "CASH", currency_code: "USD", amount: 50, direction: "IN" as const },
    ];

    const keyAbsent = build({
      txn: { ...baseTxn, metadata: { final_amount: 50, currency: "USD" } },
      legs,
    });
    const keyEmpty = build({
      txn: {
        ...baseTxn,
        metadata: { final_amount: 50, currency: "USD", parts: [] },
      },
      legs,
    });

    expect(keyAbsent).toBe(keyEmpty);
    // No stray part-line artifacts (e.g. a lingering "xN" quantity suffix)
    // leaked into a receipt that has no parts at all.
    expect(keyAbsent).not.toMatch(/\bx\d+\b/);
  });

  it("handles an LBP-only recharge with no legs", () => {
    const r = build({
      txn: {
        id: 506,
        type: "RECHARGE",
        summary: null,
        note: null,
        client_name: null,
        client_phone: null,
        created_at: "2026-07-13T10:00:00Z",
        metadata: {
          provider: "MTC",
          service_type: "DAYS",
          amount: 900000,
          currency: "LBP",
        },
      },
    });
    expect(r).toContain("Service: MTC DAYS");
    expect(r).toContain("900,000 LBP");
    expect(r).toContain("Thank you!");
  });
});
