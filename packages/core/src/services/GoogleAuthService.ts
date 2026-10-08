/**
 * Continue with Google (LIRA-280) — the Google side of sign-in, and the
 * www -> shop hand-off that follows it.
 *
 * NODE ONLY (node:crypto, network): exported from `services/index.ts`, never
 * from `browser.ts` (rule 29).
 *
 * What lives here:
 *   - PKCE + the authorization URL (authorization-code flow, S256).
 *   - The code exchange at Google's token endpoint and the ID-token check:
 *     RS256 signature against Google's published JWKS (cached; one refresh on
 *     an unknown key id, for key rotation), `iss`, `aud`, `exp`, `nonce` and
 *     `email_verified === true`. No SDK and no new dependency — node:crypto
 *     imports a JWK directly.
 *   - Identity links (`user_identities`), one-time hand-off tokens
 *     (`sso_handoff_tokens`) and the session a hand-off opens.
 *
 * Sign-in matches ONLY through a linked Google `sub` (owner decision
 * 2026-10-07): there is no lookup by email anywhere in this file.
 *
 * ONE GOOGLE ACCOUNT = ONE USER PER SHOP (LIRA-288, owner decision
 * 2026-10-08): the same Google account may be linked in several shops, to
 * one user in each; a second user of the same shop is refused by the
 * repository (`IdentityAlreadyLinkedError`). On www, "which shops does this
 * account open?" comes from the platform sign-in directory
 * (`findSignInMatches`), so it works whether shops share one file or each
 * has its own. Links and unlinks re-sync the directory.
 *
 * Scoping is the caller's job, per method (the route knows which shop):
 *   - `findSignInMatches`, `createHandoff`, `consumeHandoff`: inside
 *     `runWithoutTenant` (platform).
 *   - `findMatchInTenant`, `openSession`, `linkIdentity`, `unlinkIdentity`,
 *     `getLinkedEmail`: inside `runWithTenant(<the shop>)`.
 */

import crypto from "node:crypto";
import {
  getUserIdentityRepository,
  type IdentityMatch,
  type UserIdentityRepository,
} from "../repositories/UserIdentityRepository.js";
import {
  getSigninDirectoryRepository,
  type DirectoryAccount,
  type SigninDirectoryRepository,
} from "../repositories/SigninDirectoryRepository.js";
import {
  getSsoHandoffTokenRepository,
  type SsoHandoffTokenRepository,
} from "../repositories/SsoHandoffTokenRepository.js";
import {
  getUserRepository,
  type SafeUser,
  type UserRepository,
} from "../repositories/UserRepository.js";
import {
  getSessionRepository,
  type SessionRepository,
} from "../repositories/SessionRepository.js";
import { generateToken, hashToken } from "../utils/crypto.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  getSigninDirectoryService,
  type SigninDirectorySync,
} from "./SigninDirectoryService.js";

// ── Google's published endpoints ─────────────────────────────────────────

export const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
/** Google documents both forms for `iss`. */
export const GOOGLE_ISSUERS: readonly string[] = [
  "accounts.google.com",
  "https://accounts.google.com",
];
/** The www -> shop hand-off lives this long (contract: about 60 s). */
export const SSO_HANDOFF_TTL_MS = 60_000;
/** Clock tolerance for `exp`/`iat`, seconds. */
const CLOCK_SKEW_SECONDS = 60;
/** JWKS cache when Google sends no usable max-age. */
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000;

const PROVIDER = "google" as const;

// ── Types ────────────────────────────────────────────────────────────────

/** The slice of `fetch` this service uses — injectable so tests never touch
 * the network. The global `fetch` satisfies it. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

/** What a verified Google ID token proves. */
export interface GoogleIdentityClaims {
  /** Google's stable account id — the ONLY thing sign-in matches on. */
  sub: string;
  /** Verified by Google (`email_verified === true`); trimmed + lowercased. */
  email: string;
}

/** Every refusal of Google's answer. `reason` is for logs, never shown. */
export class GoogleTokenError extends Error {
  constructor(public readonly reason: string) {
    super(`Google sign-in refused: ${reason}`);
    this.name = "GoogleTokenError";
  }
}

