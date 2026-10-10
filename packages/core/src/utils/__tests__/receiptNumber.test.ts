/**
 * LIRA-296 (T003) — one receipt number per sale, defined once.
 *
 * Checkout used to print `RCP-${Date.now()}` and a reprint `RCP-${sale.id}`,
 * so the same sale carried two numbers and neither could be searched. The
 * number is now `RCP-<sale id>`, and the warranty search parses what a
 * cashier types back into the id.
 */
import { receiptNumberFor, parseReceiptNumber } from "../receiptNumber.js";

describe("receiptNumberFor", () => {
  it("is RCP- followed by the sale id", () => {
    expect(receiptNumberFor(12)).toBe("RCP-12");
    expect(receiptNumberFor(1)).toBe("RCP-1");
  });
});

describe("parseReceiptNumber", () => {
  it.each([
    ["RCP-12", 12],
    ["rcp12", 12],
    ["rcp-12", 12],
    ["Rcp-12", 12],
    ["12", 12],
    ["  RCP-12  ", 12],
  ])("accepts %p as sale %p", (input, id) => {
    expect(parseReceiptNumber(input)).toBe(id);
  });

  it.each([
    "",
    "   ",
    "RCP-",
    "RCP",
    "abc",
    "RCP-12a",
    "12.5",
    "-12",
    "0",
    "RCP-0",
    "RX-12",
    "RCP 12",
    "1e3",
  ])("returns null for %p", (input) => {
    expect(parseReceiptNumber(input)).toBeNull();
  });

  it("round-trips receiptNumberFor", () => {
    expect(parseReceiptNumber(receiptNumberFor(4821))).toBe(4821);
  });
});
