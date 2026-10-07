/**
 * User Identity Repository — TENANT-scoped (v196, LIRA-280).
 *
 * Links a user to an external sign-in identity (today only Google, keyed by
 * Google's stable `sub`, stored as `subject`). Uniqueness, enforced by the
 * schema:
 *   - UNIQUE (provider, subject, tenant_id): one Google account may be linked
 *     in SEVERAL shops (one owner running several shops) but to at most ONE
 *     user per shop — otherwise signing in to that shop would be ambiguous.
 *   - UNIQUE (user_id, provider): one Google account per user.
 * Owner decision (2026-10-07): links are created from Settings only, while
 * signed in — never automatically by matching an email.
 *
 * Scoping: `link`, `findByUser`, `unlink` run in the CURRENT shop.
 * `findBySubjectInTenant` takes an explicit shop. `findBySubjectAllTenants`
 * is the www "which shops can this Google account open?" lookup and is
 * deliberately cross-tenant — it only sees every shop in SHARED DB mode. In
 * per-tenant mode each shop's rows live in its own file, so that lookup would
 * need a platform-level index (follow-up; documented in the plan's contracts).
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError, IdentityAlreadyLinkedError } from "../utils/errors.js";
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
}

export interface LinkUserIdentityData {
  /** A user of the CURRENT shop. */
  userId: number;
  provider: IdentityProvider;
  subject: string;
  /** The provider's email at link time (informational; normalised). */
  email: string | null;
  /** UTC ISO — written to created_at/updated_at. */
  now: string;
}

/** One shop a provider identity can open (by-subject lookups). */
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
].join(", ");

/** The one projection behind both by-subject lookups (rule 14): only
 * ACTIVE users can be signed into. */
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
   * Links an identity to a user of the CURRENT shop. Throws
   * `IdentityAlreadyLinkedError` (IDENTITY_ALREADY_LINKED) when the account
   * is already linked to another user here, or the user already has one;
   * a `DatabaseError` when the user is not in the current shop.
   */
  link(data: LinkUserIdentityData): UserIdentityEntity {
    const tenantId = getCurrentTenantId();
    try {
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
      const result = this.db
        .prepare(
          `INSERT INTO user_identities
             (user_id, tenant_id, provider, subject, email, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.userId,
          tenantId,
          data.provider,
          data.subject,
          data.email ? normalizeEmail(data.email) : null,
          data.now,
          data.now,
        );
      const created = this.findById(Number(result.lastInsertRowid));
      if (!created) {
        throw new DatabaseError("Created identity could not be reloaded");
      }
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityAlreadyLinkedError();
      if (error instanceof DatabaseError) throw error;
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

  /**
   * Every shop (active user) this identity opens, by shop id. Cross-tenant
   * by design — the www Google sign-in has no shop yet. SHARED DB mode only;
   * see header.
   */
  findBySubjectAllTenants(
    provider: IdentityProvider,
    subject: string,
  ): IdentityMatch[] {
    return this.db
      .prepare(
        `${MATCH_SELECT} /* tenant-exempt: www sign-in resolves which shops a Google account opens, before any shop is chosen */ ORDER BY ui.tenant_id, ui.user_id`,
      )
      .all(provider, subject) as IdentityMatch[];
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