export interface GoogleAuthServiceOptions {
  fetchImpl?: FetchLike;
  identityRepo?: UserIdentityRepository;
  handoffRepo?: SsoHandoffTokenRepository;
  userRepo?: UserRepository;
  sessionRepo?: SessionRepository;
  /** LIRA-288: re-synced after a link or unlink. */
  directory?: SigninDirectorySync;
  /** LIRA-288: where www sign-in matches come from. */
  directoryRepo?: SigninDirectoryRepository;
}

interface JsonWebKeyWithKid extends crypto.JsonWebKey {
  kid?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8"),
    );
    if (isRecord(parsed)) return parsed;
  } catch {
    // fall through
  }
  throw new GoogleTokenError(what);
}

function maxAgeMs(cacheControl: string | null): number {
  const match = cacheControl ? /max-age=(\d+)/.exec(cacheControl) : null;
  const seconds = match ? Number(match[1]) : NaN;
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_JWKS_TTL_MS;
}

// ── Service ──────────────────────────────────────────────────────────────

export class GoogleAuthService {
  private readonly fetchImpl: FetchLike;
  private readonly identityRepo: UserIdentityRepository;
  private readonly handoffRepo: SsoHandoffTokenRepository;
  private readonly userRepo: UserRepository;
  private readonly sessionRepo: SessionRepository;
  private readonly directory: SigninDirectorySync;
  private readonly directoryRepo: SigninDirectoryRepository;
  private jwks: { keys: Map<string, crypto.KeyObject>; expiresAtMs: number } | null =
    null;

  constructor(options: GoogleAuthServiceOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.identityRepo = options.identityRepo ?? getUserIdentityRepository();
    this.handoffRepo = options.handoffRepo ?? getSsoHandoffTokenRepository();
    this.userRepo = options.userRepo ?? getUserRepository();
    this.sessionRepo = options.sessionRepo ?? getSessionRepository();
    this.directory = options.directory ?? getSigninDirectoryService();
    this.directoryRepo = options.directoryRepo ?? getSigninDirectoryRepository();
  }

  // ── PKCE + authorization URL ───────────────────────────────────────────

  /** RFC 7636: a 43-char base64url verifier and its S256 challenge. */
  static createPkcePair(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    return { verifier, challenge };
  }

  buildAuthorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }): string {
    const params = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: "openid email",
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`;
  }

  // ── Code exchange + ID token ───────────────────────────────────────────

  /** Trades the authorization code (with the PKCE verifier) for an ID token
   * and returns its verified claims. Throws `GoogleTokenError`. */
  async exchangeCodeForClaims(input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    nonce: string;
    nowMs: number;
  }): Promise<GoogleIdentityClaims> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.codeVerifier,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    }).toString();

    let payload: unknown;
    try {
      const response = await this.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!response.ok) throw new GoogleTokenError("token_endpoint");
      payload = await response.json();
    } catch (error) {
      if (error instanceof GoogleTokenError) throw error;
      throw new GoogleTokenError("token_endpoint");
    }
    const idToken = isRecord(payload) ? payload.id_token : undefined;
    if (typeof idToken !== "string") throw new GoogleTokenError("no_id_token");

    return this.verifyIdToken(idToken, {
      clientId: input.clientId,
      nonce: input.nonce,
      nowMs: input.nowMs,
    });
  }

  /** Verifies an ID token's signature and claims. Throws `GoogleTokenError`
   * whose `reason` names the failed check. */
  async verifyIdToken(
    idToken: string,
    expect: { clientId: string; nonce: string; nowMs: number },
  ): Promise<GoogleIdentityClaims> {
    const parts = idToken.split(".");
    if (parts.length !== 3) throw new GoogleTokenError("format");
    const [headerSeg, payloadSeg, signatureSeg] = parts as [string, string, string];

    const header = decodeSegment(headerSeg, "format");
    // RS256 exactly: refuses `none` and HS256-with-the-public-key confusion.
    if (header.alg !== "RS256") throw new GoogleTokenError("alg");
    if (typeof header.kid !== "string") throw new GoogleTokenError("kid");

    const key = await this.keyFor(header.kid, expect.nowMs);
    const valid = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${headerSeg}.${payloadSeg}`),
      key,
      Buffer.from(signatureSeg, "base64url"),
    );
    if (!valid) throw new GoogleTokenError("signature");

    const claims = decodeSegment(payloadSeg, "format");
    if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.includes(claims.iss)) {
      throw new GoogleTokenError("iss");
    }
    const audOk = Array.isArray(claims.aud)
      ? claims.aud.length === 1 && claims.aud[0] === expect.clientId
      : claims.aud === expect.clientId;
    if (!audOk) throw new GoogleTokenError("aud");
    const nowSeconds = Math.floor(expect.nowMs / 1000);
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= nowSeconds) {
      throw new GoogleTokenError("exp");
    }
    if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
      throw new GoogleTokenError("iat");
    }
    if (claims.nonce !== expect.nonce) throw new GoogleTokenError("nonce");
    // A boolean `true` only — never the string "true".
    if (claims.email_verified !== true) {
      throw new GoogleTokenError("email_verified");
    }
    if (
      typeof claims.sub !== "string" ||
      claims.sub.length === 0 ||
      typeof claims.email !== "string" ||
      claims.email.length === 0
    ) {
      throw new GoogleTokenError("claims");
    }
    return { sub: claims.sub, email: claims.email.trim().toLowerCase() };
  }

  /** Google's public key for `kid`; refetches the JWKS once when the key is
   * unknown (rotation) or the cache has expired. */
  private async keyFor(kid: string, nowMs: number): Promise<crypto.KeyObject> {
    const cached =
      this.jwks && this.jwks.expiresAtMs > nowMs ? this.jwks.keys.get(kid) : undefined;
    if (cached) return cached;
    await this.refreshJwks(nowMs);
    const fresh = this.jwks?.keys.get(kid);
    if (!fresh) throw new GoogleTokenError("kid");
    return fresh;
  }

  private async refreshJwks(nowMs: number): Promise<void> {
    let body: unknown;
    let ttl = DEFAULT_JWKS_TTL_MS;
    try {
      const response = await this.fetchImpl(GOOGLE_JWKS_URL);
      if (!response.ok) throw new GoogleTokenError("jwks");
      ttl = maxAgeMs(response.headers.get("cache-control"));
      body = await response.json();
    } catch (error) {
      if (error instanceof GoogleTokenError) throw error;
      throw new GoogleTokenError("jwks");
    }
    const keys = new Map<string, crypto.KeyObject>();
    const list = isRecord(body) && Array.isArray(body.keys) ? body.keys : [];
    for (const raw of list) {
      if (!isRecord(raw) || raw.kty !== "RSA" || typeof raw.kid !== "string") continue;
      try {
        const jwk: JsonWebKeyWithKid = raw;
        keys.set(raw.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
      } catch {
        // skip a key node cannot import
      }
    }
    this.jwks = { keys, expiresAtMs: nowMs + ttl };
  }

  // ── Identities ─────────────────────────────────────────────────────────

  /** Every ACTIVE shop this Google account opens, by shop name — from the
   * platform sign-in directory (never a scan of shops). Call inside
   * `runWithoutTenant`. */
  findSignInMatches(subject: string): DirectoryAccount[] {
    return this.directoryRepo.findByGoogleSubject(subject);
  }

  /** The user this Google account opens in ONE shop, from that shop's own
   * records, or null. Call inside `runWithTenant(tenantId)` so per-tenant
   * mode reads the shop's file. */
  findMatchInTenant(subject: string, tenantId: number): IdentityMatch | null {
    return this.identityRepo.findBySubjectInTenant(PROVIDER, subject, tenantId);
  }

  /** Links Google to a user of the CURRENT shop; the same link again is a
   * no-op. Linked in other shops is fine (LIRA-288). Throws
   * `IdentityAlreadyLinkedError` (IDENTITY_ALREADY_LINKED) when another user
   * of this shop has it, or this user already has another Google account.
   *
   * LIRA-287 (owner decision 2026-10-07): Google's verified address becomes
   * the user's CONFIRMED email when they have none — never overwriting one,
   * and skipped when another user of this shop already holds it (unique per
   * shop). Stamped with the link instant, the same rule migration v198
   * applied to links made before this. `input.email` is Google-verified:
   * `verifyIdToken` refuses `email_verified !== true`. */
  linkIdentity(input: {
    userId: number;
    subject: string;
    email: string;
    now: string;
  }): void {
    this.identityRepo.link({
      userId: input.userId,
      provider: PROVIDER,
      subject: input.subject,
      email: input.email,
      now: input.now,
    });
    if (input.email.trim()) {
      this.userRepo.setEmailIfAbsent(input.userId, input.email, input.now);
    }
    // LIRA-288: www now finds this shop for this Google account (and for the
    // email just confirmed). Never throws.
    this.directory.syncUser(getCurrentTenantId(), input.userId, input.now);
  }

  /** Removes a CURRENT-shop user's Google link (the user themself, or an
   * admin from Settings -> Users). False when there was none. */
  unlinkIdentity(userId: number, now: string): boolean {
    const unlinked = this.identityRepo.unlink(userId, PROVIDER);
    if (unlinked) this.directory.syncUser(getCurrentTenantId(), userId, now);
    return unlinked;
  }

  getLinkedEmail(userId: number): { linked: boolean; email: string | null } {
    const row = this.identityRepo.findByUser(userId, PROVIDER);
    return row ? { linked: true, email: row.email } : { linked: false, email: null };
  }

  // ── Hand-off ───────────────────────────────────────────────────────────

  /** Mints a single-use, 60-second hand-off for one user of one shop and
   * returns the raw token (only its hash is stored). */
  createHandoff(input: { userId: number; tenantId: number; now: string }): string {
    const token = generateToken();
    this.handoffRepo.createToken({
      tokenHash: hashToken(token),
      userId: input.userId,
      targetTenantId: input.tenantId,
      expiresAt: new Date(Date.parse(input.now) + SSO_HANDOFF_TTL_MS).toISOString(),
      now: input.now,
    });
    return token;
  }

  /** Uses a hand-off. Null when unknown, expired or already used. */
  consumeHandoff(
    token: string,
    now: string,
  ): { userId: number; tenantId: number } | null {
    const row = this.handoffRepo.consume(hashToken(token), now);
    return row ? { userId: row.user_id, tenantId: row.target_tenant_id } : null;
  }

  // ── Session ────────────────────────────────────────────────────────────

  /**
   * Opens a normal web session for a user a hand-off named — the same
   * gates `AuthService.login` applies after the password check (active user,
   * active shop), minus the password: Google already proved who this is.
   * Null when the user is gone, inactive, of another shop, or the shop is not
   * active. Call inside `runWithTenant(tenantId)`.
   */
  openSession(input: {
    userId: number;
    tenantId: number;
    deviceInfo?: string;
    ipAddress?: string;
    rememberMe?: boolean;
  }): { user: SafeUser; sessionToken: string } | null {
    const user = this.userRepo.findById(input.userId);
    if (!user || user.tenant_id !== input.tenantId || user.is_active !== 1) {
      return null;
    }
    if (this.userRepo.getTenantStatus(input.tenantId) !== "active") return null;

    const session = this.sessionRepo.createSession({
      user_id: user.id,
      device_type: "web",
      device_info: input.deviceInfo,
      ip_address: input.ipAddress,
      remember_me: input.rememberMe ?? false,
      tenant_id: input.tenantId,
    });
    const { password_hash: _omit, ...safeUser } = user;
    return { user: safeUser, sessionToken: session.token };
  }
}

let instance: GoogleAuthService | null = null;

export function getGoogleAuthService(): GoogleAuthService {
  if (!instance) instance = new GoogleAuthService();
  return instance;
}

export function resetGoogleAuthService(): void {
  instance = null;
}
