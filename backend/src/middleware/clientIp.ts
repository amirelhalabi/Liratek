/**
 * The real client IP behind browser -> Vercel -> Fly (LIRA-278, LIRA-283).
 *
 * Production runs browser -> Vercel rewrite -> api.liratek.shop -> Fly with
 * `trust proxy` = 1, so `req.ip` is a PROXY's address (66.241.124.103 — the
 * address api.liratek.shop itself resolves to) and every shop shares one
 * per-IP bucket: failed logins, sign-up, profits unlock, the anonymous and
 * flood API buckets, and the IP recorded on every session.
 *
 * ## Who may say who the client is
 *
 * `api.liratek.shop` is publicly reachable, so anyone can call it DIRECTLY
 * with a forged `X-Forwarded-For`, `X-Vercel-Forwarded-For` or `X-Real-IP`.
 * Trusting a header by name alone would let one attacker pick a fresh bucket
 * per request (and record any IP they like on a session). So a forwarded
 * header is believed ONLY when the request also carries the shared proxy
 * secret: `x-liratek-proxy-auth` equal to `CLIENT_IP_PROXY_SECRET`. Vercel
 * adds that header on its rewrite to Fly (the Routing Middleware in the repo
 * root `middleware.js`, value from the Vercel environment variable
 * LIRATEK_PROXY_SECRET — never in git, the repo is public). A direct caller
 * cannot know it.
 *
 * Fail-closed: no secret configured, a secret shorter than
 * MIN_PROXY_SECRET_LENGTH, a missing/wrong header, or a header value that is
 * not an IP address all fall back to `req.ip` — exactly today's behaviour,
 * never an error. A half-configured rollout therefore changes nothing.
 *
 * Which header carries the client once the secret matches: `CLIENT_IP_HEADER`
 * when set, else `x-vercel-forwarded-for` (Vercel-specific, so Fly does not
 * append to it the way it appends to `x-forwarded-for`). Production sets
 * CLIENT_IP_HEADER=x-liratek-client-ip: the middleware deletes any copy the
 * browser sent and sets it from Vercel's own `x-real-ip`.
 *
 * `trust proxy` is deliberately NOT changed: `X-Forwarded-Host` tenant
 * routing depends on it (docs/OPERATIONS.md deploy checks).
 */

import crypto from "node:crypto";
import net from "node:net";
import type { NextFunction, Request, Response } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { CLIENT_IP_HEADER } from "@liratek/core";
import { logger } from "../server.js";

type HeaderSource = Pick<Request, "headers" | "ip">;

/** The header Vercel's rewrite adds, carrying CLIENT_IP_PROXY_SECRET. */
export const PROXY_AUTH_HEADER = "x-liratek-proxy-auth";

/** Read when CLIENT_IP_HEADER is unset and the proxy secret matched. */
export const DEFAULT_PROXIED_CLIENT_HEADER = "x-vercel-forwarded-for";

/** A shorter configured secret is ignored (treated as unset). */
export const MIN_PROXY_SECRET_LENGTH = 32;

/** The first address in a header value: first of a repeated header, then
 * first of a comma list, trimmed. Null when there is none. */
function firstAddress(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first.length > 0 ? first : null;
}

function partCount(value: string | string[] | undefined): number {
  const all = Array.isArray(value) ? value.join(",") : (value ?? "");
  return all
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;
}

/** The configured proxy secret, read per call (so a restart with a new Fly
 * secret, and tests, need no module reload). Undefined when unusable. */
function configuredProxySecret(): string | undefined {
  const raw = process.env.CLIENT_IP_PROXY_SECRET?.trim();
  if (!raw) return undefined;
  if (raw.length < MIN_PROXY_SECRET_LENGTH) {
    warnShortSecretOnce();
    return undefined;
  }
  return raw;
}

let shortSecretWarned = false;
function warnShortSecretOnce(): void {
  if (shortSecretWarned) return;
  shortSecretWarned = true;
  try {
    logger.warn(
      { minLength: MIN_PROXY_SECRET_LENGTH },
      "CLIENT_IP_PROXY_SECRET is too short and is IGNORED — every request is keyed on req.ip",
    );
  } catch {
    // Logging must never block a request.
  }
}

/**
 * True only when the request carries `x-liratek-proxy-auth` equal to the
 * configured secret (constant-time). False when no usable secret is
 * configured — an empty header never matches an empty secret.
 */
