/**
 * UserInvitationService (LIRA-281, feature B) — a shop admin invites someone
 * into THEIR shop by email. The invitee opens `<shop>/#/join?invite=<token>`,
 * chooses a username and password, and becomes a user of that shop with the
 * invited email already verified.
 *
 * No SQL here (rule 13): `UserInvitationRepository` (tenant-scoped),
 * `UserRepository`, `EmailOutboxRepository` (platform) and the tenants
 * registry. Same shape as `SignupInvitationService` (LIRA-267): only the
 * token's hash is stored, the email is queued in the SAME transaction as the
 * invite, and using a link is claim -> create user -> finalize-or-release.
 *
 * Scopes:
 *   - create / list / revoke / resend run in the CURRENT shop scope (the
 *     route sits behind `authenticateJWT`, which runs it inside the JWT
 *     shop's `runWithTenant`).
 *   - check / accept are PUBLIC: the caller runs them in a scope where the
 *     by-token lookup reads the right file (the host shop in per-tenant
 *     mode), and passes `requiredTenantId` when the host names a shop. The
 *     user itself is created inside `runWithTenant(invite.tenant_id)`.
 *   - `email_outbox` and `tenants` are platform tables: always read and
 *     written under `runWithoutTenant`. In shared-DB mode that is the same
 *     connection, so invite + outbox commit together; in per-tenant mode the
 *     outbox lives in the platform file and cannot share the transaction.
 *
 * "Now" is a UTC ISO string from the caller. Expiry is decided by the
 * server's clock on purpose (a client-supplied "now" could extend a link —
 * the rule-27 exception LIRA-267 already records).
 */

import type {
  UserInvitationEntity,
  UserInvitationRepository,
  UserInvitationRole,
  UserInvitationStatus,
} from "../repositories/UserInvitationRepository.js";
import {
  deriveUserInvitationStatus,
  getUserInvitationRepository,
} from "../repositories/UserInvitationRepository.js";
import type { UserRepository } from "../repositories/UserRepository.js";
import {
  getUserRepository,
  normalizeEmail,
} from "../repositories/UserRepository.js";
import type { EmailOutboxRepository } from "../repositories/EmailOutboxRepository.js";
import { getEmailOutboxRepository } from "../repositories/EmailOutboxRepository.js";
import type {
  TenantEntity,
  TenantRepository,
} from "../repositories/TenantRepository.js";
import { getTenantRepository } from "../repositories/TenantRepository.js";
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import {
  generateToken,
  hashPassword,
  hashToken,
  validatePasswordComplexity,
} from "../utils/crypto.js";
import {
  AppError,
  DatabaseError,
  EmailNotConfiguredError,
  EmailTakenInShopError,
  ValidationError,
  isAppError,
} from "../utils/errors.js";
import { USER_ACCOUNT_CODES } from "../constants/userAccountCodes.js";
import { authLogger } from "../utils/logger.js";
import {
  formatInviteExpiry,
  toSignupInviteEmailStatus,
  type SignupInviteEmailStatus,
} from "./SignupInvitationService.js";

// =============================================================================
// Constants
// =============================================================================

/** A claim older than this has lapsed (same as sign-up invites). */
export const USER_INVITE_CLAIM_STALE_MS = 10 * 60 * 1000;

/** At most this many invites per shop... */
export const USER_INVITE_DAILY_LIMIT = 20;
/** ...per rolling window. */
export const USER_INVITE_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The pending list shows at most this many invites. */
export const USER_INVITATION_LIST_LIMIT = 200;

/** The outbox template that carries a user invite. */
export const USER_INVITE_TEMPLATE = "user-invite";
/** The outbox data key holding the secret /#/join link; the outbox worker
 * scrubs it once the email reaches a final status. */
export const USER_INVITE_URL_KEY = "inviteUrl";

/**
 * The ONE refusal for every unusable /#/join link — unknown, expired, used,
 * revoked, claimed, or another shop's — so a response never says which.
 */
export const USER_INVITE_INVALID_MESSAGE =
  "This invite link is not valid. Ask the shop for a new invite.";

