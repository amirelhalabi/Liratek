/**
 * `password-set` (LIRA-291) — the reset link, worded for a user who has NO
 * password (joined with Google): "Set a password for <username>". Sent by
 * "Forgot password", the admin's "Send password reset", and automatically
 * after an admin disconnects Google from such a user. Same token, page,
 * expiry and data as `password-reset` (PasswordResetService picks the
 * template from `users.has_password`). Variables:
 *
 *   resetUrl        the link; escaped, so safe inside href="…"
 *   username        the account a password is being set for
 *   shopName        the shop it belongs to
 *   expiresAtText   already formatted in UTC with an explicit "UTC"
 *   supportEmail    where to write for help
 */

import { PASSWORD_RESET_URL_KEY } from "@liratek/core";
import type { EmailTemplate } from "../renderTemplate.js";
import { emailButton, renderLayout, renderTextLayout } from "./layout.js";

export const PASSWORD_SET_SUBJECT = "Set a password for your LiraTek account";

const bodyHtml = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Set a password for {{username}}</h1>
<p style="margin:0 0 12px;">Set a password for <strong>{{username}}</strong> at <strong>{{shopName}}</strong>, so you can sign in with your username and password.</p>
<p style="margin:0;">Click the button to choose your password. If Google is still connected to your account, it stays connected.</p>
${emailButton("{{resetUrl}}", "Set my password")}
<p style="margin:0 0 12px;font-size:14px;">If the button doesn't work, copy this link into your browser:<br>
<a href="{{resetUrl}}" target="_blank" style="color:#0057FF;word-break:break-all;">{{resetUrl}}</a></p>
<p style="margin:0 0 12px;font-size:14px;">This link works once and expires on {{expiresAtText}}.</p>
<p style="margin:0;font-size:14px;">Didn't ask for this? You can ignore this email; nothing changes. Questions? Write to <a href="mailto:{{supportEmail}}" style="color:#0057FF;">{{supportEmail}}</a>.</p>`;

const bodyText = `Set a password for {{username}}

Set a password for {{username}} at {{shopName}}, so you can sign in with your username and password.

Open this link to choose your password. If Google is still connected to your account, it stays connected.
{{resetUrl}}

This link works once and expires on {{expiresAtText}}.

Didn't ask for this? You can ignore this email; nothing changes. Questions? Write to {{supportEmail}}.`;

export const passwordSetTemplate: EmailTemplate = {
  name: "password-set",
  // The link is a bearer secret: scrubbed from the outbox once final.
  secretKeys: [PASSWORD_RESET_URL_KEY],
  subject: PASSWORD_SET_SUBJECT,
  html: renderLayout({
    preheader: "Your link to set a LiraTek password.",
    bodyHtml,
  }),
  text: renderTextLayout(bodyText),
};
