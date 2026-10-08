/**
 * User Identity Repository — TENANT-scoped (v196, LIRA-280; rule LIRA-288).
 *
 * Links a user to an external sign-in identity (today only Google, keyed by
 * Google's stable `sub`, stored as `subject`).
 *
 * ONE GOOGLE ACCOUNT = ONE USER PER SHOP (LIRA-288, owner decision
 * 2026-10-08, replacing LIRA-280's "one shop"): the same Google account may
 * be linked in several shops, but to at most one user in each. That is
 * exactly the schema's two unique indexes, so there is no application check:
 *   - UNIQUE (provider, subject, tenant_id): at most one user per shop;
 *   - UNIQUE (user_id, provider): one Google account per user.
 * Either violation is `IdentityAlreadyLinkedError`. Links are created from
 * Settings, a Google sign-up, or "Join with Google" on an invite — never
 * automatically by matching an email.
 *
 * Scoping: every method reads/writes ONE shop's records. `link`,
 * `findByUser`, `listForCurrentShop`, `unlink` use the CURRENT shop;
 * `findBySubjectInTenant` takes an explicit shop and must run in that shop's
 * scope (`runWithTenant`) so per-tenant mode reads the right file. The www
 * "which shops can this Google account open?" question is answered by the
 * platform sign-in directory (`SigninDirectoryRepository`), never here.
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  AppError,
  DatabaseError,
  IdentityAlreadyLinkedError,
} from "../utils/errors.js";
import { normalizeEmail } from "./UserRepository.js";

export type IdentityProvider = "google";

export interface UserIdentityEntity extends BaseEntity {
  id: number;
  user_id: number;
  tenant_id: number;
  provider: IdentityProvider;
  subject: string;
  email: string | null;
  created_at: string;
  updated_at: string;
  /** v204 (LIRA-294): the Google profile photo, or null. */
  picture_url: string | null;
}

export interface LinkUserIdentityData {
  /** A user of the CURRENT shop. */
  userId: number;
  provider: IdentityProvider;
  subject: string;
  /** The provider's email at link time (informational; normalised). */
  email: string | null;
  /** LIRA-294: the profile photo URL, ALREADY checked by
   * `safeGooglePictureUrl` (null = none). Refreshed on a repeat link. */
  pictureUrl?: string | null;
  /** UTC ISO — written to created_at/updated_at. */
  now: string;
}

/** The user a provider identity opens in one shop (by-subject lookup). */
export interface IdentityMatch {
  identity_id: number;
  user_id: number;
  tenant_id: number;
  username: string;
  role: string;
}

const COLUMNS = [
  "id",
  "user_id",
  "tenant_id",
  "provider",
  "subject",
  "email",
  "created_at",
  "updated_at",
  "picture_url",
].join(", ");

/** The by-subject projection: only ACTIVE users can be signed into. */
const MATCH_SELECT = `
  SELECT ui.id AS identity_id, ui.user_id, ui.tenant_id, u.username, u.role
    FROM user_identities ui
    JOIN users u ON u.id = ui.user_id AND u.tenant_id = ui.tenant_id
   WHERE ui.provider = ? AND ui.subject = ? AND u.is_active = 1`;

/** Duck-typed (not `instanceof Error`): better-sqlite3's SqliteError can
 * come from another realm. */
function isUniqueViolation(error: unknown): boolean {
  const raw = (error as { message?: unknown } | null)?.message;
  return (
    typeof raw === "string" &&
    /UNIQUE constraint failed: user_identities\./.test(raw)
  );
}

