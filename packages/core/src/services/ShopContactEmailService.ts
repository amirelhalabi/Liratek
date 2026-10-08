/**
 * ShopContactEmailService (LIRA-290, owner decision 2026-10-08) — keeps
 * `tenants.contact_email` filled, because "one shop per OWNER email" is
 * checked against it (`SignupInvitationService.findShopOwnedByEmail`).
 *
 * The rule, defined ONCE here (rule 14): a shop's contact email is its FIRST
 * ADMIN's (UserRepository `FIRST_ADMIN_WHERE` / `FIRST_ADMIN_ORDER`)
 * CONFIRMED email. It is only ever FILLED — set when NULL, never
 * overwritten — and an address another shop already holds is skipped (the
 * shop that got it first keeps it). A STAFF member's email never counts, so
 * staff may open a shop of their own.
 *
 * When it runs:
 *   - after every writer of a sign-in fact, via the sign-in directory sync
 *     (`SigninDirectoryService.syncUser` / `syncTenant`): email set/verify,
 *     Google link (which sets the email when absent), invite accept, role /
 *     active changes, shop provisioning. New writers inherit it for free;
 *   - for every shop at once from `backfillAll`, which the directory's
 *     repair command (`signinDirectoryCli --write` → `rebuildAll`) runs.
 *     That is the per-tenant-mode back-fill: migration v201 can only reach
 *     users in shared mode (a per-tenant platform file has no shop users).
 *
 * The first admin is read in the SHOP scope (`runWithTenant`) and the shop
 * row written in the PLATFORM scope (`runWithoutTenant`), so this works in
 * both storage modes. Never throws: the caller's action already succeeded.
 *
 * No SQL here (rule 13). NODE ONLY (reaches the tenant context): exported
 * from `services/index.ts`, never from `browser.ts` (rule 29).
 */

import {
  getUserRepository,
  normalizeEmail,
  type UserRepository,
} from "../repositories/UserRepository.js";
import {
  getTenantRepository,
  type TenantRepository,
} from "../repositories/TenantRepository.js";
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import { listTenantDatabaseIds } from "../db/tenantDatabaseIds.js";
import { authLogger } from "../utils/logger.js";

/** What the sign-in directory needs: fill one shop. Never throws. */
export interface ShopContactEmailFill {
  fillFromFirstAdmin(tenantId: number): boolean;
}

export interface ShopContactEmailBackfillResult {
  /** Shops whose contact email was set by this run, ascending id. */
  filled: number[];
}

export interface ShopContactEmailServiceDeps {
  userRepo: UserRepository;
  tenantRepo: TenantRepository;
  /** Shop ids with their own database file (per-tenant mode), or null. */
  listTenantFileIds: () => number[] | null;
}

export class ShopContactEmailService implements ShopContactEmailFill {
  private readonly userRepo: UserRepository;
  private readonly tenantRepo: TenantRepository;
  private readonly listTenantFileIds: () => number[] | null;

  constructor(deps: Partial<ShopContactEmailServiceDeps> = {}) {
    this.userRepo = deps.userRepo ?? getUserRepository();
    this.tenantRepo = deps.tenantRepo ?? getTenantRepository();
    this.listTenantFileIds = deps.listTenantFileIds ?? listTenantDatabaseIds;
  }

  /**
   * Sets the shop's contact email to its first admin's confirmed email when
   * the shop has none. True when it was set. Never throws.
   */
  fillFromFirstAdmin(tenantId: number): boolean {
    try {
      const shop = runWithoutTenant(() => this.tenantRepo.getById(tenantId));
      if (!shop || shop.contact_email !== null) return false;

      const admin = runWithTenant(tenantId, () =>
        this.userRepo.getFirstAdminEmail(),
      );
      const email = admin?.email ? normalizeEmail(admin.email) : "";
      if (!email || !admin?.email_verified_at) return false;

      const set = runWithoutTenant(() =>
        this.tenantRepo.setContactEmailIfAbsent(tenantId, email),
      );
      if (set) {
        authLogger.info(
          { tenantId },
          "Shop contact email set from its first admin's confirmed email",
        );
      }
      return set;
    } catch (error) {
      authLogger.warn(
        { error, tenantId },
        "Shop contact email: fill from the first admin failed",
      );
      return false;
    }
  }

  /**
   * `fillFromFirstAdmin` for every shop with no contact email, lowest id
   * first (so when two shops' first admins share an address, the older shop
   * keeps it). In per-tenant mode only shops whose database file exists are
   * visited (like the directory rebuild), so a registry row with no file —
   * a half-provisioned shop — is never opened. Never throws; a shop that
   * cannot be read is skipped.
   */
  backfillAll(): ShopContactEmailBackfillResult {
    let ids: number[];
    try {
      const files = this.listTenantFileIds();
      ids = runWithoutTenant(() => this.tenantRepo.listAllRows())
        .filter((t) => t.contact_email === null)
        .map((t) => t.id)
        .filter((id) => files === null || files.includes(id))
        .sort((a, b) => a - b);
    } catch (error) {
      authLogger.warn({ error }, "Shop contact email: back-fill could not list shops");
      return { filled: [] };
    }
    const filled = ids.filter((id) => this.fillFromFirstAdmin(id));
    authLogger.info({ filled }, "Shop contact email back-fill done");
    return { filled };
  }
}

let instance: ShopContactEmailService | null = null;

export function getShopContactEmailService(): ShopContactEmailService {
  if (!instance) instance = new ShopContactEmailService();
  return instance;
}

export function resetShopContactEmailService(): void {
  instance = null;
}
