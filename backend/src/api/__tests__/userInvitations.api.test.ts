/**
 * /api/user-invitations (LIRA-281, feature B — contract B in
 * SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md).
 *
 * Supertest over a REAL in-memory SQLite database built from
 * electron-app/create_db.sql: routes, services, repositories, the audit write
 * and the auth middleware all run for real. Only `isEmailConfigured` is
 * stubbed so EMAIL_NOT_CONFIGURED can be toggled.
 *
 * Request bodies are parsed through the core schemas before they are sent
 * (rule 24), so a renamed field fails here rather than silently.
 *
 * Hosts: APP_BASE_DOMAIN=liratek.test. Requests without a Host header arrive
 * on 127.0.0.1 ("foreign": host tenancy inactive); `onShop(slug)` sends the
 * shop's own subdomain.
 */

import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

/** LIRA-288: "Join with Google" needs Google configured; toggled here so
 * the real ticket signing in security/googleOAuth.ts still runs. */
let googleOn = true;
jest.mock("../../security/googleOAuth.js", () => {
  const actual = jest.requireActual<typeof import("../../security/googleOAuth.js")>(
    "../../security/googleOAuth.js",
  );
  return {
    ...actual,
    googleConfig: () =>
      googleOn
        ? {
            clientId: "cid",
            clientSecret: "secret",
            platformBaseUrl: "https://www.liratek.test",
            redirectUri: "https://www.liratek.test/api/auth/google/callback",
          }
        : null,
  };
});

