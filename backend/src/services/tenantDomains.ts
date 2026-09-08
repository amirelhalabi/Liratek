/**
 * Give a new tenant its own subdomain, automatically.
 *
 * Two calls, because both are required and neither is sufficient:
 *   1. Cloudflare — a CNAME `<slug>.<APP_BASE_DOMAIN>` → Vercel, DNS-only.
 *   2. Vercel — register that hostname on the project.
 *
 * Vercel routes by `Host`, so DNS without the Vercel domain is a 404, and the
 * Vercel domain without DNS never resolves. Doing only one is worse than doing
 * neither, because it looks configured.
 *
 * ── Why this lives in backend/, not core ──
 *
 * This is hosting infrastructure, not business logic. `@liratek/core` is
 * shared with the Electron app, which has no Vercel project and no zone; a
 * desktop build should not carry Cloudflare API code. Core stays
 * hosting-agnostic and the deployment concern stays with the deployment.
 *
 * ── Why it runs AFTER the transaction, never inside ──
 *
 * `provisionTenant()` wraps its writes in one SQLite transaction. Putting an
 * HTTP call in there would hold a write lock open across the network, and a
 * rollback could not un-create a DNS record anyway. So the tenant is committed
 * first and the subdomain follows.
 *
 * ── Fail-soft, always ──
 *
 * A subdomain is a convenience; a signup is revenue. Every failure path —
 * unconfigured, network down, bad token, rate limit — logs and returns a
 * reason. Nothing here can throw into the caller, because losing a paying
 * signup to a DNS hiccup would be absurd.
 */

import {
  APP_BASE_DOMAIN,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ZONE_ID,
  VERCEL_TOKEN,
  VERCEL_PROJECT_ID,
  VERCEL_DNS_TARGET,
  VERCEL_TEAM_ID,
} from "@liratek/core";
import { logger } from "../server.js";

/** Long enough for two sequential API calls, short enough to never hang. */
const TIMEOUT_MS = 15000;

export interface DomainProvisionResult {
  /** Did the tenant end up with a working hostname? */
  ok: boolean;
  /** The hostname, when one was attempted. */
  host?: string;
  /** One line, safe to show an operator. Never contains a token. */
  detail: string;
}

/** Every piece must be present; a half-configured deployment does nothing. */
function config() {
  if (
    !APP_BASE_DOMAIN ||
    !CLOUDFLARE_API_TOKEN ||
    !CLOUDFLARE_ZONE_ID ||
    !VERCEL_TOKEN ||
    !VERCEL_PROJECT_ID
  ) {
    return null;
  }
  return {
    baseDomain: APP_BASE_DOMAIN,
    cfToken: CLOUDFLARE_API_TOKEN,
    zoneId: CLOUDFLARE_ZONE_ID,
    vercelToken: VERCEL_TOKEN,
    projectId: VERCEL_PROJECT_ID,
    dnsTarget: VERCEL_DNS_TARGET,
    teamId: VERCEL_TEAM_ID,
  };
}

/** True when automatic subdomains are switched on for this deployment. */
export function domainAutomationEnabled(): boolean {
  return config() !== null;
}

async function postJson(
  url: string,
  token: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // A body-less response is fine; the status carries the outcome.
  }
  return { status: res.status, json };
}

/**
 * Create the CNAME.
 *
 * `proxied: false` is load-bearing. A proxied (orange) record puts Cloudflare
 * in front of Vercel, which terminates TLS with its own certificate for that
 * host — the classic result is a redirect loop, and Vercel sees Cloudflare's
 * IPs instead of real visitors. Only `api.<domain>` (the tunnel) is proxied.
 */
