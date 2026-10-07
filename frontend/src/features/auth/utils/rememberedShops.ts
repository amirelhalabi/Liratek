/**
 * Remembered shops (LIRA-287): the "Continue to <shop>" rows on www.
 *
 * After a sign-in on a shop's own address (`<slug>.<base>`), the shop's slug
 * and display name are stored so the www sign-in page can offer to go
 * straight back. localStorage is per-origin, so `www` could never read what
 * `<slug>` wrote there; a cookie on the PARENT domain (`Domain=.<base>`) is
 * the one place both can see.
 *
 * What it holds: slug, name and when it was last used — no user data, no
 * token. Not httpOnly (www's script reads it); `Secure`, `SameSite=Lax`, one
 * year, at most MAX_REMEMBERED_SHOPS entries.
 *
 * On read the cookie is UNTRUSTED (any subdomain under the base could write
 * it): every slug must pass the shop-address rule, names are cut to
 * MAX_NAME_LENGTH and rendered as text, and links are built from the slug
 * only. Pure — the actual document.cookie access is in browserNavigation.ts.
 */

import { normalizeShopAddress } from "./hostMode";

export const REMEMBERED_SHOPS_COOKIE = "lt_shops";
export const MAX_REMEMBERED_SHOPS = 10;
const MAX_NAME_LENGTH = 80;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export interface RememberedShop {
  slug: string;
  name: string;
  /** UTC ISO, or "" when unknown. */
  lastUsedAt: string;
}

/** The cookie's compact JSON form. */
interface StoredShop {
  s: string;
  n: string;
  t: string;
}

/** A valid slug, exactly as stored (no normalising a hostile value into a
 * different, valid one), or null. */
function validSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return normalizeShopAddress(value) === value ? value : null;
}

function cleanName(value: unknown, slug: string): string | null {
  if (typeof value !== "string") return null;
  // Control characters out, whitespace folded, then cut.
  const name = Array.from(value, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : ch;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name || slug;
}

/** The remembered shops in a `document.cookie` string; [] when absent or
 * unreadable. Invalid entries are dropped, not repaired. */
export function parseRememberedShops(cookieHeader: string): RememberedShop[] {
  const pair = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REMEMBERED_SHOPS_COOKIE}=`));
  if (!pair) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      decodeURIComponent(pair.slice(REMEMBERED_SHOPS_COOKIE.length + 1)),
    );
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const shops: RememberedShop[] = [];
  for (const entry of parsed as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const stored = entry as Partial<Record<keyof StoredShop, unknown>>;
    const slug = validSlug(stored.s);
    if (!slug || shops.some((s) => s.slug === slug)) continue;
    const name = cleanName(stored.n, slug);
    if (name === null) continue;
    const lastUsedAt =
      typeof stored.t === "string" && ISO_INSTANT.test(stored.t) ? stored.t : "";
    shops.push({ slug, name, lastUsedAt });
    if (shops.length === MAX_REMEMBERED_SHOPS) break;
  }
  return shops;
}

/** `list` with this shop first (added or refreshed), capped. A slug the
 * shop-address rule refuses is never stored. */
export function rememberShop(
  list: RememberedShop[],
  shop: { slug: string; name: string },
  now: string,
): RememberedShop[] {
  const slug = validSlug(shop.slug);
  if (!slug) return list;
  const entry: RememberedShop = {
    slug,
    name: cleanName(shop.name, slug) ?? slug,
    lastUsedAt: now,
  };
  return [entry, ...list.filter((s) => s.slug !== slug)].slice(
    0,
    MAX_REMEMBERED_SHOPS,
  );
}

export function forgetShop(
  list: RememberedShop[],
  slug: string,
): RememberedShop[] {
  return list.filter((s) => s.slug !== slug);
}

/** The full `Set-Cookie`-style string for `document.cookie`. An empty list
 * deletes the cookie — with the SAME Domain and Path, or the browser would
 * keep the old one beside it. */
export function rememberedShopsCookie(
  list: RememberedShop[],
  baseDomain: string,
): string {
  const stored: StoredShop[] = list.map((s) => ({
    s: s.slug,
    n: s.name,
    t: s.lastUsedAt,
  }));
  const value = list.length ? encodeURIComponent(JSON.stringify(stored)) : "";
  const maxAge = list.length ? ONE_YEAR_SECONDS : 0;
  return [
    `${REMEMBERED_SHOPS_COOKIE}=${value}`,
    `Domain=.${baseDomain}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    "Secure",
  ].join("; ");
}