export class UserIdentityRepository extends BaseRepository<UserIdentityEntity> {
  constructor() {
    super("user_identities", { tenantScoped: true });
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  /**
   * Links an identity to a user of the CURRENT shop. Linking the same
   * account to the same user again is a no-op that returns the existing row.
   * Being linked in OTHER shops never matters (LIRA-288). Throws:
   *   - `IdentityAlreadyLinkedError` (IDENTITY_ALREADY_LINKED) when it is
   *     linked to another user here, or the user already has another one;
   *   - `DatabaseError` when the user is not in the current shop.
   */
  link(data: LinkUserIdentityData): UserIdentityEntity {
    const tenantId = getCurrentTenantId();
    // IMMEDIATE: the write lock is taken before the reads, so the
    // idempotence check and the insert see the same state.
    const linkOnce = this.db.transaction((): UserIdentityEntity => {
      // Refuse a user of another shop up front: the FK alone would accept
      // any existing user id.
      const owner = this.db
        .prepare(`SELECT 1 FROM users WHERE id = ? AND tenant_id = ?`)
        .get(data.userId, tenantId);
      if (!owner) {
        throw new DatabaseError("User not found in this shop", {
          entityId: data.userId,
        });
      }
      const existing = this.findByUser(data.userId, data.provider);
      if (existing && existing.subject === data.subject) {
        // LIRA-294: the same link again refreshes the photo.
        if (data.pictureUrl !== undefined) {
          this.db
            .prepare(
              `UPDATE user_identities SET picture_url = ?, updated_at = ?
                WHERE id = ? AND tenant_id = ?`,
            )
            .run(data.pictureUrl, data.now, existing.id, tenantId);
          return { ...existing, picture_url: data.pictureUrl };
        }
        return existing;
      }
      const result = this.db
        .prepare(
          `INSERT INTO user_identities
             (user_id, tenant_id, provider, subject, email, created_at, updated_at, picture_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.userId,
          tenantId,
          data.provider,
          data.subject,
          data.email ? normalizeEmail(data.email) : null,
          data.now,
          data.now,
          data.pictureUrl ?? null,
        );
      const created = this.findById(Number(result.lastInsertRowid));
      if (!created) {
        throw new DatabaseError("Created identity could not be reloaded");
      }
      return created;
    });
    try {
      return linkOnce.immediate();
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityAlreadyLinkedError();
      if (error instanceof AppError) throw error;
      throw new DatabaseError("Failed to link identity", { cause: error });
    }
  }

  /** A CURRENT-shop user's link for one provider, or null. */
  findByUser(
    userId: number,
    provider: IdentityProvider,
  ): UserIdentityEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${COLUMNS} FROM user_identities
            WHERE user_id = ? AND provider = ? AND tenant_id = ?`,
        )
        .get(userId, provider, getCurrentTenantId()) as
        | UserIdentityEntity
        | undefined) ?? null
    );
  }

  /** Every CURRENT-shop link for one provider (the sign-in directory's
   * per-shop rebuild, LIRA-288). */
  listForCurrentShop(provider: IdentityProvider): UserIdentityEntity[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM user_identities
          WHERE provider = ? AND tenant_id = ?
          ORDER BY user_id`,
      )
      .all(provider, getCurrentTenantId()) as UserIdentityEntity[];
  }

  /**
   * LIRA-294: refresh the profile photo of the CURRENT shop's link for this
   * provider account (on a Google sign-in). `pictureUrl` is already checked
   * (`safeGooglePictureUrl`); null clears it. False when there is no link.
   */
  setPicture(
    provider: IdentityProvider,
    subject: string,
    pictureUrl: string | null,
    now: string,
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE user_identities SET picture_url = ?, updated_at = ?
            WHERE provider = ? AND subject = ? AND tenant_id = ?`,
        )
        .run(pictureUrl, now, provider, subject, getCurrentTenantId()).changes >
      0
    );
  }

  /** Removes a CURRENT-shop user's link. False when there was none. */
  unlink(userId: number, provider: IdentityProvider): boolean {
    return (
      this.db
        .prepare(
          `DELETE FROM user_identities
            WHERE user_id = ? AND provider = ? AND tenant_id = ?`,
        )
        .run(userId, provider, getCurrentTenantId()).changes > 0
    );
  }

  /** The active user this identity opens in one explicit shop, or null. */
  findBySubjectInTenant(
    provider: IdentityProvider,
    subject: string,
    tenantId: number,
  ): IdentityMatch | null {
    return (
      (this.db
        .prepare(
          `${MATCH_SELECT} /* tenant-exempt: explicit shop supplied by caller */ AND ui.tenant_id = ?`,
        )
        .get(provider, subject, tenantId) as IdentityMatch | undefined) ?? null
    );
  }
}

let instance: UserIdentityRepository | null = null;

export function getUserIdentityRepository(): UserIdentityRepository {
  if (!instance) instance = new UserIdentityRepository();
  return instance;
}

export function resetUserIdentityRepository(): void {
  instance = null;
}
