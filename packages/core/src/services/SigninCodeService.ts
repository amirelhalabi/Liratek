/**
 * SigninCodeService (LIRA-287) — "email me a code" on www, then "your shops".
 *
 * The owner-approved www sign-in (2026-10-07, modelled on Slack's
 * identifier-first sign-in): the person types their email, we mail a
 * 6-digit code, and a correct code shows every shop where that email is a
 * CONFIRMED user. Choosing one opens that shop's own sign-in page with the
 * username filled in; the password is still typed there. A code proves the
 * inbox and nothing else — it never opens a session.
 *
 * No SQL here (rule 13): the code, sign-in directory and outbox
 * repositories do it.
 *
 * Who gets a code: only an email that signs in somewhere — a row in the
 * platform sign-in directory (LIRA-288: an active user, never a super admin,
 * whose email is CONFIRMED, in an active shop). Every other case sends
 * nothing; the route answers all of them with the same message.
 *
 * Storage: only `hashToken("<email>:<code>")`. Binding the email into the
 * hash means a code is only ever compared against the row of the email it
 * was sent to. A new code burns the older ones of that email, so the
 * per-email limit also bounds the total number of guesses.
 *
 * "Now" is a UTC ISO string the caller passes in; expiry is decided by the
 * server's clock on purpose (the same rule-27 exception as every link): a
 * client-supplied "now" would let anyone extend a code.
 *
 * Scoping: the code table, the sign-in directory and the outbox are all
 * platform-level, so everything here reads and writes the platform file —
 * the same answers whether shops share one file or each has its own
 * (LIRA-288). Call inside `runWithoutTenant` (every method also enters it
 * itself).
 *
 * NODE ONLY (node:crypto): exported from `services/index.ts`, never from
 * `browser.ts` (rule 29).
 */

import crypto from "node:crypto";
import { runWithoutTenant } from "../db/tenantContext.js";
import {
  getSigninCodeRepository,
  type SigninCodeRepository,
} from "../repositories/SigninCodeRepository.js";
import { normalizeEmail } from "../repositories/UserRepository.js";
import {
  getSigninDirectoryRepository,
  type SigninDirectoryRepository,
} from "../repositories/SigninDirectoryRepository.js";
import {
  getEmailOutboxRepository,
  type EmailOutboxRepository,
} from "../repositories/EmailOutboxRepository.js";
import { hashToken } from "../utils/crypto.js";
import { authLogger } from "../utils/logger.js";
import { formatInviteExpiry } from "./SignupInvitationService.js";
import {
  SIGNIN_CODE_LENGTH,
  SIGNIN_CODE_PER_EMAIL_LIMIT,
  SIGNIN_CODE_PER_EMAIL_WINDOW_MS,
  SIGNIN_CODE_SECRET_KEY,
  SIGNIN_CODE_TTL_MINUTES,
  type SigninShop,
} from "../constants/signinCode.js";

/** The outbox template that carries a sign-in code. */
export const SIGNIN_CODE_TEMPLATE = "signin-code";

/** Why a code request did or did not queue an email. Internal only: the
 * route answers every one of these identically. */
export type SigninCodeRequestReason =
  | "queued"
  | "no_account"
  | "email_limit"
  | "not_configured";

export interface RequestSigninCodeParams {
  /** As typed; normalised here. */
  email: string;
  /** UTC ISO. */
  now: string;
  /** False when the server has no mail transport. */
  emailConfigured: boolean;
  /** Shown in the email as the address to write to for help. */
  supportEmail: string;
  /** Stored only as `hashToken(ip)`. */
  requesterIp?: string | null;
}

export interface VerifySigninCodeParams {
  email: string;
  code: string;
  /** UTC ISO. */
  now: string;
}

export interface SigninCodeServiceDeps {
  codeRepo: SigninCodeRepository;
  /** LIRA-288: "which shops does this email sign in to?". */
  directoryRepo: SigninDirectoryRepository;
  outboxRepo: EmailOutboxRepository;
  /** Makes a code; injectable so tests know it. */
  newCode: () => string;
}

/** A uniformly random code of SIGNIN_CODE_LENGTH digits. */
export function generateSigninCode(): string {
  return crypto
    .randomInt(0, 10 ** SIGNIN_CODE_LENGTH)
    .toString()
    .padStart(SIGNIN_CODE_LENGTH, "0");
}

