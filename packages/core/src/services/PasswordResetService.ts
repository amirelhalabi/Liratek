/**
 * PasswordResetService (LIRA-275/276) — "Forgot password?" and the shop
 * admin's "send a reset link".
 *
 * No SQL here (rule 13): every read and write goes through the token, user,
 * session, outbox and tenant repositories.
 *
 * "Now" is a UTC ISO string the caller passes in. Expiry is decided by the
 * SERVER's clock on purpose (the same rule-27 exception as sign-up links):
 * a client-supplied "now" would let anyone extend a link.
 *
 * Scoping. A shop's users and tokens are tenant-scoped; the outbox and the
 * tenants registry are platform-level. Every method enters the right scope
 * itself (`runWithTenant(shop)` for the user/token work, `runWithoutTenant`
 * for the outbox and the registry), so callers only decide WHICH shop.
 * In shared-DB mode (production today) every write below is one SQLite
 * transaction. In per-tenant mode the outbox lives in another file, so the
 * token row and its email are no longer atomic — accepted, like the rest of
 * per-tenant mode, until that mode goes live.
 *
 * Who gets mail: ONLY an active user whose email is VERIFIED. An unverified
 * address may be a typo, and a reset link sent to a stranger hands them the
 * account (contract C, owner to confirm).
 */

import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import type { PasswordResetTokenRepository } from "../repositories/PasswordResetTokenRepository.js";
import { getPasswordResetTokenRepository } from "../repositories/PasswordResetTokenRepository.js";
import type { UserRepository } from "../repositories/UserRepository.js";
import { getUserRepository } from "../repositories/UserRepository.js";
import {
  getSigninDirectoryRepository,
  type SigninDirectoryRepository,
} from "../repositories/SigninDirectoryRepository.js";
import type { SessionRepository } from "../repositories/SessionRepository.js";
import { getSessionRepository } from "../repositories/SessionRepository.js";
import type { EmailOutboxRepository } from "../repositories/EmailOutboxRepository.js";
import { getEmailOutboxRepository } from "../repositories/EmailOutboxRepository.js";
import type {
  TenantEntity,
  TenantRepository,
} from "../repositories/TenantRepository.js";
import { getTenantRepository } from "../repositories/TenantRepository.js";
import { generateToken, hashPassword, hashToken } from "../utils/crypto.js";
import { validatePasswordComplexity } from "../utils/passwordPolicy.js";
import { AppError, ValidationError } from "../utils/errors.js";
import { authLogger } from "../utils/logger.js";
import { formatInviteExpiry } from "./SignupInvitationService.js";
import {
  PASSWORD_RESET_CODES,
  PASSWORD_RESET_EVERY_SHOP_MAX,
  PASSWORD_RESET_PER_USER_LIMIT,
  PASSWORD_RESET_PER_USER_WINDOW_MS,
  type PasswordResetCode,
} from "../constants/passwordReset.js";

// =============================================================================
// Constants
// =============================================================================

/** The outbox template that carries a reset link. */
export const PASSWORD_RESET_TEMPLATE = "password-reset";

/** The outbox data key holding the secret link. */
export const PASSWORD_RESET_URL_KEY = "resetUrl";

// =============================================================================
// Types
// =============================================================================

/** Why a forgot-password request did or did not queue an email. Internal
 * only: the route answers every one of these identically. */
export type PasswordResetRequestReason =
  | "queued"
  | "no_account"
  | "not_verified"
  | "user_limit"
  | "not_configured";

/** Everything needed to email a link, decided by the caller (server config). */
export interface PasswordResetMailOptions {
  /** UTC ISO. */
  now: string;
  /** The shop's link origin (`resolveShopLinkBaseUrl`); null = refuse. */
  linkBaseUrl: (slug: string) => string | null;
  /** False when the server has no mail transport. */
  emailConfigured: boolean;
  /** Shown in the email as the address to write to for help. */
  supportEmail: string;
  /** PASSWORD_RESET_TTL_MINUTES. */
  ttlMinutes: number;
}

export interface RequestPasswordResetParams extends PasswordResetMailOptions {
  /** The shop the request is for (from the host, or the typed address). */
  tenantId: number;
  /** As typed; normalised by the repository lookup. */
  email: string;
  /** Stored only as `hashToken(ip)`. */
  requesterIp?: string | null;
}

export interface SendPasswordResetParams extends PasswordResetMailOptions {
  /** The admin's shop, from the JWT. */
  tenantId: number;
  userId: number;
}