async function createCloudflareCname(
  cfg: NonNullable<ReturnType<typeof config>>,
  slug: string,
): Promise<{ ok: boolean; detail: string }> {
  const { status, json } = await postJson(
    `https://api.cloudflare.com/client/v4/zones/${cfg.zoneId}/dns_records`,
    cfg.cfToken,
    {
      type: "CNAME",
      name: slug,
      content: cfg.dnsTarget,
      ttl: 1, // 1 = "automatic"
      proxied: false,
      comment: "Tenant subdomain, created automatically at provisioning",
    },
  );

  if (status >= 200 && status < 300) {
    return { ok: true, detail: "DNS record created" };
  }

  // 81057 = "Record already exists". Treat as success: this function must be
  // safe to re-run, and a record that is already right is the desired state.
  const errors = extractCloudflareErrors(json);
  if (errors.some((e) => e.code === 81057)) {
    return { ok: true, detail: "DNS record already existed" };
  }

  return {
    ok: false,
    detail: `Cloudflare ${status}: ${errors.map((e) => e.message).join("; ") || "unknown error"}`,
  };
}

function extractCloudflareErrors(
  json: unknown,
): { code: number; message: string }[] {
  if (typeof json !== "object" || json === null) return [];
  const errs = (json as { errors?: unknown }).errors;
  if (!Array.isArray(errs)) return [];
  return errs.map((e) => ({
    code:
      typeof e === "object" &&
      e !== null &&
      typeof (e as { code?: unknown }).code === "number"
        ? (e as { code: number }).code
        : 0,
    message:
      typeof e === "object" &&
      e !== null &&
      typeof (e as { message?: unknown }).message === "string"
        ? (e as { message: string }).message
        : "",
  }));
}

/** Register the hostname on the Vercel project. */
async function addVercelDomain(
  cfg: NonNullable<ReturnType<typeof config>>,
  host: string,
): Promise<{ ok: boolean; detail: string }> {
  // teamId is required when the project belongs to a team; without it the API
  // reports the project as missing rather than as a permission problem.
  const query = cfg.teamId ? `?teamId=${encodeURIComponent(cfg.teamId)}` : "";
  const { status, json } = await postJson(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(cfg.projectId)}/domains${query}`,
    cfg.vercelToken,
    { name: host },
  );

  if (status >= 200 && status < 300) {
    return { ok: true, detail: "Registered on Vercel" };
  }

  // Already attached to this project is success, for the same idempotency
  // reason as above.
  const code = extractVercelErrorCode(json);
  if (code === "domain_already_in_use_by_this_project") {
    return { ok: true, detail: "Already registered on Vercel" };
  }

  return { ok: false, detail: `Vercel ${status}: ${code ?? "unknown error"}` };
}

function extractVercelErrorCode(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const error = (json as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Provision `<slug>.<APP_BASE_DOMAIN>`.
 *
 * Idempotent, so it is safe to call again for a tenant that already has one —
 * which is what makes a retry button possible without extra bookkeeping.
 */
export async function provisionTenantDomain(
  slug: string,
): Promise<DomainProvisionResult> {
  const cfg = config();
  if (!cfg) {
    return {
      ok: false,
      detail:
        "Automatic subdomains are off (needs APP_BASE_DOMAIN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, VERCEL_TOKEN, VERCEL_PROJECT_ID)",
    };
  }

  const host = `${slug}.${cfg.baseDomain}`;

  try {
    const dns = await createCloudflareCname(cfg, slug);
    if (!dns.ok) {
      logger.error(
        { host, detail: dns.detail },
        "tenant subdomain: DNS failed",
      );
      return { ok: false, host, detail: dns.detail };
    }

    const vercel = await addVercelDomain(cfg, host);
    if (!vercel.ok) {
      // The DNS record is left in place deliberately. It is harmless on its
      // own, it makes the retry a no-op, and deleting it would risk removing
      // a record someone had created by hand.
      logger.error(
        { host, detail: vercel.detail },
        "tenant subdomain: DNS created but Vercel registration failed",
      );
      return { ok: false, host, detail: vercel.detail };
    }

    logger.info(
      { host, dns: dns.detail, vercel: vercel.detail },
      "tenant subdomain provisioned",
    );
    return { ok: true, host, detail: `${host} is ready` };
  } catch (error) {
    // Network error, timeout, DNS failure reaching the APIs themselves.
    logger.error({ error, host }, "tenant subdomain: provisioning threw");
    return {
      ok: false,
      host,
      detail:
        error instanceof Error
          ? `Could not reach the DNS/hosting API: ${error.message}`
          : "Could not reach the DNS/hosting API",
    };
  }
}