let emailConfigured = true;
jest.mock("../../email/createTransport.js", () => ({
  isEmailConfigured: () => emailConfigured,
  createTransport: () => {
    throw new Error("not used in this suite");
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

const PASSWORD = "Password123!";
const NEW_PASSWORD = "Newpass123!";
const BASE = "/api/user-invitations";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");

function host(slug: string): string {
  return `${slug}.liratek.test`;
}

async function loginToken(username: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

function count(sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function createBody(input: { email: string; role: "admin" | "staff" }) {
  expect(core.createUserInvitationSchema.safeParse(input).success).toBe(true);
  return input;
}

function acceptBody(input: { token: string; username: string; password: string }) {
  // The schema is parsed only for the field NAMES (a weak password is a
  // deliberate test case), so check the key set, not success.
  const shape = core.acceptUserInvitationSchema.shape;
  expect(Object.keys(input).sort()).toEqual(Object.keys(shape).sort());
  return input;
}

/** The raw token from the newest queued user-invite email to `to`. */
function tokenFromOutbox(to: string): { token: string; url: string; key: string } {
  const row = db
    .prepare(
      `SELECT data_json, idempotency_key FROM email_outbox
        WHERE template = 'user-invite' AND to_email = ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(to) as { data_json: string; idempotency_key: string } | undefined;
  expect(row).toBeDefined();
  const url = (JSON.parse(row!.data_json) as { inviteUrl: string }).inviteUrl;
  const token = new URLSearchParams(new URL(url).hash.split("?")[1] ?? "").get(
    "invite",
  )!;
  return { token, url, key: row!.idempotency_key };
}

async function invite(
  adminToken: string,
  email: string,
  role: "admin" | "staff" = "staff",
) {
  return request(app)
    .post(BASE)
    .set("Authorization", `Bearer ${adminToken}`)
    .send(createBody({ email, role }));
}

beforeAll(async () => {
  process.env.JWT_SECRET = "user-invitations-test-secret-0123456789-0123456789";
  process.env.APP_BASE_DOMAIN = "liratek.test";
  // Every public link route in this file shares ONE per-IP limiter (30 an
  // hour by default); the suite makes more calls than that from one IP.
  process.env.USER_INVITE_LINK_RATE_LIMIT_MAX = "1000";

  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;

  core = await import("@liratek/core");
  db.exec(
    fs.readFileSync(
      path.join(__dirname, "../../../../electron-app/create_db.sql"),
      "utf8",
    ),
  );
  const hash = core.hashPassword(PASSWORD);
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Cell City', 'cellcity', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (3, 'Fone Fix', 'fonefix', 'active')`,
  ).run();
  const insertUser = db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active, email)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertUser.run(2, "cell_admin", hash, "admin", 1, "owner@cellcity.test");
  insertUser.run(2, "cell_staff", hash, "staff", 1, null);
  insertUser.run(2, "cell_gone", hash, "staff", 0, "gone@cellcity.test");
  insertUser.run(3, "fone_admin", hash, "admin", 1, null);

  core.resetUserRepository();
  core.resetSessionRepository();
  core.resetAuthService();
  core.resetTenantRepository();
  core.resetAuditRepository();
  core.resetAuditService();
  core.resetEmailOutboxRepository();
  core.resetUserInvitationRepository();
  core.resetUserInvitationService();
  core.resetSubscriptionRepository();
  core.resetSubscriptionService();

  const authRoutes = (await import("../auth")).default;
  const userInvitationRoutes = (await import("../userInvitations")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/user-invitations", userInvitationRoutes);
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  core.resetTenantContext();
  emailConfigured = true;
  googleOn = true;
  db.exec(
    `DELETE FROM user_invitations; DELETE FROM email_outbox; DELETE FROM tenant_subscriptions WHERE tenant_id IN (2, 3);`,
  );
  db.exec(
    `DELETE FROM users WHERE username NOT IN ('cell_admin','cell_staff','cell_gone','fone_admin')`,
  );
});

describe("POST /api/user-invitations (admin)", () => {
  it("401 without a token, 403 for staff", async () => {
    expect(
      (await request(app).post(BASE).send(createBody({ email: "a@b.co", role: "staff" })))
        .status,
    ).toBe(401);
    const staff = await loginToken("cell_staff");
    expect((await invite(staff, "a@b.co")).status).toBe(403);
    expect(count(`SELECT COUNT(*) AS n FROM user_invitations`)).toBe(0);
  });

  it("a role the schema does not allow is refused (validateRequest: 200 + success:false) and writes nothing", async () => {
    const admin = await loginToken("cell_admin");
    const res = await request(app)
      .post(BASE)
      .set("Authorization", `Bearer ${admin}`)
      .send({ email: "a@b.co", role: "super_admin" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(count(`SELECT COUNT(*) AS n FROM user_invitations`)).toBe(0);
  });

  it("creates the invite in the admin's shop and queues the email in the same write", async () => {
    const admin = await loginToken("cell_admin");
    const res = await invite(admin, "  New.Hire@Example.com ", "admin");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const view = res.body.data.invitation as Record<string, unknown>;
    expect(view).toMatchObject({
      email: "new.hire@example.com",
      role: "admin",
      status: "pending",
      usedAt: null,
      usedByUserId: null,
      revokedAt: null,
      emailDelivery: { status: "queued", attempts: 0, lastError: null, sentAt: null },
    });

    const stored = db
      .prepare(`SELECT tenant_id, invited_by_user_id, token_hash, email_outbox_id FROM user_invitations`)
      .get() as {
      tenant_id: number;
      invited_by_user_id: number;
      token_hash: string;
      email_outbox_id: number;
    };
    const adminId = (
      db.prepare(`SELECT id FROM users WHERE username='cell_admin'`).get() as { id: number }
    ).id;
    expect(stored.tenant_id).toBe(2);
    expect(stored.invited_by_user_id).toBe(adminId);
    expect(stored.email_outbox_id).not.toBeNull();

    const { token, url, key } = tokenFromOutbox("new.hire@example.com");
    expect(url.startsWith("https://cellcity.liratek.test/#/join?invite=")).toBe(true);
    expect(stored.token_hash).toBe(core.hashToken(token));
    // Idempotency key carries the shop (ids repeat across per-tenant files).
    expect(key).toBe(`user-invite:2:${view.id}`);
    const data = JSON.parse(
      (db.prepare(`SELECT data_json FROM email_outbox`).get() as { data_json: string })
        .data_json,
    ) as Record<string, string>;
    expect(data.shopName).toBe("Cell City");
    expect(data.roleText).toBe("an admin");
    expect(data.expiresAtText).toMatch(/ UTC$/);

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(core.hashToken(token));

    const audit = db
      .prepare(`SELECT tenant_id, action, user_id FROM audit_log WHERE action = 'user_invitation.create'`)
      .get() as { tenant_id: number; action: string; user_id: number } | undefined;
    expect(audit).toMatchObject({ tenant_id: 2, user_id: adminId });
  });

  it("refuses an address a user of this shop already has — active or deactivated — but allows it in another shop", async () => {
    const admin = await loginToken("cell_admin");
    for (const email of ["owner@cellcity.test", "gone@cellcity.test"]) {
      const res = await invite(admin, email);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("EMAIL_TAKEN_IN_SHOP");
    }
    const fone = await loginToken("fone_admin");
    const ok = await invite(fone, "owner@cellcity.test");
    expect(ok.body.success).toBe(true);
  });

  it("EMAIL_NOT_CONFIGURED (200) when there is no mail transport — nothing is written", async () => {
    emailConfigured = false;
    const admin = await loginToken("cell_admin");
    const res = await invite(admin, "a@b.co");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, error: { code: "EMAIL_NOT_CONFIGURED" } });
    expect(count(`SELECT COUNT(*) AS n FROM user_invitations`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM email_outbox`)).toBe(0);
  });

  it("RATE_LIMITED after 20 invites in 24 hours", async () => {
    const admin = await loginToken("cell_admin");
    for (let i = 0; i < core.USER_INVITE_DAILY_LIMIT; i++) {
      expect((await invite(admin, `p${i}@b.co`)).body.success).toBe(true);
    }
    const res = await invite(admin, "one.more@b.co");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, error: { code: "RATE_LIMITED" } });
  });

  it("a second invite to the same address revokes the first link", async () => {
    const admin = await loginToken("cell_admin");
    await invite(admin, "twice@b.co");
    const first = tokenFromOutbox("twice@b.co").token;
    await invite(admin, "twice@b.co");
    const check = await request(app)
      .post(`${BASE}/check`)
      .send({ token: first });
    expect(check.body.success).toBe(false);
  });
});

describe("GET /api/user-invitations (admin)", () => {
  it("lists only this shop's invites, with emailConfigured, never the hash", async () => {
    const cell = await loginToken("cell_admin");
    const fone = await loginToken("fone_admin");
    await invite(cell, "c1@b.co");
    await invite(fone, "f1@b.co");

    const res = await request(app).get(BASE).set("Authorization", `Bearer ${cell}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.emailConfigured).toBe(true);
    const emails = (res.body.data.invitations as { email: string }[]).map((i) => i.email);
    expect(emails).toEqual(["c1@b.co"]);
    expect(JSON.stringify(res.body)).not.toMatch(/token_hash|tokenHash/);

    const staff = await loginToken("cell_staff");
    expect((await request(app).get(BASE).set("Authorization", `Bearer ${staff}`)).status).toBe(403);
  });
});

describe("POST /api/user-invitations/:id/revoke and /:id/resend", () => {
  it("revoke refuses the link; repeating is harmless and audited once", async () => {
    const admin = await loginToken("cell_admin");
    const id = (await invite(admin, "rev@b.co")).body.data.invitation.id as number;
    const { token } = tokenFromOutbox("rev@b.co");

    const res = await request(app)
      .post(`${BASE}/${id}/revoke`)
      .set("Authorization", `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.data.invitation.status).toBe("revoked");
    await request(app).post(`${BASE}/${id}/revoke`).set("Authorization", `Bearer ${admin}`);
    expect(
      count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user_invitation.revoke'`),
    ).toBe(1);

    expect((await request(app).post(`${BASE}/check`).send({ token })).body.success).toBe(false);
  });

  it("another shop's invite id is NOT_FOUND", async () => {
    const cell = await loginToken("cell_admin");
    const fone = await loginToken("fone_admin");
    const id = (await invite(cell, "x@b.co")).body.data.invitation.id as number;
    for (const action of ["revoke", "resend"]) {
      const res = await request(app)
        .post(`${BASE}/${id}/${action}`)
        .set("Authorization", `Bearer ${fone}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    }
  });

  it("resend issues a NEW invite with the same email and role; the old link stops working", async () => {
    const admin = await loginToken("cell_admin");
    const oldId = (await invite(admin, "again@b.co", "admin")).body.data.invitation.id as number;
    const oldToken = tokenFromOutbox("again@b.co").token;

    const res = await request(app)
      .post(`${BASE}/${oldId}/resend`)
      .set("Authorization", `Bearer ${admin}`);
    expect(res.body.success).toBe(true);
    const fresh = res.body.data.invitation as { id: number; email: string; role: string };
    expect(fresh.id).not.toBe(oldId);
    expect(fresh).toMatchObject({ email: "again@b.co", role: "admin" });

    const newToken = tokenFromOutbox("again@b.co").token;
    expect(newToken).not.toBe(oldToken);
    expect((await request(app).post(`${BASE}/check`).send({ token: oldToken })).body.success).toBe(false);
    expect((await request(app).post(`${BASE}/check`).send({ token: newToken })).body.success).toBe(true);
  });

  it("a used invite cannot be revoked (USER_INVITATION_USED)", async () => {
    const admin = await loginToken("cell_admin");
    const id = (await invite(admin, "used@b.co")).body.data.invitation.id as number;
    const { token } = tokenFromOutbox("used@b.co");
    await request(app)
      .post(`${BASE}/accept`)
      .send(acceptBody({ token, username: "used_one", password: NEW_PASSWORD }));
    const res = await request(app)
      .post(`${BASE}/${id}/revoke`)
      .set("Authorization", `Bearer ${admin}`);
    expect(res.body).toMatchObject({ success: false, error: { code: "USER_INVITATION_USED" } });
  });
});

describe("POST /api/user-invitations/check (public)", () => {
  it("shows email, role, shop name and expiry for a usable link", async () => {
    const admin = await loginToken("cell_admin");
    await invite(admin, "look@b.co", "staff");
    const { token } = tokenFromOutbox("look@b.co");
    const res = await request(app)
      .post(`${BASE}/check`)
      .set("Host", host("cellcity"))
      .send({ token });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      email: "look@b.co",
      role: "staff",
      shopName: "Cell City",
    });
    expect(typeof res.body.data.expiresAt).toBe("string");
  });

  it("one generic 200 refusal for an unknown token, and for another shop's host", async () => {
    const admin = await loginToken("cell_admin");
    await invite(admin, "look@b.co");
    const { token } = tokenFromOutbox("look@b.co");

    const unknown = await request(app).post(`${BASE}/check`).send({ token: "nope" });
    const wrongShop = await request(app)
      .post(`${BASE}/check`)
      .set("Host", host("fonefix"))
      .send({ token });
    const platform = await request(app)
      .post(`${BASE}/check`)
      .set("Host", "www.liratek.test")
      .send({ token });
    for (const res of [unknown, wrongShop, platform]) {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe(core.USER_INVITE_INVALID_MESSAGE);
    }
  });
});

describe("POST /api/user-invitations/accept (public)", () => {
  it("creates the user in the invite's shop with the invite's role and a VERIFIED email, then the link is spent", async () => {
    const admin = await loginToken("cell_admin");
    await invite(admin, "joiner@b.co", "admin");
    const { token } = tokenFromOutbox("joiner@b.co");

    const res = await request(app)
      .post(`${BASE}/accept`)
      .set("Host", host("cellcity"))
      .send(acceptBody({ token, username: "  joiner ", password: NEW_PASSWORD }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.loginUrl).toBe("https://cellcity.liratek.test");

    const user = db
      .prepare(
        `SELECT id, tenant_id, role, email, email_verified_at, is_active FROM users WHERE username = 'joiner'`,
      )
      .get() as {
      id: number;
      tenant_id: number;
      role: string;
      email: string;
      email_verified_at: string | null;
      is_active: number;
    };
    expect(user).toMatchObject({ tenant_id: 2, role: "admin", email: "joiner@b.co", is_active: 1 });
    expect(user.email_verified_at).not.toBeNull();

    const inv = db
      .prepare(`SELECT used_at, used_by_user_id, claimed_at FROM user_invitations`)
      .get() as { used_at: string | null; used_by_user_id: number | null };
    expect(inv.used_at).not.toBeNull();
    expect(inv.used_by_user_id).toBe(user.id);

    expect(
      count(
        `SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = 2 AND entity_type = 'user' AND action = 'create' AND user_id = ?`,
        user.id,
      ),
    ).toBe(1);

    // The new account can sign in on its shop.
    const login = await request(app)
      .post("/api/auth/login")
      .set("Host", host("cellcity"))
      .send({ username: "joiner", password: NEW_PASSWORD });
    expect(login.status).toBe(200);

    // Spent.
    const again = await request(app)
      .post(`${BASE}/accept`)
      .send(acceptBody({ token, username: "joiner2", password: NEW_PASSWORD }));
    expect(again.status).toBe(200);
    expect(again.body.success).toBe(false);
    expect(again.body.error.message).toBe(core.USER_INVITE_INVALID_MESSAGE);
  });

  it("USERNAME_TAKEN releases the claim: the same link then works with another name", async () => {
    const admin = await loginToken("cell_admin");
    await invite(admin, "dup@b.co");
    const { token } = tokenFromOutbox("dup@b.co");

    const taken = await request(app)
      .post(`${BASE}/accept`)
      .send(acceptBody({ token, username: "cell_staff", password: NEW_PASSWORD }));
    expect(taken.status).toBe(200);
    expect(taken.body).toMatchObject({ success: false, error: { code: "USERNAME_TAKEN" } });

    const ok = await request(app)
      .post(`${BASE}/accept`)
      .send(acceptBody({ token, username: "dup_user", password: NEW_PASSWORD }));
    expect(ok.body.success).toBe(true);
  });

  it("another shop's host gets the generic refusal and does NOT spend the link", async () => {
    const admin = await loginToken("cell_admin");
    await invite(admin, "host@b.co");
    const { token } = tokenFromOutbox("host@b.co");

    const wrong = await request(app)
      .post(`${BASE}/accept`)
      .set("Host", host("fonefix"))
      .send(acceptBody({ token, username: "hosty", password: NEW_PASSWORD }));
    expect(wrong.body.success).toBe(false);
    expect(wrong.body.error.message).toBe(core.USER_INVITE_INVALID_MESSAGE);
    expect(count(`SELECT COUNT(*) AS n FROM users WHERE username = 'hosty'`)).toBe(0);

    const right = await request(app)
      .post(`${BASE}/accept`)
      .set("Host", host("cellcity"))
      .send(acceptBody({ token, username: "hosty", password: NEW_PASSWORD }));
    expect(right.body.success).toBe(true);
  });

  it("a weak password is refused (200 + success:false) and creates nothing", async () => {
    const admin = await loginToken("cell_admin");
    await invite(admin, "weak@b.co");
    const { token } = tokenFromOutbox("weak@b.co");
    const res = await request(app)
      .post(`${BASE}/accept`)
      .send(acceptBody({ token, username: "weakling", password: "short" }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(count(`SELECT COUNT(*) AS n FROM users WHERE username = 'weakling'`)).toBe(0);
  });
});

// A shop whose subscription has lapsed to read_only must not gain users
// through an invite sent before the lapse. The link is not spent: once the
// shop renews (before the link expires) it works again.
describe("an invite into a LAPSED (read-only) shop", () => {
  const SHOP_INACTIVE_MESSAGE =
    "This shop is not active right now. Ask the shop owner to renew, then use the link again.";

  function setSubscription(tenantId: number, status: "active" | "grace" | "read_only") {
    db.prepare(
      `INSERT INTO tenant_subscriptions (tenant_id, plan, status) VALUES (?, 'standard', ?)
       ON CONFLICT(tenant_id) DO UPDATE SET status = excluded.status`,
    ).run(tenantId, status);
  }

  async function pendingInvite(email: string): Promise<string> {
    const admin = await loginToken("cell_admin");
    expect((await invite(admin, email)).body.success).toBe(true);
    return tokenFromOutbox(email).token;
  }

  it("/check reports the link unusable with the renew message", async () => {
    const token = await pendingInvite("lapse.check@b.co");
    setSubscription(2, "read_only");

    const res = await request(app)
      .post(`${BASE}/check`)
      .set("Host", host("cellcity"))
      .send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "SHOP_NOT_ACTIVE", message: SHOP_INACTIVE_MESSAGE },
    });
  });

  it("/accept is refused, creates no user, and leaves the invite pending and unclaimed", async () => {
    const token = await pendingInvite("lapse.accept@b.co");
    setSubscription(2, "read_only");

    const res = await request(app)
      .post(`${BASE}/accept`)
      .set("Host", host("cellcity"))
      .send(acceptBody({ token, username: "lapsed_joiner", password: NEW_PASSWORD }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "SHOP_NOT_ACTIVE", message: SHOP_INACTIVE_MESSAGE },
    });
    expect(count(`SELECT COUNT(*) AS n FROM users WHERE username = 'lapsed_joiner'`)).toBe(0);
    const inv = db
      .prepare(`SELECT used_at, used_by_user_id, claimed_at, revoked_at FROM user_invitations`)
      .get() as Record<string, unknown>;
    expect(inv).toEqual({ used_at: null, used_by_user_id: null, claimed_at: null, revoked_at: null });
  });

  it("after the shop renews, the SAME link works again", async () => {
    const token = await pendingInvite("lapse.renew@b.co");
    setSubscription(2, "read_only");
    await request(app)
      .post(`${BASE}/accept`)
      .send(acceptBody({ token, username: "renewed_joiner", password: NEW_PASSWORD }));

    setSubscription(2, "active");
    expect((await request(app).post(`${BASE}/check`).send({ token })).body.success).toBe(true);
    const ok = await request(app)
      .post(`${BASE}/accept`)
      .send(acceptBody({ token, username: "renewed_joiner", password: NEW_PASSWORD }));
    expect(ok.body.success).toBe(true);
    expect(count(`SELECT COUNT(*) AS n FROM users WHERE username = 'renewed_joiner'`)).toBe(1);
  });

  it("an unknown token still gets the generic refusal (the lapse is not revealed for a bad link)", async () => {
    setSubscription(2, "read_only");
    const res = await request(app)
      .post(`${BASE}/check`)
      .set("Host", host("cellcity"))
      .send({ token: "nope" });
    expect(res.body.error.message).toBe(core.USER_INVITE_INVALID_MESSAGE);
  });

  it("a shop in GRACE (still fully working) is unchanged: check and accept succeed", async () => {
    const token = await pendingInvite("grace@b.co");
    setSubscription(2, "grace");
    expect((await request(app).post(`${BASE}/check`).send({ token })).body.success).toBe(true);
    const ok = await request(app)
      .post(`${BASE}/accept`)
      .send(acceptBody({ token, username: "grace_joiner", password: NEW_PASSWORD }));
    expect(ok.body.success).toBe(true);
  });
});

// ── LIRA-288: Join with Google — the start, on the invite page ────────────

describe("POST /api/user-invitations/google/start (public)", () => {
  /** Rule 24: the body's keys are the schema's own. */
  function joinBody(input: { token: string; username: string }) {
    expect(Object.keys(input).sort()).toEqual(
      Object.keys(core.joinWithGoogleStartSchema.shape).sort(),
    );
    return input;
  }

  async function pendingInvite(email: string): Promise<string> {
    const admin = await loginToken("cell_admin");
    expect((await invite(admin, email)).body.success).toBe(true);
    return tokenFromOutbox(email).token;
  }

  const start = (hostName: string | null, body: { token: string; username: string }) => {
    let req = request(app).post(`${BASE}/google/start`);
    if (hostName) req = req.set("Host", hostName);
    return req.send(joinBody(body));
  };

  it("returns the www start URL and a join ticket naming the invite, the username and the shop — and claims nothing", async () => {
    const token = await pendingInvite("google.joiner@b.co");
    const res = await start(host("cellcity"), { token, username: "  gjoiner " });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toBe("https://www.liratek.test/api/auth/google/start");
    const { readJoinTicket, verifyTicket } = jest.requireActual<
      typeof import("../../security/googleOAuth.js")
    >("../../security/googleOAuth.js");
    expect(readJoinTicket(verifyTicket("join", res.body.data.ticket))).toEqual({
      token,
      username: "gjoiner",
      tenantId: 2,
    });
    // Nothing claimed: the link is still usable.
    expect((await request(app).post(`${BASE}/check`).send({ token })).body.success).toBe(true);
  });

  it("refuses an unusable link (unknown, another shop's host) with INVITE_INVALID", async () => {
    const token = await pendingInvite("google.bad@b.co");
    for (const res of [
      await start(host("cellcity"), { token: "nope", username: "gjoiner" }),
      await start(host("fonefix"), { token, username: "gjoiner" }),
    ]) {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INVITE_INVALID");
    }
  });

  it("refuses a username already taken in the shop with USERNAME_TAKEN", async () => {
    const token = await pendingInvite("google.taken@b.co");
    const res = await start(host("cellcity"), { token, username: "CELL_STAFF" });
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("USERNAME_TAKEN");
  });

  it("refuses a lapsed (read-only) shop with SHOP_NOT_ACTIVE", async () => {
    const token = await pendingInvite("google.lapsed@b.co");
    db.prepare(
      `INSERT INTO tenant_subscriptions (tenant_id, plan, status) VALUES (2, 'standard', 'read_only')
       ON CONFLICT(tenant_id) DO UPDATE SET status = excluded.status`,
    ).run();
    const res = await start(host("cellcity"), { token, username: "gjoiner" });
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("SHOP_NOT_ACTIVE");
  });

  it("refuses with GOOGLE_NOT_CONFIGURED while Google sign-in is off", async () => {
    const token = await pendingInvite("google.off@b.co");
    googleOn = false;
    const res = await start(host("cellcity"), { token, username: "gjoiner" });
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(core.GOOGLE_NOT_CONFIGURED);
  });

  it("refuses a too-short username through the schema (200 + success:false)", async () => {
    const token = await pendingInvite("google.short@b.co");
    const res = await request(app)
      .post(`${BASE}/google/start`)
      .set("Host", host("cellcity"))
      .send({ token, username: "ab" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });
});
