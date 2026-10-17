/** @jest-environment jsdom */
import { loadLanguage } from "@/i18n/setup";
import { paymentMethodLabel } from "../paymentMethodLabel";

beforeAll(async () => {
  await loadLanguage("ar");
});

describe("paymentMethodLabel (OD-3)", () => {
  it("translates a seeded method whose label still equals its seed", () => {
    expect(paymentMethodLabel("CASH", "Cash", "en")).toBe("Cash");
    expect(paymentMethodLabel("CASH", "Cash", "ar")).not.toBe("Cash");
  });

  it("shows a renamed seed as stored", () => {
    expect(paymentMethodLabel("CASH", "Cash drawer", "ar")).toBe(
      "Cash drawer",
    );
  });

  it("shows a method the shop added as stored", () => {
    expect(paymentMethodLabel("PAYPAL", "PayPal", "ar")).toBe("PayPal");
  });
});
