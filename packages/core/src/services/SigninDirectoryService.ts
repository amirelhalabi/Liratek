/**
 * SigninDirectoryService (LIRA-288) — keeps the www sign-in directory
 * (`signin_directory`, platform level) in step with the shops' own records.
 *
 * The shop's `users` and `user_identities` are the SOURCE OF TRUTH; the
 * directory is an index of them. One idempotent operation keeps it current:
 * `syncUser(tenantId, userId)` reads that user's facts in the SHOP scope
 * (`runWithTenant`) and replaces that user's rows in the PLATFORM scope
 * (`runWithoutTenant`). Every writer calls it AFTER its own shop-side
 * commit. In per-tenant mode the two scopes are different files, so no
 * single transaction can span them: a sync failure is logged and reported
 * (`false`), never thrown — the user's action already succeeded, and
 * `rebuildAll` (the operator CLI) repairs any drift. Signing in on a shop's
 * own address never reads the directory, so drift can only hide a shop from
 * the www lists, never lock anyone out of their shop.
 *
 * The same hook also fills the shop's contact email from its first admin's
 * confirmed email when the shop has none (LIRA-290,
 * `ShopContactEmailService`): the writers that change a sign-in fact are
 * exactly the ones that can change it, so every writer — and every future
 * one — keeps "one shop per owner email" complete without a second call.
 *
 * Which rows a user gets is decided ONCE, by `buildDirectoryRows` (rule 14):
 * an active, non-super-admin user gets an `email` row when their email is
 * confirmed, and a `google` row when they have a Google link.
 *
 * No SQL here (rule 13). NODE ONLY (reaches the tenant context): exported
 * from `services/index.ts`, never from `browser.ts` (rule 29).
 */

import {
  getSigninDirectoryRepository,
  type SigninDirectoryEntry,
  type SigninDirectoryRepository,
  type SigninDirectoryRowInput,
  type SigninDirectoryTenantRow,
} from "../repositories/SigninDirectoryRepository.js";
import {
  getUserRepository,
  type SigninUserFacts,
  type UserRepository,
} from "../repositories/UserRepository.js";
import {
  getUserIdentityRepository,
  type UserIdentityRepository,
} from "../repositories/UserIdentityRepository.js";
import {
  getTenantRepository,
  type TenantRepository,
} from "../repositories/TenantRepository.js";
import { listTenantDatabaseIds } from "../db/tenantDatabaseIds.js";
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import { normalizeEmail } from "../repositories/UserRepository.js";
import {
  ShopContactEmailService,
  type ShopContactEmailFill,
} from "./ShopContactEmailService.js";
import { authLogger } from "../utils/logger.js";

const PROVIDER = "google" as const;

/** The one thing every writer needs: re-sync one user. Never throws. */
export interface SigninDirectorySync {
  syncUser(tenantId: number, userId: number, now?: string): boolean;
}

/** A user's Google link, as far as the directory cares. */
export interface DirectoryIdentityFacts {
  subject: string;
  email: string | null;
}

/** Directory vs the shops' records. Keyed by (kind, value, shop). */
export interface SigninDirectoryDiff {
  /** Expected from the shops' records, absent from the directory. */
  missing: SigninDirectoryTenantRow[];
  /** In the directory, not backed by any shop record. */
  extra: SigninDirectoryTenantRow[];
  /** Same key, different user / username / display email. */
  stale: Array<{ expected: SigninDirectoryTenantRow; actual: SigninDirectoryTenantRow }>;
  /** Shops whose records could not be read (their rows are not judged). */
  failedTenantIds: number[];
}

export interface SigninDirectoryRebuildResult {
  shops: number;
  rows: number;
  /** Shops whose records could not be read: their rows were KEPT as-is. */
  failedTenantIds: number[];
}

export interface SigninDirectoryServiceDeps {
  directoryRepo: SigninDirectoryRepository;
  userRepo: UserRepository;
  identityRepo: UserIdentityRepository;
  tenantRepo: TenantRepository;
  /** Shop ids with their own database file (per-tenant mode), or null. */
  listTenantFileIds: () => number[] | null;
  /** LIRA-290: fills a shop's NULL contact email. Never throws. */
  contactEmail: ShopContactEmailFill & {
    backfillAll(): { filled: number[] };
  };
}

/**
 * The directory rows one user should have (data-model invariant 1). Pure,
 * and the ONLY definition (rule 14): an active, non-super-admin user gets an
 * `email` row when their email is confirmed and a `google` row when they
 * have a Google link. `user` null (not in the shop) gives none.
 */
