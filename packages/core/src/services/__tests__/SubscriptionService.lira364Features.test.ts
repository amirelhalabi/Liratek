/**
 * LIRA-364 — per-shop opt-in features, switched by super admin in the Plan
 * window. The opposite default of modules: NO list means NOTHING is on, and
 * a broken value reads as off (an opt-in feature must never switch itself on).
 *
 * RULE 17 — written before enabled_features / isFeatureEnabled existed.
 */
import type Database from "better-sqlite3";
import { SubscriptionRepository } from "../../repositories/SubscriptionRepository.js";
import { SubscriptionService, toDesktopView } from "../SubscriptionService.js";
import {
  installWarrantyTestDb,
  uninstallWarrantyTestDb,
} from "../../repositories/testHelpers/warrantyDb.js";

describe("SubscriptionService — opt-in features (LIRA-364)", () => {
  let db: Database.Database;
  let service: SubscriptionService;

  beforeEach(() => {
    db = installWarrantyTestDb();
    service = new SubscriptionService(new SubscriptionRepository(db));
  });

  afterEach(() => uninstallWarrantyTestDb(db));

  it("is off by default", () => {
    expect(service.isFeatureEnabled(1, "kpi_snapshots")).toBe(false);
    expect(service.statusFor(1)?.enabledFeatures).toEqual([]);
  });

  it("super admin switches it on and off", () => {
    service.setEnabledFeatures(1, ["kpi_snapshots"]);
    expect(service.isFeatureEnabled(1, "kpi_snapshots")).toBe(true);
    expect(service.statusFor(1)?.enabledFeatures).toEqual(["kpi_snapshots"]);

    service.setEnabledFeatures(1, []);
    expect(service.isFeatureEnabled(1, "kpi_snapshots")).toBe(false);
  });

  it("drops unknown feature keys", () => {
    service.setEnabledFeatures(1, ["kpi_snapshots", "made_up"]);
    expect(service.statusFor(1)?.enabledFeatures).toEqual(["kpi_snapshots"]);
  });

  it("a broken stored value reads as off", () => {
    db.prepare(
      `UPDATE tenant_subscriptions SET enabled_features = 'not json' WHERE tenant_id = 1`,
    ).run();
    expect(service.isFeatureEnabled(1, "kpi_snapshots")).toBe(false);
  });

  it("a shop with no subscription row has it off", () => {
    expect(service.isFeatureEnabled(999, "kpi_snapshots")).toBe(false);
  });

  it("switching it does not touch the module allowlist", () => {
    service.setEntitledModules(1, ["pos"]);
    service.setEnabledFeatures(1, ["kpi_snapshots"]);
    expect(service.statusFor(1)?.entitledModules).toEqual(["pos"]);
  });

  it("the desktop licence answer carries it, so a desktop shop follows the switch", () => {
    service.setEnabledFeatures(1, ["kpi_snapshots"]);
    expect(toDesktopView(service.statusFor(1)!).enabledFeatures).toEqual([
      "kpi_snapshots",
    ]);
  });
});
