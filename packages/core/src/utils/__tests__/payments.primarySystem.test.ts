/**
 * LIRA-304 T008/T009 — the one primary-system predicate and the one
 * `shop_base_system` reader new code uses.
 */
import { isPrimarySystemProvider } from "../payments";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  setBaseSystem,
} from "../../repositories/testHelpers/debtItemDb";
import {
  getSettingsRepository,
  resetSettingsRepository,
} from "../../repositories/SettingsRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

describe("isPrimarySystemProvider", () => {
  it.each([
    ["OMT", "OMT", true],
    ["WHISH", "WHISH", true],
    ["WHISH", "OMT", false], // secondary system
    ["OMT", "WHISH", false],
    ["WHISH_APP", "WHISH", false], // Whish App is not Whish system
    ["OMT_APP", "OMT", false],
    ["BINANCE", "OMT", false],
    ["Katsh", "OMT", false],
    [null, "OMT", false],
  ] as const)("%s in a %s shop → %s", (provider, base, expected) => {
    expect(isPrimarySystemProvider(provider, base)).toBe(expected);
  });
});

describe("SettingsRepository.getShopBaseSystem", () => {
  it("defaults to OMT and follows the setting", () => {
    const db = installDebtItemTestDb();
    initFixedTenantContext(1);
    resetSettingsRepository();
    try {
      expect(getSettingsRepository().getShopBaseSystem()).toBe("OMT");
      setBaseSystem(db, "WHISH");
      expect(getSettingsRepository().getShopBaseSystem()).toBe("WHISH");
    } finally {
      resetSettingsRepository();
      resetTenantContext();
      uninstallDebtItemTestDb(db);
    }
  });
});
