/**
 * User Identity Repository — TENANT-scoped (v196, LIRA-280).
 *
 * Links a user to an external sign-in identity (today only Google, keyed by
 * Google's stable `sub`, stored as `subject`).
 *
 * ONE GOOGLE ACCOUNT = ONE SHOP (owner decision 2026-10-07): a Google account
 * may be linked to one user in one shop, platform-wide. Enforced by `link()`
 * — a check and the insert inside one IMMEDIATE transaction — NOT by a unique
 * index on (provider, subject): production already holds links made before
 * the decision (one account in two shops), which such an index could not be
 * built over, and those existing links keep working (sign-in shows the shop
 * chooser) until the owner disconnects one. The schema still enforces:
 *   - UNIQUE (provider, subject, tenant_id): at most one user per shop.
 *   - UNIQUE (user_id, provider): one Google account per user.
 * Owner decision (2026-10-07): links are created from Settings (or by a
 * Google sign-up) only — never automatically by matching an email.
 *
 * Scoping: `link`, `findByUser`, `unlink` run in the CURRENT shop.
 * `findBySubjectInTenant` takes an explicit shop. `findBySubjectAllTenants`
 * (the www "which shops can this Google account open?" lookup) and
 * `findLinksBySubject` (the one-shop check) are deliberately cross-tenant —
 * they only see every shop in SHARED DB mode. In per-tenant mode each shop's
 * rows live in its own file, so both lookups — and therefore the one-shop
 * rule — need a platform-level (provider, subject) index before that split
 * goes live (follow-up; documented in the plan's contracts §D).
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  AppError,
  DatabaseError,
  GoogleAccountInOtherShopError,
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

/** Where an identity is linked — every link, whatever the user's state. */
export interface IdentityLink {
  user_id: number;
  tenant_id: number;
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
   * Links an identity to a user of the CURRENT shop. Linking the same
   * account to the same user again is a no-op that returns the existing row.
   * Throws:
   *   - `GoogleAccountInOtherShopError` (GOOGLE_ACCOUNT_IN_OTHER_SHOP) when
   *     the account is already linked in ANOTHER shop (one account = one
   *     shop; a deactivated user's link counts too);
   *   - `IdentityAlreadyLinkedError` (IDENTITY_ALREADY_LINKED) when it is
   *     linked to another user here, or the user already has another one;
   *   - `DatabaseError` when the user is not in the current shop.
   */
  link(data: LinkUserIdentityData): UserIdentityEntity {
    const tenantId = getCurrentTenantId();
    // IMMEDIATE: the write lock is taken before the check, so no other
    // writer can link the same account between the check and the insert.
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
      const links = this.findLinksBySubject(data.provider, data.subject);
      const own = links.find(
        (l) => l.tenant_id === tenantId && l.user_id === data.userId,
      );
      if (own) {
        const existing = this.findByUser(data.userId, data.provider);
        if (existing) return existing;
      }
      if (links.some((l) => l.tenant_id !== tenantId)) {
        throw new GoogleAccountInOtherShopError();
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
    });
    try {
      return linkOnce.immediate();
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityAlreadyLinkedError();
      if (error instanceof AppError) throw error;
      throw new DatabaseError("Failed to link identity", { cause: error });
    }
  }

  /**
   * Every link of this identity, in every shop, whatever the user's state —
   * the one-account-one-shop check (`link`, and the Google sign-up refusal).
   * Cross-tenant by design; SHARED DB mode only (see header).
   */
  findLinksBySubject(
    provider: IdentityProvider,
    subject: string,
  ): IdentityLink[] {
    return this.db
      .prepare(
        `SELECT user_id, tenant_id FROM user_identities /* tenant-exempt: one Google account = one shop is a platform-wide rule */
          WHERE provider = ? AND subject = ?
          ORDER BY tenant_id, user_id`,
      )
      .all(provider, subject) as IdentityLink[];
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
