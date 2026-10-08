/**
 * GoogleAuthService (LIRA-280) — Continue with Google.
 *
 * No network: Google's token endpoint and JWKS are a mocked `fetchImpl`, and
 * ID tokens are signed here with an RSA key generated per run. The identity,
 * hand-off and session steps run against a real in-memory database.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { runWithTenant, runWithoutTenant } from "../../db/tenantContext.js";
import {
  GoogleAuthService,
  GoogleTokenError,
  type FetchLike,
} from "../GoogleAuthService.js";
import { IDENTITY_ALREADY_LINKED } from "../../utils/errors.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const CLIENT_ID = "client-123.apps.googleusercontent.com";
const NOW_MS = Date.parse("2026-10-07T10:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const NONCE = "nonce-abc";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const KID = "test-kid-1";
const JWK = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

function b64url(value: object | Buffer): string {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  return buf.toString("base64url");
}

function signIdToken(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: KID, typ: "JWT" },
  key: crypto.KeyObject = privateKey,
): string {
  const input = `${b64url(header)}.${b64url(claims)}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(input), key);
  return `${input}.${b64url(sig)}`;
}

function goodClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-sub-1",
    email: "Owner@Gmail.com",
    email_verified: true,
    nonce: NONCE,
    iat: Math.floor(NOW_MS / 1000) - 10,
    exp: Math.floor(NOW_MS / 1000) + 3600,
    ...over,
  };
}

interface FetchCall {
  url: string;
  body?: string;
}

function makeFetch(idToken: string | (() => string)): {
  fetchImpl: FetchLike;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: init?.body });
    const headers = { get: () => "public, max-age=3600" };
    if (url.includes("/certs")) {
      return { ok: true, status: 200, headers, json: async () => ({ keys: [JWK] }) };
    }
    if (url.includes("/token")) {
      const token = typeof idToken === "function" ? idToken() : idToken;
      return {
        ok: true,
        status: 200,
        headers,
        json: async () => ({ id_token: token, access_token: "x" }),
      };
    }
    return { ok: false, status: 404, headers, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  db.exec(`
    INSERT INTO tenants (id, name, slug, status) VALUES
      (2, 'Two', 'two', 'active'), (3, 'Three', 'three', 'active'),
      (4, 'Four', 'four', 'suspended');
    INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES
      (20, 2, 'boss', 'x', 'admin', 1),
      (21, 2, 'cashier', 'x', 'staff', 1),
      (30, 3, 'boss3', 'x', 'admin', 1),
      (31, 3, 'old', 'x', 'admin', 0),
      (40, 4, 'boss4', 'x', 'admin', 1);
  `);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

async function reasonOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GoogleTokenError) return error.reason;
    throw error;
  }
  return undefined;
}

describe("PKCE + authorization URL", () => {
  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = GoogleAuthService.createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(
      crypto.createHash("sha256").update(verifier).digest("base64url"),
    );
  });

  it("asks for an authorization code with PKCE, state and nonce", () => {
    const url = new URL(
      new GoogleAuthService().buildAuthorizationUrl({
        clientId: CLIENT_ID,
        redirectUri: "https://www.liratek.shop/api/auth/google/callback",
        state: "st",
        nonce: NONCE,
        codeChallenge: "ch",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("nonce")).toBe(NONCE);
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://www.liratek.shop/api/auth/google/callback",
    );
  });
});

describe("code exchange + ID token verification", () => {
  const exchange = (svc: GoogleAuthService) =>
    svc.exchangeCodeForClaims({
      code: "auth-code",
      codeVerifier: "the-verifier",
      clientId: CLIENT_ID,
      clientSecret: "secret",
      redirectUri: "https://www.liratek.shop/api/auth/google/callback",
      nonce: NONCE,
      nowMs: NOW_MS,
    });

  it("sends the PKCE verifier to Google's token endpoint and returns verified claims", async () => {
    const { fetchImpl, calls } = makeFetch(signIdToken(goodClaims()));
    const claims = await exchange(new GoogleAuthService({ fetchImpl }));
    expect(claims).toEqual({ sub: "google-sub-1", email: "owner@gmail.com" });
    const tokenCall = calls.find((c) => c.url.includes("/token"));
    expect(tokenCall?.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(tokenCall?.body ?? "");
    expect(form.get("code_verifier")).toBe("the-verifier");
    expect(form.get("code")).toBe("auth-code");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_secret")).toBe("secret");
  });

  it("accepts the bare issuer form too", async () => {
    const { fetchImpl } = makeFetch(
      signIdToken(goodClaims({ iss: "accounts.google.com" })),
    );
    await expect(exchange(new GoogleAuthService({ fetchImpl }))).resolves.toEqual(
      { sub: "google-sub-1", email: "owner@gmail.com" },
    );
  });

  it.each([
    ["bad issuer", goodClaims({ iss: "https://evil.example.com" }), "iss"],
    ["wrong audience", goodClaims({ aud: "someone-else" }), "aud"],
    ["expired", goodClaims({ exp: Math.floor(NOW_MS / 1000) - 600 }), "exp"],
    ["unverified email", goodClaims({ email_verified: false }), "email_verified"],
    ["email_verified as a string", goodClaims({ email_verified: "true" }), "email_verified"],
    ["wrong nonce", goodClaims({ nonce: "other" }), "nonce"],
    ["missing sub", goodClaims({ sub: undefined }), "claims"],
  ])("refuses an ID token with %s", async (_label, claims, reason) => {
    const { fetchImpl } = makeFetch(signIdToken(claims));
    expect(await reasonOf(exchange(new GoogleAuthService({ fetchImpl })))).toBe(
      reason,
    );
  });

  it("refuses a token signed by a key Google does not publish", async () => {
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { fetchImpl } = makeFetch(
      signIdToken(goodClaims(), undefined, other.privateKey),
    );
    expect(await reasonOf(exchange(new GoogleAuthService({ fetchImpl })))).toBe(
      "signature",
    );
  });

  it("refuses alg none / HS256 (algorithm confusion)", async () => {
    const unsigned = `${b64url({ alg: "none", kid: KID })}.${b64url(goodClaims())}.`;
    const { fetchImpl } = makeFetch(unsigned);
    expect(await reasonOf(exchange(new GoogleAuthService({ fetchImpl })))).toBe(
      "alg",
    );
  });

  it("refuses an unknown key id after one JWKS refresh", async () => {
    let unknownKid = false;
    const { fetchImpl, calls } = makeFetch(() =>
      unknownKid
        ? signIdToken(goodClaims(), { alg: "RS256", kid: "rotated-away" })
        : signIdToken(goodClaims()),
    );
    const svc = new GoogleAuthService({ fetchImpl });
    await exchange(svc); // warms the key cache
    unknownKid = true;
    expect(await reasonOf(exchange(svc))).toBe("kid");
    // one fetch to warm, exactly one refresh for the unknown key
    expect(calls.filter((c) => c.url.includes("/certs")).length).toBe(2);
  });

  it("caches Google's keys between sign-ins", async () => {
    const { fetchImpl, calls } = makeFetch(() => signIdToken(goodClaims()));
    const svc = new GoogleAuthService({ fetchImpl });
    await exchange(svc);
    await exchange(svc);
    expect(calls.filter((c) => c.url.includes("/certs")).length).toBe(1);
  });

  it("refuses when Google's token endpoint answers an error", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 400,
      headers: { get: () => null },
      json: async () => ({ error: "invalid_grant" }),
    });
    expect(await reasonOf(exchange(new GoogleAuthService({ fetchImpl })))).toBe(
      "token_endpoint",
    );
  });
});

describe("identities, hand-off and session", () => {
  const svc = () => new GoogleAuthService();

  function linkIn(tenantId: number, userId: number, subject = "google-sub-1") {
    runWithTenant(tenantId, () =>
      svc().linkIdentity({ userId, subject, email: "Owner@Gmail.com", now: NOW }),
    );
  }

  it("links from Settings, refuses a second user in the same shop, and unlinks", () => {
    linkIn(2, 20);
    let code: string | undefined;
    try {
      linkIn(2, 21);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe(IDENTITY_ALREADY_LINKED);
    runWithTenant(2, () => {
      expect(svc().getLinkedEmail(20)).toEqual({
        linked: true,
        email: "owner@gmail.com",
      });
      expect(svc().unlinkIdentity(20, NOW)).toBe(true);
      expect(svc().getLinkedEmail(20)).toEqual({ linked: false, email: null });
      expect(svc().unlinkIdentity(20, NOW)).toBe(false);
    });
  });

  it("LIRA-288: www sign-in matches come from the sign-in directory — active users, active shops, by shop name", () => {
    linkIn(2, 20);
    linkIn(3, 30);
    // A link in a SUSPENDED shop (seeded raw) is never a match.
    db.exec(
      `INSERT INTO user_identities (user_id, tenant_id, provider, subject) VALUES (40, 4, 'google', 'google-sub-1')`,
    );
    expect(
      runWithoutTenant(() => svc().findSignInMatches("google-sub-1")).map((m) => [
        m.tenant_id,
        m.user_id,
        m.shop_name,
      ]),
    ).toEqual([
      [3, 30, "Three"],
      [2, 20, "Two"],
    ]);
    // The directory is what www reads: a shop missing from it is not listed,
    // even though its own records still hold the link...
    db.exec(`DELETE FROM signin_directory WHERE target_tenant_id = 3`);
    expect(
      runWithoutTenant(() => svc().findSignInMatches("google-sub-1")).map((m) => m.tenant_id),
    ).toEqual([2]);
    // ...while the explicit-shop lookup (shop address, chooser re-check)
    // reads the shop's own records.
    expect(
      runWithTenant(3, () => svc().findMatchInTenant("google-sub-1", 3))?.user_id,
    ).toBe(30);
    expect(runWithoutTenant(() => svc().findSignInMatches("someone-else"))).toEqual([]);
  });

  it("LIRA-288: one Google account = one user PER SHOP — another shop is fine, another user of the same shop is refused", () => {
    linkIn(2, 20);
    expect(() => linkIn(3, 30)).not.toThrow();
    let code: string | undefined;
    try {
      linkIn(2, 21);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe(IDENTITY_ALREADY_LINKED);
    // Same user again: idempotent, no error.
    expect(() => linkIn(2, 20)).not.toThrow();
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM user_identities WHERE subject = 'google-sub-1'`).get() as { n: number }).n,
    ).toBe(2);
    // The old "linked to any shop" sign-up refusal is gone (rule 24: kept as
    // a guard that the removed path is not taken).
    expect("isLinkedToAnyShop" in svc()).toBe(false);
  });

  it("a hand-off token works once, stores only its hash, and names its shop", () => {
    const token = runWithoutTenant(() =>
      svc().createHandoff({ userId: 20, tenantId: 2, now: NOW }),
    );
    const stored = db
      .prepare(`SELECT token_hash, expires_at FROM sso_handoff_tokens`)
      .get() as { token_hash: string; expires_at: string };
    expect(stored.token_hash).not.toBe(token);
    expect(stored.token_hash).toBe(
      crypto.createHash("sha256").update(token).digest("hex"),
    );
    expect(Date.parse(stored.expires_at) - NOW_MS).toBe(60_000);

    expect(runWithoutTenant(() => svc().consumeHandoff(token, NOW))).toEqual({
      userId: 20,
      tenantId: 2,
    });
    expect(runWithoutTenant(() => svc().consumeHandoff(token, NOW))).toBeNull();
  });

  it("an expired hand-off token is refused", () => {
    const token = runWithoutTenant(() =>
      svc().createHandoff({ userId: 20, tenantId: 2, now: NOW }),
    );
    const later = new Date(NOW_MS + 61_000).toISOString();
    expect(runWithoutTenant(() => svc().consumeHandoff(token, later))).toBeNull();
  });

  it("opens a normal web session for an active user of an active shop", () => {
    const opened = runWithTenant(2, () =>
      svc().openSession({ userId: 20, tenantId: 2, deviceInfo: "ua" }),
    );
    expect(opened?.user.id).toBe(20);
    expect(opened?.user).not.toHaveProperty("password_hash");
    const row = db
      .prepare(`SELECT user_id, tenant_id, device_type FROM sessions WHERE token = ?`)
      .get(opened?.sessionToken) as Record<string, unknown>;
    expect(row).toEqual({ user_id: 20, tenant_id: 2, device_type: "web" });
  });

  it("refuses a session for an inactive user, a suspended shop, or a user of another shop", () => {
    expect(
      runWithTenant(3, () => svc().openSession({ userId: 31, tenantId: 3 })),
    ).toBeNull();
    expect(
      runWithTenant(4, () => svc().openSession({ userId: 40, tenantId: 4 })),
    ).toBeNull();
    expect(
      runWithTenant(2, () => svc().openSession({ userId: 30, tenantId: 2 })),
    ).toBeNull();
  });
});

// LIRA-287 (A): connecting Google gives a user with NO email the Google
// address as their confirmed email — never overwriting one, never taking an
// address another user of the same shop already holds.
describe("connecting Google confirms the user's email (LIRA-287)", () => {
  const svc = () => new GoogleAuthService();
  const emailOf = (id: number) =>
    db
      .prepare(`SELECT email, email_verified_at FROM users WHERE id = ?`)
      .get(id) as { email: string | null; email_verified_at: string | null };

  it("a user with no email gets Google's verified address, lowercased", () => {
    runWithTenant(2, () =>
      svc().linkIdentity({
        userId: 20,
        subject: "sub-a",
        email: "Owner@Gmail.com",
        now: NOW,
      }),
    );
    expect(emailOf(20)).toEqual({
      email: "owner@gmail.com",
      email_verified_at: NOW,
    });
  });

  it("never overwrites an existing email", () => {
    db.prepare(`UPDATE users SET email = 'mine@shop.com' WHERE id = 20`).run();
    runWithTenant(2, () =>
      svc().linkIdentity({
        userId: 20,
        subject: "sub-a",
        email: "owner@gmail.com",
        now: NOW,
      }),
    );
    expect(emailOf(20)).toEqual({ email: "mine@shop.com", email_verified_at: null });
  });

  it("skips (and still links) when another user of the shop holds the address", () => {
    db.prepare(`UPDATE users SET email = 'owner@gmail.com' WHERE id = 21`).run();
    runWithTenant(2, () =>
      svc().linkIdentity({
        userId: 20,
        subject: "sub-a",
        email: "owner@gmail.com",
        now: NOW,
      }),
    );
    expect(emailOf(20)).toEqual({ email: null, email_verified_at: null });
    expect(
      runWithTenant(2, () => svc().getLinkedEmail(20)).linked,
    ).toBe(true);
  });
});
