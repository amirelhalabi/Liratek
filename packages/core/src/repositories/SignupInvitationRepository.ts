/**
 * Signup Invitation Repository — PLATFORM level (LIRA-267, migration v195).
 *
 * Single-use sign-up links. Only `sha256(token)` is stored (`token_hash`);
 * the raw token exists only in the emailed link (and, until the email is
 * final, in the outbox row's `data_json`).
 *
 * Using a link is claim -> provision -> finalize-or-release (research R4),
 * because provisioning a shop cannot share one transaction with this table
 * in per-tenant mode. `claim()` is a conditional UPDATE: better-sqlite3 is
 * synchronous and the database has a single writer, so two sign-ups racing
 * on one token cannot both claim it. A claim older than the stale cutoff
 * (10 minutes, decided by the caller) lapses on its own, so a crash between
 * claim and finalize needs no cleanup.
 *
 * `signup_invitations` has NO `tenant_id` — `used_by_tenant_id` records the
 * shop an invite CREATED, it does not scope the row — so this repository is
 * `tenantScoped: false` and every caller wraps it in `runWithoutTenant`.
 *
 * Time format: every timestamp written here, INCLUDING `created_at`, is a
 * UTC ISO string supplied by the caller (`new Date().toISOString()` shape).
 * The rate-limit counts compare `created_at >= ?` as strings, and SQLite's
 * `CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`) sorts below a same-day ISO
 * cutoff — so relying on the column DEFAULT would silently disable the
 * limits. Never use `datetime('now')` for a comparison here.
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import type { TenantStatus } from "./TenantRepository.js";
import type { EmailOutboxStatus } from "./EmailOutboxRepository.js";

// =============================================================================
// Types
// =============================================================================

export type SignupInvitationSource = "admin" | "self";

export type SignupInvitationStatus = "pending" | "used" | "expired" | "revoked";

export interface SignupInvitationEntity extends BaseEntity {
  id: number;
  email: string;
  shop_name_hint: string | null;
  token_hash: string;
  source: SignupInvitationSource;
  /** The super admin who sent it; NULL for a self-serve request. */
  invited_by_user_id: number | null;
  expires_at: string;
  /** Short-lived lock while the shop is being created. */
  claimed_at: string | null;
  used_at: string | null;
  used_by_tenant_id: number | null;
  revoked_at: string | null;
  email_outbox_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSignupInvitationData {
  /** Already trimmed + lowercased (the zod schema does it). */
  email: string;
  shopNameHint?: string | null;
  tokenHash: string;
  source: SignupInvitationSource;
  invitedByUserId: number | null;
  expiresAt: string;
  /** UTC ISO — written to created_at/updated_at. */
  now: string;
}

/** A row for the admin list: the invite (minus its token hash) plus the
 * status of the email that announced it. */
export interface SignupInvitationListRow {
  id: number;
  email: string;
  shop_name_hint: string | null;
  source: SignupInvitationSource;
  invited_by_user_id: number | null;
  expires_at: string;
  claimed_at: string | null;
  used_at: string | null;
  used_by_tenant_id: number | null;
  revoked_at: string | null;
  email_outbox_id: number | null;
  created_at: string;
  updated_at: string;
  email_status: EmailOutboxStatus | null;
  /** Every individual send attempt so far; null when there is no outbox row. */
  email_attempts: number | null;
  email_last_error: string | null;
  email_sent_at: string | null;
  /** Slug of the shop this invite created; null until used. */
  used_by_tenant_slug: string | null;
}

export interface TenantByContactEmail {
  id: number;
  name: string;
  slug: string;
  status: TenantStatus;
}

const COLUMNS = [
  "id",
  "email",
  "shop_name_hint",
  "token_hash",
  "source",
  "invited_by_user_id",
  "expires_at",
  "claimed_at",
  "used_at",
  "used_by_tenant_id",
  "revoked_at",
  "email_outbox_id",
  "created_at",
  "updated_at",
].join(", ");