export interface PasswordResetCheckResult {
  username: string;
  shopName: string;
}

/** A completed reset — what the route needs for its audit row and reply. */
export interface PasswordResetDone {
  userId: number;
  username: string;
  role: string;
  tenantId: number;
  tenantSlug: string;
  sessionsRevoked: number;
}

export interface PasswordResetServiceDeps {
  tokenRepo: PasswordResetTokenRepository;
  userRepo: UserRepository;
  sessionRepo: SessionRepository;
  outboxRepo: EmailOutboxRepository;
  tenantRepo: TenantRepository;
  /** LIRA-288: the www fan-out's "which shops does this email sign in to?". */
  directoryRepo: SigninDirectoryRepository;
  newToken: () => string;
}

/** A refusal of `sendForUser`, carrying one of PASSWORD_RESET_CODES. */
export class PasswordResetRefusedError extends AppError {
  constructor(code: PasswordResetCode, message: string) {
    super(code, message, 409, true);
  }
}

// =============================================================================
// Pure helpers
// =============================================================================

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function resetUrl(baseUrl: string, token: string): string {
  // Hash route: the web app uses HashRouter (see SignupInvitationService).
  return `${baseUrl.replace(/\/+$/, "")}/#/reset-password?token=${encodeURIComponent(token)}`;
}

// =============================================================================
// Service
// =============================================================================

interface ResetTarget {
  userId: number;
  username: string;
  email: string;
}

export class PasswordResetService {
  private readonly tokenRepo: PasswordResetTokenRepository;
  private readonly userRepo: UserRepository;
  private readonly sessionRepo: SessionRepository;
  private readonly outboxRepo: EmailOutboxRepository;
  private readonly tenantRepo: TenantRepository;
  private readonly directoryRepo: SigninDirectoryRepository;
  private readonly newToken: () => string;

  constructor(deps: Partial<PasswordResetServiceDeps> = {}) {
    this.tokenRepo = deps.tokenRepo ?? getPasswordResetTokenRepository();
    this.userRepo = deps.userRepo ?? getUserRepository();
    this.sessionRepo = deps.sessionRepo ?? getSessionRepository();
    this.outboxRepo = deps.outboxRepo ?? getEmailOutboxRepository();
    this.tenantRepo = deps.tenantRepo ?? getTenantRepository();
    this.directoryRepo = deps.directoryRepo ?? getSigninDirectoryRepository();
    this.newToken = deps.newToken ?? generateToken;
  }

  /**
   * "Forgot password?" Never throws for a business outcome: the route answers
   * every reason with the same message, so the form cannot reveal which
   * emails have accounts. The address is logged only as `hashToken(email)`.
   */
  requestByEmail(params: RequestPasswordResetParams): {
    queued: boolean;
    reason: PasswordResetRequestReason;
  } {
    const emailHash = hashToken(params.email.trim().toLowerCase());
    const outcome = (reason: PasswordResetRequestReason) => {
      authLogger.info(
        { emailHash, tenantId: params.tenantId, reason },
        reason === "queued"
          ? "Password reset link queued"
          : "Password reset request not sent",
      );
      return { queued: reason === "queued", reason };
    };

    const tenant = this.activeTenant(params.tenantId);
    if (!tenant) return outcome("no_account");
    const baseUrl = params.emailConfigured ? params.linkBaseUrl(tenant.slug) : null;
    if (!baseUrl) return outcome("not_configured");

    return runWithTenant(tenant.id, () => {
      const user = this.userRepo.findByEmailInTenant(params.email, tenant.id);
      if (!user || !user.email) return outcome("no_account");
      if (!user.email_verified_at) return outcome("not_verified");
      if (this.overUserLimit(user.id, params.now)) return outcome("user_limit");

      this.issue(
        { userId: user.id, username: user.username, email: user.email },
        tenant,
        baseUrl,
        params,
        params.requesterIp ? hashToken(params.requesterIp) : null,
      );
      return outcome("queued");
    });
  }

