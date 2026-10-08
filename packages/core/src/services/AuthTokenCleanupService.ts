/**
 * Purges expired single-use auth rows once they are past a grace period:
 *
 *   - `signin_codes`, `sso_handoff_tokens` — PLATFORM tables (no tenant_id),
 *     swept in the platform pass only.
 *   - `password_reset_tokens`, `email_verification_tokens` — shop tables,
 *     swept in every file (the platform/shared file, plus each shop file in
 *     `per-tenant` mode).
 *
 * Before this, nothing ever deleted these rows, so they only grew. Only
 * `sha256` of each token is stored, so this is housekeeping, not secrecy.
 *
 * Deliberately NOT swept:
 *   - `user_invitations` / `signup_invitations` — the admin invite lists show
 *     them as history (used / expired / revoked).
 *   - `email_outbox` — the delivery record; secrets are already scrubbed when
 *     a row reaches a final status, and `signup_invitations.email_outbox_id`
 *     is a real FOREIGN KEY to it, so a purge would have to skip invite rows.
 *
 * Grace: a row is deleted only once it has been expired for
 * AUTH_TOKEN_PURGE_GRACE_MS. Until then an old link still resolves to the
 * same generic "expired" answer it gave a minute after expiry. Every
 * per-email/per-user rate-limit window is 1 hour and counts by `created_at`,
 * far inside the grace, so a purge can never reset a limit.
 *
 * Fan-out mirrors `SessionSweepService` (rule 13: SQL in the repositories,
 * this class only picks WHICH file is current). One shop's file failing never
 * stops the others or the platform pass — failures are logged and reported,
 * never thrown. "Now" is passed in by the caller (rule 27).
 */
import {
  SigninCodeRepository,
  getSigninCodeRepository,
} from "../repositories/SigninCodeRepository.js";
import {
  SsoHandoffTokenRepository,
  getSsoHandoffTokenRepository,
} from "../repositories/SsoHandoffTokenRepository.js";
import {
  PasswordResetTokenRepository,
  getPasswordResetTokenRepository,
} from "../repositories/PasswordResetTokenRepository.js";
import {
  EmailVerificationTokenRepository,
  getEmailVerificationTokenRepository,
} from "../repositories/EmailVerificationTokenRepository.js";
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import { listTenantDatabaseIds } from "../db/tenantDatabaseIds.js";
import { authLogger } from "../utils/logger.js";

/** How long a row stays after it expired before the sweep deletes it. */
export const AUTH_TOKEN_PURGE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthTokenCleanupResult {
  signinCodes: number;
  ssoHandoffTokens: number;
  passwordResetTokens: number;
  emailVerificationTokens: number;
  /** Databases swept successfully (platform + shops). */
  sweptDatabaseCount: number;
  /** True when the platform pass threw (logged, not thrown). */
  platformFailed: boolean;
  /** Shop ids whose pass threw (logged, not thrown). */
  failedTenantIds: number[];
}

export interface AuthTokenCleanupRepositories {
  signinCodes: SigninCodeRepository;
  ssoHandoffTokens: SsoHandoffTokenRepository;
  passwordResetTokens: PasswordResetTokenRepository;
  emailVerificationTokens: EmailVerificationTokenRepository;
}

export class AuthTokenCleanupService {
  private repos: AuthTokenCleanupRepositories;

  constructor(repos: AuthTokenCleanupRepositories) {
    this.repos = repos;
  }

  /** `nowIso`: the current UTC time as an ISO string. */
  sweepAll(nowIso: string): AuthTokenCleanupResult {
    const nowMs = Date.parse(nowIso);
    if (Number.isNaN(nowMs)) {
      throw new Error(`AuthTokenCleanupService: invalid now "${nowIso}"`);
    }
    const cutoff = new Date(nowMs - AUTH_TOKEN_PURGE_GRACE_MS).toISOString();

    const result: AuthTokenCleanupResult = {
      signinCodes: 0,
      ssoHandoffTokens: 0,
      passwordResetTokens: 0,
      emailVerificationTokens: 0,
      sweptDatabaseCount: 0,
      platformFailed: false,
      failedTenantIds: [],
    };

    const sweepShopTables = (): { reset: number; verify: number } => ({
      reset: this.repos.passwordResetTokens.deleteExpiredBefore(cutoff),
      verify: this.repos.emailVerificationTokens.deleteExpiredBefore(cutoff),
    });

    try {
      // Counts are added only after the whole pass succeeds, so a pass that
      // throws half-way reports nothing (its DELETEs are idempotent and the
      // next tick redoes them).
      const pass = runWithoutTenant(() => ({
        signin: this.repos.signinCodes.deleteExpiredBefore(cutoff),
        sso: this.repos.ssoHandoffTokens.deleteExpiredBefore(cutoff),
        ...sweepShopTables(),
      }));
      result.signinCodes += pass.signin;
      result.ssoHandoffTokens += pass.sso;
      result.passwordResetTokens += pass.reset;
      result.emailVerificationTokens += pass.verify;
      result.sweptDatabaseCount += 1;
    } catch (error) {
      result.platformFailed = true;
      authLogger.error(
        { error },
        "auth token cleanup failed for the platform database",
      );
    }

    const tenantIds = listTenantDatabaseIds();
    if (tenantIds) {
      for (const tenantId of tenantIds) {
        try {
          const pass = runWithTenant(tenantId, sweepShopTables);
          result.passwordResetTokens += pass.reset;
          result.emailVerificationTokens += pass.verify;
          result.sweptDatabaseCount += 1;
        } catch (error) {
          result.failedTenantIds.push(tenantId);
          authLogger.error(
            { error, tenantId },
            "auth token cleanup failed for a tenant database",
          );
        }
      }
    }

    return result;
  }
}

let instance: AuthTokenCleanupService | null = null;

export function getAuthTokenCleanupService(): AuthTokenCleanupService {
  if (!instance) {
    instance = new AuthTokenCleanupService({
      signinCodes: getSigninCodeRepository(),
      ssoHandoffTokens: getSsoHandoffTokenRepository(),
      passwordResetTokens: getPasswordResetTokenRepository(),
      emailVerificationTokens: getEmailVerificationTokenRepository(),
    });
  }
  return instance;
}

export function resetAuthTokenCleanupService(): void {
  instance = null;
}
