/**
 * `password-added` (LIRA-291) — the notice sent after a signed-in user who
 * had no password (joined with Google) added one from Settings. It is the
 * safeguard against a stolen session, so it carries no link and no secret.
 * Variables:
 *
 *   username        the account a password was added to
 *   shopName        the shop it belongs to
 *   supportEmail    where to write for help
 */

import type { EmailTemplate } from "../renderTemplate.js";
import { renderLayout, renderTextLayout } from "./layout.js";

export const PASSWORD_ADDED_SUBJECT =
  "A password was added to your LiraTek account";

const bodyHtml = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">A password was added</h1>
<p style="margin:0 0 12px;">A password was added to <strong>{{username}}</strong> at <strong>{{shopName}}</strong>. You can now sign in with your username and this password, or with Google.</p>
<p style="margin:0;font-size:14px;">If this wasn't you, contact your shop admin. Questions? Write to <a href="mailto:{{supportEmail}}" style="color:#0057FF;">{{supportEmail}}</a>.</p>`;

const bodyText = `A password was added

A password was added to {{username}} at {{shopName}}. You can now sign in with your username and this password, or with Google.

If this wasn't you, contact your shop admin. Questions? Write to {{supportEmail}}.`;

export const passwordAddedTemplate: EmailTemplate = {
  name: "password-added",
  // No link: nothing to scrub.
  secretKeys: [],
  subject: PASSWORD_ADDED_SUBJECT,
  html: renderLayout({
    preheader: "A password was added to your LiraTek account.",
    bodyHtml,
  }),
  text: renderTextLayout(bodyText),
};
