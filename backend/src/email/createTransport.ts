/**
 * Picks the email transport from `EMAIL_TRANSPORT` (LIRA-267, T017).
 *
 *   disabled  (default) nothing is sent; invites are refused up front with
 *             EMAIL_NOT_CONFIGURED, so this transport is a backstop only.
 *   file      writes emails to EMAIL_FILE_DIR (dev, preview, web e2e).
 *   smtp      Spacemail via nodemailer — lands with T040.
 *   resend    HTTPS API fallback — lands with T040 if SMTP is blocked.
 *
 * `isEmailConfigured()` is cheap and never throws, so routes may call it on
 * every request. `createTransport()` is the one that throws on a bad
 * configuration; the outbox worker calls it at boot, so a mistake surfaces
 * in the deploy, not on the first invite.
 */

import { EMAIL_FILE_DIR, EMAIL_TRANSPORT } from "@liratek/core";
import type { EmailTransport } from "./EmailTransport.js";
import { createDisabledTransport } from "./transports/disabled.js";
import { createFileTransport } from "./transports/file.js";

export type EmailTransportKind = "disabled" | "file" | "smtp" | "resend";

/** True when the server is set up to send email at all. */
export function isEmailConfigured(
  kind: EmailTransportKind = EMAIL_TRANSPORT,
): boolean {
  return kind !== "disabled";
}

export function createTransport(
  kind: EmailTransportKind = EMAIL_TRANSPORT,
  fileDir: string | undefined = EMAIL_FILE_DIR,
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
    case "smtp":
    case "resend":
      throw new Error(
        `EMAIL_TRANSPORT=${kind} is not available in this build yet. ` +
          "Use EMAIL_TRANSPORT=file or disabled until the real transport ships.",
      );
  }
}