/** What is stored for a code: bound to the email it was sent to. */
export function hashSigninCode(email: string, code: string): string {
  return hashToken(`${normalizeEmail(email)}:${code}`);
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

export class SigninCodeService {
  private readonly codeRepo: SigninCodeRepository;
  private readonly directoryRepo: SigninDirectoryRepository;
  private readonly outboxRepo: EmailOutboxRepository;
  private readonly newCode: () => string;

  constructor(deps: Partial<SigninCodeServiceDeps> = {}) {
    this.codeRepo = deps.codeRepo ?? getSigninCodeRepository();
    this.directoryRepo = deps.directoryRepo ?? getSigninDirectoryRepository();
    this.outboxRepo = deps.outboxRepo ?? getEmailOutboxRepository();
    this.newCode = deps.newCode ?? generateSigninCode;
  }

  /**
   * "Send me a code". Never throws for a business outcome; the address is
   * logged only as `hashToken(email)`.
   */
  requestCode(params: RequestSigninCodeParams): {
    queued: boolean;
    reason: SigninCodeRequestReason;
  } {
    const email = normalizeEmail(params.email);
    const emailHash = hashToken(email);
    const outcome = (reason: SigninCodeRequestReason) => {
      authLogger.info(
        { emailHash, reason },
        reason === "queued" ? "Sign-in code queued" : "Sign-in code not sent",
      );
      return { queued: reason === "queued", reason };
    };

    if (!params.emailConfigured) return outcome("not_configured");

    return runWithoutTenant(() => {
      if (this.directoryRepo.findByEmail(email).length === 0) {
        return outcome("no_account");
      }
      const since = addMs(params.now, -SIGNIN_CODE_PER_EMAIL_WINDOW_MS);
      if (
        this.codeRepo.countForEmailSince(email, since) >=
        SIGNIN_CODE_PER_EMAIL_LIMIT
      ) {
        return outcome("email_limit");
      }

      const code = this.newCode();
      const expiresAt = addMs(params.now, SIGNIN_CODE_TTL_MINUTES * 60_000);
      this.codeRepo.transaction(() => {
        this.codeRepo.invalidateForEmail(email, params.now);
        const created = this.codeRepo.createCode({
          email,
          codeHash: hashSigninCode(email, code),
          expiresAt,
          requestedIpHash: params.requesterIp
            ? hashToken(params.requesterIp)
            : null,
          now: params.now,
        });
        const outbox = this.outboxRepo.enqueue({
          // The code row's id is unique platform-wide (one platform table).
          idempotencyKey: `signin-code:${created.id}`,
          template: SIGNIN_CODE_TEMPLATE,
          toEmail: email,
          data: {
            [SIGNIN_CODE_SECRET_KEY]: code,
            expiresAtText: formatInviteExpiry(expiresAt),
            supportEmail: params.supportEmail,
          },
          now: params.now,
          // No round may start after the code itself stops working.
          giveUpAt: expiresAt,
        });
        this.codeRepo.linkOutbox(created.id, outbox.id, params.now);
      });
      return outcome("queued");
    });
  }

  /**
   * Checks a code. On success it is used up and the shops this email signs
   * in to are returned (possibly none, if every account was switched off in
   * the meantime). Null for every unusable code — wrong (counted as a try),
   * expired, used, superseded, locked, or never sent.
   */
  verifyCode(params: VerifySigninCodeParams): { shops: SigninShop[] } | null {
    const email = normalizeEmail(params.email);
    return runWithoutTenant(() => {
      const row = this.codeRepo.findUsableForEmail(email, params.now);
      if (!row) return null;
      if (!sameHash(hashSigninCode(email, params.code), row.code_hash)) {
        this.codeRepo.recordFailedAttempt(row.id, params.now);
        authLogger.info(
          { emailHash: hashToken(email), codeId: row.id },
          "Wrong sign-in code",
        );
        return null;
      }
      if (!this.codeRepo.consume(row.id, params.now)) return null;
      const shops = this.directoryRepo
        .findByEmail(email)
        .map((a) => ({ slug: a.slug, name: a.shop_name, username: a.username }));
      authLogger.info(
        { emailHash: hashToken(email), shops: shops.length },
        "Sign-in code accepted",
      );
      return { shops };
    });
  }
}

let instance: SigninCodeService | null = null;

export function getSigninCodeService(): SigninCodeService {
  if (!instance) instance = new SigninCodeService();
  return instance;
}

export function resetSigninCodeService(): void {
  instance = null;
}
