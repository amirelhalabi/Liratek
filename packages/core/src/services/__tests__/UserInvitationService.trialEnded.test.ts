/**
 * LIRA-332 US2 — an invite link into a shop whose free trial has ended is
 * refused (accepting would create a user, a new record), with the TRIAL
 * wording, never the lapsed-subscription wording. The code stays
 * SHOP_NOT_ACTIVE for compatibility, and the link stays usable for after
 * activation.
 *
 * Production wiring: the singleton (`getUserInvitationService`) over the real
 * SubscriptionService, one in-memory database from create_db.sql. Only the
 * system time is faked.
 *
 * Failing-first: the refusal itself already happened once `canWrite` became
 * false for trial_ended (T011), but both wording assertions failed before
 * T039 (they got "Ask the shop owner to renew").
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext.js";
import {
  getUserInvitationService,
  resetUserInvitationService,
} from "../UserInvitationService.js";
import { resetSubscriptionService } from "../SubscriptionService.js";
import { resetSubscriptionRepository } from "../../repositories/SubscriptionRepository.js";
import { resetSigninDirectoryService } from "../SigninDirectoryService.js";
import { resetSigninDirectoryRepository } from "../../repositories/SigninDirectoryRepository.js";
import { USER_ACCOUNT_CODES } from "../../constants/userAccountCodes.js";
import { hashToken } from "../../utils/crypto.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const NOW = "2026-11-03T10:00:00.000Z"; // after the 2026-11-01 last day
let db: Database.Database;

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date(NOW),
    doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"],
  });
  resetSigninDirectoryService();
  resetSigninDirectoryRepository();
  resetSubscriptionRepository();
  resetSubscriptionService();
  resetUserInvitationService();
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_DB_SQL);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active)
      VALUES (20, 2, 'boss', 'x', 'admin', 1);
    INSERT INTO tenant_subscriptions (tenant_id, plan, status, trial_started_at, trial_ends_at)
      VALUES (2, 'standard', 'active', '2026-10-19 09:00:00', '2026-11-01 22:00:00');
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
});

afterEach(() => {
  jest.useRealTimers();
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

/** An invite created while the trial was still running. */
function seedInvite(token: string): void {
  db.prepare(
    `INSERT INTO user_invitations (tenant_id, email, role, token_hash, invited_by_user_id, expires_at, created_at)
     VALUES (2, 'rami@gmail.com', 'staff', ?, 20, '2026-11-10T00:00:00.000Z', '2026-11-01T09:00:00.000Z')`,
  ).run(hashToken(token));
}

function refusal(fn: () => unknown): { code?: string; message?: string } {
  try {
    fn();
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  return {};
}

const TRIAL_TEXT =
  "This shop's free trial has ended. Its admin can contact LiraTek to activate.";

describe("invite links into a trial-ended shop", () => {
  it("check is refused with the trial wording (code SHOP_NOT_ACTIVE kept)", () => {
    seedInvite("tok-check");
    const err = refusal(() =>
      runWithTenant(2, () => getUserInvitationService().check("tok-check", NOW, 2)),
    );
    expect(err.code).toBe(USER_ACCOUNT_CODES.SHOP_NOT_ACTIVE);
    expect(err.message).toBe(TRIAL_TEXT);
    expect(err.message).not.toMatch(/renew|lapsed|overdue|read-only/i);
  });

  it("accept is refused, creates no user, and leaves the link usable", () => {
    seedInvite("tok-accept");
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
    const err = refusal(() =>
      runWithTenant(2, () =>
        getUserInvitationService().accept({
          token: "tok-accept",
          username: "rami",
          password: "Str0ng-Password!",
          now: NOW,
          requiredTenantId: 2,
        }),
      ),
    );
    expect(err.code).toBe(USER_ACCOUNT_CODES.SHOP_NOT_ACTIVE);
    expect(err.message).toBe(TRIAL_TEXT);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n).toBe(before);
    expect(
      db.prepare(`SELECT claimed_at, used_at FROM user_invitations`).get(),
    ).toEqual({ claimed_at: null, used_at: null });
  });
});
