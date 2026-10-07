/**
 * SignupInvitationService (LIRA-267, T019) — invite creation and the
 * claim -> provision -> finalize-or-release flow (research R4).
 *
 * Deviation from tasks.md T019 ("mocked repositories"): this runs the REAL
 * repositories over a real in-memory database (create_db.sql +
 * runMigrations through `__LIRATEK_TEST_DB__`). The two properties that
 * matter most here — "invite and outbox row commit together or not at all"
 * and "a claim is single-use" — are a SQLite transaction and a conditional
 * UPDATE. A mocked repository cannot roll anything back, so it would prove
 * neither. The clock is fixed (every "now" is passed in) and the token
 * generator is injected, so every value asserted below is deterministic.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { SignupInvitationRepository } from "../../repositories/SignupInvitationRepository.js";
import { EmailOutboxRepository } from "../../repositories/EmailOutboxRepository.js";
import { hashToken } from "../../utils/crypto.js";
import {
  AppError,
  EmailAlreadyHasShopError,
  EMAIL_ALREADY_HAS_SHOP,
  EMAIL_NOT_CONFIGURED,
} from "../../utils/errors.js";
import {
  SignupInvitationService,
  SIGNUP_INVITE_TEMPLATE,
  type CreateSignupInvitationParams,
} from "../SignupInvitationService.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-07T10:00:00.000Z";
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const TOKEN = "tok_fixed_for_test_0123456789";
const BASE_URL = "https://www.liratek.test";

function plus(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

let db: Database.Database;
let inviteRepo: SignupInvitationRepository;
let outboxRepo: EmailOutboxRepository;
let service: SignupInvitationService;
let tokens: string[];

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  inviteRepo = new SignupInvitationRepository();
  outboxRepo = new EmailOutboxRepository();
  tokens = [TOKEN, "tok_second", "tok_third"];
  service = new SignupInvitationService(inviteRepo, outboxRepo, () => {
    const next = tokens.shift();
    if (!next) throw new Error("test ran out of tokens");
    return next;
  });
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function params(
  overrides: Partial<CreateSignupInvitationParams> = {},
): CreateSignupInvitationParams {
  return {
    source: "admin",
    email: "owner@example.com",
    shopNameHint: "Cell City",
    invitedByUserId: 1,
    now: T0,
    baseUrl: BASE_URL,
    emailConfigured: true,
    supportEmail: "help@liratek.test",
    ...overrides,
  };
}

function countInvites(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM signup_invitations`).get() as {
      n: number;
    }
  ).n;
}

function countOutbox(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM email_outbox`).get() as { n: number }
  ).n;
}

/** Inserts a real tenant row (FK target of used_by_tenant_id). */
function insertTenant(slug: string, contactEmail: string | null): number {
  return Number(
    db
      .prepare(
        `INSERT INTO tenants (name, slug, status, contact_email)
         VALUES (?, ?, 'active', ?)`,
      )
      .run(slug, slug, contactEmail).lastInsertRowid,
  );
}

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

// =============================================================================
// create
// =============================================================================

