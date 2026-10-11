/**
 * LIRA-306 T029 — actor policy (O-new-7, FR-023, owner-approved G0): replayed
 * work is credited to the user who did it on the PC; that user must belong
 * to the shop and hold a role the channel allows (the IPC handler's roles);
 * a user switched off since is still booked, with a note.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { offlineActorPolicy } from "../actorPolicy";
import { installReplayDb, uninstallReplayDb } from "../testHelpers/replayHarness";

let db: Database.Database;
beforeEach(() => {
  ({ db } = installReplayDb()); // users 1 admin, 2 staff (tenant 1)
  db.exec(`INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (3, 2, 'other', '', 'admin', 1)`);
});
afterEach(() => uninstallReplayDb(db));

const check = (user: number, channel: string) => runWithTenant(1, () => offlineActorPolicy()(user, channel));

describe("offlineActorPolicy", () => {
  it("allows a shop user whose role the channel allows", () => {
    expect(check(2, "sales:process")).toMatchObject({ ok: true, username: "cashier", role: "staff" });
    expect(check(1, "transactions:void")).toMatchObject({ ok: true, role: "admin" });
  });

  it("refuses a role the channel does not allow", () => {
    expect(check(2, "transactions:void")).toMatchObject({ ok: false });
  });

  it("refuses a user of another shop or an unknown user", () => {
    expect(check(3, "sales:process")).toMatchObject({ ok: false });
    expect(check(999, "sales:process")).toMatchObject({ ok: false });
  });

  it("books a switched-off user with a user_switched_off note", () => {
    db.exec(`UPDATE users SET is_active = 0 WHERE id = 2`);
    expect(check(2, "sales:process")).toMatchObject({ ok: true, note: { kind: "user_switched_off" } });
  });
});
