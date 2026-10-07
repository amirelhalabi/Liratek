/**
 * Picks the email transport from `EMAIL_TRANSPORT` (LIRA-267, T017).
 *
 *   disabled  (default) nothing is sent; invites are refused up front with
 *             EMAIL_NOT_CONFIGURED, so this transport is a backstop only.
 *   file      writes emails to EMAIL_FILE_DIR (dev, preview, web e2e).
 *   smtp      Spacemail via nodemailer (T040). Needs SMTP_HOST, SMTP_USER
 *             and SMTP_PASS; SMTP_PORT defaults to 465 (implicit TLS).
 *   resend    HTTPS API fallback — NOT built: SMTP is reachable from Fly
 *             (research R6), so selecting it refuses to start.
 *
 * `createTransport()` throws on a bad configuration. Nothing else does:
 * `resolveEmailTransport()` builds the transport ONCE (the outbox worker
 * calls it at boot), and a configuration error is logged and remembered
 * instead of thrown. A broken mail setup therefore never stops the API from
 * booting, and `isEmailConfigured()` — the one definition of "email is
 * usable", behind every invite route, self-serve and signup-status — reads
 * false, so no invite is ever queued that could not be sent.
 */

import {
  emailLogger,
  EMAIL_FILE_DIR,
  EMAIL_TRANSPORT,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_USER,
} from "@liratek/core";
import type { EmailTransport } from "./EmailTransport.js";
import { createDisabledTransport } from "./transports/disabled.js";
import { createFileTransport } from "./transports/file.js";
import { createSmtpTransport } from "./transports/smtp.js";

export type EmailTransportKind = "disabled" | "file" | "smtp" | "resend";

/** Implicit TLS — the port Spacemail recommends and Fly allows (R6). */
export const DEFAULT_SMTP_PORT = 465;

/** The raw SMTP_* values; any may be absent. */
export interface SmtpEnv {
  host: string | undefined;
  port: number | undefined;
  user: string | undefined;
  pass: string | undefined;
}

const SMTP_ENV: SmtpEnv = {
  host: SMTP_HOST,
  port: SMTP_PORT,
  user: SMTP_USER,
  pass: SMTP_PASS,
};

/** The outcome of resolving the configured transport. */
export type EmailTransportState =
  | { status: "off" }
  | { status: "ready"; transport: EmailTransport }
  | { status: "invalid"; error: string };

let state: EmailTransportState | null = null;

/**
 * Builds the configured transport and remembers the outcome. Never throws:
 * a configuration error (it names the missing variable, never a value) is
 * logged and leaves email OFF until the config is fixed and the API
 * restarted.
 */
export function resolveEmailTransport(
  kind: EmailTransportKind = EMAIL_TRANSPORT,
  fileDir: string | undefined = EMAIL_FILE_DIR,
  smtp: SmtpEnv = SMTP_ENV,
): EmailTransportState {
  if (kind === "disabled") {
    state = { status: "off" };
    return state;
  }
  try {
    state = { status: "ready", transport: createTransport(kind, fileDir, smtp) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emailLogger.error(
      { transport: kind, error: message },
      "email configuration is invalid; email is OFF until it is fixed",
    );
    state = { status: "invalid", error: message };
  }
  return state;
}

/** The usable transport, or null when email is off or misconfigured. */
export function getEmailTransport(): EmailTransport | null {
  const current = state ?? resolveEmailTransport();
  return current.status === "ready" ? current.transport : null;
}

/** True only when email can actually be sent: a transport is configured AND
 * it was built without error. Cheap after the first call; never throws. */
export function isEmailConfigured(): boolean {
  return getEmailTransport() !== null;
}

/**
 * Switches email OFF after the transport was built, e.g. when the startup
 * login check is refused. Same `invalid` state a bad configuration produces,
 * so `isEmailConfigured()` stays the one switch every route reads. `reason`
 * must not contain a secret.
 */
export function markEmailTransportInvalid(reason: string): void {
  state = { status: "invalid", error: reason };
}

/** Tests only: forget the resolved transport. */
export function resetEmailTransportState(): void {
  state = null;
}

export function createTransport(
  kind: EmailTransportKind = EMAIL_TRANSPORT,
  fileDir: string | undefined = EMAIL_FILE_DIR,
  smtp: SmtpEnv = SMTP_ENV,
): EmailTransport {
  switch (kind) {
    case "disabled":
      return createDisabledTransport();
    case "file":
      if (!fileDir) {
        throw new Error(
          "EMAIL_TRANSPORT=file needs EMAIL_FILE_DIR (the directory emails are written to)",
        );
      }
      return createFileTransport(fileDir);
    case "smtp": {
      const missing = (
        [
          ["SMTP_HOST", smtp.host],
          ["SMTP_USER", smtp.user],
          ["SMTP_PASS", smtp.pass],
        ] as const
      )
        .filter(([, value]) => !value)
        .map(([key]) => key);
      if (!smtp.host || !smtp.user || !smtp.pass) {
        throw new Error(
          `EMAIL_TRANSPORT=smtp needs ${missing.join(", ")} ` +
            "(set them with `yarn api secrets set …`)",
        );
      }
      return createSmtpTransport({
        host: smtp.host,
        port: smtp.port ?? DEFAULT_SMTP_PORT,
        user: smtp.user,
        pass: smtp.pass,
      });
    }
    case "resend":
      throw new Error(
        "EMAIL_TRANSPORT=resend is not available in this build: the Resend " +
          "fallback was not needed (SMTP works from Fly). Use EMAIL_TRANSPORT=smtp.",
      );
  }
}
