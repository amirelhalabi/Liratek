/**
 * `smtp` transport (LIRA-267, T040, research R6): Spacemail through
 * nodemailer. `mail.spacemail.com` on 465 (implicit TLS, the default) or 587
 * (STARTTLS) — both reachable from the Fly machine (checked 2026-10-07).
 *
 * The job here is the error contract the outbox worker retries on
 * (`EmailTransport.ts`):
 *   - 4xx reply                      -> transient (greylisting, rate limits,
 *                                       a 454 temporary auth failure)
 *   - EAUTH / 535 (bad credentials)  -> permanent; an operator must fix the
 *                                       secrets, retrying only hammers the
 *                                       server with a wrong password
 *   - any other 5xx reply            -> permanent (bad address, rejected)
 *   - no reply code at all           -> transient (DNS, connect, TLS,
 *                                       timeout, dropped socket)
 *
 * No pool: invites are rare, and a fresh connection per send means a stale
 * pooled socket can never fail a message.
 */

import nodemailer from "nodemailer";
import {
  PermanentEmailError,
  TransientEmailError,
  type EmailMessage,
  type EmailSendResult,
  type EmailTransport,
} from "../EmailTransport.js";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

/**
 * Bounded so a hung server cannot hold a send for long: worst case per
 * attempt is roughly connect + greeting + one idle socket wait, about a
 * minute, far below the worker's 10-minute stuck-row recovery.
 */
const CONNECTION_TIMEOUT_MS = 15_000;
const GREETING_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 30_000;

/** The fields nodemailer puts on the errors it rejects with. */
interface NodemailerErrorFields {
  code?: unknown;
  responseCode?: unknown;
  response?: unknown;
}

/** Turns whatever nodemailer threw into the worker's two error kinds. */
export function classifySmtpError(
  error: unknown,
): PermanentEmailError | TransientEmailError {
  if (!(error instanceof Error)) {
    return new TransientEmailError(`SMTP send failed: ${String(error)}`);
  }
  const fields = error as Error & NodemailerErrorFields;
  const code = typeof fields.code === "string" ? fields.code : undefined;
  const responseCode =
    typeof fields.responseCode === "number" ? fields.responseCode : undefined;
  const reply =
    typeof fields.response === "string" ? fields.response : error.message;

  // A 4xx is temporary by definition — including a 454 temporary auth
  // failure, so this check comes before the EAUTH one.
  if (responseCode !== undefined && responseCode >= 400 && responseCode < 500) {
    return new TransientEmailError(
      `SMTP temporary failure (${responseCode}): ${reply}`,
    );
  }

  // Bad credentials. The server's own text is deliberately NOT included: an
  // auth reply can echo the login, and this message is stored and shown.
  if (code === "EAUTH" || responseCode === 535) {
    return new PermanentEmailError(
      `SMTP login failed${responseCode ? ` (${responseCode})` : ""} — check SMTP_USER/SMTP_PASS`,
    );
  }

  if (responseCode !== undefined && responseCode >= 500 && responseCode < 600) {
    return new PermanentEmailError(
      `SMTP rejected the message (${responseCode}): ${reply}`,
    );
  }

  return new TransientEmailError(
    `SMTP send failed${code ? ` (${code})` : ""}: ${error.message}`,
  );
}

export function createSmtpTransport(config: SmtpConfig): EmailTransport {
  const secure = config.port === 465;
  const mailer = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    // On 587, refuse to authenticate unless STARTTLS succeeded: the
    // password must never cross the wire in plaintext.
    requireTLS: !secure,
    auth: { user: config.user, pass: config.pass },
    pool: false,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });

  return {
    name: "smtp",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      try {
        const info = await mailer.sendMail({
          from: message.from,
          to: message.to,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
        return { providerMessageId: info.messageId ?? null };
      } catch (error) {
        throw classifySmtpError(error);
      }
    },
  };
}
