/**
 * LIRA-267 FR-013a/b — a shop's contact email is stored lowercased, and one
 * email can own at most one shop.
 *
 * Real schema (create_db.sql + runMigrations) on an in-memory database,
 * because the property under test is the `idx_tenants_contact_email` partial
 * unique index and how its SQLite error surfaces to callers — a mock could
 * only prove the service calls its repository.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithoutTenant } from "../../db/tenantContext.js";
import { TenantRepository } from "../../repositories/TenantRepository.js";
import { UserRepository } from "../../repositories/UserRepository.js";
import { SubscriptionRepository } from "../../repositories/SubscriptionRepository.js";
import { TenantProvisioningService } from "../TenantProvisioningService.js";
import { isAppError } from "../../utils/errors.js";
import { SignupInvitationRepository } from "../../repositories/SignupInvitationRepository.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const BASE = {
  adminUsername: "owner",
  adminPassword: "Str0ng-Password!",
};

let db: Database.Database;
let tenants: TenantRepository;
let service: TenantProvisioningService;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  tenants = new TenantRepository(db);
  service = new TenantProvisioningService(
    tenants,
    new UserRepository(),
    new SubscriptionRepository(db),
  );
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function provision(slug: string, contactEmail?: string | null) {
  return runWithoutTenant(() =>
    service.provisionTenant({
      ...BASE,
      name: `Shop ${slug}`,
      slug,
      contactEmail,
    }),
  );
}

function contactEmailOf(id: number): string | null {
  return (
    db.prepare(`SELECT contact_email FROM tenants WHERE id = ?`).get(id) as {
      contact_email: string | null;
    }
  ).contact_email;
}

describe("provisionTenant — contactEmail", () => {
  it("stores the email trimmed and lowercased, and returns it on the entity", () => {
    const tenant = provision("cornershop", "  Owner@Example.COM ");
    expect(contactEmailOf(tenant.id)).toBe("owner@example.com");
    expect(tenant.contact_email).toBe("owner@example.com");
  });

  it("stores NULL when no email is given (the shared-code path)", () => {
    const tenant = provision("nomail");
    expect(contactEmailOf(tenant.id)).toBeNull();
    const second = provision("nomail2", "   ");
    expect(contactEmailOf(second.id)).toBeNull();
  });

  it("refuses a second shop for the same email with EMAIL_ALREADY_HAS_SHOP, case-insensitively, and creates nothing", () => {
    provision("first", "owner@example.com");
    const before = (
      db.prepare(`SELECT COUNT(*) AS n FROM tenants`).get() as { n: number }
    ).n;

    let caught: unknown;
    try {
      provision("second", "OWNER@example.com");
    } catch (error) {
      caught = error;
    }
    // Compared as an object so a failure prints the actual error, not just
    // its code.
    expect(
      isAppError(caught)
        ? {
            code: caught.code,
            message: caught.message,
            cause: String(
              (caught.details as { cause?: unknown } | undefined)?.cause ?? "",
            ),
          }
        : caught,
    ).toEqual({
      code: "EMAIL_ALREADY_HAS_SHOP",
      message: expect.any(String),
      cause: "",
    });

    const after = (
      db.prepare(`SELECT COUNT(*) AS n FROM tenants`).get() as { n: number }
    ).n;
    expect(after).toBe(before);
    expect(tenants.getBySlug("second")).toBeNull();
  });

  it("does not mistake a duplicate SLUG for a duplicate email", () => {
    tenants.create({ name: "A", slug: "dup", contact_email: "a@example.com" });
    let caught: unknown;
    try {
      tenants.create({ name: "B", slug: "dup", contact_email: "b@example.com" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isAppError(caught) && caught.code).not.toBe("EMAIL_ALREADY_HAS_SHOP");
  });

  it("allows many shops with no email", () => {
    provision("nullone");
    provision("nulltwo");
    expect(tenants.getBySlug("nulltwo")).not.toBeNull();
  });
});

describe("provisionTenant — the first admin's account email (v196)", () => {
  function adminEmailOf(tenantId: number): {
    email: string | null;
    email_verified_at: string | null;
  } {
    return db
      .prepare(
        `SELECT email, email_verified_at FROM users WHERE tenant_id = ? AND role = 'admin' ORDER BY id LIMIT 1`,
      )
      .get(tenantId) as { email: string | null; email_verified_at: string | null };
  }

  it("links the admin to the sign-up email, verified at the instant the caller proved it", () => {
    const proven = "2026-10-07T12:00:00.000Z";
    const tenant = runWithoutTenant(() =>
      service.provisionTenant({
        ...BASE,
        name: "Linked",
        slug: "linked",
        contactEmail: " Owner@Example.com",
        contactEmailVerifiedAt: proven,
      }),
    );
    expect(adminEmailOf(tenant.id)).toEqual({
      email: "owner@example.com",
      email_verified_at: proven,
    });
  });

  it("a typed (unproven) contact email is linked but left unverified", () => {
    const tenant = provision("typed", "typed@example.com");
    expect(adminEmailOf(tenant.id)).toEqual({
      email: "typed@example.com",
      email_verified_at: null,
    });
  });

  it("no contact email: the admin has no email, even if a verified stamp is passed", () => {
    const tenant = runWithoutTenant(() =>
      service.provisionTenant({
        ...BASE,
        name: "Bare",
        slug: "bare",
        contactEmailVerifiedAt: "2026-10-07T12:00:00.000Z",
      }),
    );
    expect(adminEmailOf(tenant.id)).toEqual({
      email: null,
      email_verified_at: null,
    });
  });
});

describe("deleteTenant after an invite created the shop (LIRA-267)", () => {
  it("deletes the shop and keeps the invitation row, still reading as used", () => {
    db.pragma("foreign_keys = ON");
    const tenant = provision("invited", "invited@example.com");
    const invitations = new SignupInvitationRepository();
    const invite = runWithoutTenant(() =>
      invitations.createInvitation({
        email: "invited@example.com",
        tokenHash: "hash-invited",
        source: "admin",
        invitedByUserId: null,
        expiresAt: "2026-10-10T10:00:00.000Z",
        now: "2026-10-07T10:00:00.000Z",
      }),
    );
    runWithoutTenant(() =>
      invitations.finalize(invite.id, tenant.id, "2026-10-07T10:05:00.000Z"),
    );

    expect(() =>
      runWithoutTenant(() => service.deleteTenant(tenant.id, "invited")),
    ).not.toThrow();

    expect(tenants.getById(tenant.id)).toBeNull();
    const row = db
      .prepare(
        `SELECT used_at, used_by_tenant_id FROM signup_invitations WHERE id = ?`,
      )
      .get(invite.id) as { used_at: string | null; used_by_tenant_id: number | null };
    expect(row.used_at).toBe("2026-10-07T10:05:00.000Z");
    expect(row.used_by_tenant_id).toBeNull();
  });
});
