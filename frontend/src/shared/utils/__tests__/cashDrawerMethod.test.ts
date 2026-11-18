/**
 * LIRA-399 — the cash drawer on the payment line (owner 2026-11-18):
 * "Cash · <drawer>" labels, the Settle Account split, and the leg a code
 * stands for. Written with the feature (not proven failing-first).
 */
import {
  CASH_GENERAL_CODE,
  baseMethodCode,
  labelCashByDrawer,
  legFromMethodCode,
  withCashDrawerMethods,
} from "../cashDrawerMethod";

const METHODS = [
  { code: "CASH", label: "Cash", drawer_name: "General", affects_drawer: 1 },
  { code: "WHISH", label: "Whish", drawer_name: "Whish_App", affects_drawer: 1 },
];

describe("labelCashByDrawer", () => {
  it("relabels only Cash and keeps the bare label", () => {
    const out = labelCashByDrawer(METHODS, "General");
    expect(out.map((m) => m.label)).toEqual(["Cash · General", "Whish"]);
    expect(out[0]?.rawLabel).toBe("Cash");
  });

  it("never stacks: a second relabel starts from the bare label", () => {
    const twice = labelCashByDrawer(labelCashByDrawer(METHODS, "General"), "OMT Cash Drawer");
    expect(twice[0]?.label).toBe("Cash · OMT Cash Drawer");
  });
});

describe("withCashDrawerMethods (OMT Settle Account)", () => {
  it("splits Cash in two from the bare label, keeps the rest", () => {
    const out = withCashDrawerMethods(labelCashByDrawer(METHODS, "General"), {
      system: "OMT Cash Drawer",
      general: "General",
    });
    expect(out.map((m) => [m.code, m.label])).toEqual([
      ["CASH", "Cash · OMT Cash Drawer"],
      [CASH_GENERAL_CODE, "Cash · General"],
      ["WHISH", "Whish"],
    ]);
  });
});

describe("legFromMethodCode / baseMethodCode", () => {
  it("CASH_GENERAL is a CASH leg from General; everything else passes through", () => {
    expect(legFromMethodCode(CASH_GENERAL_CODE)).toEqual({ method: "CASH", cash_drawer: "GENERAL" });
    expect(legFromMethodCode("CASH")).toEqual({ method: "CASH" });
    expect(legFromMethodCode("WHISH")).toEqual({ method: "WHISH" });
    expect(baseMethodCode(CASH_GENERAL_CODE)).toBe("CASH");
    expect(baseMethodCode("WHISH")).toBe("WHISH");
  });
});
