/**
 * Which logged-out page a web host gets (owner UX change 2026-10-07).
 *
 *   platform  www.<base>: the front door, "Sign in to LiraTek" (LIRA-287):
 *             remembered shops, Google, and email -> code -> "Your shops";
 *             creating a shop lives here. Super admins sign in at the
 *             unlinked #/platform route.
 *   shop      <slug>.<base>: that shop's own login. Nothing about creating
 *             a shop.
 *   combined  everything else — desktop, localhost, preview deployments, an
 *             unknown shop address, a backend that did not answer: the page
 *             as it was before, so nothing that works today changes.
 *
 * The BACKEND decides (`GET /api/auth/signup-status`: `platformHost` +
 * `baseDomain` on the platform host, `shopName` on a real shop's address).
 * The hostname is consulted only to recover the base domain on a shop
 * address, after the backend has confirmed it IS one — the backend only
 * resolves a single label under the base, so dropping the first label is
 * exact. Classifying from the hostname alone would read a preview such as
 * `liratek.vercel.app` as shop "liratek".
 */

export type HostMode =
  | { kind: "combined" }
  | { kind: "platform"; baseDomain: string }
  | { kind: "shop"; baseDomain: string };

/** The fields of the signup-status answer this decision reads. */
export interface HostInfo {
  platformHost?: boolean;
  baseDomain?: string | null;
  shopName?: string | null;
}

const COMBINED: HostMode = { kind: "combined" };
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function resolveHostMode(
  info: HostInfo | null | undefined,
  hostname: string,
): HostMode {
  if (!info) return COMBINED;
  if (info.platformHost && info.baseDomain) {
    return { kind: "platform", baseDomain: info.baseDomain };
  }
  if (info.shopName) {
    const host = hostname.trim().toLowerCase();
    const labels = host.split(".");
    // `<slug>.<name>.<tld>` at least; localhost / an IP can carry a shop name
    // only through the dev override, and there is no base to send anyone to.
    if (labels.length < 3 || IPV4.test(host)) return COMBINED;
    return { kind: "shop", baseDomain: labels.slice(1).join(".") };
  }
  return COMBINED;
}

/** Mirror of the server's slug rule (Signup.tsx keeps the same copy for the
 * same reason: save a round trip; the server remains the authority). */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Labels under the base domain that are the platform, never a shop
 * (backend `tenantHost.ts` PLATFORM_LABELS). */
const PLATFORM_LABELS = new Set(["www", "admin"]);

/** `https://CellCity.liratek.shop/` or `cellcity` -> `cellcity`. Strips only
 * what people paste around a slug; does not validate it. */
export function shopSlugFromAddress(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split(/[./#?]/)[0] ?? ""
  );
}

/** A shop address as typed -> the shop's slug, or null when it cannot name
 * a shop (empty, malformed, or one of the platform's own labels). */
export function normalizeShopAddress(value: string): string | null {
  const slug = shopSlugFromAddress(value);
  if (!SLUG_PATTERN.test(slug) || PLATFORM_LABELS.has(slug)) return null;
  return slug;
}

/** A shop's own sign-in page; with `username`, that field arrives filled in
 * (`?u=`, LIRA-287: picked from www's "Your shops" list). */
export function shopLoginUrl(
  slug: string,
  baseDomain: string,
  username?: string,
): string {
  const base = `https://${slug}.${baseDomain}/#/login`;
  return username ? `${base}?u=${encodeURIComponent(username)}` : base;
}

/** The platform front door's sign-up page. */
export function platformSignupUrl(baseDomain: string): string {
  return `https://www.${baseDomain}/#/signup`;
}
