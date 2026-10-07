/**
 * `verify-email` — confirm a user's account email (LIRA-279, feature B).
 * Variables (contract B):
 *
 *   verifyUrl       the /#/verify-email link; escaped, so safe in href="…"
 *   username        the account the address belongs to
 *   shopName        the shop the account belongs to
 *   expiresAtText   already formatted in UTC with an explicit "UTC"
 *   supportEmail    where to write for help
 */

import type { EmailTemplate } from "../renderTemplate.js";
import { emailButton, renderLayout, renderTextLayout } from "./layout.js";

const bodyHtml = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Confirm your email</h1>
<p style="margin:0 0 12px;">This address was added to the LiraTek account <strong>{{username}}</strong> at <strong>{{shopName}}</strong>.</p>
<p style="margin:0;">Click the button to confirm it is yours.</p>
${emailButton("{{verifyUrl}}", "Confirm my email")}
<p style="margin:0 0 12px;font-size:14px;">If the button doesn't work, copy this link into your browser:<br>
<a href="{{verifyUrl}}" target="_blank" style="color:#0057FF;word-break:break-all;">{{verifyUrl}}</a></p>
<p style="margin:0 0 12px;font-size:14px;">This link works once and expires on {{expiresAtText}}.</p>
<p style="margin:0;font-size:14px;">Didn't expect this email? You can ignore it. Questions? Write to <a href="mailto:{{supportEmail}}" style="color:#0057FF;">{{supportEmail}}</a>.</p>`;

const bodyText = `Confirm your email

This address was added to the LiraTek account {{username}} at {{shopName}}.

Open this link to confirm it is yours:
{{verifyUrl}}

This link works once and expires on {{expiresAtText}}.

Didn't expect this email? You can ignore it. Questions? Write to {{supportEmail}}.`;

export const verifyEmailTemplate: EmailTemplate = {
  name: "verify-email",
  subject: "Confirm your email for LiraTek",
  html: renderLayout({
    preheader: "Confirm the email address on your LiraTek account.",
    bodyHtml,
  }),
  text: renderTextLayout(bodyText),
};
