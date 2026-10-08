/**
 * SSO Hand-off Token Repository — PLATFORM level (v196, LIRA-280).
 *
 * After Google sign-in on `www`, the backend mints a ~60-second, single-use
 * token naming ONE user of ONE shop and redirects the browser to
 * `https://<slug>.liratek.shop/#/login?sso=<token>`; that page exchanges it
 * for a normal session. Only `sha256(token)` is stored.
 *
 * The table has no `tenant_id` — the shop is `target_tenant_id` — so the
 * per-tenant split keeps it in platform.db and the platform-split guard never
 * counts it as shop data. `tenantScoped: false`; every caller wraps it in
 * `runWithoutTenant`. Times are UTC ISO strings passed in.
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { EXPIRED_BEFORE_WHERE, USABLE_TOKEN_WHERE } from "./authTokenSql.js";

export interface SsoHandoffTokenEntity extends BaseEntity {
  id: number;
  token_hash: string;
  user_id: number;
  target_tenant_id: number;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSsoHandoffTokenData {
  tokenHash: string;
  userId: number;
  targetTenantId: number;
  expiresAt: string;
  /** UTC ISO — written to created_at/updated_at. */
  now: string;
}

const COLUMNS = [
  "id",
  "token_hash",
  "user_id",
  "target_tenant_id",
  "expires_at",
  "used_at",
  "created_at",
  "updated_at",
].join(", ");

export class SsoHandoffTokenRepository extends BaseRepository<SsoHandoffTokenEntity> {
  constructor() {
    super("sso_handoff_tokens", { tenantScoped: false });
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  createToken(data: CreateSsoHandoffTokenData): SsoHandoffTokenEntity {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO sso_handoff_tokens
             (token_hash, user_id, target_tenant_id, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.tokenHash,
          data.userId,
          data.targetTenantId,
          data.expiresAt,
          data.now,
          data.now,
        );
      const created = this.findById(Number(result.lastInsertRowid));
      if (!created) {
        throw new DatabaseError("Created hand-off token could not be reloaded");
      }
      return created;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("Failed to create hand-off token", {
        cause: error,
      });
    }
  }

  /** Atomically uses the hand-off; the row when THIS call consumed it,
   * else null (unknown, expired or already used). */
  consume(tokenHash: string, now: string): SsoHandoffTokenEntity | null {
    const result = this.db
      .prepare(
        `UPDATE sso_handoff_tokens SET used_at = ?, updated_at = ?
          WHERE token_hash = ? AND ${USABLE_TOKEN_WHERE}`,
      )
      .run(now, now, tokenHash, now);
    if (result.changes !== 1) return null;
    return (
      (this.db
        .prepare(
          `SELECT ${COLUMNS} FROM sso_handoff_tokens WHERE token_hash = ?`,
        )
        .get(tokenHash) as SsoHandoffTokenEntity | undefined) ?? null
    );
  }

  /** Housekeeping: deletes rows that expired before `beforeIso`. */
  deleteExpiredBefore(beforeIso: string): number {
    return this.db
      .prepare(`DELETE FROM sso_handoff_tokens WHERE ${EXPIRED_BEFORE_WHERE}`)
      .run(beforeIso).changes;
  }
}

let instance: SsoHandoffTokenRepository | null = null;

export function getSsoHandoffTokenRepository(): SsoHandoffTokenRepository {
  if (!instance) instance = new SsoHandoffTokenRepository();
  return instance;
}

export function resetSsoHandoffTokenRepository(): void {
  instance = null;
}
