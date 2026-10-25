import { homeDrawerOrder } from "../drawerOrder";

describe("Home drawer order", () => {
  const ALL = ["MTC", "iPick", "Whish_System", "Binance", "General", "Alfa", "OMT_App", "Katsh", "OMT_System", "Whish_App"];

  it("OMT shop: cash first, OMT System second, then wallets, vouchers, SIM credit", () => {
    expect(homeDrawerOrder(ALL, "OMT")).toEqual([
      "General",
      "OMT_System",
      "Whish_System",
      "Whish_App",
      "OMT_App",
      "Binance",
      "Katsh",
      "iPick",
      "Alfa",
      "MTC",
    ]);
  });

  it("Whish shop: Whish System is second", () => {
    expect(homeDrawerOrder(["OMT_System", "Whish_System", "General"], "WHISH")).toEqual([
      "General",
      "Whish_System",
      "OMT_System",
    ]);
  });

  it("unknown base system: General, then OMT System, then Whish System", () => {
    expect(homeDrawerOrder(["Whish_System", "OMT_System", "General"], null)).toEqual([
      "General",
      "OMT_System",
      "Whish_System",
    ]);
  });

  it("drawers it does not know go last, alphabetically, never dropped", () => {
    expect(homeDrawerOrder(["Zeta", "General", "Alpha", "MTC"], "OMT")).toEqual(["General", "MTC", "Alpha", "Zeta"]);
  });
});
