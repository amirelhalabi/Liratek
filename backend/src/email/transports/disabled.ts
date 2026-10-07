/**
 * The transport when nothing is configured (`EMAIL_TRANSPORT=disabled`, the
 * default). Every send fails permanently: retrying cannot make an absent
 * mail account appear.
 */

import {
  PermanentEmailError,
  type EmailSendResult,
  type EmailTransport,
} from "../EmailTransport.js";

export function createDisabledTransport(): EmailTransport {
  return {
    name: "disabled",
    async send(): Promise<EmailSendResult> {
      throw new PermanentEmailError("email not configured");
    },
  };
}
