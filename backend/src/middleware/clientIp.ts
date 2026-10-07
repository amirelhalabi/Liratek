/**
 * The visitor's real IP for the public sign-up limiters (LIRA-278).
 *
 * Production runs browser -> Vercel rewrite -> api.liratek.shop -> Fly with
 * `trust proxy` = 1, so `req.ip` is a PROXY's address (66.241.124.103 in the
 * production log) and every visitor shares one per-IP sign-up budget.
 *
 * `trust proxy` is deliberately NOT changed: `X-Forwarded-Host` tenant
 * routing depends on it (docs/OPERATIONS.md deploy checks). Instead the
 * sign-up limiters read ONE named header, `CLIENT_IP_HEADER` (for example
 * `fly-client-ip`), when the owner sets it. Unset, nothing changes.
 *
 * Which header carries the visitor is not known yet: the temporary
 * diagnostic below logs what arrives so the owner can choose after a deploy.
 */

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { CLIENT_IP_HEADER } from "@liratek/core";
import { logger } from "../server.js";

type HeaderSource = Pick<Request, "headers" | "ip">;

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

/**
 * The visitor's IP: the first address in `headerName` when it is configured
 * and present, else `req.ip`, else "". Header names are matched lowercased
 * (Node lowercases incoming header names).
 */
export function resolveClientIp(
  req: HeaderSource,
  headerName: string | undefined = CLIENT_IP_HEADER,
): string {
  if (headerName) {
    const fromHeader = firstAddress(req.headers[headerName.toLowerCase()]);
    if (fromHeader) return fromHeader;
  }
  return req.ip ?? "";
}

/**
 * `keyGenerator` for the sign-up limiters. IPv6 goes through
 * express-rate-limit's `ipKeyGenerator` (grouped by /56) so one visitor
 * cannot rotate through its own address block to reset the budget.
 */
export function clientIpRateLimitKey(
  req: HeaderSource,
  headerName: string | undefined = CLIENT_IP_HEADER,
): string {
  return ipKeyGenerator(resolveClientIp(req, headerName));
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