export function buildDirectoryRows(
  user: SigninUserFacts | null,
  identity: DirectoryIdentityFacts | null,
): SigninDirectoryRowInput[] {
  if (!user || user.is_active !== 1 || user.role === "super_admin") return [];
  const rows: SigninDirectoryRowInput[] = [];
  const email = user.email ? normalizeEmail(user.email) : "";
  if (email && user.email_verified_at) {
    rows.push({
      kind: "email",
      value: email,
      target_user_id: user.id,
      username: user.username,
      display_email: null,
    });
  }
  if (identity && identity.subject) {
    const shown = identity.email ? normalizeEmail(identity.email) : "";
    rows.push({
      kind: "google",
      value: identity.subject,
      target_user_id: user.id,
      username: user.username,
      display_email: shown || null,
    });
  }
  return rows;
}

const nowIso = (): string => new Date().toISOString();

/** (kind, value, shop): the directory's unique key. */
function keyOf(row: SigninDirectoryTenantRow): string {
  return `${row.kind}\u0000${row.value}\u0000${row.target_tenant_id}`;
}

function sameRow(a: SigninDirectoryTenantRow, b: SigninDirectoryTenantRow): boolean {
  return (
    a.target_user_id === b.target_user_id &&
    a.username === b.username &&
    (a.display_email ?? null) === (b.display_email ?? null)
  );
}

function toTenantRow(entry: SigninDirectoryEntry): SigninDirectoryTenantRow {
  return {
    kind: entry.kind,
    value: entry.value,
    target_tenant_id: entry.target_tenant_id,
    target_user_id: entry.target_user_id,
    username: entry.username,
    display_email: entry.display_email,
  };
}

export class SigninDirectoryService implements SigninDirectorySync {
  private readonly directoryRepo: SigninDirectoryRepository;
  private readonly userRepo: UserRepository;
  private readonly identityRepo: UserIdentityRepository;
  private readonly tenantRepo: TenantRepository;
  private readonly listTenantFileIds: () => number[] | null;
  private readonly contactEmail: SigninDirectoryServiceDeps["contactEmail"];

  constructor(deps: Partial<SigninDirectoryServiceDeps> = {}) {
    this.directoryRepo = deps.directoryRepo ?? getSigninDirectoryRepository();
    this.userRepo = deps.userRepo ?? getUserRepository();
    this.identityRepo = deps.identityRepo ?? getUserIdentityRepository();
    this.tenantRepo = deps.tenantRepo ?? getTenantRepository();
    this.listTenantFileIds = deps.listTenantFileIds ?? listTenantDatabaseIds;
    // Built from THIS service's repositories and file lister, so it reads
    // and writes exactly what the directory does.
    this.contactEmail =
      deps.contactEmail ??
      new ShopContactEmailService({
        userRepo: this.userRepo,
        tenantRepo: this.tenantRepo,
        listTenantFileIds: this.listTenantFileIds,
      });
  }

  /**
   * Makes the directory match ONE user's current records (shop scope read,
   * platform scope write). Idempotent. Never throws: false = not synced
   * (logged); the repair command fixes it.
   */
  syncUser(tenantId: number, userId: number, now: string = nowIso()): boolean {
    // LIRA-290: independent of the directory write below; never throws.
    this.contactEmail.fillFromFirstAdmin(tenantId);
    try {
      const rows = runWithTenant(tenantId, () => {
        const user = this.userRepo.getSigninFacts(userId);
        const identity = user ? this.identityRepo.findByUser(userId, PROVIDER) : null;
        return buildDirectoryRows(
          user,
          identity ? { subject: identity.subject, email: identity.email } : null,
        );
      });
      runWithoutTenant(() =>
        this.directoryRepo.replaceForUser(tenantId, userId, rows, now),
      );
      return true;
    } catch (error) {
      authLogger.warn(
        { error, tenantId, userId },
        "Sign-in directory: user sync failed (the repair command will fix it)",
      );
      return false;
    }
  }

  /** Makes the directory match ONE shop's records (a new shop). Never throws. */
  syncTenant(tenantId: number, now: string = nowIso()): boolean {
    // LIRA-290: independent of the directory write below; never throws.
    this.contactEmail.fillFromFirstAdmin(tenantId);
    try {
      const rows = this.expectedRowsForTenant(tenantId);
      runWithoutTenant(() =>
        this.directoryRepo.replaceForTenant(tenantId, rows, now),
      );
      return true;
    } catch (error) {
      authLogger.warn(
        { error, tenantId },
        "Sign-in directory: shop sync failed (the repair command will fix it)",
      );
      return false;
    }
  }