/**
 * The ONE projection behind every admin list row (rule 14): the invite minus
 * its token hash, the announcing email's state, and the slug of the shop it
 * created. `listRecent` and `findListRowById` add only their WHERE/ORDER.
 */
const LIST_ROW_SELECT = `
  SELECT si.id, si.email, si.shop_name_hint, si.source,
         si.invited_by_user_id, si.expires_at, si.claimed_at,
         si.used_at, si.used_by_tenant_id, si.revoked_at,
         si.email_outbox_id, si.created_at, si.updated_at,
         eo.status AS email_status,
         eo.attempts AS email_attempts,
         eo.last_error AS email_last_error,
         eo.sent_at AS email_sent_at,
         t.slug AS used_by_tenant_slug
    FROM signup_invitations si
    LEFT JOIN email_outbox eo ON eo.id = si.email_outbox_id
    LEFT JOIN tenants t ON t.id = si.used_by_tenant_id`;

// =============================================================================
// Derived status (pure)
// =============================================================================

/**
 * Status is derived when read, never stored. Checked in this order:
 * revoked, used, expired (`expires_at <= now`), pending. A claimed-but-unused
 * row is pending.
 */
export function deriveStatus<
  T extends Pick<
    SignupInvitationEntity,
    "revoked_at" | "used_at" | "expires_at"
  >,
>(row: T, now: string): SignupInvitationStatus {
  if (row.revoked_at) return "revoked";
  if (row.used_at) return "used";
  if (Date.parse(row.expires_at) <= Date.parse(now)) return "expired";
  return "pending";
}

// =============================================================================
// Repository
// =============================================================================

