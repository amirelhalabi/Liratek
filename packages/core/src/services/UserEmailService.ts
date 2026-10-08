/**
 * UserEmailService (LIRA-279, feature B) — a shop user's account email:
 * set it, email a verification link, and verify it from that link.
 *
 * No SQL here (rule 13): `UserRepository`, `EmailVerificationTokenRepository`
 * (tenant-scoped), `EmailOutboxRepository` (platform) and the tenants
 * registry. Only the token's hash is stored; the link carries the token.
 *
 * Scopes: list / setEmail / sendVerification run in the CURRENT shop (the
 * route is behind `authenticateJWT`). `verify` is PUBLIC: the caller runs it
 * where the by-token lookup reads the right file and passes the host's shop
 * when the host names one; the stamp is written inside
 * `runWithTenant(row.tenant_id)`. Outbox and tenants are platform tables,
 * always under `runWithoutTenant` (see UserInvitationService's header for
 * what that means for atomicity in per-tenant mode).
 *
 * A link verifies ONLY the address it was sent to: the token stores that
 * address, and `markEmailVerified` refuses when the user's email has changed
 * since. Changing the address also burns every open link.
 */

import type { UserRepository } from "../repositories/UserRepository.js";
import {
  getUserRepository,
  normalizeEmail,
} from "../repositories/UserRepository.js";
import type { EmailVerificationTokenRepository } from "../repositories/EmailVerificationTokenRepository.js";
import { getEmailVerificationTokenRepository } from "../repositories/EmailVerificationTokenRepository.js";
import type { EmailOutboxRepository } from "../repositories/EmailOutboxRepository.js";
import { getEmailOutboxRepository } from "../repositories/EmailOutboxRepository.js";
import type {
  TenantEntity,
  TenantRepository,
} from "../repositories/TenantRepository.js";
import { getTenantRepository } from "../repositories/TenantRepository.js";
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import { generateToken, hashToken } from "../utils/crypto.js";
import {
  AppError,
  EmailNotConfiguredError,
  LastSigninMethodError,
} from "../utils/errors.js";
import { USER_ACCOUNT_CODES } from "../constants/userAccountCodes.js";
import { authLogger } from "../utils/logger.js";
import { formatInviteExpiry } from "./SignupInvitationService.js";
import {
  getSigninDirectoryService,
  type SigninDirectorySync,
} from "./SigninDirectoryService.js";
import {
  getUserIdentityRepository,
  type UserIdentityRepository,
} from "../repositories/UserIdentityRepository.js";

// =============================================================================
// Constants
// =============================================================================

/** A verification link works for 24 hours (contract B). */
export const EMAIL_VERIFY_TTL_HOURS = 24;

/** At most this many links per user... */
export const EMAIL_VERIFY_PER_USER_LIMIT = 3;
/** ...per rolling hour. A link issued by setting the email counts too. */
export const EMAIL_VERIFY_WINDOW_MS = 60 * 60 * 1000;

/** The outbox template that carries a verification link. */
export const VERIFY_EMAIL_TEMPLATE = "verify-email";
/** The outbox data key holding the secret verification link; the outbox
 * worker scrubs it once the email reaches a final status. */
export const EMAIL_VERIFY_URL_KEY = "verifyUrl";

/** The ONE refusal for every unusable verification link. */
export const EMAIL_VERIFY_INVALID_MESSAGE =
  "This link is not valid. Ask for a new verification email.";

// =============================================================================
// Types
// =============================================================================

export interface UserEmailView {
  id: number;
  email: string | null;
  emailVerifiedAt: string | null;
  /** LIRA-288: the user's Google sign-in link (the address Google
   * reported), or null when Google is not connected. */
  google: { email: string | null } | null;
  /** LIRA-291: false = the user has no password (joined with Google). With
   * `google`, it gives the Sign-in label (`signinMethodLabel`). */
  hasPassword: boolean;
}

/** LIRA-292: the signed-in user's own email (My account → Profile). */
export interface OwnEmailView {
  email: string | null;
  emailVerifiedAt: string | null;
}