describe("create", () => {
  it("writes the invite and its outbox row, linked, with the token only hashed", () => {
    const view = service.create(params());

    const invite = inviteRepo.findById(view.id)!;
    expect(invite.email).toBe("owner@example.com");
    expect(invite.token_hash).toBe(hashToken(TOKEN));
    expect(invite.source).toBe("admin");
    expect(invite.invited_by_user_id).toBe(1);
    expect(invite.expires_at).toBe(plus(T0, 72 * HOUR_MS));
    expect(invite.email_outbox_id).not.toBeNull();

    const outbox = outboxRepo.findById(invite.email_outbox_id!)!;
    expect(outbox.idempotency_key).toBe(`signup-invite:${invite.id}`);
    expect(outbox.template).toBe(SIGNUP_INVITE_TEMPLATE);
    expect(outbox.to_email).toBe("owner@example.com");
    expect(outbox.status).toBe("pending");
    expect(outbox.next_attempt_at).toBe(T0);
    // No round may start after the link itself stops working.
    expect(outbox.give_up_at).toBe(invite.expires_at);
    expect(JSON.parse(outbox.data_json)).toEqual({
      inviteUrl: `${BASE_URL}/signup?invite=${TOKEN}`,
      shopNameHint: "Cell City",
      expiresAtText: "10 October 2026, 10:00 UTC",
      supportEmail: "help@liratek.test",
    });
  });

  it("returns the list-item view with no token or hash anywhere in it", () => {
    const view = service.create(params());

    expect(view).toEqual({
      id: view.id,
      email: "owner@example.com",
      shopNameHint: "Cell City",
      source: "admin",
      status: "pending",
      createdAt: T0,
      expiresAt: plus(T0, 72 * HOUR_MS),
      usedAt: null,
      usedByTenant: null,
      revokedAt: null,
      emailDelivery: {
        status: "queued",
        attempts: 0,
        lastError: null,
        sentAt: null,
      },
    });
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain(hashToken(TOKEN));
  });

  it("strips a trailing slash from the base URL and stores an empty hint as empty", () => {
    service.create(params({ baseUrl: `${BASE_URL}/`, shopNameHint: undefined }));
    const outbox = db
      .prepare(`SELECT data_json FROM email_outbox`)
      .get() as { data_json: string };
    const data = JSON.parse(outbox.data_json) as Record<string, string>;
    expect(data.inviteUrl).toBe(`${BASE_URL}/signup?invite=${TOKEN}`);
    // Always present, so the template's {{#if shopNameHint}} has a value to
    // test and the renderer's "missing variable" guard never fires.
    expect(data.shopNameHint).toBe("");
  });

  it("commits nothing when the outbox insert throws (one transaction)", () => {
    jest.spyOn(outboxRepo, "enqueue").mockImplementation(() => {
      throw new Error("disk full");
    });

    expect(() => service.create(params())).toThrow("disk full");
    expect(countInvites()).toBe(0);
    expect(countOutbox()).toBe(0);
  });

  it("refuses EMAIL_ALREADY_HAS_SHOP, naming the slug, when the email already has a shop", () => {
    insertTenant("cellcity", "owner@example.com");

    const error = captureError(() =>
      service.create(params({ email: "Owner@Example.com " })),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(EMAIL_ALREADY_HAS_SHOP);
    expect((error as AppError).statusCode).toBe(409);
    expect((error as AppError).details).toEqual({ slug: "cellcity" });
    expect(countInvites()).toBe(0);
    expect(countOutbox()).toBe(0);
  });

  it("refuses EMAIL_NOT_CONFIGURED when email is not configured", () => {
    const error = captureError(() =>
      service.create(params({ emailConfigured: false })),
    );
    expect((error as AppError).code).toBe(EMAIL_NOT_CONFIGURED);
    expect((error as AppError).statusCode).toBe(409);
    expect(countInvites()).toBe(0);
    expect(countOutbox()).toBe(0);
  });

  it("allows a second pending invite to the same address", () => {
    const first = service.create(params());
    const second = service.create(params());
    expect(second.id).not.toBe(first.id);
    expect(countOutbox()).toBe(2);
  });
});

// =============================================================================
// check
// =============================================================================

describe("check", () => {
  it("returns the email, hint and expiry for a valid token", () => {
    service.create(params());
    expect(service.check(TOKEN, plus(T0, HOUR_MS))).toEqual({
      email: "owner@example.com",
      shopNameHint: "Cell City",
      expiresAt: plus(T0, 72 * HOUR_MS),
    });
  });

  it("returns null for an unknown, expired, used, revoked or freshly claimed token", () => {
    expect(service.check("nope", T0)).toBeNull();

    const view = service.create(params());
    // expired (exactly at expiry counts as expired)
    expect(service.check(TOKEN, plus(T0, 72 * HOUR_MS))).toBeNull();

    // claimed 1 minute ago by another sign-up in progress
    inviteRepo.claim(hashToken(TOKEN), plus(T0, MIN_MS), T0);
    expect(service.check(TOKEN, plus(T0, 2 * MIN_MS))).toBeNull();
    // ...but a claim older than 10 minutes has lapsed
    expect(service.check(TOKEN, plus(T0, 12 * MIN_MS))).not.toBeNull();

    inviteRepo.revoke(view.id, plus(T0, 20 * MIN_MS));
    expect(service.check(TOKEN, plus(T0, 21 * MIN_MS))).toBeNull();
  });

  it("returns null once the invite is used", () => {
    const view = service.create(params());
    const tenantId = insertTenant("cellcity", null);
    inviteRepo.finalize(view.id, tenantId, plus(T0, MIN_MS));
    expect(service.check(TOKEN, plus(T0, 2 * MIN_MS))).toBeNull();
  });
});

// =============================================================================
// consume
// =============================================================================

describe("consume", () => {
  const NOW = plus(T0, HOUR_MS);

  it("claims, provisions with the INVITE's email, then finalizes as used", () => {
    const view = service.create(params());
    const provision = jest.fn((invite: { email: string }) => ({
      id: insertTenant("cellcity", invite.email),
    }));

    const outcome = service.consume(TOKEN, NOW, provision);

    expect(outcome.ok).toBe(true);
    expect(provision).toHaveBeenCalledTimes(1);
    expect(provision.mock.calls[0]![0].email).toBe("owner@example.com");
    const invite = inviteRepo.findById(view.id)!;
    expect(invite.used_at).toBe(NOW);
    expect(invite.used_by_tenant_id).toBe(
      outcome.ok ? outcome.result.id : -1,
    );

    // Single use: the same link never provisions a second shop.
    const again = service.consume(TOKEN, plus(NOW, MIN_MS), provision);
    expect(again).toEqual({ ok: false });
    expect(provision).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false without provisioning for an unknown or expired token", () => {
    const provision = jest.fn(() => ({ id: 1 }));
    expect(service.consume("nope", NOW, provision)).toEqual({ ok: false });

    service.create(params());
    expect(
      service.consume(TOKEN, plus(T0, 72 * HOUR_MS), provision),
    ).toEqual({ ok: false });
    expect(provision).not.toHaveBeenCalled();
  });

  it("releases the claim and rethrows when provisioning fails, so the link works again", () => {
    const view = service.create(params());
    const failing = jest.fn((): { id: number } => {
      throw new Error("Tenant slug 'cellcity' is already taken");
    });

    expect(() => service.consume(TOKEN, NOW, failing)).toThrow(
      "already taken",
    );
    const invite = inviteRepo.findById(view.id)!;
    expect(invite.claimed_at).toBeNull();
    expect(invite.used_at).toBeNull();

    // Immediately usable again — no 10-minute wait after a clean failure.
    const ok = service.consume(TOKEN, plus(NOW, 1000), (inv) => ({
      id: insertTenant("cellcity2", inv.email),
    }));
    expect(ok.ok).toBe(true);
  });

  it("releases and rethrows EMAIL_ALREADY_HAS_SHOP when there was NO earlier claim (a race past the admin check)", () => {
    const view = service.create(params());
    insertTenant("othershop", "owner@example.com");
    const provision = jest.fn((): { id: number } => {
      throw new EmailAlreadyHasShopError();
    });

    const error = captureError(() => service.consume(TOKEN, NOW, provision));
    expect((error as AppError).code).toBe(EMAIL_ALREADY_HAS_SHOP);
    const invite = inviteRepo.findById(view.id)!;
    expect(invite.claimed_at).toBeNull();
    expect(invite.used_at).toBeNull();
  });

  it("crash case (FR-010): a stale claim is reused and the shop already exists — finalize as used, generic refusal, no second shop", () => {
    const view = service.create(params());
    // An earlier sign-up claimed the invite, created the shop, then crashed
    // before finalizing. 15 minutes later its claim has lapsed.
    inviteRepo.claim(hashToken(TOKEN), NOW, T0);
    const crashedShopId = insertTenant("cellcity", "owner@example.com");

    const later = plus(NOW, 15 * MIN_MS);
    const provision = jest.fn((): { id: number } => {
      throw new EmailAlreadyHasShopError();
    });

    const outcome = service.consume(TOKEN, later, provision);

    expect(outcome).toEqual({ ok: false });
    expect(provision).toHaveBeenCalledTimes(1);
    const invite = inviteRepo.findById(view.id)!;
    expect(invite.used_at).toBe(later);
    expect(invite.used_by_tenant_id).toBe(crashedShopId);
    const shops = db
      .prepare(`SELECT COUNT(*) AS n FROM tenants WHERE contact_email = ?`)
      .get("owner@example.com") as { n: number };
    expect(shops.n).toBe(1);
  });
});
