/**
 * LIRA-333 T003 — the FR-014 phone table, verbatim (spec.md FR-014,
 * contracts/whatsapp-message.md). One rule for every place that sends to
 * WhatsApp (FR-015): the receipt link and WhatsAppService.
 */
import { toWhatsAppNumber } from "../whatsappPhone.js";

describe("toWhatsAppNumber (FR-014)", () => {
  const accepted: Array<[string, string]> = [
    ["03 123 456", "9613123456"],
    ["03-123456", "9613123456"],
    ["(03) 123456", "9613123456"],
    ["76901610", "96176901610"],
    ["+961 76 901 610", "96176901610"],
    ["0096176901610", "96176901610"],
    ["96176901610", "96176901610"],
    ["+33 6 12 34 56 78", "33612345678"],
    ["0033612345678", "33612345678"],
    ["+961 03 123 456", "9613123456"],
    ["03.123.456", "9613123456"],
  ];

  it.each(accepted)("%s → %s", (typed, digits) => {
    expect(toWhatsAppNumber(typed)).toEqual({ ok: true, digits });
  });

  it.each([
    ["abc", "invalid"],
    ["12", "invalid"],
    ["1234567890123456", "invalid"], // 16 digits: over E.164's 15
    ["+", "invalid"],
    ["03 12a 456", "invalid"],
    ["", "empty"],
    ["   ", "empty"],
  ])("refuses %j (%s)", (typed, reason) => {
    expect(toWhatsAppNumber(typed)).toEqual({ ok: false, reason });
  });

  it("refuses null/undefined as empty", () => {
    expect(toWhatsAppNumber(null)).toEqual({ ok: false, reason: "empty" });
    expect(toWhatsAppNumber(undefined)).toEqual({ ok: false, reason: "empty" });
  });
});