const ROLE_TEXT: Record<UserInvitationRole, string> = {
  admin: "an admin",
  staff: "a staff member",
};

// =============================================================================
// Types
// =============================================================================

/** What the Users tab shows for an invite. Never carries the token or its hash. */
export interface UserInvitationView {
  id: number;
  email: string;
  role: UserInvitationRole;
  status: UserInvitationStatus;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByUserId: number | null;
  revokedAt: string | null;
  emailDelivery: {
    status: SignupInviteEmailStatus;
    attempts: number;
    lastError: string | null;
    sentAt: string | null;
  } | null;
}

/** What the /#/join page shows before the form. */
export interface UserInviteCheckResult {
  email: string;
  role: UserInvitationRole;
  shopName: string;
  expiresAt: string;
}

/** Everything needed to email a link, decided by the caller (backend env). */
export interface UserInviteSendContext {
  /** UTC ISO. */
  now: string;
  /** False when the server has no mail transport. */
  emailConfigured: boolean;
  /** Address the email tells people to write to. */
  supportEmail: string;
  /** The shop's link origin (`resolveShopLinkBaseUrl`), or null = cannot send. */
  resolveLinkBase: (slug: string) => string | null;
  /** How long the link works (USER_INVITE_TTL_HOURS). */
  ttlHours: number;
}

export interface CreateUserInvitationParams extends UserInviteSendContext {
  /** The shop, from the JWT. */
  tenantId: number;
  /** Already trimmed + lowercased by the schema; normalised again here. */
  email: string;
  role: UserInvitationRole;
  /** The inviting admin, from the JWT. */
  invitedByUserId: number;
}

export interface RevokeUserInvitationResult {
  invitation: UserInvitationView;
  /** False when it was already revoked (a harmless repeat — not audited). */
  changed: boolean;
}

export interface AcceptUserInvitationParams {
  token: string;
  username: string;
  password: string;
  /** UTC ISO. */
  now: string;
  /** The host's shop, when the host names one: the invite must be for it. */
  requiredTenantId: number | null;
}

export type AcceptUserInvitationOutcome =
  | { ok: false }
  | {
      ok: true;
      invite: UserInvitationEntity;
      user: { id: number; username: string; role: UserInvitationRole };
      shop: { id: number; name: string; slug: string };
    };

/** USERNAME_TAKEN: the invitee must pick another name; the link still works. */
export class UsernameTakenError extends AppError {
  constructor(message: string = "This username is already taken in this shop") {
    super(USER_ACCOUNT_CODES.USERNAME_TAKEN, message, 409, true);
  }
}

/** USER_INVITATION_USED: the invite already created a user. */
export class UserInvitationUsedError extends AppError {
  constructor(
    message: string = "This invite has already been used, so it cannot be revoked",
  ) {
    super(USER_ACCOUNT_CODES.USER_INVITATION_USED, message, 409, true);
  }
}

/** RATE_LIMITED: too many invites from this shop in the last 24 hours. */
export class UserInviteRateLimitedError extends AppError {
  constructor(
    message: string = "Too many invites were sent today. Try again tomorrow.",
  ) {
    super(USER_ACCOUNT_CODES.RATE_LIMITED, message, 429, true);
  }
}

/** NOT_FOUND for an invite id that is not this shop's. */
export class UserInvitationNotFoundError extends AppError {
  constructor() {
    super(USER_ACCOUNT_CODES.NOT_FOUND, "Invitation not found", 404, true);
  }
}

// =============================================================================
// Pure helpers
// =============================================================================

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function joinUrl(baseUrl: string, token: string): string {
  // Hash route: the web app uses HashRouter (see SignupInvitationService).
  return `${baseUrl.replace(/\/+$/, "")}/#/join?invite=${encodeURIComponent(token)}`;
}

/**
 * The outbox idempotency key. Carries the shop id because in per-tenant DB
 * mode every shop file numbers `user_invitations` from 1, while the outbox is
 * ONE platform table: `user-invite:<id>` alone would make shop B's invite
 * silently reuse shop A's queued email (enqueue returns the existing row).
 */