  /** Removes a deleted shop's rows. Never throws. */
  deleteForTenant(tenantId: number): boolean {
    try {
      runWithoutTenant(() => this.directoryRepo.deleteForTenant(tenantId));
      return true;
    } catch (error) {
      authLogger.warn(
        { error, tenantId },
        "Sign-in directory: removing a deleted shop's rows failed",
      );
      return false;
    }
  }

  /** The directory compared with every shop's records. Read-only. */
  diff(): SigninDirectoryDiff {
    const { rows: expectedRows, failedTenantIds } = this.computeExpected();
    const failed = new Set(failedTenantIds);
    const actualRows = runWithoutTenant(() => this.directoryRepo.listAll())
      .map(toTenantRow)
      .filter((row) => !failed.has(row.target_tenant_id));
    const expected = new Map(expectedRows.map((r) => [keyOf(r), r]));
    const actual = new Map(actualRows.map((r) => [keyOf(r), r]));

    const result: SigninDirectoryDiff = { missing: [], extra: [], stale: [], failedTenantIds };
    for (const [key, row] of expected) {
      const found = actual.get(key);
      if (!found) result.missing.push(row);
      else if (!sameRow(row, found)) result.stale.push({ expected: row, actual: found });
    }
    for (const [key, row] of actual) {
      if (!expected.has(key)) result.extra.push(row);
    }
    return result;
  }

  /**
   * Rebuilds the WHOLE directory from every shop's records, in one platform
   * transaction. A shop whose records cannot be read keeps its current rows
   * (reported in `failedTenantIds`) — a broken file must never empty the
   * www lists for that shop.
   *
   * Also back-fills every shop's NULL contact email from its first admin
   * (LIRA-290) — in per-tenant mode this repair command is the only way the
   * back-fill reaches users, since migration v201 sees none there.
   */
  rebuildAll(now: string): SigninDirectoryRebuildResult {
    this.contactEmail.backfillAll();
    const { rows, shops, failedTenantIds } = this.computeExpected();
    const failed = new Set(failedTenantIds);
    const kept = runWithoutTenant(() => this.directoryRepo.listAll())
      .filter((row) => failed.has(row.target_tenant_id))
      .map(toTenantRow);
    runWithoutTenant(() => this.directoryRepo.replaceAll([...rows, ...kept], now));
    authLogger.info(
      { shops, rows: rows.length, failedTenantIds },
      "Sign-in directory rebuilt",
    );
    return { shops, rows: rows.length, failedTenantIds };
  }

  /** Every directory row (platform scope). */
  listAll(): SigninDirectoryEntry[] {
    return runWithoutTenant(() => this.directoryRepo.listAll());
  }

  // ---------------------------------------------------------------------------

  /** One shop's expected rows, read in that shop's own scope. Throws. */
  private expectedRowsForTenant(tenantId: number): SigninDirectoryRowInput[] {
    return runWithTenant(tenantId, () => {
      const identities = new Map(
        this.identityRepo
          .listForCurrentShop(PROVIDER)
          .map((i) => [i.user_id, { subject: i.subject, email: i.email }]),
      );
      return this.userRepo
        .listSigninFacts()
        .flatMap((user) => buildDirectoryRows(user, identities.get(user.id) ?? null));
    });
  }

  /**
   * Every shop the platform knows (`tenants`), narrowed in per-tenant mode
   * to those whose file exists; each read in its own scope.
   */
  private computeExpected(): {
    rows: SigninDirectoryTenantRow[];
    shops: number;
    failedTenantIds: number[];
  } {
    const registered = runWithoutTenant(() => this.tenantRepo.listAllRows()).map(
      (t) => t.id,
    );
    const files = this.listTenantFileIds();
    const tenantIds = files
      ? registered.filter((id) => files.includes(id))
      : registered;
    const rows: SigninDirectoryTenantRow[] = [];
    const failedTenantIds: number[] = [];
    let shops = 0;
    for (const tenantId of tenantIds) {
      try {
        for (const row of this.expectedRowsForTenant(tenantId)) {
          rows.push({ ...row, target_tenant_id: tenantId });
        }
        shops += 1;
      } catch (error) {
        failedTenantIds.push(tenantId);
        authLogger.error(
          { error, tenantId },
          "Sign-in directory: could not read a shop's records",
        );
      }
    }
    return { rows, shops, failedTenantIds };
  }
}

let instance: SigninDirectoryService | null = null;

export function getSigninDirectoryService(): SigninDirectoryService {
  if (!instance) instance = new SigninDirectoryService();
  return instance;
}

export function resetSigninDirectoryService(): void {
  instance = null;
}
