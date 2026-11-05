/**
 * LIRA-371 — the one method-list cash test (moved out of the Debts Repay
 * preview, same rule), shared by Debts and the settle screens (rule 14).
 */
import { isGeneralCash } from "../isGeneralCash";

describe("isGeneralCash", () => {
  it("GIFT_CARD and CUSTOMER_ACCOUNT are never cash", () => {
    const methods = [
      { code: "GIFT_CARD", drawer_name: "General", affects_drawer: 1 },
      { code: "CUSTOMER_ACCOUNT", drawer_name: "General", affects_drawer: 1 },
    ];
    expect(isGeneralCash("GIFT_CARD", methods)).toBe(false);
    expect(isGeneralCash("CUSTOMER_ACCOUNT", methods)).toBe(false);
  });

  it("a method with a drawer is cash iff it affects the General drawer", () => {
    const methods = [
      { code: "CASH", drawer_name: "General", affects_drawer: 1 },
      { code: "CHEQUE", drawer_name: "General", affects_drawer: 0 },
      { code: "WHISH", drawer_name: "Whish_App", affects_drawer: 1 },
    ];
    expect(isGeneralCash("CASH", methods)).toBe(true);
    expect(isGeneralCash("CHEQUE", methods)).toBe(false);
    expect(isGeneralCash("WHISH", methods)).toBe(false);
  });

  it("a method without a drawer is cash iff its code is CASH", () => {
    expect(isGeneralCash("CASH", [])).toBe(true);
    expect(isGeneralCash("WHISH", [{ code: "WHISH" }])).toBe(false);
  });
});
