/**
 * Unit tests for the service-transaction receipt builder (RCP-2,
 * docs/plans/done_plans/RECEIPTS_PLAN.md). Pure function → tested directly across the
 * shapes the advisor flagged: SEND, RECEIVE/cash-out, card-grid item, split
 * payment, LBP-only. Guards the two rules that matter most: it prints
 * customer-facing detail (fee/legs/change) and NEVER cost/price/profit.
 */

import {
  buildServiceReceiptText,
  buildServiceReceiptTextByTransaction,
  type ServiceReceiptInput,
  type ServiceReceiptApi,
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
      {
        method: "CASH",
        currency_code: "USD",
        amount: 50,
        direction: "IN" as const,
      },
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

  // LIRA-185 #1 follow-up (owner decision 2026-10-02) — an MTC/Alfa sale
  // with a payment-sheet Discount shows the breakdown, not just the charged
  // total, so the customer sees what was taken off.
  // NOT proven failing-first (LIRA-185): verified by toggling the fix in
  // place, which rule 17 does not accept.
  it("shows Price / Discount / Total for a discounted RECHARGE", () => {
    const r = build({
      txn: {
        id: 508,
        type: "RECHARGE",
        summary: null,
        note: null,
        client_name: null,
        client_phone: null,
        created_at: "2026-10-02T10:00:00Z",
        metadata: {
          provider: "MTC",
          type: "CREDIT_TRANSFER",
          amount: 3,
          cost: 255000,
          price: 280000,
          list_price: 300000,
          discount: 20000,
          currency: "LBP",
        },
      },
      legs: [
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 280000,
          direction: "IN",
        },
      ],
    });
    expect(r).toContain("Price:");
    expect(r).toContain("300,000 LBP");
    expect(r).toContain("Discount:");
    expect(r).toContain("-20,000 LBP");
    expect(r).toContain("Total:");
    expect(r).toContain("280,000 LBP");
    expect(r).not.toContain("Amount:");
  });

  // NOT proven failing-first (LIRA-185): verified by toggling the fix in
  // place, which rule 17 does not accept.
  it("shows NO discount line when discount is 0 — just the plain Amount", () => {
    const r = build({
      txn: {
        id: 509,
        type: "RECHARGE",
        summary: null,
        note: null,
        client_name: null,
        client_phone: null,
        created_at: "2026-10-02T10:00:00Z",
        metadata: {
          provider: "MTC",
          type: "CREDIT_TRANSFER",
          amount: 3,
          cost: 255000,
          price: 300000,
          list_price: 300000,
          discount: 0,
          currency: "LBP",
        },
      },
      legs: [
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 300000,
          direction: "IN",
        },
      ],
    });
    expect(r).toContain("Amount:");
    expect(r).toContain("300,000 LBP");
    expect(r).not.toContain("Discount:");
    expect(r).not.toContain("Price:");
    expect(r).not.toContain("Total:");
  });

  // Rule 19 fix (LIRA reprint-on-web) — `buildServiceReceiptTextByTransaction`
  // used to call `window.api.transactions.getById`/`getCustomerLegs` directly,
  // which is `undefined` in a browser (no Electron preload ever runs there),
  // so the Transactions page's reprint button silently couldn't work on web.
  // Pre-fix red, proven WITHOUT reverting the (already-fixed) real source —
  // rule 17 forbids re-breaking finished code to prove a test — via an
  // isolated repro of the exact removed line in a plain jsdom test env:
  //   await window.api.transactions.getById(501)
  // throws "Cannot read properties of undefined (reading 'transactions')"
  // because `window.api` is undefined here too (no setup file sets it — see
  // frontend/jest.setup.ts), confirmed by running that one line directly
  // under Node before writing this suite.
  //
  // This jsdom test file never sets `window.api`, so these two specs ARE
  // already running in "web mode" — no extra stubbing needed to prove the
  // fix doesn't touch `window.api` at all.
  describe("buildServiceReceiptTextByTransaction (dual-transport, rule 19)", () => {
    function fakeApi(
      txn: Record<string, unknown>,
      legs: ServiceReceiptInput["legs"] = [],
    ): ServiceReceiptApi {
      return {
        getTransactionById: jest.fn().mockResolvedValue(txn),
        getCustomerFacingLegs: jest.fn().mockResolvedValue(legs),
        getAllSettings: jest.fn().mockResolvedValue([]),
      };
    }

    it("builds the receipt via the injected api — no window.api access (web mode)", async () => {
      expect(window.api).toBeUndefined();

      const api = fakeApi(
        {
          id: 501,
          type: "FINANCIAL_SERVICE",
          note: null,
          client_name: "Sami",
          client_phone: "70111222",
          created_at: "2026-07-13T10:00:00Z",
          metadata_json: JSON.stringify({
            provider: "OMT",
            service_type: "SEND",
            amount: 100,
            currency: "USD",
            commission: 2,
          }),
        },
        [
          {
            method: "CASH",
            currency_code: "USD",
            amount: 102,
            direction: "IN",
          },
        ],
      );

      const result = await buildServiceReceiptTextByTransaction(api, 501, SHOP);

      expect(result.ok).toBe(true);
      expect(result.text).toContain("Service: OMT SEND");
      expect(result.text).toContain("Amount:");
      expect(result.text).toContain("$100.00");
      expect(api.getTransactionById).toHaveBeenCalledWith(501);
      expect(api.getCustomerFacingLegs).toHaveBeenCalledWith(501);
    });

    it("shows Price / Discount / Total for a discounted MTC sale via the injected api", async () => {
      const api = fakeApi(
        {
          id: 508,
          type: "RECHARGE",
          note: null,
          client_name: null,
          client_phone: null,
          created_at: "2026-10-02T10:00:00Z",
          metadata_json: JSON.stringify({
            provider: "MTC",
            type: "CREDIT_TRANSFER",
            amount: 3,
            cost: 255000,
            price: 280000,
            list_price: 300000,
            discount: 20000,
            currency: "LBP",
          }),
        },
        [
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 280000,
            direction: "IN",
          },
        ],
      );

      const result = await buildServiceReceiptTextByTransaction(api, 508, SHOP);

      expect(result.ok).toBe(true);
      expect(result.text).toContain("Price:");
      expect(result.text).toContain("300,000 LBP");
      expect(result.text).toContain("Discount:");
      expect(result.text).toContain("-20,000 LBP");
      expect(result.text).toContain("Total:");
      expect(result.text).toContain("280,000 LBP");
      expect(result.text).not.toContain("Amount:");
    });

    it("returns ok:false when the transaction is not found, without touching window.api", async () => {
      const api = fakeApi(null as unknown as Record<string, unknown>);
      (api.getTransactionById as jest.Mock).mockResolvedValue(null);

      const result = await buildServiceReceiptTextByTransaction(api, 999, SHOP);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Transaction not found");
    });
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

// LIRA-296 (T026, SF-3) — the saved receipt header prints under the shop
// name on service (repair, recharge, …) receipts too, only when set.
describe("buildServiceReceiptText — receipt header (LIRA-296)", () => {
  it("prints the header under the shop name", () => {
    const r = build({ shop: { ...SHOP, headerText: "Open daily 9-9" } });
    expect(r).toContain("Open daily 9-9");
    expect(r.indexOf("Open daily 9-9")).toBeGreaterThan(
      r.indexOf("Corner Tech"),
    );
    expect(r.indexOf("Open daily 9-9")).toBeLessThan(r.indexOf("#501"));
  });

  it("prints nothing extra when the header is empty", () => {
    expect(build({ shop: { ...SHOP, headerText: "" } })).toBe(build({}));
  });
});

// LIRA-296 (T043, user story 5) — a repair's own warranty prints on its
// receipt, with the shop's warranty terms; a receipt with no warranty shows
// neither.
describe("buildServiceReceiptText — repair warranty (LIRA-296)", () => {
  const repair = (metadata: Record<string, unknown>) =>
    build({
      shop: { ...SHOP, warrantyTerms: "Covers the replaced part only." },
      txn: {
        id: 77,
        type: "MAINTENANCE",
        summary: null,
        note: "Screen swap",
        client_name: null,
        client_phone: null,
        created_at: "2026-10-10T10:00:00Z",
        metadata: {
          final_amount: 50,
          currency: "USD",
          amount: 50,
          ...metadata,
        },
      },
    });

  it("prints the warranty end day and the terms", () => {
    const r = repair({ warranty_until: "2027-01-10" });
    expect(r).toContain("Warranty until: 2027-01-10");
    expect(r).toContain("Covers the replaced part only.");
  });

  it("prints neither without a warranty", () => {
    const r = repair({});
    expect(r).not.toContain("Warranty until");
    expect(r).not.toContain("Covers the replaced part only.");
  });
});
