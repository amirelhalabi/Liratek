/**
 * POST /api/admin/signup-invitations (LIRA-267, T020/T026).
 *
 * Supertest over a REAL in-memory SQLite database built from the actual
 * electron-app/create_db.sql (the wp5_wp6 pattern): the route, the service,
 * both repositories, the audit write and the auth middleware all run for
 * real. Only `isEmailConfigured` is stubbed, so the EMAIL_NOT_CONFIGURED
 * case can be toggled without re-importing the env.
 *
 * Request field names come from `createSignupInvitationSchema` itself
 * (rule 24): each body is parsed through the schema before it is sent.
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

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");

async function loginToken(username: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

function count(table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

/** A body validated by the real schema, so a renamed field fails here. */
function body(input: { email: string; shopNameHint?: string }) {
  const parsed = core.createSignupInvitationSchema.safeParse(input);
  expect(parsed.success).toBe(true);
  return input;
}

beforeAll(async () => {
  process.env.JWT_SECRET =
    "signup-invitations-test-secret-0123456789-0123456789";
  process.env.APP_BASE_DOMAIN = "liratek.test";

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
  const insertUser = db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active)
     VALUES (?, ?, ?, ?, 1)`,
  );
  insertUser.run(null, "root", hash, "super_admin");
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status, contact_email)
     VALUES (2, 'Cell City', 'cellcity', 'active', 'taken@example.com')`,
  ).run();
  insertUser.run(2, "cell_admin", hash, "admin");

  core.resetUserRepository();
  core.resetSessionRepository();
  core.resetAuthService();
  core.resetTenantRepository();
  core.resetAuditRepository();
  core.resetAuditService();
  core.resetSignupInvitationRepository();
  core.resetEmailOutboxRepository();
  core.resetSignupInvitationService();

  const authRoutes = (await import("../auth")).default;
  const adminRoutes = (await import("../admin")).default;
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  core.resetTenantContext();
  emailConfigured = true;
  db.exec(`DELETE FROM signup_invitations; DELETE FROM email_outbox;`);
});

describe("POST /api/admin/signup-invitations", () => {
  const url = "/api/admin/signup-invitations";

  it("401 without a token", async () => {
    const res = await request(app).post(url).send(body({ email: "a@b.co" }));
    expect(res.status).toBe(401);
    expect(count("signup_invitations")).toBe(0);
  });

  it("403 for a shop admin (not super admin)", async () => {
    const token = await loginToken("cell_admin");
    const res = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send(body({ email: "a@b.co" }));
    expect(res.status).toBe(403);
    expect(count("signup_invitations")).toBe(0);
  });

  it("201 with the invitation view; the token is nowhere in the response", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send(body({ email: "  New.Owner@Example.com ", shopNameHint: "Fone Fix" }));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const invitation = res.body.data.invitation as Record<string, unknown>;
    expect(invitation).toMatchObject({
      email: "new.owner@example.com",
      shopNameHint: "Fone Fix",
      source: "admin",
      status: "pending",
      usedAt: null,
      usedByTenant: null,
      revokedAt: null,
      emailDelivery: { status: "queued", attempts: 0, lastError: null, sentAt: null },
    });

    // The real token only exists in the queued email's link.
    const outbox = db
      .prepare(`SELECT data_json, idempotency_key FROM email_outbox`)
      .get() as { data_json: string; idempotency_key: string };
    const inviteUrl = (JSON.parse(outbox.data_json) as { inviteUrl: string })
      .inviteUrl;
    expect(inviteUrl.startsWith("https://www.liratek.test/signup?invite=")).toBe(
      true,
    );
    const rawToken = new URL(inviteUrl).searchParams.get("invite")!;
    expect(rawToken.length).toBeGreaterThan(20);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(rawToken);
    expect(serialised).not.toContain(core.hashToken(rawToken));
    expect(outbox.idempotency_key).toBe(`signup-invite:${invitation.id}`);

    const invite = db
      .prepare(`SELECT invited_by_user_id, token_hash FROM signup_invitations`)
      .get() as { invited_by_user_id: number; token_hash: string };
    const root = db
      .prepare(`SELECT id FROM users WHERE username = 'root'`)
      .get() as { id: number };
    // The actor comes from the JWT, never the body.
    expect(invite.invited_by_user_id).toBe(root.id);
    expect(invite.token_hash).toBe(core.hashToken(rawToken));
  });

  it("writes a platform audit row signup_invitation.create", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send(body({ email: "audit.me@example.com" }));
    expect(res.status).toBe(201);

    const rows = db
      .prepare(
        `SELECT tenant_id, entity_type, entity_id FROM audit_log
          WHERE action = 'signup_invitation.create' AND entity_id = ?`,
      )
      .all(String(res.body.data.invitation.id)) as Array<{
      tenant_id: number | null;
      entity_type: string;
      entity_id: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      tenant_id: null,
      entity_type: "signup_invitation",
      entity_id: String(res.body.data.invitation.id),
    });
  });

  it("409 EMAIL_NOT_CONFIGURED when email is not configured; nothing created", async () => {
    emailConfigured = false;
    const token = await loginToken("root");
    const res = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send(body({ email: "someone@example.com" }));

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("EMAIL_NOT_CONFIGURED");
    expect(count("signup_invitations")).toBe(0);
    expect(count("email_outbox")).toBe(0);
  });

  it("409 EMAIL_ALREADY_HAS_SHOP with the slug; nothing created", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send(body({ email: "Taken@Example.com" }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_ALREADY_HAS_SHOP");
    expect(res.body.error.details).toEqual({ slug: "cellcity" });
    expect(res.body.error.message).toContain("cellcity");
    expect(count("signup_invitations")).toBe(0);
    expect(count("email_outbox")).toBe(0);
  });

  it("rejects an invalid email through the schema", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "not-an-email" });
    expect(res.body.success).toBe(false);
    expect(count("signup_invitations")).toBe(0);
  });
});

