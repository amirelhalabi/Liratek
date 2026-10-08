/**
 * LIRA-294 — the Google profile photo, accepted ONLY from Google's own image
 * host. The `picture` claim of a Google ID token is a URL we later put in an
 * <img src>, so anything else (another host, plain http, `javascript:`,
 * `data:`, credentials in the URL, an absurd length) is dropped to null
 * rather than stored. The CSP's img-src allows exactly this host too
 * (frontend/index.html), so the two rules agree.
 *
 * Pure, no imports: safe for `browser.ts` (rule 29).
 */

/** Longest URL we keep; Google's photo URLs are far shorter. */
export const GOOGLE_PICTURE_MAX_LENGTH = 2048;

/** The one image host accepted: `https://<anything>.googleusercontent.com`. */
export const GOOGLE_PICTURE_HOST_SUFFIX = ".googleusercontent.com";

/** `raw` when it is an https URL on *.googleusercontent.com, else null. */
export function safeGooglePictureUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > GOOGLE_PICTURE_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(GOOGLE_PICTURE_HOST_SUFFIX)) return null;
  // A label before the suffix is required ("x.googleusercontent.com").
  if (host.length <= GOOGLE_PICTURE_HOST_SUFFIX.length) return null;
  return url.toString();
}
