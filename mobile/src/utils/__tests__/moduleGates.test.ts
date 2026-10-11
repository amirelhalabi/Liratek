import {
  contentAccess,
  debtsTabVisible,
  gateFrom,
  parseEnabledModuleKeys,
  SALE_MODULE,
  sellTabVisible,
  visibleDrawers,
} from "../moduleGates";

describe("module gates — enabled module list (LIRA-307)", () => {
  it("keeps the key of every enabled module", () => {
    const keys = parseEnabledModuleKeys({
      success: true,
      modules: [{ key: "debts" }, { key: "ipec_katch", label: "x" }],
    });
    expect([...keys].sort()).toEqual(["debts", "ipec_katch"]);
  });

  it.each([
    ["success false", { success: false }],
    ["no modules", { success: true }],
    ["modules not an array", { success: true, modules: { key: "debts" } }],
    ["a key that is not a string", { success: true, modules: [{ key: 7 }] }],
    ["not an object", "oops"],
  ])("refuses any other shape (%s), so the gate stays closed", (_name, body) => {
    expect(() => parseEnabledModuleKeys(body)).toThrow();
  });
});

describe("module gates — gate state (LIRA-307)", () => {
  it("unverified: nothing is enabled", () => {
    const gate = gateFrom(undefined);
    expect(gate.verified).toBe(false);
    expect(gate.isEnabled("debts")).toBe(false);
  });

  it("verified: exactly the listed modules are enabled", () => {
    const gate = gateFrom(new Set(["debts"]));
    expect(gate.verified).toBe(true);
    expect(gate.isEnabled("debts")).toBe(true);
    expect(gate.isEnabled("ipec_katch")).toBe(false);
  });
});

describe("module gates — Sell tab (LIRA-307 US1)", () => {
  it("follows iPick/Katsh, the switch all four phone sales sit under on the web", () => {
    // frontend/src/features/recharge/types/index.ts: iPick, Katsh, WHISH_APP and OMT_APP all use module "ipec_katch".
    expect(SALE_MODULE).toBe("ipec_katch");
  });

  it("shown until the list is known (no connection hides nothing; content is gated instead)", () => {
    expect(sellTabVisible(gateFrom(undefined))).toBe(true);
  });

  it("hidden when iPick/Katsh is off", () => {
    expect(sellTabVisible(gateFrom(new Set(["debts", "omt_whish"])))).toBe(false);
  });

  it("shown when iPick/Katsh is on", () => {
    expect(sellTabVisible(gateFrom(new Set(["ipec_katch"])))).toBe(true);
  });
});

describe("module gates — Debts tab (LIRA-307 US2)", () => {
  it("shown until the list is known", () => {
    expect(debtsTabVisible(gateFrom(undefined))).toBe(true);
  });

  it("hidden when Accounts is off", () => {
    expect(debtsTabVisible(gateFrom(new Set(["ipec_katch"])))).toBe(false);
  });

  it("shown when Accounts is on", () => {
    expect(debtsTabVisible(gateFrom(new Set(["debts"])))).toBe(true);
  });
});

describe("module gates — Home drawer lines (LIRA-307 US3)", () => {
  const DRAWERS = ["Whish_App", "OMT_App", "Binance", "Katsh", "iPick", "General", "Mystery"];

  it("unverified: drawers a module owns are hidden, the rest stay", () => {
    expect(visibleDrawers(DRAWERS, gateFrom(undefined))).toEqual(["General", "Mystery"]);
  });

  it("verified: each drawer follows its owning module, same rule as the web Dashboard", () => {
    expect(visibleDrawers(DRAWERS, gateFrom(new Set(["binance", "ipec_katch"])))).toEqual([
      "Binance",
      "Katsh",
      "iPick",
      "General",
      "Mystery",
    ]);
  });

  it("Whish/OMT App drawers follow OMT/Whish (core DRAWER_MODULE_OWNER), not iPick/Katsh", () => {
    expect(visibleDrawers(["Whish_App", "OMT_App"], gateFrom(new Set(["omt_whish"])))).toEqual(["Whish_App", "OMT_App"]);
    expect(visibleDrawers(["Whish_App", "OMT_App"], gateFrom(new Set(["ipec_katch"])))).toEqual([]);
  });
});

describe("module gates — tab content needs a connection (LIRA-307 revision)", () => {
  it("checking: no list yet and no failure yet", () => {
    expect(contentAccess({ hasList: false, errorCode: null })).toBe("checking");
  });

  it("offline: the last check found no connection, even with a list from earlier", () => {
    expect(contentAccess({ hasList: false, errorCode: "NO_CONNECTION" })).toBe("offline");
    expect(contentAccess({ hasList: true, errorCode: "NO_CONNECTION" })).toBe("offline");
  });

  it("unavailable: connected but the check failed and nothing is known", () => {
    expect(contentAccess({ hasList: false, errorCode: "HTTP_500" })).toBe("unavailable");
  });

  it("ok: list known and the last check did not lose the connection", () => {
    expect(contentAccess({ hasList: true, errorCode: null })).toBe("ok");
    expect(contentAccess({ hasList: true, errorCode: "HTTP_500" })).toBe("ok");
  });
});
