/**
 * `password-changed` (LIRA-293) — the notice sent after a signed-in user
 * changed their own password from My account. The safeguard against a
 * stolen session, so it carries no link and no secret. Variables:
 *
 *   username        the account whose password changed
 *   shopName        the shop it belongs to
 *   supportEmail    where to write for help
 */

import type { EmailTemplate } from "../renderTemplate.js";
import { renderLayout, renderTextLayout } from "./layout.js";

export const PASSWORD_CHANGED_SUBJECT = "Your LiraTek password was changed";

const bodyHtml = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Your password was changed</h1>
<p style="margin:0 0 12px;">The password for <strong>{{username}}</strong> at <strong>{{shopName}}</strong> was just changed. Other devices signed in to this account were signed out.</p>
<p style="margin:0;font-size:14px;">If this wasn't you, contact your shop admin right away. Questions? Write to <a href="mailto:{{supportEmail}}" style="color:#0057FF;">{{supportEmail}}</a>.</p>`;

const bodyText = `Your password was changed

The password for {{username}} at {{shopName}} was just changed. Other devices signed in to this account were signed out.

If this wasn't you, contact your shop admin right away. Questions? Write to {{supportEmail}}.`;

export const passwordChangedTemplate: EmailTemplate = {
  name: "password-changed",
  // No link: nothing to scrub.
  secretKeys: [],
  subject: PASSWORD_CHANGED_SUBJECT,
  html: renderLayout({
    preheader: "The password for your LiraTek account was changed.",
    bodyHtml,
  }),
  text: renderTextLayout(bodyText),
};