/** LIRA-288: an admin disconnected a member's Google. */
export interface AdminUnlinkGoogleResult {
  user: UserEmailView;
  /** False when nothing was linked (a harmless repeat — not audited). */
  unlinked: boolean;
}

export interface SetUserEmailResult {
  email: string | null;
  /** Always null: a newly set address is unverified until its link is opened. */
  emailVerifiedAt: null;
  verificationSent: boolean;
}

/** Everything needed to email a link, decided by the caller (backend env). */
export interface UserEmailSendContext {
  /** The shop, from the JWT. */
  tenantId: number;
  /** UTC ISO. */
  now: string;
  emailConfigured: boolean;
  supportEmail: string;
  /** The shop's link origin (`resolveShopLinkBaseUrl`), or null = cannot send. */
  resolveLinkBase: (slug: string) => string | null;
}

export class UserNotFoundInShopError extends AppError {
  constructor() {
    super(USER_ACCOUNT_CODES.NOT_FOUND, "User not found", 404, true);
  }
}

export class UserHasNoEmailError extends AppError {
  constructor() {
    super(
      USER_ACCOUNT_CODES.USER_HAS_NO_EMAIL,
      "This user has no email address yet",
      409,
      true,
    );
  }
}

export class EmailAlreadyVerifiedError extends AppError {
  constructor() {
    super(
      USER_ACCOUNT_CODES.EMAIL_ALREADY_VERIFIED,
      "This email is already verified",
      409,
      true,
    );
  }
}

export class EmailVerifyRateLimitedError extends AppError {
  constructor() {
    super(
      USER_ACCOUNT_CODES.RATE_LIMITED,
      "Too many verification emails for this user. Try again in an hour.",
      429,
      true,
    );
  }
}

// =============================================================================
// Pure helpers
// =============================================================================

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function verifyUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/#/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * Outbox idempotency key. Carries the shop id: in per-tenant DB mode every
 * shop file numbers its tokens from 1 while the outbox is one platform table.
 */
export function verifyEmailIdempotencyKey(tenantId: number, tokenId: number): string {
  return `verify-email:${tenantId}:${tokenId}`;
}

// =============================================================================
// Service
// =============================================================================

export class UserEmailService {
  private userRepo: UserRepository;
  private tokenRepo: EmailVerificationTokenRepository;
  private outboxRepo: EmailOutboxRepository;
  private tenantRepo: TenantRepository;
  private newToken: () => string;
  private directory: SigninDirectorySync;
  private identityRepo: UserIdentityRepository;

  /** `directory` (LIRA-288): re-synced after every email change, so www's
   * "your shops" lists follow confirmed emails. `identityRepo`: the Users
   * list shows, and an admin can remove, each member's Google link. */
  constructor(
    userRepo: UserRepository,
    tokenRepo: EmailVerificationTokenRepository,
    outboxRepo: EmailOutboxRepository,
    tenantRepo: TenantRepository,
    tokenGenerator: () => string = generateToken,
    directory?: SigninDirectorySync,
    identityRepo?: UserIdentityRepository,
  ) {
    this.identityRepo = identityRepo ?? getUserIdentityRepository();
    this.userRepo = userRepo;
    this.tokenRepo = tokenRepo;
    this.outboxRepo = outboxRepo;
    this.tenantRepo = tenantRepo;
    this.newToken = tokenGenerator;
    this.directory = directory ?? getSigninDirectoryService();
  }

  /**
   * LIRA-292: the signed-in user's OWN email, for My account → Profile. The
   * caller passes the id from the session, never from the request. NOT_FOUND
   * for an id that is not a user of the current shop.
   */
  getOwn(userId: number): OwnEmailView {
    const row = this.userRepo.getEmail(userId);
    if (!row) throw new UserNotFoundInShopError();
    return { email: row.email, emailVerifiedAt: row.email_verified_at };
  }

