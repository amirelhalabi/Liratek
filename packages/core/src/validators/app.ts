/**
 * LIRA-333 (contracts/open-external.md) — the ONE allow-list for links that
 * LiraTek may open outside itself: the desktop `app:open-external` channel
 * (Electron `shell.openExternal`) and the web arm of `openExternalUrl`
 * (`window.open`) both validate with this schema.
 *
 * Only `https:` links whose host is exactly one of WhatsApp's click-to-chat
 * hosts pass. `shell.openExternal` on an arbitrary URL (file:, javascript:,
 * a look-alike host) is the risk this closes. Imports only `zod`, so it is
 * safe for `browser.ts` (rule 29).
 */
import { z } from "zod";

export const WHATSAPP_HOSTS = ["wa.me", "api.whatsapp.com"] as const;

export const OPEN_EXTERNAL_URL_NOT_ALLOWED = "URL not allowed";

/** True only for `https://wa.me/…` or `https://api.whatsapp.com/…`. */
export function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    (WHATSAPP_HOSTS as readonly string[]).includes(parsed.hostname) &&
    parsed.username === "" &&
    parsed.password === ""
  );
}

export const openExternalUrlSchema = z.object({
  url: z
    .string()
    .max(16_000)
    .refine(isAllowedExternalUrl, OPEN_EXTERNAL_URL_NOT_ALLOWED),
});

export type OpenExternalUrlInput = z.input<typeof openExternalUrlSchema>;