// =============================================================================
// US2 (T032) — list and revoke
// =============================================================================

async function createInvite(
  token: string,
  input: { email: string; shopNameHint?: string },
): Promise<number> {
  const res = await request(app)
    .post("/api/admin/signup-invitations")
    .set("Authorization", `Bearer ${token}`)
    .send(body(input));
  expect(res.status).toBe(201);
  return res.body.data.invitation.id as number;
}

function auditCount(action: string, entityId: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND entity_id = ?`,
      )
      .get(action, String(entityId)) as { n: number }
  ).n;
}

describe("GET /api/admin/signup-invitations", () => {
  const url = "/api/admin/signup-invitations";

  it("403 for a shop admin", async () => {
    const token = await loginToken("cell_admin");
    const res = await request(app)
      .get(url)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("lists newest first with emailConfigured, derived status, delivery state and the shop that used it", async () => {
    const token = await loginToken("root");
    const pendingId = await createInvite(token, {
      email: "pending@example.com",
      shopNameHint: "Pending Shop",
    });
    const usedId = await createInvite(token, { email: "used@example.com" });
    const expiredId = await createInvite(token, {
      email: "expired@example.com",
    });

    // pending + sending both show as "queued"; attempts come from the outbox.
    db.prepare(
      `UPDATE email_outbox SET status = 'sending', attempts = 2
        WHERE idempotency_key = ?`,
    ).run(`signup-invite:${pendingId}`);
    db.prepare(
      `UPDATE email_outbox SET status = 'accepted', attempts = 1,
              sent_at = '2026-10-07T09:00:01.000Z'
        WHERE idempotency_key = ?`,
    ).run(`signup-invite:${usedId}`);
    db.prepare(
      `UPDATE email_outbox SET status = 'failed', attempts = 4,
              last_error = 'PermanentEmailError: mailbox does not exist'
        WHERE idempotency_key = ?`,
    ).run(`signup-invite:${expiredId}`);
    db.prepare(
      `UPDATE signup_invitations SET used_at = ?, used_by_tenant_id = 2
        WHERE id = ?`,
    ).run("2026-10-07T09:30:00.000Z", usedId);
    db.prepare(
      `UPDATE signup_invitations SET expires_at = '2000-01-01T00:00:00.000Z'
        WHERE id = ?`,
    ).run(expiredId);

    const res = await request(app)
      .get(url)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.emailConfigured).toBe(true);
    const items = res.body.data.invitations as Array<Record<string, unknown>>;
    expect(items.map((i) => i.id)).toEqual([expiredId, usedId, pendingId]);

    const byId = new Map(items.map((i) => [i.id as number, i]));
    expect(byId.get(pendingId)).toMatchObject({
      email: "pending@example.com",
      shopNameHint: "Pending Shop",
      source: "admin",
      status: "pending",
      usedByTenant: null,
      emailDelivery: { status: "queued", attempts: 2, lastError: null },
    });
    expect(byId.get(usedId)).toMatchObject({
      status: "used",
      usedAt: "2026-10-07T09:30:00.000Z",
      usedByTenant: { id: 2, slug: "cellcity" },
      emailDelivery: {
        status: "accepted",
        attempts: 1,
        sentAt: "2026-10-07T09:00:01.000Z",
      },
    });
    expect(byId.get(expiredId)).toMatchObject({
      status: "expired",
      emailDelivery: {
        status: "failed",
        attempts: 4,
        lastError: "PermanentEmailError: mailbox does not exist",
      },
    });

    // Never the token or its hash.
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain("token");
    const hashes = db
      .prepare(`SELECT token_hash FROM signup_invitations`)
      .all() as Array<{ token_hash: string }>;
    for (const { token_hash } of hashes) {
      expect(serialised).not.toContain(token_hash);
    }
  });

  it("reports emailConfigured: false when the server cannot send", async () => {
    emailConfigured = false;
    const token = await loginToken("root");
    const res = await request(app)
      .get(url)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ emailConfigured: false, invitations: [] });
  });
});

describe("POST /api/admin/signup-invitations/:id/revoke", () => {
  const revokeUrl = (id: number | string) =>
    `/api/admin/signup-invitations/${id}/revoke`;

  it("403 for a shop admin; nothing revoked", async () => {
    const root = await loginToken("root");
    const id = await createInvite(root, { email: "keep@example.com" });
    const token = await loginToken("cell_admin");
    const res = await request(app)
      .post(revokeUrl(id))
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    const row = db
      .prepare(`SELECT revoked_at FROM signup_invitations WHERE id = ?`)
      .get(id) as { revoked_at: string | null };
    expect(row.revoked_at).toBeNull();
  });

  it("200 with the revoked view, audits once; a second call is harmless and not re-audited", async () => {
    const token = await loginToken("root");
    const id = await createInvite(token, { email: "wrong@example.com" });

    const first = await request(app)
      .post(revokeUrl(id))
      .set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);
    expect(first.body.data.invitation).toMatchObject({
      id,
      email: "wrong@example.com",
      status: "revoked",
    });
    const revokedAt = first.body.data.invitation.revokedAt as string;
    expect(typeof revokedAt).toBe("string");
    expect(auditCount("signup_invitation.revoke", id)).toBe(1);

    const second = await request(app)
      .post(revokeUrl(id))
      .set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(200);
    expect(second.body.data.invitation).toMatchObject({
      id,
      status: "revoked",
      revokedAt,
    });
    expect(auditCount("signup_invitation.revoke", id)).toBe(1);
  });

  it("the revoked link is refused by the invite check", async () => {
    const token = await loginToken("root");
    const id = await createInvite(token, { email: "gone@example.com" });
    const outbox = db
      .prepare(`SELECT data_json FROM email_outbox WHERE idempotency_key = ?`)
      .get(`signup-invite:${id}`) as { data_json: string };
    const rawToken = new URL(
      (JSON.parse(outbox.data_json) as { inviteUrl: string }).inviteUrl,
    ).searchParams.get("invite")!;

    await request(app)
      .post(revokeUrl(id))
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const check = await request(app)
      .post("/api/auth/signup/invite/check")
      .send({ token: rawToken });
    expect(check.body.success).toBe(false);
  });

  it("409 when the invite is already used; not revoked, not audited", async () => {
    const token = await loginToken("root");
    const id = await createInvite(token, { email: "done@example.com" });
    db.prepare(
      `UPDATE signup_invitations SET used_at = ?, used_by_tenant_id = 2
        WHERE id = ?`,
    ).run("2026-10-07T09:30:00.000Z", id);

    const res = await request(app)
      .post(revokeUrl(id))
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("SIGNUP_INVITATION_USED");
    const row = db
      .prepare(`SELECT revoked_at FROM signup_invitations WHERE id = ?`)
      .get(id) as { revoked_at: string | null };
    expect(row.revoked_at).toBeNull();
    expect(auditCount("signup_invitation.revoke", id)).toBe(0);
  });

  it("404 for an unknown id", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .post(revokeUrl(999999))
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("400 for a non-numeric id", async () => {
    const token = await loginToken("root");
    const res = await request(app)
      .post(revokeUrl("abc"))
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
