/**
 * MobileAuthService — sign-in for the LiraTek phone app (LIRA-289, T023).
 *
 * The web login learns the shop from the request Host (`<slug>.liratek.shop`).
 * The phone app calls the API host directly, so it sends the shop address
 * instead. This service owns the rules for that sign-in; the REST route only
 * validates the body and shapes the reply (constitution §II, rule 13):
 *
 *   1. Find the shop by address. An unknown shop still runs a doomed login
 *      against `unknownRealm`, so it costs the same as a wrong password.
 *   2. Authenticate the username INSIDE that shop only — usernames are unique
 *      per shop (v172), never matched across shops.
 *   3. Refuse a shop that is not active, and any user who is not an admin.
 *      Each refusal revokes the session `login()` already created.
 *
 * Every refusal except ADMIN_ONLY is the same INVALID_CREDENTIALS, so the
 * answer never says which shops or usernames exist (spec FR-028). ADMIN_ONLY
 * is only reachable with a correct password.
 */

import type { SafeUser } from "../repositories/UserRepository.js";
import {
  getTenantRepository,
  type TenantEntity,
  type TenantRepository,
} from "../repositories/TenantRepository.js";
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import { authLogger } from "../utils/logger.js";
import { getAuthService, type AuthService } from "./AuthService.js";

export interface MobileLoginRequest {
  shop: string;
  username: string;
  password: string;
  deviceInfo: string;
  ipAddress?: string;
}

export type MobileLoginOutcome =
  | {
      ok: true;
      user: SafeUser;
      sessionToken: string;
      shop: { id: number; slug: string; name: string };
    }
  | { ok: false; reason: "INVALID_CREDENTIALS" | "ADMIN_ONLY" };

export interface MobileAuthServiceDeps {
  auth?: Pick<AuthService, "login" | "logout">;
  tenants?: Pick<TenantRepository, "getBySlug">;
  /**
   * The realm id no tenant can have, used for the doomed lookup on an
   * unknown shop. The backend passes its `NO_SUCH_REALM` so both sign-ins
   * share one definition.
   */
  unknownRealm: number;
}

export class MobileAuthService {
  private readonly auth: Pick<AuthService, "login" | "logout">;
  private readonly tenants: Pick<TenantRepository, "getBySlug">;
  private readonly unknownRealm: number;

  constructor(deps: MobileAuthServiceDeps) {
    this.auth = deps.auth ?? getAuthService();
    this.tenants = deps.tenants ?? getTenantRepository();
    this.unknownRealm = deps.unknownRealm;
  }

  async loginWithShop(req: MobileLoginRequest): Promise<MobileLoginOutcome> {
    const slug = req.shop.trim().toLowerCase();
    const loginOptions = {
      rememberMe: true,
      deviceType: "mobile" as const,
      deviceInfo: req.deviceInfo,
      ...(req.ipAddress ? { ipAddress: req.ipAddress } : {}),
    };

    const tenant = this.findShop(slug);
    if (!tenant) {
      await runWithoutTenant(() =>
        this.auth.login(req.username, req.password, {
          ...loginOptions,
          realm: this.unknownRealm,
        }),
      );
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    const tenantId = tenant.id;
    const result = await runWithTenant(tenantId, () =>
      this.auth.login(req.username, req.password, {
        ...loginOptions,
        realm: tenantId,
      }),
    );
    if (!result.success || !result.user || !result.token) {
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    const user = result.user;
    const sessionToken = result.token;

    if (user.tenant_id !== tenantId || tenant.status !== "active") {
      await this.revoke(tenantId, sessionToken);
      authLogger.warn(
        { username: req.username, slug, status: tenant.status },
        "Mobile login refused: wrong shop or shop not active",
      );
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    if (user.role !== "admin") {
      await this.revoke(tenantId, sessionToken);
      authLogger.info(
        { username: req.username, slug },
        "Mobile login refused: not an admin",
      );
      return { ok: false, reason: "ADMIN_ONLY" };
    }

    return {
      ok: true,
      user,
      sessionToken,
      shop: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    };
  }

  private findShop(slug: string): TenantEntity | null {
    try {
      // The tenants registry is a control-plane read with no ambient tenant.
      return runWithoutTenant(() => this.tenants.getBySlug(slug)) ?? null;
    } catch (error) {
      authLogger.error({ error, slug }, "Mobile login: shop lookup failed");
      return null;
    }
  }

  private async revoke(tenantId: number, sessionToken: string): Promise<void> {
    try {
      await runWithTenant(tenantId, () => this.auth.logout(sessionToken));
    } catch {
      // best effort — the token is never returned to the client
    }
  }
}
