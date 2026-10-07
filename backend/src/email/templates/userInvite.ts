/**
 * `user-invite` — a shop admin invited someone into their shop (LIRA-281,
 * feature B). Variables (contract B):
 *
 *   inviteUrl       the /#/join link; escaped, so safe inside href="…".
 *                   Named `inviteUrl` so the outbox worker scrubs it.
 *   shopName        the inviting shop's name. Safe to show: only a shop
 *                   admin can send this (unlike self-serve sign-up).
 *   roleText        "an admin" / "a staff member"
 *   expiresAtText   already formatted in UTC with an explicit "UTC"
 *   supportEmail    where to write for help
 */

import { USER_INVITE_URL_KEY } from "@liratek/core";
import type { EmailTemplate } from "../renderTemplate.js";
import { emailButton, renderLayout, renderTextLayout } from "./layout.js";

const bodyHtml = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Join {{shopName}} on LiraTek</h1>
<p style="margin:0 0 12px;"><strong>{{shopName}}</strong> invited you to use LiraTek as {{roleText}}.</p>
<p style="margin:0;">Click the button to choose your username and password.</p>
${emailButton("{{inviteUrl}}", "Accept the invite")}
<p style="margin:0 0 12px;font-size:14px;">If the button doesn't work, copy this link into your browser:<br>
<a href="{{inviteUrl}}" target="_blank" style="color:#0057FF;word-break:break-all;">{{inviteUrl}}</a></p>
<p style="margin:0 0 12px;font-size:14px;">This link works once and expires on {{expiresAtText}}.</p>
<p style="margin:0;font-size:14px;">Didn't expect this email? You can ignore it. Questions? Write to <a href="mailto:{{supportEmail}}" style="color:#0057FF;">{{supportEmail}}</a>.</p>`;

const bodyText = `Join {{shopName}} on LiraTek

{{shopName}} invited you to use LiraTek as {{roleText}}.

Open this link to choose your username and password:
{{inviteUrl}}

This link works once and expires on {{expiresAtText}}.

Didn't expect this email? You can ignore it. Questions? Write to {{supportEmail}}.`;

export const userInviteTemplate: EmailTemplate = {
  name: "user-invite",
  // The link is a bearer secret: scrubbed from the outbox once final.
  secretKeys: [USER_INVITE_URL_KEY],
  // Subjects are substituted verbatim (plain text, not HTML).
  subject: "{{shopName}} invited you to LiraTek",
  html: renderLayout({
    preheader: "Your personal link to join your shop on LiraTek.",
    bodyHtml,
  }),
  text: renderTextLayout(bodyText),
};
