/**
 * Remember the shop this page belongs to (LIRA-287), after a successful
 * sign-in on a shop's own address — so www can offer "Continue to <shop>".
 *
 * Asks the backend which host this is (the same `signup-status` answer the
 * sign-in page reads) instead of trusting page state: after a Google
 * hand-off the page reloads as soon as the exchange succeeds, possibly
 * before the page's own copy of that answer arrived. Only on a real shop
 * address (`resolveHostMode` kind "shop"): never on desktop, localhost,
 * previews or www. Never throws — remembering is a convenience and must
 * never block a sign-in.
 */

import { isElectron, publicAuthInfo } from "@/api/backendApi";
import logger from "@/utils/logger";
import { resolveHostMode } from "./hostMode";
import {
  currentHostname,
  readCookies,
  writeCookie,
} from "./browserNavigation";
import {
  parseRememberedShops,
  rememberShop,
  rememberedShopsCookie,
} from "./rememberedShops";

export async function rememberCurrentShop(
  now: string = new Date().toISOString(),
): Promise<void> {
  try {
    if (isElectron()) return;
    const res = await publicAuthInfo();
    const data = res.success ? res.data : undefined;
    const hostname = currentHostname();
    const mode = resolveHostMode(data, hostname);
    if (mode.kind !== "shop" || !data?.shopName) return;
    const slug = hostname.trim().toLowerCase().split(".")[0] ?? "";
    const list = rememberShop(
      parseRememberedShops(readCookies()),
      { slug, name: data.shopName },
      now,
    );
    if (!list.some((s) => s.slug === slug)) return;
    writeCookie(rememberedShopsCookie(list, mode.baseDomain));
  } catch (error) {
    logger.warn("Could not remember this shop for www", { error });
  }
}
