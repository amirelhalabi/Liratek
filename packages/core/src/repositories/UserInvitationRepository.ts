/**
 * User Invitation Repository — TENANT-scoped (v196, LIRA-281).
 *
 * A shop admin invites someone into THEIR shop by email; the invitee opens
 * `https://<slug>.liratek.shop/#/join?invite=<token>` and picks a username
 * and password. Only `sha256(token)` is stored (`token_hash`).
 *
 * Using a link is claim -> create user -> finalize-or-release, the same
 * research-R4 pattern as `SignupInvitationRepository`: `claim()` is a
 * conditional UPDATE, and better-sqlite3 is synchronous with one writer, so
 * two requests racing on one token cannot both win. A claim older than the
 * caller's stale cutoff (10 minutes, like sign-up) lapses on its own.
 *
 * Scoping: create/list/revoke/finalize/release run in the CURRENT shop
 * (`tenant_id = getCurrentTenantId()`). The by-token lookups (`findByTokenHash`,
 * `claim`) are deliberately cross-tenant in SQL: the 256-bit token IS the
 * capability, and the row's `tenant_id` names the shop. The caller must
 * check that shop against the request host's shop (when the host resolves
 * one) and then do the rest inside `runWithTenant(row.tenant_id)`. In
 * per-tenant DB mode the caller must already be inside the host shop's
 * `runWithTenant` so this query reads the right file.
 *
 * `email_outbox_id` has no FK (the outbox is platform-only), and the list
 * does NOT join `email_outbox`: in per-tenant mode that table is empty in a
 * shop file. Read delivery state through `EmailOutboxRepository` under
 * `runWithoutTenant`.
 *
 * Time format: every timestamp written here, including `created_at`, is a
 * UTC ISO string supplied by the caller.
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError } from "../utils/errors.js";
import { normalizeEmail } from "./UserRepository.js";
import {
  deriveStatus,
  type SignupInvitationStatus,
} from "./SignupInvitationRepository.js";

// =============================================================================
// Types
// =============================================================================

export type UserInvitationRole = "admin" | "staff";

/** pending | used | expired | revoked — derived when read, never stored. */
export type UserInvitationStatus = SignupInvitationStatus;

export interface UserInvitationEntity extends BaseEntity {
  id: number;
  tenant_id: number;
  email: string;
  role: UserInvitationRole;
  token_hash: string;
  invited_by_user_id: number | null;
  expires_at: string;
  claimed_at: string | null;
  used_at: string | null;
  used_by_user_id: number | null;
  revoked_at: string | null;
  email_outbox_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInvitationData {
  /** Normalised again here (trim + lowercase). */
  email: string;
  role: UserInvitationRole;
  tokenHash: string;
  /** The inviting admin (from the JWT), or null. */
  invitedByUserId: number | null;
  expiresAt: string;
  /** UTC ISO — written to created_at/updated_at. */
  now: string;
}

const COLUMNS = [
  "id",
  "tenant_id",
  "email",
  "role",
  "token_hash",
  "invited_by_user_id",
  "expires_at",
  "claimed_at",
  "used_at",
  "used_by_user_id",
  "revoked_at",
  "email_outbox_id",
  "created_at",
  "updated_at",
].join(", ");

/** Same derivation as sign-up invites (rule 14): revoked, used, expired, pending. */
export const deriveUserInvitationStatus = deriveStatus;

// =============================================================================
// Repository
// =============================================================================

export class UserInvitationRepository extends BaseRepository<UserInvitationEntity> {
  constructor() {
    super("user_invitations", { tenantScoped: true });
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  /** Creates an invite in the CURRENT shop. */
  createInvitation(data: CreateUserInvitationData): UserInvitationEntity {
    const tenantId = getCurrentTenantId();
    try {
      const result = this.db
        .prepare(
          `INSERT INTO user_invitations
             (tenant_id, email, role, token_hash, invited_by_user_id,
              expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          tenantId,
          normalizeEmail(data.email),
          data.role,
          data.tokenHash,
          data.invitedByUserId,
          data.expiresAt,
          data.now,
          data.now,
        );
      const created = this.findById(Number(result.lastInsertRowid));
      if (!created) {
        throw new DatabaseError(
          "Created user invitation could not be reloaded",
        );
      }
      return created;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to create user invitation", {
        cause: error,
      });
    }
  }

  /** Points the invite at the outbox row that emails it. Current shop. */
  linkOutbox(id: number, outboxId: number, now: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE user_invitations SET email_outbox_id = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
        )
        .run(outboxId, now, id, getCurrentTenantId()).changes === 1
    );
  }

  /** By token, across shops — the token is the capability; see header. */
  findByTokenHash(tokenHash: string): UserInvitationEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${COLUMNS} FROM user_invitations /* tenant-exempt: lookup by 256-bit token hash; the tenant_id of the row names the shop and the caller checks it against the host */ WHERE token_hash = ?`,
        )
        .get(tokenHash) as UserInvitationEntity | undefined) ?? null
    );
  }