  /** Every current-shop user's email, and Google link (LIRA-288). */
  list(): UserEmailView[] {
    const google = new Map(
      this.identityRepo
        .listForCurrentShop("google")
        .map((link) => [link.user_id, { email: link.email }]),
    );
    return this.userRepo.listEmails().map((row) => ({
      id: row.id,
      email: row.email,
      emailVerifiedAt: row.email_verified_at,
      google: google.get(row.id) ?? null,
      hasPassword: row.has_password === 1,
    }));
  }

  /**
   * An admin disconnects a member's Google sign-in (LIRA-288) — CURRENT
   * shop only (another shop's user, or a super admin, is NOT_FOUND). That
   * Google account no longer signs in to THIS shop; its links in other
   * shops are untouched. The member's password (if they set one) and
   * "Forgot password" still work. Then the sign-in directory is re-synced.
   * Disconnecting nothing is a harmless repeat (`unlinked: false`).
   *
   * LIRA-291: disconnecting ANOTHER user with no password is allowed (the
   * admin was warned; the route then emails a "Set a password" link). But
   * an admin disconnecting their OWN Google while they have no password
   * gets the same refusal as Settings → Sign-in methods
   * (`LastSigninMethodError`, SET_PASSWORD_FIRST): `actorUserId` is the
   * admin, from the JWT.
   */
  adminUnlinkGoogle(
    userId: number,
    ctx: { tenantId: number; now: string; actorUserId?: number },
  ): AdminUnlinkGoogleResult {
    const current = this.userRepo.getEmail(userId);
    if (!current) throw new UserNotFoundInShopError();
    const hasPassword = this.userRepo.hasPassword(userId);
    if (
      ctx.actorUserId === userId &&
      !hasPassword &&
      this.identityRepo.findByUser(userId, "google")
    ) {
      throw new LastSigninMethodError();
    }
    const unlinked = this.identityRepo.unlink(userId, "google");
    if (unlinked) {
      this.directory.syncUser(ctx.tenantId, userId, ctx.now);
      authLogger.info(
        { userId, tenantId: ctx.tenantId },
        "Google sign-in disconnected by an admin",
      );
    }
    return {
      user: {
        id: userId,
        email: current.email,
        emailVerifiedAt: current.email_verified_at,
        google: null,
        hasPassword,
      },
      unlinked,
    };
  }

  /**
   * Sets (or, with null, clears) a user's email, UNVERIFIED, and burns every
   * open verification link. When an address is set and email can be sent
   * (and the per-user limit allows), a verification link is queued in the
   * same transaction. Throws NOT_FOUND / EMAIL_TAKEN_IN_SHOP.
   */
  setEmail(
    userId: number,
    email: string | null,
    ctx: UserEmailSendContext,
  ): SetUserEmailResult {
    const normalized = email ? normalizeEmail(email) : null;
    if (!this.userRepo.getEmail(userId)) throw new UserNotFoundInShopError();

    const shop = this.shopById(ctx.tenantId);
    const baseUrl = shop ? ctx.resolveLinkBase(shop.slug) : null;

    const verificationSent = this.tokenRepo.transaction(() => {
      if (!this.userRepo.setEmail(userId, normalized, null)) {
        throw new UserNotFoundInShopError();
      }
      this.tokenRepo.invalidateForUser(userId, ctx.now);
      if (!normalized || !ctx.emailConfigured || !shop || !baseUrl) return false;
      if (this.overLimit(userId, ctx.now)) return false;
      this.issue(userId, normalized, shop, baseUrl, ctx);
      return true;
    });

    authLogger.info(
      { userId, tenantId: ctx.tenantId, cleared: normalized === null, verificationSent },
      "User email set",
    );
    // After the shop commit (LIRA-288): an old confirmed address stops
    // listing this shop on www at once. Never throws.
    this.directory.syncUser(ctx.tenantId, userId, ctx.now);
    return { email: normalized, emailVerifiedAt: null, verificationSent };
  }