  /**
   * "Forgot password?" on www, where no shop is named (LIRA-287): one reset
   * link per shop this email signs in to (the platform sign-in directory,
   * LIRA-288 — confirmed email, active user, active shop; at most
   * PASSWORD_RESET_EVERY_SHOP_MAX), each through `requestByEmail`, so every
   * per-shop rule (verified only, per-user limit, the shop's own link
   * address, one email per link) applies unchanged. The existing email
   * already names the account and the shop. Never throws for a business
   * outcome. The directory is platform-level, so this works whether shops
   * share one file or each has its own.
   */
  requestByEmailEveryShop(
    params: Omit<RequestPasswordResetParams, "tenantId">,
  ): { queued: number } {
    const accounts = runWithoutTenant(() =>
      this.directoryRepo.findByEmail(params.email),
    );
    const shopIds = [...new Set(accounts.map((a) => a.tenant_id))].slice(
      0,
      PASSWORD_RESET_EVERY_SHOP_MAX,
    );
    let queued = 0;
    for (const tenantId of shopIds) {
      if (this.requestByEmail({ ...params, tenantId }).queued) queued += 1;
    }
    if (shopIds.length === 0) {
      authLogger.info(
        { emailHash: hashToken(params.email.trim().toLowerCase()) },
        "Password reset request (every shop) not sent: no account",
      );
    }
    return { queued };
  }

  /**
   * The shop admin's "send a reset link" (LIRA-276). Throws a
   * PasswordResetRefusedError with a code the Settings page can show:
   * EMAIL_NOT_CONFIGURED, NOT_FOUND (no such ACTIVE user in this shop),
   * USER_HAS_NO_EMAIL, EMAIL_NOT_VERIFIED, RATE_LIMITED.
   */
  sendForUser(params: SendPasswordResetParams): { sent: true } {
    const tenant = this.activeTenant(params.tenantId);
    const baseUrl =
      tenant && params.emailConfigured ? params.linkBaseUrl(tenant.slug) : null;
    if (!tenant || !baseUrl) {
      throw new PasswordResetRefusedError(
        PASSWORD_RESET_CODES.EMAIL_NOT_CONFIGURED,
        "Email is not set up on this server, so a reset link cannot be sent.",
      );
    }

    return runWithTenant(tenant.id, () => {
      const user = this.userRepo.findById(params.userId);
      const info = user ? this.userRepo.getEmail(user.id) : null;
      if (!user || !info) {
        throw new PasswordResetRefusedError(
          PASSWORD_RESET_CODES.NOT_FOUND,
          "User not found",
        );
      }
      if (!info.email) {
        throw new PasswordResetRefusedError(
          PASSWORD_RESET_CODES.USER_HAS_NO_EMAIL,
          "This user has no email address.",
        );
      }
      if (!info.email_verified_at) {
        throw new PasswordResetRefusedError(
          PASSWORD_RESET_CODES.EMAIL_NOT_VERIFIED,
          "This user's email is not verified yet.",
        );
      }
      if (this.overUserLimit(user.id, params.now)) {
        throw new PasswordResetRefusedError(
          PASSWORD_RESET_CODES.RATE_LIMITED,
          "Too many reset links for this user. Try again in an hour.",
        );
      }

      this.issue(
        { userId: user.id, username: user.username, email: info.email },
        tenant,
        baseUrl,
        params,
        null,
      );
      authLogger.info(
        { tenantId: tenant.id, userId: user.id },
        "Password reset link sent by a shop admin",
      );
      return { sent: true as const };
    });
  }

  /**
   * What the reset page shows for a link, or null when it cannot be used:
   * unknown, expired, used, another shop's host, or a user no longer active.
   * Read-only. `hostTenantId` is the shop the request's host names, or null
   * when the host names none (then no host check applies).
   */
  check(
    token: string,
    now: string,
    hostTenantId: number | null,
  ): PasswordResetCheckResult | null {
    const target = this.usableTarget(token, now, hostTenantId);
    if (!target) return null;
    return { username: target.user.username, shopName: target.tenant.name };
  }

