/**
 * `email-change-notice` (LIRA-293) — sent to a user's OLD confirmed address
 * when they ask to change their email from My account. The new address is
 * MASKED (`n***@gmail.com`), and the mail has no link: the change itself is
 * confirmed from the new inbox. Variables:
 *
 *   username        the account
 *   shopName        the shop it belongs to
 *   newEmailMasked  the new address, masked
 *   supportEmail    where to write for help
 */

import type { EmailTemplate } from "../renderTemplate.js";
import { renderLayout, renderTextLayout } from "./layout.js";

export const EMAIL_CHANGE_NOTICE_SUBJECT =
  "Your LiraTek email is being changed";

const bodyHtml = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Your email is being changed</h1>
<p style="margin:0 0 12px;">Someone signed in as <strong>{{username}}</strong> at <strong>{{shopName}}</strong> asked to change this account's email to <strong>{{newEmailMasked}}</strong>. It changes once the link sent to that address is opened.</p>
<p style="margin:0;font-size:14px;">If this wasn't you, change your password and contact your shop admin. Questions? Write to <a href="mailto:{{supportEmail}}" style="color:#0057FF;">{{supportEmail}}</a>.</p>`;

const bodyText = `Your email is being changed

Someone signed in as {{username}} at {{shopName}} asked to change this account's email to {{newEmailMasked}}. It changes once the link sent to that address is opened.

If this wasn't you, change your password and contact your shop admin. Questions? Write to {{supportEmail}}.`;

export const emailChangeNoticeTemplate: EmailTemplate = {
  name: "email-change-notice",
  // No link: nothing to scrub.
  secretKeys: [],
  subject: EMAIL_CHANGE_NOTICE_SUBJECT,
  html: renderLayout({
    preheader: "Your LiraTek email is being changed.",
    bodyHtml,
  }),
  text: renderTextLayout(bodyText),
};