export function isFromTrustedProxy(
  req: Pick<Request, "headers">,
  secret: string | undefined = configuredProxySecret(),
): boolean {
  if (!secret) return false;
  const presented = req.headers[PROXY_AUTH_HEADER];
  const value = Array.isArray(presented) ? presented[0] : presented;
  if (typeof value !== "string" || value.length === 0) return false;
  // Hash both sides so the comparison is constant-time AND length-safe
  // (timingSafeEqual throws on unequal lengths).
  const a = crypto.createHash("sha256").update(value, "utf8").digest();
  const b = crypto.createHash("sha256").update(secret, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

export type ClientIpSource = "vercel" | "direct";

export interface ClientIpResolution {
  /** The address every limiter and session uses. "" when unknown. */
  ip: string;
  /** "vercel" = proven by the proxy secret and read from `header`;
   * "direct" = `req.ip` (no/wrong secret, or no usable header value). */
  source: ClientIpSource;
  /** The header the address was read from, null for `req.ip`. */
  header: string | null;
  /** The proxy secret matched — true even when the header then had no
   * usable address, so a diagnostic can tell "secret never arrived" from
   * "secret arrived but the client-IP header was missing / not an IP". */
  proxyVerified: boolean;
}

/**
 * The full answer: which IP, and why. `headerName` defaults to
 * CLIENT_IP_HEADER, else `x-vercel-forwarded-for`; `secret` to
 * CLIENT_IP_PROXY_SECRET. Header names are matched lowercased (Node
 * lowercases incoming header names).
 */
export function resolveClientIpDetailed(
  req: HeaderSource,
  headerName: string | undefined = CLIENT_IP_HEADER,
  secret: string | undefined = configuredProxySecret(),
): ClientIpResolution {
  const proxyVerified = isFromTrustedProxy(req, secret);
  if (proxyVerified) {
    const header = (headerName || DEFAULT_PROXIED_CLIENT_HEADER).toLowerCase();
    const fromHeader = firstAddress(req.headers[header]);
    if (fromHeader && net.isIP(fromHeader) !== 0) {
      return { ip: fromHeader, source: "vercel", header, proxyVerified };
    }
  }
  return { ip: req.ip ?? "", source: "direct", header: null, proxyVerified };
}

/** The client IP (see the file header). Never throws, never undefined. */
export function resolveClientIp(
  req: HeaderSource,
  headerName: string | undefined = CLIENT_IP_HEADER,
  secret: string | undefined = configuredProxySecret(),
): string {
  return resolveClientIpDetailed(req, headerName, secret).ip;
}

/** THE helper (LIRA-283): every per-IP limiter and every session's
 * `ip_address` goes through this. */
export function clientIp(req: HeaderSource): string {
  return resolveClientIp(req);
}

/**
 * `keyGenerator` for every per-IP limiter. IPv6 goes through
 * express-rate-limit's `ipKeyGenerator` (grouped by /56) so one visitor
 * cannot rotate through its own address block to reset the budget.
 */
export function clientIpRateLimitKey(
  req: HeaderSource,
  headerName: string | undefined = CLIENT_IP_HEADER,
  secret: string | undefined = configuredProxySecret(),
): string {
  return ipKeyGenerator(resolveClientIp(req, headerName, secret));
}

// =============================================================================
// TEMPORARY DIAGNOSTIC (LIRA-278) — remove once CLIENT_IP_HEADER is chosen.
// =============================================================================

/** The forwarded headers the owner chooses between. */
export const FORWARDED_HEADERS_PROBED = [
  "x-forwarded-for",
  "x-real-ip",
  "x-vercel-forwarded-for",
  "fly-client-ip",
  "cf-connecting-ip",
] as const;

export interface ForwardedHeaderProbe {
  /** How many comma-separated addresses the header carried. */
  parts: number;
  /** sha256(salt + first address), hex, first 12 characters. The salt is
   * random per server process, so two hashes compare equal within one
   * deploy, but an address cannot be recovered by hashing every candidate. */
  firstHash: string;
  /** IPv4 `a.b.x.x`, IPv6 `a:b:x` — enough to spot a proxy range. */
  firstMasked: string;
}

/** Created once per process; never logged. */
const DIAGNOSTIC_SALT = crypto.randomBytes(16).toString("hex");

function maskAddress(ip: string): string {
  if (ip.includes(":")) {
    const groups = ip.split(":").filter((g) => g.length > 0);
    return `${groups.slice(0, 2).join(":")}:x`;
  }
  const octets = ip.split(".");
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.x.x` : "x";
}

function probe(
  value: string | string[] | undefined,
  salt: string,
): ForwardedHeaderProbe | null {
  const first = firstAddress(value);
  if (!first) return null;
  return {
    parts: partCount(value),
    firstHash: crypto
      .createHash("sha256")
      .update(salt + first, "utf8")
      .digest("hex")
      .slice(0, 12),
    firstMasked: maskAddress(first),
  };
}

/** Which forwarded headers arrived, with every address reduced to a short
 * hash and a masked prefix. Never a raw address. `reqIp` is Express's view,
 * for comparison. */
export function describeForwardedHeaders(
  req: HeaderSource,
  salt: string = DIAGNOSTIC_SALT,
): Record<
  (typeof FORWARDED_HEADERS_PROBED)[number] | "reqIp",
  ForwardedHeaderProbe | null
> {
  const report = {} as Record<
    (typeof FORWARDED_HEADERS_PROBED)[number] | "reqIp",
    ForwardedHeaderProbe | null
  >;
  for (const name of FORWARDED_HEADERS_PROBED) {
    report[name] = probe(req.headers[name], salt);
  }
  report.reqIp = probe(req.ip, salt);
  return report;
}

/**
 * TEMPORARY (LIRA-278): logs the forwarded-header report for each sign-up
 * link request, BEFORE the limiter so throttled requests are measured too.
 * Logs no email and no raw address. Remove once CLIENT_IP_HEADER is set.
 * At WARN on purpose, so it shows whatever LOG_LEVEL production runs at.
 */
export function logForwardedHeadersForSignup(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    logger.warn(
      {
        diagnostic: "LIRA-278 client-ip",
        clientIpHeader: CLIENT_IP_HEADER ?? null,
        headers: describeForwardedHeaders(req),
      },
      "TEMP LIRA-278: forwarded headers on /signup/request",
    );
  } catch {
    // A diagnostic must never block a request.
  }
  next();
}
