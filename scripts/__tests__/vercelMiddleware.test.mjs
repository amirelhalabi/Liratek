#!/usr/bin/env node
/**
 * Node-native tests for the Vercel Routing Middleware (`middleware.js`,
 * LIRA-283): what it forwards to api.liratek.shop on /api, /health and
 * /socket.io requests.
 *
 * The middleware answers with `next({ request: { headers } })` from
 * `@vercel/functions`, which encodes the upstream request headers as
 * `x-middleware-request-<name>` plus `x-middleware-override-headers` (the
 * complete list — a header missing from it is removed upstream). These tests
 * read that encoding back, so they check what Vercel is handed, not only the
 * pure helper.
 *
 * Rule 17: written before `middleware.js` existed; the first run failed with
 * ERR_MODULE_NOT_FOUND (recorded 2026-10-08).
 */
import test from "node:test";
import assert from "node:assert/strict";
import middleware, {
  CLIENT_IP_FORWARD_HEADER,
  EDGE_MARKER_HEADER,
  MIN_PROXY_SECRET_LENGTH,
  PROXY_AUTH_HEADER,
  buildUpstreamHeaders,
  isProxiedPath,
} from "../../middleware.js";

const SECRET = "s".repeat(MIN_PROXY_SECRET_LENGTH + 8);
const REAL_IP = "185.187.131.199";
const FORGED_IP = "203.0.113.99";

/** A request as Vercel hands it to the middleware: `x-real-ip` is set by
 * Vercel's edge; the client additionally tries to forge our own headers. */
function edgeRequest(path, extra = {}) {
  return new Request(`https://www.liratek.shop${path}`, {
    headers: {
      host: "cornertech.liratek.shop",
      "x-forwarded-host": "cornertech.liratek.shop",
      "x-real-ip": REAL_IP,
      cookie: "sid=abc",
      [PROXY_AUTH_HEADER]: "client-guessed-secret",
      [CLIENT_IP_FORWARD_HEADER]: FORGED_IP,
      ...extra,
    },
  });
}

/** Decode `next({request:{headers}})` back into the upstream header set. */
function upstreamOf(response) {
  const list = response.headers.get("x-middleware-override-headers");
  assert.ok(list !== null, "middleware must override the request headers");
  const upstream = new Map();
  for (const name of list.split(",").filter(Boolean)) {
    upstream.set(name, response.headers.get(`x-middleware-request-${name}`));
  }
  return upstream;
}

function withSecret(value, fn) {
  const before = process.env.LIRATEK_PROXY_SECRET;
  if (value === undefined) delete process.env.LIRATEK_PROXY_SECRET;
  else process.env.LIRATEK_PROXY_SECRET = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.LIRATEK_PROXY_SECRET;
    else process.env.LIRATEK_PROXY_SECRET = before;
  }
}

test("proxied paths: /api, /health and /socket.io only", () => {
  for (const p of [
    "/api",
    "/api/auth/login",
    "/health",
    "/health/client-ip",
    "/socket.io/",
    "/socket.io/?EIO=4&transport=polling",
  ]) {
    assert.equal(isProxiedPath(new URL(p, "https://x").pathname), true, p);
  }
  for (const p of [
    "/",
    "/index.html",
    "/assets/app.js",
    "/apiary",
    "/healthy",
    "/runtime-config.js",
    "/login",
  ]) {
    assert.equal(isProxiedPath(p), false, p);
  }
});

test("the secret replaces whatever the client sent, and the client IP is Vercel's x-real-ip", () => {
  withSecret(SECRET, () => {
    const res = middleware(edgeRequest("/health/client-ip"));
    const up = upstreamOf(res);
    assert.equal(up.get(PROXY_AUTH_HEADER), SECRET);
    assert.equal(up.get(CLIENT_IP_FORWARD_HEADER), REAL_IP);
    assert.equal(res.headers.get("x-middleware-next"), "1");
  });
});

test("every other request header is kept — X-Forwarded-Host above all (tenant login)", () => {
  withSecret(SECRET, () => {
    const up = upstreamOf(middleware(edgeRequest("/api/auth/login")));
    assert.equal(up.get("x-forwarded-host"), "cornertech.liratek.shop");
    // Host is NOT overridden: Vercel sets api.liratek.shop on the rewrite.
    assert.equal(up.has("host"), false);
    assert.equal(up.get("cookie"), "sid=abc");
    assert.equal(up.get("x-real-ip"), REAL_IP);
  });
});

test("no usable secret (unset or short): client copies are still STRIPPED, nothing is set", () => {
  for (const value of [undefined, "", "too-short"]) {
    withSecret(value, () => {
      const res = middleware(edgeRequest("/api/x"));
      const up = upstreamOf(res);
      assert.equal(up.has(PROXY_AUTH_HEADER), false, String(value));
      assert.equal(up.get(CLIENT_IP_FORWARD_HEADER), REAL_IP);
      assert.equal(res.headers.get(EDGE_MARKER_HEADER), "nosecret");
    });
  }
});

test("no x-real-ip: the forged client-IP header is removed, not passed through", () => {
  const h = buildUpstreamHeaders(
    new Headers({
      [CLIENT_IP_FORWARD_HEADER]: FORGED_IP,
      [PROXY_AUTH_HEADER]: "x",
    }),
    SECRET,
  );
  assert.equal(h.has(CLIENT_IP_FORWARD_HEADER), false);
  assert.equal(h.get(PROXY_AUTH_HEADER), SECRET);
});

test("a non-IP x-real-ip is not forwarded", () => {
  const h = buildUpstreamHeaders(
    new Headers({ "x-real-ip": "not-an-ip, 1.2.3.4" }),
    SECRET,
  );
  assert.equal(h.has(CLIENT_IP_FORWARD_HEADER), false);
});

test("IPv6 from x-real-ip is forwarded", () => {
  const h = buildUpstreamHeaders(
    new Headers({ "x-real-ip": "2a02:6ea0:c51b::12" }),
    SECRET,
  );
  assert.equal(h.get(CLIENT_IP_FORWARD_HEADER), "2a02:6ea0:c51b::12");
});

test("the response marker never carries the secret", () => {
  withSecret(SECRET, () => {
    const res = middleware(edgeRequest("/api/x"));
    assert.equal(res.headers.get(EDGE_MARKER_HEADER), "ok");
    for (const [name, value] of res.headers) {
      if (name.startsWith("x-middleware-request-")) continue; // consumed by Vercel
      assert.ok(!value.includes(SECRET), `${name} leaks the secret`);
    }
  });
});

test("non-proxied paths pass through untouched (no header override)", () => {
  withSecret(SECRET, () => {
    const res = middleware(edgeRequest("/assets/app.js"));
    assert.equal(res.headers.get("x-middleware-next"), "1");
    assert.equal(res.headers.get("x-middleware-override-headers"), null);
    for (const [name, value] of res.headers) {
      assert.ok(!value.includes(SECRET), `${name} leaks the secret`);
    }
  });
});
