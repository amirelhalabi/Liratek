/**
 * SignupInvitationService (LIRA-267) — single-use, emailed sign-up links.
 *
 * No SQL here (rule 13): every read and write goes through
 * `SignupInvitationRepository` / `EmailOutboxRepository`, both platform-level
 * (`tenantScoped: false`). Callers wrap every method in `runWithoutTenant`.
 *
 * "Now" is always a UTC ISO string passed in by the caller (data-model.md
 * "Time format"). Expiry is an absolute instant decided by the SERVER's clock
 * on purpose: if the client supplied "now", anyone could extend a link
 * (plan.md Complexity Tracking, the rule-27 exception).
 *
 * Using a link is claim -> provision -> finalize-or-release (research R4),
 * because creating a shop cannot share one transaction with this table in
 * per-tenant mode.
 */

import type {
  SignupInvitationEntity,
  SignupInvitationListRow,
  SignupInvitationRepository,
  SignupInvitationSource,
  SignupInvitationStatus,
} from "../repositories/SignupInvitationRepository.js";
import {
  deriveStatus,
  getSignupInvitationRepository,
} from "../repositories/SignupInvitationRepository.js";
import type {
  EmailOutboxRepository,
  EmailOutboxStatus,
} from "../repositories/EmailOutboxRepository.js";
import { getEmailOutboxRepository } from "../repositories/EmailOutboxRepository.js";
import { generateToken, hashToken } from "../utils/crypto.js";
import {
  EMAIL_ALREADY_HAS_SHOP,
  EmailAlreadyHasShopError,
  EmailNotConfiguredError,
  isAppError,
} from "../utils/errors.js";
import { authLogger } from "../utils/logger.js";

// =============================================================================
// Constants
// =============================================================================

/** A link works for 72 hours (spec). */
export const SIGNUP_INVITE_TTL_MS = 72 * 60 * 60 * 1000;

/** A claim older than this has lapsed (research R4): a crash between claim
 * and finalize frees the link on its own after 10 minutes. */
export const SIGNUP_INVITE_CLAIM_STALE_MS = 10 * 60 * 1000;

/** The outbox template that announces an invite. */
export const SIGNUP_INVITE_TEMPLATE = "signup-invite";

/** The outbox data key holding the secret link; scrubbed once the email is
 * final (research R3). */
export const SIGNUP_INVITE_URL_KEY = "inviteUrl";

/** The ONE refusal for every unusable link — unknown, expired, used, revoked
 * or claimed (spec FR-009) — so a response never says which. */
export const SIGNUP_INVITE_INVALID_MESSAGE =
  "This invite link is not valid. Ask for a new invite.";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// =============================================================================
// Types
// =============================================================================

export interface CreateSignupInvitationParams {
  source: SignupInvitationSource;
  /** Already trimmed + lowercased by the zod schema. */
  email: string;
  shopNameHint?: string | null;
  /** The super admin from the JWT; null for a self-serve request. */
  invitedByUserId: number | null;
  /** UTC ISO. */
  now: string;
  /** e.g. `https://www.liratek.shop` — the link is `${baseUrl}/signup?invite=…`. */
  baseUrl: string;
  /** False when the server has no mail transport: refuse up front. */
  emailConfigured: boolean;
  /** Shown in the email as the address to reply to for help. */
  supportEmail: string;
}

/** Outbox state as the admin sees it: `pending` and `sending` are both
 * "queued" (contracts/api.md). */
export type SignupInviteEmailStatus = "queued" | "accepted" | "failed";

/**
 * One invite as the admin list shows it (contracts/api.md list item).
 * Never carries the token or its hash.
 *
 * Deviation from contracts/api.md: the contract's example uses the key
 * `email` twice (the address AND the delivery object), which JSON cannot
 * hold. The delivery object is `emailDelivery` here.
 */
export interface SignupInvitationView {
  id: number;
  email: string;
  shopNameHint: string | null;
  source: SignupInvitationSource;
  status: SignupInvitationStatus;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByTenant: { id: number; slug: string } | null;
  revokedAt: string | null;
  emailDelivery: {
    status: SignupInviteEmailStatus;
    attempts: number;
    lastError: string | null;
    sentAt: string | null;
  } | null;
}

/** The extra outbox fields the view needs beyond the list row. */
export interface SignupInvitationViewExtras {
  emailAttempts: number;
  usedByTenant: { id: number; slug: string } | null;
}

export interface SignupInviteCheckResult {
  email: string;
  shopNameHint: string | null;
  expiresAt: string;
}

/** `ok: false` is the generic refusal; the caller never learns why. */
export type ConsumeSignupInviteOutcome<T> =
  | { ok: true; invite: SignupInvitationEntity; result: T }
  | { ok: false };