export function userInviteIdempotencyKey(tenantId: number, id: number): string {
  return `user-invite:${tenantId}:${id}`;
}

// =============================================================================
// Service
// =============================================================================

export class UserInvitationService {
  private inviteRepo: UserInvitationRepository;
  private userRepo: UserRepository;
  private outboxRepo: EmailOutboxRepository;
  private tenantRepo: TenantRepository;
  private newToken: () => string;

  constructor(
    inviteRepo: UserInvitationRepository,
    userRepo: UserRepository,
    outboxRepo: EmailOutboxRepository,
    tenantRepo: TenantRepository,
    tokenGenerator: () => string = generateToken,
  ) {
    this.inviteRepo = inviteRepo;
    this.userRepo = userRepo;
    this.outboxRepo = outboxRepo;
    this.tenantRepo = tenantRepo;
    this.newToken = tokenGenerator;
  }

  /**
   * Invites `email` into the current shop and queues the email, in ONE
   * transaction. Refuses, in order:
   *   - EMAIL_NOT_CONFIGURED: no transport, or no link origin for the shop;
   *   - EMAIL_TAKEN_IN_SHOP: a user of this shop (active OR deactivated —
   *     the unique index covers both) already has the address;
   *   - RATE_LIMITED: 20 invites in the last 24 hours.
   * Any still-pending invite for the same address is revoked in the same
   * transaction, so one address never holds two live links.
   */
  create(params: CreateUserInvitationParams): UserInvitationView {
    const email = normalizeEmail(params.email);
    try {
      const shop = this.shopById(params.tenantId);
      const baseUrl = shop ? params.resolveLinkBase(shop.slug) : null;
      if (!params.emailConfigured || !shop || !baseUrl) {
        throw new EmailNotConfiguredError(
          "Email is not configured on this server, so an invite cannot be sent",
        );
      }

      if (this.userRepo.listEmails().some((row) => row.email === email)) {
        throw new EmailTakenInShopError(
          "A user in this shop already uses this email",
        );
      }

      const since = addMs(params.now, -USER_INVITE_DAILY_WINDOW_MS);
      if (this.inviteRepo.countCreatedSince(since) >= USER_INVITE_DAILY_LIMIT) {
        throw new UserInviteRateLimitedError();
      }

      const token = this.newToken();
      const expiresAt = addMs(params.now, params.ttlHours * 60 * 60 * 1000);

      const created = this.inviteRepo.transaction(() => {
        for (const old of this.inviteRepo.findPendingByEmail(email, params.now)) {
          this.inviteRepo.revoke(old.id, params.now);
        }
        const invite = this.inviteRepo.createInvitation({
          email,
          role: params.role,
          tokenHash: hashToken(token),
          invitedByUserId: params.invitedByUserId,
          expiresAt,
          now: params.now,
        });
        const outbox = runWithoutTenant(() =>
          this.outboxRepo.enqueue({
            idempotencyKey: userInviteIdempotencyKey(params.tenantId, invite.id),
            template: USER_INVITE_TEMPLATE,
            toEmail: invite.email,
            data: {
              // The `user-invite` template lists this key as a secret, so the
              // outbox worker scrubs it once the email is final.
              [USER_INVITE_URL_KEY]: joinUrl(baseUrl, token),
              shopName: shop.name,
              roleText: ROLE_TEXT[params.role],
              expiresAtText: formatInviteExpiry(expiresAt),
              supportEmail: params.supportEmail,
            },
            now: params.now,
            giveUpAt: expiresAt,
          }),
        );
        this.inviteRepo.linkOutbox(invite.id, outbox.id, params.now);
        return invite;
      });

      authLogger.info(
        { invitationId: created.id, tenantId: params.tenantId, role: params.role },
        "User invitation created",
      );
      return this.viewById(created.id, params.now);
    } catch (error) {
      if (isAppError(error) && error.isOperational) {
        authLogger.info(
          { code: error.code, tenantId: params.tenantId },
          "User invitation refused",
        );
      } else {
        authLogger.error({ error }, "User invitation create failed");
      }
      throw error;
    }
  }

