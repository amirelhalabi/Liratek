/**
 * LIRA-366 — the Binance form's existing Notes box is its typed note. The
 * ONE builder (walk-in send and session basket alike, rule 22) carries it
 * as `typedNote`; `referenceNumber` keeps the same text as before, so the
 * Binance History screen loses nothing. Blank → no key. Parsed through the
 * shared schema (rule 24). Rule 17: seen failing before the builder took it.
 */
import { createFinancialServiceSchema } from "@liratek/core";
import { buildCryptoServiceFields } from "../cryptoServiceFields";

function build(typedNote: string) {
  return buildCryptoServiceFields({
    cryptoType: "SEND",
    amount: 100,
    commission: 2,
    clientId: 7,
    clientName: "Rana Aziz",
    reference: typedNote,
    typedNote,
    detailFields: { feePaidBy: "SENDER" },
  });
}

describe("buildCryptoServiceFields — typed note (LIRA-366)", () => {
  it("a typed note rides as typedNote and still as the reference", () => {
    const parsed = createFinancialServiceSchema.parse({
      ...build("rest on Monday"),
      payments: [],
    });
    expect(parsed.typedNote).toBe("rest on Monday");
    expect(parsed.referenceNumber).toBe("rest on Monday");
  });

  it("blank → no typedNote key", () => {
    expect("typedNote" in build("   ")).toBe(false);
  });
});
