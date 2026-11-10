/**
 * `shop-restored` (LIRA-377, FR-018) — sent after every web shop restore to
 * the shop's platform contact email, and to the admin who restored it when
 * that is a different confirmed address. No link: it only reports what
 * happened. Every time is in the SHOP's time (the browser offset stored with
 * the restore, rule 27). Variables:
 *
 *   shopName         the shop (platform name)
 *   restoredToText   the moment the shop now reflects, "YYYY-MM-DD HH:MM"
 *   restoredAtText   when the restore was done, "YYYY-MM-DD HH:MM"
 *   byName           the admin who did it
 *   kindText         "an earlier time" | "a backup file" | "the copy taken before an earlier restore"
 *   supportEmail     where to write for help
 */

import type { EmailTemplate } from "../renderTemplate.js";
import { renderLayout, renderTextLayout } from "./layout.js";

export const SHOP_RESTORED_SUBJECT = "Your LiraTek shop was restored";

const bodyHtml = `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Your shop was restored</h1>
<p style="margin:0 0 12px;"><strong>{{shopName}}</strong> was restored from {{kindText}} on <strong>{{restoredAtText}}</strong> by <strong>{{byName}}</strong>. The shop's data is now as it was at <strong>{{restoredToText}}</strong>; anything recorded after that moment is no longer in the shop.</p>
<p style="margin:0 0 12px;">Everyone was signed out and signs in again with their own password. A copy of the shop as it was just before the restore is kept for 7 days and can be restored from Settings › Backup.</p>
<p style="margin:0;font-size:14px;">If you did not expect this, contact your shop admin. Questions? Write to <a href="mailto:{{supportEmail}}" style="color:#0057FF;">{{supportEmail}}</a>.</p>`;

const bodyText = `Your shop was restored

{{shopName}} was restored from {{kindText}} on {{restoredAtText}} by {{byName}}. The shop's data is now as it was at {{restoredToText}}; anything recorded after that moment is no longer in the shop.

Everyone was signed out and signs in again with their own password. A copy of the shop as it was just before the restore is kept for 7 days and can be restored from Settings › Backup.

If you did not expect this, contact your shop admin. Questions? Write to {{supportEmail}}.`;

export const shopRestoredTemplate: EmailTemplate = {
  name: "shop-restored",
  // No link: nothing to scrub.
  secretKeys: [],
  subject: SHOP_RESTORED_SUBJECT,
  html: renderLayout({
    preheader: "Your LiraTek shop was restored to an earlier state.",
    bodyHtml,
  }),
  text: renderTextLayout(bodyText),
};