  /**
   * Can this deployment email a link for `tenantId` at all? A transport AND
   * a link origin for the shop. The list's `emailConfigured` banner uses
   * this, so it never claims "configured" while every send would be refused.
   */
  emailReady(
    tenantId: number,
    emailConfigured: boolean,
    resolveLinkBase: (slug: string) => string | null,
  ): boolean {
    if (!emailConfigured) return false;
    const shop = this.shopById(tenantId);
    return shop !== null && resolveLinkBase(shop.slug) !== null;
  }

  /** The current shop's newest invites. */
  list(now: string, limit: number = USER_INVITATION_LIST_LIMIT): UserInvitationView[] {
    return this.inviteRepo
      .listRecent(limit)
      .map((row) => this.toView(row, now));
  }

  /**
   * Revokes a current-shop invite so its link is refused.
   *   - not this shop's: NOT_FOUND;
   *   - already used: USER_INVITATION_USED;
   *   - already revoked: returned unchanged, `changed: false`.
   */
  revoke(id: number, now: string): RevokeUserInvitationResult {
    const before = this.inviteRepo.findById(id);
    if (!before) throw new UserInvitationNotFoundError();
    if (before.used_at) throw new UserInvitationUsedError();
    if (before.revoked_at) {
      return { invitation: this.toView(before, now), changed: false };
    }
    if (!this.inviteRepo.revoke(id, now)) {
      const raced = this.inviteRepo.findById(id);
      if (raced?.used_at) throw new UserInvitationUsedError();
      if (raced?.revoked_at) {
        return { invitation: this.toView(raced, now), changed: false };
      }
      throw new DatabaseError("User invitation could not be revoked");
    }
    authLogger.info({ invitationId: id }, "User invitation revoked");
    return { invitation: this.viewById(id, now), changed: true };
  }

  /**
   * Sends a NEW invite with the same email and role. The old one, if still
   * pending, is revoked by `create`. Refusals as `create`, plus NOT_FOUND
   * for another shop's id and USER_INVITATION_USED for a used invite.
   */
  resend(
    id: number,
    params: Omit<CreateUserInvitationParams, "email" | "role">,
  ): UserInvitationView {
    const old = this.inviteRepo.findById(id);
    if (!old) throw new UserInvitationNotFoundError();
    if (old.used_at) throw new UserInvitationUsedError();
    return this.create({ ...params, email: old.email, role: old.role });
  }

  /**
   * What the /#/join page shows, or null for any unusable link (unknown,
   * expired, used, revoked, claimed by an accept in progress, another
   * shop's, or a shop that is not active). Read-only.
   */
  check(
    token: string,
    now: string,
    requiredTenantId: number | null,
  ): UserInviteCheckResult | null {
    const invite = this.inviteRepo.findByTokenHash(hashToken(token));
    if (!invite) return null;
    if (requiredTenantId !== null && invite.tenant_id !== requiredTenantId) {
      return null;
    }
    if (deriveUserInvitationStatus(invite, now) !== "pending") return null;
    if (
      invite.claimed_at &&
      Date.parse(invite.claimed_at) >= Date.parse(now) - USER_INVITE_CLAIM_STALE_MS
    ) {
      return null;
    }
    const shop = this.shopById(invite.tenant_id);
    if (!shop || shop.status !== "active") return null;
    return {
      email: invite.email,
      role: invite.role,
      shopName: shop.name,
      expiresAt: invite.expires_at,
    };
  }