  /**
   * Emails a fresh verification link to the user's CURRENT address.
   * Refuses NOT_FOUND, USER_HAS_NO_EMAIL, EMAIL_ALREADY_VERIFIED,
   * EMAIL_NOT_CONFIGURED and RATE_LIMITED (3 per user per hour).
   */
  sendVerification(userId: number, ctx: UserEmailSendContext): { sent: true } {
    const current = this.userRepo.getEmail(userId);
    if (!current) throw new UserNotFoundInShopError();
    if (!current.email) throw new UserHasNoEmailError();
    if (current.email_verified_at) throw new EmailAlreadyVerifiedError();

    const shop = this.shopById(ctx.tenantId);
    const baseUrl = shop ? ctx.resolveLinkBase(shop.slug) : null;
    if (!ctx.emailConfigured || !shop || !baseUrl) {
      throw new EmailNotConfiguredError(
        "Email is not configured on this server, so a link cannot be sent",
      );
    }
    if (this.overLimit(userId, ctx.now)) throw new EmailVerifyRateLimitedError();

    const email = current.email;
    this.tokenRepo.transaction(() =>
      this.issue(userId, email, shop, baseUrl, ctx),
    );
    authLogger.info({ userId, tenantId: ctx.tenantId }, "Verification email queued");
    return { sent: true };
  }

  /**
   * Opens a verification link. True when the address was marked verified.
   * False — the one generic refusal — for an unknown, used or expired link,
   * another shop's link (checked BEFORE the token is spent), or a link for
   * an address the user no longer has.
   */
  verify(token: string, now: string, requiredTenantId: number | null): boolean {
    const tokenHash = hashToken(token);
    const usable = this.tokenRepo.findUsableByTokenHash(tokenHash, now);
    if (!usable) return false;
    if (requiredTenantId !== null && usable.tenant_id !== requiredTenantId) {
      return false;
    }
    const row = this.tokenRepo.consume(tokenHash, now);
    if (!row) return false;
    const verified = runWithTenant(row.tenant_id, () =>
      this.userRepo.markEmailVerified(row.user_id, row.email, now),
    );
    authLogger.info(
      { userId: row.user_id, tenantId: row.tenant_id, verified },
      "Email verification link used",
    );
    if (verified) this.directory.syncUser(row.tenant_id, row.user_id, now);
    return verified;
  }

  // ---------------------------------------------------------------------------

  private overLimit(userId: number, now: string): boolean {
    return (
      this.tokenRepo.countForUserSince(userId, addMs(now, -EMAIL_VERIFY_WINDOW_MS)) >=
      EMAIL_VERIFY_PER_USER_LIMIT
    );
  }

  /** Token row + outbox row + link, inside the caller's transaction. */
  private issue(
    userId: number,
    email: string,
    shop: TenantEntity,
    baseUrl: string,
    ctx: UserEmailSendContext,
  ): void {
    const token = this.newToken();
    const expiresAt = addMs(ctx.now, EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1000);
    const username = this.userRepo.findById(userId)?.username ?? "";
    const created = this.tokenRepo.createToken({
      userId,
      email,
      tokenHash: hashToken(token),
      expiresAt,
      now: ctx.now,
    });
    const outbox = runWithoutTenant(() =>
      this.outboxRepo.enqueue({
        idempotencyKey: verifyEmailIdempotencyKey(ctx.tenantId, created.id),
        template: VERIFY_EMAIL_TEMPLATE,
        toEmail: email,
        data: {
          [EMAIL_VERIFY_URL_KEY]: verifyUrl(baseUrl, token),
          username,
          shopName: shop.name,
          expiresAtText: formatInviteExpiry(expiresAt),
          supportEmail: ctx.supportEmail,
        },
        now: ctx.now,
        giveUpAt: expiresAt,
      }),
    );
    this.tokenRepo.linkOutbox(created.id, outbox.id, ctx.now);
  }

  private shopById(tenantId: number): TenantEntity | null {
    return runWithoutTenant(() => this.tenantRepo.getById(tenantId));
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: UserEmailService | null = null;

export function getUserEmailService(): UserEmailService {
  if (!instance) {
    instance = new UserEmailService(
      getUserRepository(),
      getEmailVerificationTokenRepository(),
      getEmailOutboxRepository(),
      getTenantRepository(),
    );
  }
  return instance;
}

export function resetUserEmailService(): void {
  instance = null;
}
