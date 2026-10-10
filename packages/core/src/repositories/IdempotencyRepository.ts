/**
 * IdempotencyRepository — stored replies for money submissions that carried
 * an Idempotency-Key (LIRA-289 v208, FR-017). Tenant-scoped; one row per
 * (tenant, user, route, key).
 *
 * `atomically` runs the duplicate check, the booking and the stored reply in
 * ONE SQLite transaction (better-sqlite3 nests the services' own transactions
 * as savepoints), so a crash can never leave a booking without its reply or a
 * reply without its booking.
 */

import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

export interface IdempotencyEntity extends BaseEntity {
  id: number;
  tenant_id: number;
  user_id: number;
  route: string;
  idem_key: string;
  response_json: string;
  created_at: string;
  updated_at: string;
}

export interface IdempotencyScope {
  userId: number;
  route: string;
  key: string;
}

const COLUMNS =
  "id, tenant_id, user_id, route, idem_key, response_json, created_at, updated_at";

export class IdempotencyRepository extends BaseRepository<IdempotencyEntity> {
  constructor() {
    super("idempotency_keys", { tenantScoped: true });
  }

  protected getColumns(): string {
    return COLUMNS;
  }

  /** The stored reply for this submission in the CURRENT shop, or null. */
  findResponse(scope: IdempotencyScope): string | null {
    const row = this.db
      .prepare(
        `SELECT response_json FROM idempotency_keys
          WHERE tenant_id = ? AND user_id = ? AND route = ? AND idem_key = ?`,
      )
      .get(getCurrentTenantId(), scope.userId, scope.route, scope.key) as
      | { response_json: string }
      | undefined;
    return row?.response_json ?? null;
  }

  /** Stores the reply of a successful submission. `now`: UTC ISO. */
  saveResponse(scope: IdempotencyScope, responseJson: string, now: string): void {
    this.db
      .prepare(
        `INSERT INTO idempotency_keys
           (tenant_id, user_id, route, idem_key, response_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(getCurrentTenantId(), scope.userId, scope.route, scope.key, responseJson, now, now);
  }

  /** Runs `fn` inside one transaction (nested service transactions become savepoints). */
  atomically<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Housekeeping: deletes replies created strictly before `beforeIso` (UTC ISO). */
  deleteOlderThan(beforeIso: string): number {
    return this.db
      .prepare(
        `DELETE FROM idempotency_keys /* tenant-exempt: global expired-row cleanup sweep — background maintenance job, must purge every tenant, not just the current context */ WHERE created_at < ?`,
      )
      .run(beforeIso).changes;
  }
}

let instance: IdempotencyRepository | null = null;

export function getIdempotencyRepository(): IdempotencyRepository {
  if (!instance) instance = new IdempotencyRepository();
  return instance;
}

export function resetIdempotencyRepository(): void {
  instance = null;
}
