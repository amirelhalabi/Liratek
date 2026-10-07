/**
 * `password-reset` — the email carrying a single-use "choose a new password"
 * link (LIRA-275/276, contract C). Variables:
 *
 *   resetUrl        the link; escaped, so safe inside href="…"
 *   username        the account the link resets
 *   shopName        the shop it belongs to (safe: only that shop's verified
 *                   address, or its own admin, can trigger this email)
 *   expiresAtText   already formatted in UTC with an explicit "UTC"
 *   supportEmail    where to write for help
 */

import type { EmailTemplate } from "../renderTemplate.js";
import { emailButton, renderLayout, renderTextLayout } from "./layout.js";

export const PASSWORD_RESET_SUBJECT = "Reset your LiraTek password";

const bodyHtml = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Reset your password</h1>
<p style="margin:0 0 12px;">Someone asked to reset the password of <strong>{{username}}</strong> at <strong>{{shopName}}</strong>.</p>
<p style="margin:0;">Click the button to choose a new password. Everyone signed in to this account will be signed out.</p>
${emailButton("{{resetUrl}}", "Choose a new password")}
<p style="margin:0 0 12px;font-size:14px;">If the button doesn't work, copy this link into your browser:<br>
<a href="{{resetUrl}}" target="_blank" style="color:#0057FF;word-break:break-all;">{{resetUrl}}</a></p>
<p style="margin:0 0 12px;font-size:14px;">This link works once and expires on {{expiresAtText}}.</p>
<p style="margin:0;font-size:14px;">Didn't ask for this? You can ignore this email; your password stays the same. Questions? Write to <a href="mailto:{{supportEmail}}" style="color:#0057FF;">{{supportEmail}}</a>.</p>`;

const bodyText = `Reset your password

Someone asked to reset the password of {{username}} at {{shopName}}.

Open this link to choose a new password. Everyone signed in to this account will be signed out.
{{resetUrl}}

This link works once and expires on {{expiresAtText}}.

Didn't ask for this? You can ignore this email; your password stays the same. Questions? Write to {{supportEmail}}.`;

export const passwordResetTemplate: EmailTemplate = {
  name: "password-reset",
  subject: PASSWORD_RESET_SUBJECT,
  html: renderLayout({
    preheader: "Your link to choose a new LiraTek password.",
    bodyHtml,
  }),
  text: renderTextLayout(bodyText),
};
