import { brandOf } from "@/shared/brand/providerBrands";

/**
 * `brandOf` maps every drawer name and payment-method code the app uses
 * (`create_db.sql` drawer_balances / payment_methods seeds) to its provider
 * brand, case-insensitively. Anything else stays unbranded.
 */
describe("brandOf", () => {
  it.each([
    // Whish / OMT (unchanged)
    ["Whish_App", "WHISH"],
    ["Whish_System", "WHISH"],
    ["WHISH", "WHISH"],
    ["OMT_App", "OMT"],
    ["OMT_System", "OMT"],
    ["OMT_WALLET", "OMT"],
    // iPick
    ["iPick", "IPICK"],
    ["IPICK", "IPICK"],
    // Katsh
    ["Katsh", "KATSH"],
    ["KATSH", "KATSH"],
    // MTC
    ["MTC", "MTC"],
    ["mtc", "MTC"],
    // Alfa
    ["Alfa", "ALFA"],
    ["ALFA", "ALFA"],
    // Binance (drawer + payment method)
    ["Binance", "BINANCE"],
    ["BINANCE", "BINANCE"],
  ])("maps %p to %p", (code, brand) => {
    expect(brandOf(code)).toBe(brand);
  });

  it.each([
    ["General"],
    ["CASH"],
    ["CUSTOMER_ACCOUNT"],
    ["GIFT_CARD"],
    ["USDT"],
    [""],
    [null],
    [undefined],
  ])("leaves %p unbranded", (code) => {
    expect(brandOf(code)).toBeNull();
  });
});
