/**
 * `signup-invite` — the email carrying a single-use sign-up link (LIRA-267,
 * T023). Variables (contracts/api.md "Email template contract"):
 *
 *   inviteUrl       the link; escaped, so safe inside href="…"
 *   shopNameHint    optional; its block is hidden when empty. ADMIN invites
 *                   only: the service sends "" for a self-serve request, so
 *                   a visitor-typed name is never echoed (LIRA-278)
 *   expiresAtText   already formatted in UTC with an explicit "UTC"
 *   supportEmail    where to write for help
 */

import type { EmailTemplate } from "../renderTemplate.js";
import { emailButton, renderLayout, renderTextLayout } from "./layout.js";

export const SIGNUP_INVITE_SUBJECT =
  "You're invited to open your shop on LiraTek";

const bodyHtml = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Open your shop on LiraTek</h1>
<p style="margin:0 0 12px;">You've been invited to create your shop on LiraTek.</p>
{{#if shopNameHint}}<p style="margin:0 0 12px;">Suggested shop name: <strong>{{shopNameHint}}</strong>. You can change it on the form.</p>{{/if}}
<p style="margin:0;">Click the button to set up your shop and its admin account.</p>
${emailButton("{{inviteUrl}}", "Create my shop")}
<p style="margin:0 0 12px;font-size:14px;">If the button doesn't work, copy this link into your browser:<br>
<a href="{{inviteUrl}}" target="_blank" style="color:#0057FF;word-break:break-all;">{{inviteUrl}}</a></p>
<p style="margin:0 0 12px;font-size:14px;">This link works once and expires on {{expiresAtText}}.</p>
<p style="margin:0;font-size:14px;">Didn't expect this email? You can ignore it. Questions? Write to <a href="mailto:{{supportEmail}}" style="color:#0057FF;">{{supportEmail}}</a>.</p>`;

const bodyText = `Open your shop on LiraTek

You've been invited to create your shop on LiraTek.
{{#if shopNameHint}}
Suggested shop name: {{shopNameHint}}. You can change it on the form.
{{/if}}
Open this link to set up your shop and its admin account:
{{inviteUrl}}

This link works once and expires on {{expiresAtText}}.

Didn't expect this email? You can ignore it. Questions? Write to {{supportEmail}}.`;

export const signupInviteTemplate: EmailTemplate = {
  name: "signup-invite",
  subject: SIGNUP_INVITE_SUBJECT,
  html: renderLayout({
    preheader: "Your personal link to set up your shop on LiraTek.",
    bodyHtml,
  }),
  text: renderTextLayout(bodyText),
};