export class SignupInvitationRepository extends BaseRepository<SignupInvitationEntity> {
  constructor() {
    super("signup_invitations", { tenantScoped: false });
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  /**
   * Named `createInvitation` rather than `create` because BaseRepository's
   * generic `create(entity)` has an incompatible signature.
   */
  createInvitation(data: CreateSignupInvitationData): SignupInvitationEntity {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO signup_invitations
             (email, shop_name_hint, token_hash, source, invited_by_user_id,
              expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.email,
          data.shopNameHint ?? null,
          data.tokenHash,
          data.source,
          data.invitedByUserId,
          data.expiresAt,
          data.now,
          data.now,
        );
      const created = this.findById(Number(result.lastInsertRowid));
      if (!created) {
        throw new DatabaseError("Created invitation could not be reloaded");
      }
      return created;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to create signup invitation", {
        cause: error,
      });
    }
  }

  /** Points the invite at the outbox row that emails it. */
  linkOutbox(id: number, outboxId: number, now: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE signup_invitations
            SET email_outbox_id = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(outboxId, now, id);
    return result.changes === 1;
  }

  findByTokenHash(tokenHash: string): SignupInvitationEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${COLUMNS} FROM signup_invitations WHERE token_hash = ?`,
        )
        .get(tokenHash) as SignupInvitationEntity | undefined) ?? null
    );
  }

  /**
   * Atomically claims a usable invite (research R4): not used, not revoked,
   * not expired, and either unclaimed or claimed before `staleBefore`.
   * Returns the claimed row, or null if this call did not win the claim.
   */
  claim(
    tokenHash: string,
    now: string,
    staleBefore: string,
  ): SignupInvitationEntity | null {
    const result = this.db
      .prepare(
        `UPDATE signup_invitations
            SET claimed_at = ?, updated_at = ?
          WHERE token_hash = ?
            AND used_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > ?
            AND (claimed_at IS NULL OR claimed_at < ?)`,
      )
      .run(now, now, tokenHash, now, staleBefore);
    if (result.changes !== 1) return null;
    return this.findByTokenHash(tokenHash);
  }

  /**
   * Marks the invite used by the shop it created. Deliberately not blocked by
   * `revoked_at`: if the shop now exists, recording that truthfully matters
   * more than the revoke that raced it.
   */
  finalize(id: number, tenantId: number, now: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE signup_invitations
            SET used_at = ?, used_by_tenant_id = ?, updated_at = ?
          WHERE id = ? AND used_at IS NULL`,
      )
      .run(now, tenantId, now, id);
    return result.changes === 1;
  }

  /** Drops a claim after provisioning failed, so the link works again. */
  release(id: number, now: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE signup_invitations
            SET claimed_at = NULL, updated_at = ?
          WHERE id = ? AND used_at IS NULL`,
      )
      .run(now, id);
    return result.changes === 1;
  }

  /** Revokes an unused invite. False if it was already used or revoked. */
  revoke(id: number, now: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE signup_invitations
            SET revoked_at = ?, updated_at = ?
          WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL`,
      )
      .run(now, now, id);
    return result.changes === 1;
  }

  /**
   * Newest first, with the announcing email's status. Never the hash.
   * `source` (LIRA-278) filters BEFORE the limit, so self-serve rows are
   * never crowded out of a filtered list by newer admin invites.
   */
  listRecent(
    limit: number,
    source?: SignupInvitationSource,
  ): SignupInvitationListRow[] {
    if (source) {
      return this.db
        .prepare(
          `${LIST_ROW_SELECT}
            WHERE si.source = ?
            ORDER BY si.created_at DESC, si.id DESC
            LIMIT ?`,
        )
        .all(source, limit) as SignupInvitationListRow[];
    }
    return this.db
      .prepare(
        `${LIST_ROW_SELECT}
          ORDER BY si.created_at DESC, si.id DESC
          LIMIT ?`,
      )
      .all(limit) as SignupInvitationListRow[];
  }

  /** One admin list row by id, or null. Never the hash. */
  findListRowById(id: number): SignupInvitationListRow | null {
    return (
      (this.db
        .prepare(`${LIST_ROW_SELECT} WHERE si.id = ?`)
        .get(id) as SignupInvitationListRow | undefined) ?? null
    );
  }

  /**
   * The shop holding `email` as its contact email, if any. Used both to
   * refuse an invite for an email that already has a shop and to recover a
   * claim that crashed after provisioning (data-model.md).
   */
  findTenantByContactEmail(email: string): TenantByContactEmail | null {
    return (
      (this.db
        .prepare(
          `SELECT id, name, slug, status FROM tenants WHERE contact_email = ?`,
        )
        .get(email.trim().toLowerCase()) as TenantByContactEmail | undefined) ??
      null
    );
  }

  /** Self-serve requests for one email since `sinceIso` (per-email limit). */
  countSelfRequestsByEmailSince(email: string, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM signup_invitations
          WHERE source = 'self' AND email = ? AND created_at >= ?`,
      )
      .get(email.trim().toLowerCase(), sinceIso) as { n: number };
    return row.n;
  }

  /**
   * Every PUBLIC sign-up since `sinceIso`: emailed self-serve requests plus
   * shops created with Google (owner decision 2026-10-07: one daily limit
   * for all public sign-ups). Both tables are platform-level and both
   * stamps are UTC ISO strings written by the app, so the comparison is a
   * plain string compare. Admin invites and admin-created shops never count.
   * The ONE definition of the cap's count (rule 14).
   */
  countPublicSignupsSince(sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM signup_invitations
             WHERE source = 'self' AND created_at >= ?)
         + (SELECT COUNT(*) FROM tenants
             WHERE google_signup_at IS NOT NULL AND google_signup_at >= ?)
           AS n`,
      )
      .get(sinceIso, sinceIso) as { n: number };
    return row.n;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: SignupInvitationRepository | null = null;

export function getSignupInvitationRepository(): SignupInvitationRepository {
  if (!instance) instance = new SignupInvitationRepository();
  return instance;
}

export function resetSignupInvitationRepository(): void {
  instance = null;
}
