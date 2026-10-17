/**
 * LIRA-332 US3 (FR-022) — the owner's per-shop subscription history: the
 * PLATFORM audit rows (`tenant_id IS NULL`) written by
 * `AuditService.logAdminAction` with `entity_type 'subscription'` for that
 * target shop, newest first, at most 50. Shop-note copies, other shops and
 * other entity types are excluded.
 *
 * Not proven failing-first (new contract).
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runWithoutTenant } from "../../db/tenantContext.js";
import { getAuditService, resetAuditService } from "../../services/AuditService.js";
import { getAuditRepository, resetAuditRepository } from "../AuditRepository.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.exec(`INSERT INTO tenants (id, name, slug) VALUES (2, 'A', 'shopa'), (3, 'B', 'shopb');`);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  resetAuditRepository();
  resetAuditService();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function act(targetTenantId: number, action: string, entityType = "subscription", n = 0) {
  getAuditService().logAdminAction({
    actorUserId: 1,
    actorUsername: "root",
    actorRole: "super_admin",
    action,
    entityType,
    entityId: String(targetTenantId),
    summary: `${action} #${n}`,
    oldValues: { standing: "trial", n },
    newValues: { standing: "active", n },
    targetTenantId,
  });
}

describe("listSubscriptionHistory", () => {
  it("returns only shop A's platform subscription rows, newest first", () => {
    act(2, "extend_trial", "subscription", 1);
    act(3, "activate_subscription", "subscription", 2); // other shop
    act(2, "suspend", "tenant", 3); // other entity type
    act(2, "activate_subscription", "subscription", 4);

    const rows = runWithoutTenant(() =>
      getAuditRepository().listSubscriptionHistory(2, 50),
    );
    expect(rows.map((r) => r.action)).toEqual([
      "activate_subscription",
      "extend_trial",
    ]);
    // The shop-note copy (tenant_id = 2) is never returned twice.
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0]!.new_values!)).toEqual({ standing: "active", n: 4 });
  });

  it("is capped at the limit", () => {
    for (let i = 0; i < 55; i += 1) act(2, "extend_trial", "subscription", i);
    const rows = runWithoutTenant(() =>
      getAuditRepository().listSubscriptionHistory(2, 50),
    );
    expect(rows).toHaveLength(50);
    expect(JSON.parse(rows[0]!.new_values!).n).toBe(54);
  });

  it("AuditService.subscriptionHistory maps rows for the owner screen", () => {
    act(2, "extend_trial", "subscription", 7);
    const entries = getAuditService().subscriptionHistory(2);
    expect(entries).toEqual([
      {
        at: expect.any(String),
        actor: "root",
        action: "extend_trial",
        summary: "extend_trial #7",
        oldValues: { standing: "trial", n: 7 },
        newValues: { standing: "active", n: 7 },
      },
    ]);
  });
});
