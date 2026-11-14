/**
 * LIRA-391 — `lumpMethodOf`: the method only when every line shares it.
 * Not proven failing-first (new helper; the guard and the page tests carry
 * the failing-first evidence).
 */
import { derivePaidByMethod, lumpMethodOf } from "../paymentUtils";

describe("lumpMethodOf", () => {
  it("no lines → undefined", () => {
    expect(lumpMethodOf([])).toBeUndefined();
  });
  it("one line → its method", () => {
    expect(lumpMethodOf([{ method: "CUSTOMER_ACCOUNT" }])).toBe(
      "CUSTOMER_ACCOUNT",
    );
  });
  it("several lines of one method → that method", () => {
    expect(lumpMethodOf([{ method: "CASH" }, { method: "CASH" }])).toBe("CASH");
  });
  it("a split of different methods → undefined", () => {
    expect(
      lumpMethodOf([{ method: "CUSTOMER_ACCOUNT" }, { method: "WHISH" }]),
    ).toBeUndefined();
  });
  it("derivePaidByMethod keeps its display rule (MULTI for 2+ lines)", () => {
    expect(derivePaidByMethod([{ method: "CASH" }, { method: "CASH" }])).toBe(
      "MULTI",
    );
    expect(derivePaidByMethod([{ method: "WHISH" }])).toBe("WHISH");
    expect(derivePaidByMethod([])).toBe("CASH");
  });
});
