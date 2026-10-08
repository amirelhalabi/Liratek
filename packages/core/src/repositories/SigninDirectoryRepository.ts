/**
 * Sign-in directory repository — PLATFORM-scoped (v200, LIRA-288).
 *
 * The www index behind "which shops can this person open?": one row per
 * sign-in method of an active, non-super-admin shop user — `kind='email'`
 * (a CONFIRMED email, lowercased) or `kind='google'` (the Google `sub`) —
 * naming the shop (`target_tenant_id`) and the user (`target_user_id`).
 *
 * The shop's own `users` / `user_identities` are the source of truth;
 * `SigninDirectoryService` keeps this table in step with them and rebuilds
 * it on demand. Nothing here reads a shop's records: every method runs in
 * the PLATFORM scope (`runWithoutTenant`), so www's answers are the same
 * whether shops share one file or each has its own.
 *
 * Shop status is applied at READ time by the one predicate
 * `DIRECTORY_USABLE` (rule 14): suspending, archiving or reactivating a shop
 * needs no write here.
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { normalizeEmail } from "./UserRepository.js";

export type SigninDirectoryKind = "email" | "google";

/** One directory row for a user, as `SigninDirectoryService` builds it. */
export interface SigninDirectoryRowInput {
  kind: SigninDirectoryKind;
  /** email: lowercased address; google: the Google `sub`. */
  value: string;
  target_user_id: number;
  username: string;
  /** google rows: the address Google reported; email rows: null. */
  display_email: string | null;
}

/** A row with the shop it names — what a full rebuild writes. */
export interface SigninDirectoryTenantRow extends SigninDirectoryRowInput {
  target_tenant_id: number;
}

export interface SigninDirectoryEntry extends BaseEntity {
  id: number;
  kind: SigninDirectoryKind;
  value: string;
  target_tenant_id: number;
  target_user_id: number;
  username: string;
  display_email: string | null;
  created_at: string;
  updated_at: string;
}

/** One shop a person can open (www lists). Same shape the old cross-tenant
 * lookups returned, so their callers barely change. */
export interface DirectoryAccount {
  tenant_id: number;
  slug: string;
  shop_name: string;
  user_id: number;
  username: string;
}

/**
 * "This directory row can be used to sign in right now": its shop is
 * 'active'. The single definition (rule 14); `d` is signin_directory, `t`
 * is tenants. Replaces the two predicates that used to disagree
 * (`SIGNIN_ACCOUNT_FROM` said 'active', the Google live-link check also
 * accepted 'provisioning').
 */
export const DIRECTORY_USABLE = `
  JOIN tenants t ON t.id = d.target_tenant_id
 WHERE t.status = 'active'`;

export class SigninDirectoryRepository extends BaseRepository<SigninDirectoryEntry> {
  constructor() {
    super("signin_directory", { tenantScoped: false });
  }

  protected getColumns(): string {
    return "id, kind, value, target_tenant_id, target_user_id, username, display_email, created_at, updated_at";
  }

  /** Replaces every row of one user of one shop with `rows`, in one
   * transaction. An empty `rows` removes the user from the directory. */
  replaceForUser(
    tenantId: number,
    userId: number,
    rows: SigninDirectoryRowInput[],
    now: string,
  ): void {
    this.transaction(() => {
      this.execute(
        `DELETE FROM signin_directory WHERE target_tenant_id = ? AND target_user_id = ?`,
        tenantId,
        userId,
      );
      for (const row of rows) this.upsert(tenantId, row, now);
    });
  }

  /** Replaces every row of one shop with `rows`, in one transaction. */
  replaceForTenant(
    tenantId: number,
    rows: SigninDirectoryRowInput[],
    now: string,
  ): void {
    this.transaction(() => {
      this.execute(
        `DELETE FROM signin_directory WHERE target_tenant_id = ?`,
        tenantId,
      );
      for (const row of rows) this.upsert(tenantId, row, now);
    });
  }

  /** Replaces the WHOLE directory, in one transaction (repair). */
  replaceAll(rows: SigninDirectoryTenantRow[], now: string): void {
    this.transaction(() => {
      this.execute(`DELETE FROM signin_directory`);
      for (const row of rows) this.upsert(row.target_tenant_id, row, now);
    });
  }

  /** Removes a shop's rows (shop deleted). Returns how many. */
  deleteForTenant(tenantId: number): number {
    return this.execute(
      `DELETE FROM signin_directory WHERE target_tenant_id = ?`,
      tenantId,
    ).changes;
  }

  /** Every usable shop where this email is a confirmed user, by shop name. */
  findByEmail(email: string): DirectoryAccount[] {
    return this.findAccounts("email", directoryEmail(email));
  }

  /** Every usable shop where this Google account is linked, by shop name. */
  findByGoogleSubject(subject: string): DirectoryAccount[] {
    return this.findAccounts("google", subject);
  }

  /** Every row (repair / drift check), in a stable order. */
  listAll(): SigninDirectoryEntry[] {
    return this.query<SigninDirectoryEntry>(
      `SELECT ${this.getColumns()} FROM signin_directory
        ORDER BY target_tenant_id, target_user_id, kind, value`,
    );
  }

  // ---------------------------------------------------------------------------

  private findAccounts(kind: SigninDirectoryKind, value: string): DirectoryAccount[] {
    return this.query<DirectoryAccount>(
      `SELECT t.id AS tenant_id, t.slug AS slug, t.name AS shop_name,
              d.target_user_id AS user_id, d.username AS username
         FROM signin_directory d
         ${DIRECTORY_USABLE}
          AND d.kind = ? AND d.value = ?
        ORDER BY t.name COLLATE NOCASE, t.id, d.username COLLATE NOCASE`,
      kind,
      value,
    );
  }

  /**
   * One row in. A (kind, value) already held by ANOTHER user of the same
   * shop is taken over: the shop's own records are unique per shop (email
   * index, user_identities UNIQUE), so the older row can only be stale —
   * its owner has not been re-synced yet.
   */
  private upsert(tenantId: number, row: SigninDirectoryRowInput, now: string): void {
    this.execute(
      `INSERT INTO signin_directory
         (kind, value, target_tenant_id, target_user_id, username, display_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, value, target_tenant_id) DO UPDATE SET
         target_user_id = excluded.target_user_id,
         username = excluded.username,
         display_email = excluded.display_email,
         updated_at = excluded.updated_at`,
      row.kind,
      row.kind === "email" ? directoryEmail(row.value) : row.value,
      tenantId,
      row.target_user_id,
      row.username,
      row.display_email,
      now,
      now,
    );
  }
}

let instance: SigninDirectoryRepository | null = null;

export function getSigninDirectoryRepository(): SigninDirectoryRepository {
  if (!instance) instance = new SigninDirectoryRepository();
  return instance;
}

export function resetSigninDirectoryRepository(): void {
  instance = null;
}

/** Normalises an email the way every directory row stores it. */
export function directoryEmail(email: string): string {
  return normalizeEmail(email);
}