  /**
   * Atomically claims a usable invite: not used, not revoked, not expired,
   * and unclaimed or claimed before `staleBefore`. Returns the claimed row
   * (with its `tenant_id`), or null if this call did not win.
   */
  claim(
    tokenHash: string,
    now: string,
    staleBefore: string,
  ): UserInvitationEntity | null {
    const result = this.db
      .prepare(
        `UPDATE user_invitations /* tenant-exempt: claim by 256-bit token hash; the tenant_id of the row names the shop */
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
   * Marks the invite used by the user it created. Not blocked by
   * `revoked_at`: if the user now exists, recording that truthfully matters
   * more than the revoke that raced it. Single-shot.
   */
  finalize(id: number, userId: number, now: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE user_invitations /* tenant-exempt: id comes from the row claim() returned, so finalize works from any scope the claim ran in */
              SET used_at = ?, used_by_user_id = ?, updated_at = ?
            WHERE id = ? AND used_at IS NULL`,
        )
        .run(now, userId, now, id).changes === 1
    );
  }

  /** Drops a claim after user creation failed, so the link works again. */
  release(id: number, now: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE user_invitations /* tenant-exempt: id comes from the row claim() returned */
              SET claimed_at = NULL, updated_at = ?
            WHERE id = ? AND used_at IS NULL`,
        )
        .run(now, id).changes === 1
    );
  }

  /** Revokes an unused invite of the CURRENT shop. False if used/revoked/not ours. */
  revoke(id: number, now: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE user_invitations SET revoked_at = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
        )
        .run(now, now, id, getCurrentTenantId()).changes === 1
    );
  }

  /** The CURRENT shop's invites, newest first. Includes token_hash — never
   * send rows to a client as-is; map them to a view. */
  listRecent(limit: number): UserInvitationEntity[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM user_invitations
          WHERE tenant_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      )
      .all(getCurrentTenantId(), limit) as UserInvitationEntity[];
  }

  /** The CURRENT shop's still-usable invites for one email (duplicate check
   * and "resend"). */
  findPendingByEmail(email: string, now: string): UserInvitationEntity[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM user_invitations
          WHERE tenant_id = ? AND email = ?
            AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
          ORDER BY created_at DESC, id DESC`,
      )
      .all(
        getCurrentTenantId(),
        normalizeEmail(email),
        now,
      ) as UserInvitationEntity[];
  }

  /** Invites the CURRENT shop created at or after `sinceIso` (rate limit). */
  countCreatedSince(sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM user_invitations
          WHERE tenant_id = ? AND created_at >= ?`,
      )
      .get(getCurrentTenantId(), sinceIso) as { n: number };
    return row.n;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: UserInvitationRepository | null = null;

export function getUserInvitationRepository(): UserInvitationRepository {
  if (!instance) instance = new UserInvitationRepository();
  return instance;
}

export function resetUserInvitationRepository(): void {
  instance = null;
}
