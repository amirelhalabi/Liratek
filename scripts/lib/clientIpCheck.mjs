/**
 * The deploy verifier's client-IP check (LIRA-283), kept pure so it can be
 * unit-tested (`scripts/__tests__/clientIpCheck.test.mjs`).
 *
 * `scripts/deploy-api.mjs` calls `GET /health/client-ip` twice with forged
 * headers (FORGED_DIRECT_HEADERS directly, FORGED_IP_HEADERS via Vercel):
 *
 *   direct      https://api.liratek.shop  — anyone can call Fly directly, so
 *               the forged value must NOT come back, and the source must be
 *               "direct" (the junk proxy secret must not be accepted).
 *   viaVercel   https://www.liratek.shop  — the real user path. Once the
 *               proxy secret is wired, the source is "vercel" and `ip` is the
 *               machine running the verifier (print it; the owner compares).
 *               The forged value coming back means Vercel passed the client's
 *               own header through — the trust would be spoofable.
 */

/** TEST-NET-3 (RFC 5737): never a real client. */
export const FORGED_IP = "203.0.113.99";

/** What a browser could forge: client-IP headers only. Sent THROUGH Vercel.
 * No proxy-auth header — Vercel's transform may not overwrite one that is
 * already present, and a real browser does not send it. */
export const FORGED_IP_HEADERS = {
  "X-Forwarded-For": FORGED_IP,
  "X-Vercel-Forwarded-For": FORGED_IP,
  "X-Real-IP": FORGED_IP,
  "Fly-Client-IP": FORGED_IP,
};

/** A direct caller's best attempt: forged IP headers plus a guessed secret.
 * Sent straight to Fly. */
export const FORGED_DIRECT_HEADERS = {
  ...FORGED_IP_HEADERS,
  "x-liratek-proxy-auth": "deploy-verifier-deliberately-wrong-secret",
};

const usable = (r) =>
  r && r.status === 200 && r.json && r.json.success === true;

/**
 * @param {{ direct: {status:number, json:any}|null,
 *           viaVercel: {status:number, json:any}|null,
 *           flySecretSet: boolean }} input
 * @returns {{ failures: string[], oks: string[], infos: string[] }}
 */
export function evaluateClientIpChecks({ direct, viaVercel, flySecretSet }) {
  const failures = [];
  const oks = [];
  const infos = [];

  if (!usable(direct)) {
    failures.push(
      `/health/client-ip (direct) did not answer (status ${direct?.status ?? "none"})`,
    );
  } else if (direct.json.ip === FORGED_IP) {
    failures.push(
      "a DIRECT request with a forged client-IP header was believed — every per-IP limit is spoofable",
    );
  } else if (direct.json.source !== "direct") {
    failures.push(
      `a DIRECT request with a wrong proxy secret was trusted (source ${direct.json.source})`,
    );
  } else {
    oks.push("forged client-IP headers on a direct request are ignored");
  }

  if (!usable(viaVercel)) {
    infos.push(
      `/health/client-ip through Vercel did not answer (status ${viaVercel?.status ?? "none"}) — client-IP state unknown`,
    );
  } else if (viaVercel.json.ip === FORGED_IP) {
    failures.push(
      "through Vercel, a client-supplied IP header reached the API unchanged — set CLIENT_IP_HEADER to a header Vercel overwrites",
    );
  } else if (
    viaVercel.json.source === "vercel" &&
    viaVercel.json.header === "fly-client-ip"
  ) {
    failures.push(
      "the client IP is read from fly-client-ip, which behind Vercel is VERCEL's address, not the shop's — unset CLIENT_IP_HEADER on Fly",
    );
  } else if (viaVercel.json.source === "vercel") {
    oks.push(
      `through Vercel the API sees this machine as ${viaVercel.json.ip} (from ${viaVercel.json.header}) — it should be this machine's public IP`,
    );
  } else if (viaVercel.json.proxyVerified === true) {
    failures.push(
      `the Vercel proxy secret arrived but the client-IP header was missing or not an IP — check CLIENT_IP_HEADER (now ${viaVercel.json.header ?? "default x-vercel-forwarded-for"}); every shop still shares one IP bucket`,
    );
  } else if (flySecretSet) {
    failures.push(
      "CLIENT_IP_PROXY_SECRET is set on Fly but requests through Vercel do not carry it — check LIRATEK_PROXY_SECRET on Vercel (same value) and the vercel.json transform; until then every shop shares one IP bucket",
    );
  } else {
    infos.push(
      "client IP not wired yet (no CLIENT_IP_PROXY_SECRET on Fly) — every shop shares one per-IP bucket (LIRA-283)",
    );
  }

  return { failures, oks, infos };
}
