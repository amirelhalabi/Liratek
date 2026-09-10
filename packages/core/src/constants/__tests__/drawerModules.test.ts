import {
  isDrawerVisible,
  moduleOwningDrawer,
  drawersOwnedByModule,
  isRechargeModuleKey,
  RECHARGE_MODULE_KEYS,
  UNGATED_DRAWERS,
  DRAWER_MODULE_OWNER,
} from "../drawerModules.js";
import { PRIMARY_CASH_DRAWER_NAMES } from "../systemFloatDrawers.js";

/**
 * Which module owns which drawer.
 *
 * This mapping existed in four hand-written copies (dashboard cards, the setup
 * wizard's opening balances, the in-app opening-balance modal, and the
 * Settings table) and all four said the OMT and Whish drawers belonged to
 * `ipec_katch`. They belong to `omt_whish`, which is enabled by default — so
 * every tenant with iPick/Katsh off lost four drawers to a module they had
 * switched on. `ipec_katch` ships DISABLED from seedConfig, so that was every
 * web-provisioned tenant.
 *
 * Two of those copies decide which drawers the operator is asked to COUNT,
 * which is why this is not a cosmetic matter.
 */
describe("drawer → module ownership", () => {
  /** The state every web-provisioned tenant starts in (seedConfig defaults). */
  const freshTenant = (key: string) =>
    !["recharge", "ipec_katch", "binance"].includes(key);

  const allOff = () => false;

  describe("till cash is never hidden", () => {
    it.each([...UNGATED_DRAWERS])(
      "%s stays visible with every module disabled",
      (drawer) => {
        // FEATURE_GUIDE §235: the primary cash drawers hold "the banknotes
        // physically inside the dedicated money-transfer drawer at the
        // counter". A feature flag cannot make that money stop existing, and
        // a drawer that is never offered is never counted at closing.
        expect(isDrawerVisible(drawer, allOff)).toBe(true);
        expect(moduleOwningDrawer(drawer)).toBeNull();
      },
    );

    it("covers General and BOTH primary cash drawers", () => {
      // Derived from PRIMARY_CASH_DRAWER_NAMES rather than retyped, so the two
      // lists cannot drift.
      expect(UNGATED_DRAWERS).toEqual(
        expect.arrayContaining(["General", ...PRIMARY_CASH_DRAWER_NAMES]),
      );
    });

    it("OMT_System is offered for counting on a fresh tenant", () => {
      // THE MONEY BUG, stated plainly. `ipec_katch` is off by default, and the
      // old mapping gated OMT_System on it — so the shop was never asked for
      // its counter drawer's opening balance, leaving no starting checkpoint
      // for closing to reconcile against.
      expect(isDrawerVisible("OMT_System", freshTenant)).toBe(true);
      expect(isDrawerVisible("Whish_System", freshTenant)).toBe(true);
    });
  });

  describe("app wallets follow their own module", () => {
    it("OMT/Whish app wallets belong to omt_whish, not ipec_katch", () => {
      expect(moduleOwningDrawer("OMT_App")).toBe("omt_whish");
      expect(moduleOwningDrawer("Whish_App")).toBe("omt_whish");
    });

    it("shows them when omt_whish is on even though ipec_katch is off", () => {
      // Exactly the reported symptom: the OMT/Whish module was enabled and its
      // drawers were hidden anyway.
      expect(isDrawerVisible("OMT_App", freshTenant)).toBe(true);
      expect(isDrawerVisible("Whish_App", freshTenant)).toBe(true);
    });

    it("hides them when omt_whish itself is off", () => {
      const omtOff = (k: string) => k !== "omt_whish";
      expect(isDrawerVisible("OMT_App", omtOff)).toBe(false);
      // ...but the physical drawer is still counted.
      expect(isDrawerVisible("OMT_System", omtOff)).toBe(true);
    });
  });

  describe("provider drawers still follow their provider", () => {
    it.each([
      ["iPick", "ipec_katch"],
      ["Katsh", "ipec_katch"],
      ["MTC", "recharge"],
      ["Alfa", "recharge"],
      ["Binance", "binance"],
    ])("%s is owned by %s", (drawer, owner) => {
      expect(moduleOwningDrawer(drawer)).toBe(owner);
      expect(isDrawerVisible(drawer, (k) => k === owner)).toBe(true);
      expect(isDrawerVisible(drawer, (k) => k !== owner)).toBe(false);
    });

    it("hides the genuinely-disabled providers on a fresh tenant", () => {
      // The fix must not turn everything on — these are correctly off.
      for (const d of ["iPick", "Katsh", "MTC", "Alfa", "Binance"]) {
        expect(isDrawerVisible(d, freshTenant)).toBe(false);
      }
    });
  });

  it("shows an unrecognised drawer rather than hiding it", () => {
    // Safe direction: a drawer nobody knows about may still hold money. An
    // unexpected card is a question; an invisible one is a loss.
    expect(moduleOwningDrawer("Some_New_Drawer")).toBeNull();
    expect(isDrawerVisible("Some_New_Drawer", allOff)).toBe(true);
  });

  it("never lists a primary cash drawer as module-owned", () => {
    // The single guard against this whole class of bug returning: if someone
    // adds OMT_System to DRAWER_MODULE_OWNER, this fails.
    for (const pcd of PRIMARY_CASH_DRAWER_NAMES) {
      expect(DRAWER_MODULE_OWNER[pcd]).toBeUndefined();
    }
  });

  describe("recharge grouping", () => {
    it("groups exactly the three provider modules", () => {
      expect([...RECHARGE_MODULE_KEYS]).toEqual([
        "recharge",
        "ipec_katch",
        "binance",
      ]);
    });

    it("excludes omt_whish — it is a peer module, not a recharge provider", () => {
      // Treating it as one is the same category error the ownership table
      // above corrects; the sidebar/HomeGrid/Settings/wizard all read this.
      expect(isRechargeModuleKey("omt_whish")).toBe(false);
      expect(isRechargeModuleKey("ipec_katch")).toBe(true);
    });
  });

  it("reports the drawers a module owns", () => {
    // Drives the "Drawers: …" line in Settings, so it must agree with the
    // ownership table rather than a second hand-written list.
    expect(drawersOwnedByModule("omt_whish").sort()).toEqual([
      "OMT_App",
      "Whish_App",
    ]);
    expect(drawersOwnedByModule("recharge").sort()).toEqual(["Alfa", "MTC"]);
    expect(drawersOwnedByModule("pos")).toEqual([]);
  });
});
