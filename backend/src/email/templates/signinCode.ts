/**
 * `signin-code` — the 6-digit code a www sign-in mails (LIRA-287).
 * Variables:
 *
 *   code            the code; the SECRET (scrubbed from the outbox once final)
 *   expiresAtText   already formatted in UTC with an explicit "UTC"
 *   supportEmail    where to write for help
 *
 * Nothing the visitor typed is echoed (only the address it is sent to), so
 * the form cannot be used to deliver someone else's text from our domain.
 * The code stays out of the subject: subjects show on lock screens.
 */

import { SIGNIN_CODE_SECRET_KEY } from "@liratek/core";
import type { EmailTemplate } from "../renderTemplate.js";
import { renderLayout, renderTextLayout } from "./layout.js";

export const SIGNIN_CODE_SUBJECT = "Your LiraTek sign-in code";

const bodyHtml = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Your sign-in code</h1>
<p style="margin:0 0 12px;">Enter this code on the LiraTek sign-in page to see your shops:</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:bold;letter-spacing:6px;font-family:Menlo,Consolas,monospace;">{{${SIGNIN_CODE_SECRET_KEY}}}</p>
<p style="margin:0 0 12px;font-size:14px;">The code works once and expires on {{expiresAtText}}. You will still type your password in your shop.</p>
<p style="margin:0;font-size:14px;">Didn't ask for this? You can ignore this email; nobody can sign in with the code alone. Questions? Write to <a href="mailto:{{supportEmail}}" style="color:#0057FF;">{{supportEmail}}</a>.</p>`;

const bodyText = `Your sign-in code

Enter this code on the LiraTek sign-in page to see your shops:

{{${SIGNIN_CODE_SECRET_KEY}}}

The code works once and expires on {{expiresAtText}}. You will still type your password in your shop.

Didn't ask for this? You can ignore this email; nobody can sign in with the code alone. Questions? Write to {{supportEmail}}.`;

export const signinCodeTemplate: EmailTemplate = {
  name: "signin-code",
  // The code is a secret: scrubbed from the outbox once final.
  secretKeys: [SIGNIN_CODE_SECRET_KEY],
  subject: SIGNIN_CODE_SUBJECT,
  html: renderLayout({
    preheader: "Your LiraTek sign-in code.",
    bodyHtml,
  }),
  text: renderTextLayout(bodyText),
};