  /**
   * Uses a link: claim -> (host shop check) -> create the user in the
   * invite's shop with the INVITE's email, verified -> finalize. Any failure
   * after the claim releases it, so the link works again at once.
   *
   *   - unusable / other shop's link: `{ ok: false }` (the caller answers
   *     with the one generic message);
   *   - USERNAME_TAKEN / EMAIL_TAKEN_IN_SHOP / ValidationError: thrown, the
   *     claim released.
   */
  accept(params: AcceptUserInvitationParams): AcceptUserInvitationOutcome {
    const username = params.username.trim();
    const complexity = validatePasswordComplexity(params.password);
    if (!complexity.valid) {
      throw new ValidationError(complexity.errors.join(", "));
    }

    const invite = this.inviteRepo.claim(
      hashToken(params.token),
      params.now,
      addMs(params.now, -USER_INVITE_CLAIM_STALE_MS),
    );
    if (!invite) return { ok: false };

    const tenantId = invite.tenant_id;
    if (params.requiredTenantId !== null && tenantId !== params.requiredTenantId) {
      this.releaseQuietly(invite, params.now);
      return { ok: false };
    }
    const shop = this.shopById(tenantId);
    if (!shop || shop.status !== "active") {
      this.releaseQuietly(invite, params.now);
      return { ok: false };
    }

    const passwordHash = hashPassword(params.password);
    let user;
    try {
      // The user and the "used" stamp commit together, in the shop's file.
      user = runWithTenant(tenantId, () =>
        this.inviteRepo.transaction(() => {
          if (this.userRepo.usernameExistsInRealm(username, tenantId)) {
            throw new UsernameTakenError();
          }
          const created = this.userRepo.createUser({
            username,
            password_hash: passwordHash,
            role: invite.role,
            tenant_id: tenantId,
            email: invite.email,
            // Opening the emailed link proved the address.
            email_verified_at: params.now,
          });
          if (!this.inviteRepo.finalize(invite.id, created.id, params.now)) {
            // Cannot happen while we hold the claim; the user exists, so it
            // is logged, never thrown.
            authLogger.warn(
              { invitationId: invite.id, userId: created.id },
              "User invite was already finalized",
            );
          }
          return created;
        }),
      );
    } catch (error) {
      this.releaseQuietly(invite, params.now);
      throw error;
    }

    authLogger.info(
      { invitationId: invite.id, tenantId, userId: user.id },
      "User invite used",
    );
    return {
      ok: true,
      invite,
      user: { id: user.id, username: user.username, role: invite.role },
      shop: { id: shop.id, name: shop.name, slug: shop.slug },
    };
  }

  // ---------------------------------------------------------------------------

  private shopById(tenantId: number): TenantEntity | null {
    return runWithoutTenant(() => this.tenantRepo.getById(tenantId));
  }

  private viewById(id: number, now: string): UserInvitationView {
    const row = this.inviteRepo.findById(id);
    if (!row) throw new DatabaseError("User invitation could not be reloaded");
    return this.toView(row, now);
  }

  /** The one mapping from a stored invite to what the admin sees. Delivery
   * is read from the platform outbox, never joined (per-tenant mode keeps it
   * in another file). */
  private toView(row: UserInvitationEntity, now: string): UserInvitationView {
    const outboxId = row.email_outbox_id;
    const outbox =
      outboxId === null
        ? null
        : runWithoutTenant(() => this.outboxRepo.findById(outboxId));
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      status: deriveUserInvitationStatus(row, now),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      usedByUserId: row.used_by_user_id,
      revokedAt: row.revoked_at,
      emailDelivery: outbox
        ? {
            status: toSignupInviteEmailStatus(outbox.status),
            attempts: outbox.attempts,
            lastError: outbox.last_error,
            sentAt: outbox.sent_at,
          }
        : null,
    };
  }

  private releaseQuietly(invite: UserInvitationEntity, now: string): void {
    try {
      runWithTenant(invite.tenant_id, () =>
        this.inviteRepo.release(invite.id, now),
      );
    } catch (releaseError) {
      // The claim lapses on its own after 10 minutes.
      authLogger.error(
        { releaseError, invitationId: invite.id },
        "Failed to release user invite claim",
      );
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: UserInvitationService | null = null;

export function getUserInvitationService(): UserInvitationService {
  if (!instance) {
    instance = new UserInvitationService(
      getUserInvitationRepository(),
      getUserRepository(),
      getEmailOutboxRepository(),
      getTenantRepository(),
    );
  }
  return instance;
}

export function resetUserInvitationService(): void {
  instance = null;
}
