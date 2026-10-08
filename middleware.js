/**
 * Vercel Routing Middleware (LIRA-283) — wired by `proxy` in vercel.json.
 *
 * Runs on Vercel before the external rewrites that send /api, /health and
 * /socket.io to https://api.liratek.shop (Fly). It hands the API two headers
 * the browser cannot forge end to end:
 *
 *   x-liratek-proxy-auth   the shared secret (Vercel env LIRATEK_PROXY_SECRET
 *                          = Fly secret CLIENT_IP_PROXY_SECRET). Proves the
 *                          request came through Vercel, not straight to Fly.
 *   x-liratek-client-ip    the visitor's address as Vercel's edge saw it
 *                          (`x-real-ip`, which Vercel sets itself and
 *                          overwrites — docs: /docs/headers/request-headers).
 *
 * Both are DELETED from the incoming request first and then set, so a client
 * that sends its own copies gets neither through. The API believes the
 * client-IP header only when the secret matches (backend/src/middleware/
 * clientIp.ts, fail-closed), and reads it from Fly secret CLIENT_IP_HEADER.
 *
 * Why middleware and not a `routes` transform: commit c02b98ef added a
 * `request.headers` transform with `$LIRATEK_PROXY_SECRET`; it compiled
 * (first route in .vercel/output/config.json) but the header never reached
 * Fly. Middleware reads the variable with process.env at request time.
 *
 * WebSockets: Vercel does not forward an Upgrade to an external origin
 * (docs/DEPLOYMENT.md §4b), so socket.io runs on HTTP long-polling, which is
 * ordinary requests and passes through here like /api.
 *
 * Request bodies: this file never reads one, so vercel.json sets
 * `skipMiddlewareRequestBody: true` (the rewrite target still receives the
 * body). Routing Middleware lists a 4 MB body limit; the API accepts 10 MB.
 *
 * Never logs. The secret appears only in the upstream request headers.
 */
import { next } from "@vercel/functions";

/** Carries the shared secret; must match backend PROXY_AUTH_HEADER. */
export const PROXY_AUTH_HEADER = "x-liratek-proxy-auth";

/** Carries the client address; Fly CLIENT_IP_HEADER must name it. */
export const CLIENT_IP_FORWARD_HEADER = "x-liratek-client-ip";

/** Vercel's own client address (`ipAddress()` in @vercel/functions reads
 * this same header). */
const VERCEL_CLIENT_IP_HEADER = "x-real-ip";

/** Non-secret RESPONSE marker: "ok" = secret attached, "nosecret" = the
 * variable is unset or too short (requests still forwarded, stripped). Lets
 * the owner see with `curl -I` whether the middleware ran at all. */
export const EDGE_MARKER_HEADER = "x-liratek-edge";

/** Same floor as the backend (MIN_PROXY_SECRET_LENGTH): a shorter value is
 * ignored there, so it is not sent at all. */
export const MIN_PROXY_SECRET_LENGTH = 32;

const PROXIED_PATH = /^\/(?:api|health|socket\.io)(?:\/|$)/;

/** True for the paths vercel.json rewrites to the API. */
export function isProxiedPath(pathname) {
  return PROXIED_PATH.test(pathname);
}

const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^[0-9a-fA-F:.]{2,45}$/;

/** A single, plain IP literal (the API validates again with net.isIP). */
function plainIp(value) {
  const v = (value ?? "").trim();
  if (IPV4.test(v)) return v;
  if (v.includes(":") && IPV6.test(v)) return v;
  return null;
}

/**
 * The header set to send upstream: a copy of `incoming` with any client
 * copies of our two headers removed, then the secret (when usable) and the
 * client address (when Vercel supplied a valid one) set.
 *
 * @param {Headers} incoming
 * @param {string | undefined} secret
 * @returns {Headers}
 */
export function buildUpstreamHeaders(incoming, secret) {
  const headers = new Headers(incoming);
  // Host is left to Vercel: an external rewrite must reach Fly with
  // Host: api.liratek.shop (Fly routes and serves TLS by it). The shop's own
  // host travels in X-Forwarded-Host, which is kept (tenant login needs it).
  headers.delete("host");
  headers.delete(PROXY_AUTH_HEADER);
  headers.delete(CLIENT_IP_FORWARD_HEADER);

  const s = (secret ?? "").trim();
  if (s.length >= MIN_PROXY_SECRET_LENGTH) headers.set(PROXY_AUTH_HEADER, s);

  const ip = plainIp(incoming.get(VERCEL_CLIENT_IP_HEADER));
  if (ip) headers.set(CLIENT_IP_FORWARD_HEADER, ip);
  return headers;
}

/** @param {Request} request */
export default function middleware(request) {
  const { pathname } = new URL(request.url);
  if (!isProxiedPath(pathname)) return next();

  const secret = process.env.LIRATEK_PROXY_SECRET;
  const headers = buildUpstreamHeaders(request.headers, secret);
  return next({
    request: { headers },
    headers: {
      [EDGE_MARKER_HEADER]: headers.has(PROXY_AUTH_HEADER) ? "ok" : "nosecret",
    },
  });
}