// =============================================================================
// Pure helpers
// =============================================================================

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

/**
 * `10 October 2026, 09:00 UTC`. Built from the UTC getters, never
 * `toLocaleString`, so the text is identical on every server whatever its
 * timezone or locale (rule 27), and says "UTC" outright.
 */
export function formatInviteExpiry(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function toSignupInviteEmailStatus(
  status: EmailOutboxStatus,
): SignupInviteEmailStatus {
  if (status === "accepted") return "accepted";
  if (status === "failed") return "failed";
  return "queued";
}

/** The one mapping from a stored invite to what the admin sees. */
export function toSignupInvitationView(
  row: SignupInvitationListRow,
  now: string,
  extras: SignupInvitationViewExtras,
): SignupInvitationView {
  return {
    id: row.id,
    email: row.email,
    shopNameHint: row.shop_name_hint,
    source: row.source,
    status: deriveStatus(row, now),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedByTenant: extras.usedByTenant,
    revokedAt: row.revoked_at,
    emailDelivery:
      row.email_status === null
        ? null
        : {
            status: toSignupInviteEmailStatus(row.email_status),
            attempts: extras.emailAttempts,
            lastError: row.email_last_error,
            sentAt: row.email_sent_at,
          },
  };
}

function inviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/signup?invite=${encodeURIComponent(token)}`;
}

// =============================================================================
// Service
// =============================================================================

export class SignupInvitationService {
  private inviteRepo: SignupInvitationRepository;
  private outboxRepo: EmailOutboxRepository;
  private newToken: () => string;

  constructor(
    inviteRepo: SignupInvitationRepository,
    outboxRepo: EmailOutboxRepository,
    tokenGenerator: () => string = generateToken,
  ) {
    this.inviteRepo = inviteRepo;
    this.outboxRepo = outboxRepo;
    this.newToken = tokenGenerator;
  }

  /**
   * Creates an invite and queues its email, in ONE transaction: either both
   * rows exist (linked) or neither does. Refuses EMAIL_NOT_CONFIGURED when
   * there is no mail transport and EMAIL_ALREADY_HAS_SHOP (with the shop's
   * slug) when the address already belongs to a shop.
   */
  create(params: CreateSignupInvitationParams): SignupInvitationView {
    try {
      if (!params.emailConfigured) {
        throw new EmailNotConfiguredError(
          "Email is not configured on this server, so an invite cannot be sent",
        );
      }

      const existing = this.inviteRepo.findTenantByContactEmail(params.email);
      if (existing) {
        throw new EmailAlreadyHasShopError(
          `This email already has a shop: ${existing.slug}`,
          { slug: existing.slug },
        );
      }

      const token = this.newToken();
      const expiresAt = addMs(params.now, SIGNUP_INVITE_TTL_MS);
      const shopNameHint = params.shopNameHint?.trim() || null;

      const { invite, outboxId } = this.inviteRepo.transaction(() => {
        const created = this.inviteRepo.createInvitation({
          email: params.email,
          shopNameHint,
          tokenHash: hashToken(token),
          source: params.source,
          invitedByUserId: params.invitedByUserId,
          expiresAt,
          now: params.now,
        });
        const outbox = this.outboxRepo.enqueue({
          idempotencyKey: `signup-invite:${created.id}`,
          template: SIGNUP_INVITE_TEMPLATE,
          toEmail: created.email,
          data: {
            [SIGNUP_INVITE_URL_KEY]: inviteUrl(params.baseUrl, token),
            // Always present ("" when absent) so the template's
            // {{#if shopNameHint}} has a value to test.
            shopNameHint: shopNameHint ?? "",
            expiresAtText: formatInviteExpiry(expiresAt),
            supportEmail: params.supportEmail,
          },
          now: params.now,
          // No round may start after the link itself stops working.
          giveUpAt: expiresAt,
        });
        this.inviteRepo.linkOutbox(created.id, outbox.id, params.now);
        return { invite: created, outboxId: outbox.id };
      });

      authLogger.info(
        { invitationId: invite.id, source: params.source, outboxId },
        "Sign-up invitation created",
      );

      return toSignupInvitationView(
        {
          id: invite.id,
          email: invite.email,
          shop_name_hint: invite.shop_name_hint,
          source: invite.source,
          invited_by_user_id: invite.invited_by_user_id,
          expires_at: invite.expires_at,
          claimed_at: invite.claimed_at,
          used_at: invite.used_at,
          used_by_tenant_id: invite.used_by_tenant_id,
          revoked_at: invite.revoked_at,
          email_outbox_id: outboxId,
          created_at: invite.created_at,
          updated_at: invite.updated_at,
          email_status: "pending",
          email_last_error: null,
          email_sent_at: null,
        },
        params.now,
        { emailAttempts: 0, usedByTenant: null },
      );
    } catch (error) {
      if (isAppError(error) && error.isOperational) {
        authLogger.info(
          { code: error.code, source: params.source },
          "Sign-up invitation refused",
        );
      } else {
        authLogger.error({ error }, "Sign-up invitation create failed");
      }
      throw error;
    }
  }

  /**
   * What the sign-up form shows for a link, or null when the link cannot be
   * used right now (unknown, expired, used, revoked, or claimed by a sign-up
   * in progress). Read-only.
   */
  check(token: string, now: string): SignupInviteCheckResult | null {
    const invite = this.inviteRepo.findByTokenHash(hashToken(token));
    if (!invite) return null;
    if (deriveStatus(invite, now) !== "pending") return null;
    if (invite.claimed_at && !this.claimHasLapsed(invite.claimed_at, now)) {
      return null;
    }
    return {
      email: invite.email,
      shopNameHint: invite.shop_name_hint,
      expiresAt: invite.expires_at,
    };
  }

  /**
   * Uses a link: claim -> `provision(invite)` -> finalize, or release on
   * failure (research R4). `provision` receives the claimed invite so the
   * shop is created with the INVITE's email, never one from the request.
   *
   * - Unusable link: `{ ok: false }`, `provision` is not called.
   * - `provision` throws: the claim is released (the link works again at
   *   once) and the error is rethrown for the caller to map.
   * - Crash case (FR-010): if this call re-claimed a LAPSED claim and
   *   provisioning fails with EMAIL_ALREADY_HAS_SHOP while a shop holds the
   *   invite's email, the earlier attempt created that shop and crashed
   *   before finalizing. The invite is finalized as used by that shop and the
   *   generic refusal is returned, so one invite never yields two shops.
   */
  consume<T extends { id: number }>(
    token: string,
    now: string,
    provision: (invite: SignupInvitationEntity) => T,
  ): ConsumeSignupInviteOutcome<T> {
    const tokenHash = hashToken(token);
    // Read BEFORE claiming: claim() overwrites claimed_at, and whether an
    // earlier claim existed is what tells the crash case apart from a race.
    const before = this.inviteRepo.findByTokenHash(tokenHash);
    const reclaimedLapsedClaim = Boolean(before?.claimed_at);

    const invite = this.inviteRepo.claim(
      tokenHash,
      now,
      addMs(now, -SIGNUP_INVITE_CLAIM_STALE_MS),
    );
    if (!invite) return { ok: false };

    let result: T;
    try {
      result = provision(invite);
    } catch (error) {
      if (
        reclaimedLapsedClaim &&
        isAppError(error) &&
        error.code === EMAIL_ALREADY_HAS_SHOP
      ) {
        const shop = this.inviteRepo.findTenantByContactEmail(invite.email);
        if (shop) {
          this.inviteRepo.finalize(invite.id, shop.id, now);
          authLogger.warn(
            { invitationId: invite.id, tenantId: shop.id },
            "Sign-up invite finalized after a crashed earlier attempt",
          );
          return { ok: false };
        }
      }
      this.releaseQuietly(invite.id, now);
      throw error;
    }

    if (!this.inviteRepo.finalize(invite.id, result.id, now)) {
      // Cannot happen while we hold the claim; logged, never thrown — the
      // shop exists and the caller must be told it does.
      authLogger.warn(
        { invitationId: invite.id, tenantId: result.id },
        "Sign-up invite was already finalized",
      );
    }
    authLogger.info(
      { invitationId: invite.id, tenantId: result.id },
      "Sign-up invite used",
    );
    return { ok: true, invite, result };
  }

  private claimHasLapsed(claimedAt: string, now: string): boolean {
    return (
      Date.parse(claimedAt) < Date.parse(now) - SIGNUP_INVITE_CLAIM_STALE_MS
    );
  }

  private releaseQuietly(id: number, now: string): void {
    try {
      this.inviteRepo.release(id, now);
    } catch (releaseError) {
      // The claim lapses on its own after 10 minutes; the provisioning error
      // is the one the caller needs to see.
      authLogger.error(
        { releaseError, invitationId: id },
        "Failed to release sign-up invite claim",
      );
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: SignupInvitationService | null = null;

export function getSignupInvitationService(): SignupInvitationService {
  if (!instance) {
    instance = new SignupInvitationService(
      getSignupInvitationRepository(),
      getEmailOutboxRepository(),
    );
  }
  return instance;
}

export function resetSignupInvitationService(): void {
  instance = null;
}
