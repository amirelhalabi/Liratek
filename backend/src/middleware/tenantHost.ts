/**
 * Resolve which tenant a request is addressed to, from its Host name.
 *
 * The multi-tenant work deliberately deferred this: `MULTI_TENANT_IMPLEMENTATION_PLAN.md`
 * records "Tenant resolution — **from the JWT**, not from the Host header.
 * Subdomain routing is explicitly out of scope for v1", and `tenants.slug` was
 * added with the comment "future subdomain". This is that follow-up.
 *
 * ── What it is for ──
 *
 * Without it, login is global: a tenant's credentials authenticate on ANY
 * hostname. That is not a data leak — the JWT carries `tenantId` from the user
 * row and every repository is tenant-scoped, so a user still only ever sees
 * their own tenant's rows — but the hostname means nothing, which is not the
 * product: each tenant should have its own subdomain and credentials that work
 * only there.
 *
 * ── Disabled by default, on purpose ──
 *
 * With `APP_BASE_DOMAIN` unset this returns `disabled` and callers must behave
 * exactly as before. The app is currently served from `liratek.vercel.app` and
 * a bare IP; neither is `<slug>.<base>`, so enforcing resolution before a
 * domain exists would lock everyone out. Turning the feature on is setting one
 * env var, not deploying new code.
 *
 * ── Realms ──
 *
 *   cornertech.liratek.app  -> tenant  (slug "cornertech")
 *   liratek.app             -> platform (super_admin only)
 *   admin.liratek.app       -> platform (a friendlier alias for the same)
 *   www.liratek.app         -> platform (in practice THE platform host: the
 *                             apex 308-redirects to www before Express sees it)
 *   nosuchshop.liratek.app  -> unknown  (refuse everything)
 *   liratek.vercel.app      -> foreign  (not under the base domain)
 *
 * `foreign` is treated as `disabled` by callers rather than refused, so a
 * preview deployment or the bare IP keeps working while a real domain is being
 * set up. That is a deliberate looseness: strictness here would break the
 * environment the feature is developed in, and the enforcement that matters
 * (credentials only work on their own subdomain) still applies wherever the
 * base domain does.
 */

import type { Request } from "express";
import {
  APP_BASE_DOMAIN,
  TENANT_HOST_HEADER_OVERRIDE,
  getTenantRepository,
  runWithoutTenant,
  createChildLogger,
  type TenantEntity,
} from "@liratek/core";

const hostLogger = createChildLogger({ module: "tenant-host" });

/**
 * Labels under the base domain that mean "the platform", not a tenant.
 *
 * `www` is here, and it was NOT always. It used to be INERT (behave as if no
 * base domain), on the reasoning that the app is actually served at
 * www.<domain> while the platform realm admits only super_admins — so calling
 * it the platform realm would lock every ordinary user out of the hostname
 * they use.
 *
 * That reasoning expired when tenants started getting their own subdomain
 * automatically (`backend/src/services/tenantDomains.ts`). Ordinary users are
 * no longer locked out of anything: they have an address of their own to use.
 *
 * Keeping it inert became the ACTIVE bug. Inert means "no realm", and with
 * per-tenant usernames (v172) a realmless login has to guess which shop an
 * `admin` belongs to — `resolveWithoutRealm` prefers the platform, then the
 * FIRST tenant. So on www the incumbent shop wins the name and every later
 * tenant that picked the same username simply cannot sign in, anywhere on the
 * shared host. Not ambiguous: broken, silently, for tenant #2 onward.
 *
 * Platform is therefore the correct reading, and the same one Slack, Zendesk
 * and Freshdesk settle on: the shared host signs in staff, the workspace host
 * signs in the workspace. The host IS the disambiguator.
 */
const PLATFORM_LABELS = new Set(["admin", "www"]);

/**
 * A realm id no user row can carry, used to make a login on an UNKNOWN
 * subdomain fail at the lookup rather than after verifying a password --
 * so an unresolvable subdomain gives away nothing, not even timing.
 */
export const NO_SUCH_REALM = -1;

export type TenantHostResolution =
  /** Host-based tenancy is switched off (no APP_BASE_DOMAIN). */
  | { kind: "disabled" }
  /** Request did not arrive on the base domain at all. Treat as disabled. */
  | { kind: "foreign"; host: string }
  /** The platform realm: only a super_admin may authenticate here. */
  | { kind: "platform"; host: string }
  /** A real tenant. */
  | { kind: "tenant"; slug: string; tenant: TenantEntity }
  /** Looks like a tenant subdomain, but no such tenant exists. */
  | { kind: "unknown"; slug: string };

/**
 * The hostname to resolve against, lowercased and without a port.
 *
 * `req.hostname` already strips the port and honours X-Forwarded-Host when
 * `trust proxy` is set (it is — see server.ts), which is what makes this work
 * behind nginx, Cloudflare and Vercel's rewrite.
 */
function requestHost(req: Request): string {
  return (req.hostname || "").toLowerCase();
}

/**
 * Extract the tenant label from a host under the base domain.
 * Returns null when the host is not `<label>.<base>` (including the apex).
 */
function labelUnderBase(host: string, base: string): string | null {
  if (host === base) return null;
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  // Only a SINGLE label counts. "a.b.liratek.app" is not a tenant subdomain;
  // silently treating it as tenant "a" would let a wildcard cert holder or a
  // typo resolve to a real tenant.
  if (!label || label.includes(".")) return null;
  return label;
}

export function resolveTenantHost(req: Request): TenantHostResolution {
  const base = APP_BASE_DOMAIN;
  if (!base) return { kind: "disabled" };

  // Dev/test escape hatch. Checked BEFORE the Host so a test can pin a tenant
  // without DNS, and gated behind an env flag because it is client-controlled.
  if (TENANT_HOST_HEADER_OVERRIDE) {
    const header = req.header("x-tenant-slug")?.trim().toLowerCase();
    if (header) return lookup(header);
  }

  const host = requestHost(req);
  if (!host) return { kind: "foreign", host };

  if (host === base) return { kind: "platform", host };

  const label = labelUnderBase(host, base);
  if (label === null) return { kind: "foreign", host };
  if (PLATFORM_LABELS.has(label)) return { kind: "platform", host };

  return lookup(label);
}

function lookup(slug: string): TenantHostResolution {
  try {
    // A control-plane read: the tenants registry is not itself tenant-scoped,
    // and at this point in the request there is no tenant context to inherit.
    // runWithoutTenant makes that explicit rather than depending on whatever
    // happened to be active.
    const tenant = runWithoutTenant(() =>
      getTenantRepository().getBySlug(slug),
    );
    if (!tenant) return { kind: "unknown", slug };
    return { kind: "tenant", slug, tenant };
  } catch (error) {
    // A failed registry lookup must not authenticate anyone: report unknown,
    // which callers refuse.
    hostLogger.error({ error, slug }, "tenant slug lookup failed");
    return { kind: "unknown", slug };
  }
}

/** The resolutions that actually constrain who may authenticate. */
export type EnforcedTenantHost = Extract<
  TenantHostResolution,
  { kind: "platform" } | { kind: "tenant" } | { kind: "unknown" }
>;

/**
 * Whether host resolution should be enforced for this request at all.
 * `disabled` and `foreign` both mean "behave as before".
 *
 * A type predicate rather than a plain boolean, so callers narrow to the
 * variants that carry `tenant`/`slug` instead of casting.
 */
export function isHostTenancyActive(
  r: TenantHostResolution,
): r is EnforcedTenantHost {
  return r.kind !== "disabled" && r.kind !== "foreign";
}