  /**
   * Sets a new password from an emailed link. Order:
   *   1. the password is checked against the policy (throws ValidationError,
   *      the link stays usable);
   *   2. the link is looked up and its shop checked against the host
   *      (a mismatch leaves the link usable);
   *   3. in ONE transaction: consume the link, write the password, burn every
   *      other open link of that user, delete all of that user's sessions.
   *      If any write fails, the link is not used up.
   * Returns null for every unusable link (the generic refusal).
   */
  reset(
    token: string,
    password: string,
    now: string,
    hostTenantId: number | null,
  ): PasswordResetDone | null {
    const policy = validatePasswordComplexity(password);
    if (!policy.valid) throw new ValidationError(policy.errors.join(", "));

    const target = this.usableTarget(token, now, hostTenantId);
    if (!target) return null;
    const { tenant, user } = target;
    const passwordHash = hashPassword(password);
    const tokenHash = hashToken(token);

    return runWithTenant(tenant.id, () =>
      this.tokenRepo.transaction(() => {
        const consumed = this.tokenRepo.consume(tokenHash, now);
        if (!consumed || consumed.user_id !== user.id) return null;
        if (!this.userRepo.updatePassword(user.id, passwordHash)) return null;
        this.tokenRepo.invalidateForUser(user.id, now);
        const sessionsRevoked = this.sessionRepo.deleteByUserId(user.id);
        authLogger.info(
          { tenantId: tenant.id, userId: user.id, sessionsRevoked },
          "Password reset by emailed link",
        );
        return {
          userId: user.id,
          username: user.username,
          role: user.role,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          sessionsRevoked,
        };
      }),
    );
  }

  // ---------------------------------------------------------------------------

  /** The shop, if it exists and is active. Registry read, platform scope. */
  private activeTenant(tenantId: number): TenantEntity | null {
    const tenant = runWithoutTenant(() => this.tenantRepo.getById(tenantId));
    return tenant && tenant.status === "active" ? tenant : null;
  }

  private overUserLimit(userId: number, now: string): boolean {
    return (
      this.tokenRepo.countForUserSince(
        userId,
        addMs(now, -PASSWORD_RESET_PER_USER_WINDOW_MS),
      ) >= PASSWORD_RESET_PER_USER_LIMIT
    );
  }

  /**
   * The usable link's shop and (active) user, or null. Never consumes. The
   * token lookup is cross-tenant by design (the token is the capability);
   * the user lookup runs inside the token's own shop.
   */
  private usableTarget(
    token: string,
    now: string,
    hostTenantId: number | null,
  ): {
    tenant: TenantEntity;
    user: { id: number; username: string; role: string };
  } | null {
    const row = this.tokenRepo.findUsableByTokenHash(hashToken(token), now);
    if (!row) return null;
    if (hostTenantId !== null && row.tenant_id !== hostTenantId) {
      authLogger.warn(
        { tokenTenantId: row.tenant_id, hostTenantId },
        "Password reset link used on another shop's address",
      );
      return null;
    }
    const tenant = this.activeTenant(row.tenant_id);
    if (!tenant) return null;
    const user = runWithTenant(tenant.id, () =>
      this.userRepo.findById(row.user_id),
    );
    if (!user) return null;
    return {
      tenant,
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  /**
   * Burns the user's older links, issues a new one and queues its email —
   * in ONE transaction (shared-DB mode). Runs inside the shop's scope; the
   * outbox write is platform-level.
   */
  private issue(
    target: ResetTarget,
    tenant: TenantEntity,
    baseUrl: string,
    mail: PasswordResetMailOptions,
    requestedIpHash: string | null,
  ): void {
    const token = this.newToken();
    const expiresAt = addMs(mail.now, mail.ttlMinutes * 60 * 1000);

    this.tokenRepo.transaction(() => {
      this.tokenRepo.invalidateForUser(target.userId, mail.now);
      const created = this.tokenRepo.createToken({
        userId: target.userId,
        tokenHash: hashToken(token),
        expiresAt,
        requestedIpHash,
        now: mail.now,
      });
      const outbox = runWithoutTenant(() =>
        this.outboxRepo.enqueue({
          // The shop id is part of the key: token ids restart per shop file
          // in per-tenant mode, and the outbox is shared by every shop.
          idempotencyKey: `password-reset:${tenant.id}:${created.id}`,
          template: PASSWORD_RESET_TEMPLATE,
          toEmail: target.email,
          data: {
            [PASSWORD_RESET_URL_KEY]: resetUrl(baseUrl, token),
            username: target.username,
            shopName: tenant.name,
            expiresAtText: formatInviteExpiry(expiresAt),
            supportEmail: mail.supportEmail,
          },
          now: mail.now,
          // No round may start after the link itself stops working.
          giveUpAt: expiresAt,
        }),
      );
      this.tokenRepo.linkOutbox(created.id, outbox.id, mail.now);
    });
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: PasswordResetService | null = null;

export function getPasswordResetService(): PasswordResetService {
  if (!instance) instance = new PasswordResetService();
  return instance;
}

export function resetPasswordResetService(): void {
  instance = null;
}
