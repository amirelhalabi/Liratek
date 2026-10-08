#!/usr/bin/env node
/**
 * Node-native tests for `scripts/lib/clientIpCheck.mjs` (LIRA-283): the
 * deploy verifier's judgement of `/health/client-ip`, called directly with
 * forged headers and through Vercel.
 *
 * Rule 17: written before the module existed; the first run failed with
 * ERR_MODULE_NOT_FOUND (recorded 2026-10-07), then passed once it was written.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FORGED_IP,
  FORGED_IP_HEADERS,
  FORGED_DIRECT_HEADERS,
  evaluateClientIpChecks,
} from "../lib/clientIpCheck.mjs";

const reply = (json, status = 200) => ({ status, json });

test("direct: a forged header that is echoed back is a HARD failure (spoofable)", () => {
  const r = evaluateClientIpChecks({
    direct: reply({ success: true, ip: FORGED_IP, source: "vercel" }),
    viaVercel: reply({
      success: true,
      ip: "185.187.131.199",
      source: "vercel",
    }),
    flySecretSet: true,
  });
  assert.ok(r.failures.some((f) => /forged/i.test(f)));
});

test("direct: ignored forgery + via Vercel real IP = all ok, and the IP is printed", () => {
  const r = evaluateClientIpChecks({
    direct: reply({ success: true, ip: "66.241.124.103", source: "direct" }),
    viaVercel: reply({
      success: true,
      ip: "185.187.131.199",
      source: "vercel",
      header: "x-vercel-forwarded-for",
    }),
    flySecretSet: true,
  });
  assert.deepEqual(r.failures, []);
  assert.ok(r.oks.some((m) => m.includes("185.187.131.199")));
});

test("via Vercel: echoing the forged value is a HARD failure (Vercel passed it through)", () => {
  const r = evaluateClientIpChecks({
    direct: reply({ success: true, ip: "66.241.124.103", source: "direct" }),
    viaVercel: reply({ success: true, ip: FORGED_IP, source: "vercel" }),
    flySecretSet: true,
  });
  assert.ok(r.failures.some((f) => /Vercel/i.test(f)));
});

test("via Vercel 'direct' while the Fly secret is set = HARD failure (Vercel not sending it)", () => {
  const r = evaluateClientIpChecks({
    direct: reply({ success: true, ip: "66.241.124.103", source: "direct" }),
    viaVercel: reply({ success: true, ip: "66.241.124.103", source: "direct" }),
    flySecretSet: true,
  });
  assert.ok(r.failures.some((f) => /LIRATEK_PROXY_SECRET/.test(f)));
});

test("via Vercel 'direct' with NO Fly secret = informational only (not configured yet)", () => {
  const r = evaluateClientIpChecks({
    direct: reply({ success: true, ip: "66.241.124.103", source: "direct" }),
    viaVercel: reply({ success: true, ip: "66.241.124.103", source: "direct" }),
    flySecretSet: false,
  });
  assert.deepEqual(r.failures, []);
  assert.ok(r.infos.some((m) => /CLIENT_IP_PROXY_SECRET/.test(m)));
});

test("a missing endpoint (HTML 404) directly is a failure; through Vercel it is info", () => {
  const r = evaluateClientIpChecks({
    direct: reply(null, 404),
    viaVercel: reply(null, 404),
    flySecretSet: false,
  });
  assert.equal(r.failures.length, 1);
  assert.ok(r.infos.length >= 1);
});

test("both probes forge the proxy secret AND the middleware's own client-IP header", () => {
  // The Vercel middleware (repo root middleware.js) deletes and re-sets
  // both, so the via-Vercel probe must send them to prove the overwrite;
  // the direct probe must send them to prove Fly ignores a guessed secret.
  const lower = (o) => Object.keys(o).map((k) => k.toLowerCase());
  for (const probe of [FORGED_IP_HEADERS, FORGED_DIRECT_HEADERS]) {
    assert.ok(lower(probe).includes("x-liratek-proxy-auth"));
    assert.ok(lower(probe).includes("x-liratek-client-ip"));
  }
});

test("secret arrived but no usable header = HARD failure pointing at CLIENT_IP_HEADER", () => {
  const r = evaluateClientIpChecks({
    direct: reply({ success: true, ip: "66.241.124.103", source: "direct" }),
    viaVercel: reply({
      success: true,
      ip: "66.241.124.103",
      source: "direct",
      header: null,
      proxyVerified: true,
    }),
    flySecretSet: true,
  });
  assert.ok(r.failures.some((f) => /CLIENT_IP_HEADER/.test(f)));
  assert.ok(!r.failures.some((f) => /LIRATEK_PROXY_SECRET/.test(f)));
});

test("reading fly-client-ip behind Vercel (Vercel's own address) = HARD failure", () => {
  const r = evaluateClientIpChecks({
    direct: reply({ success: true, ip: "66.241.124.103", source: "direct" }),
    viaVercel: reply({
      success: true,
      ip: "3.120.0.1",
      source: "vercel",
      header: "fly-client-ip",
      proxyVerified: true,
    }),
    flySecretSet: true,
  });
  assert.ok(r.failures.some((f) => /fly-client-ip/.test(f)));
});
