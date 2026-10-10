import type { MobileLoginInput, MobileSignupLinkInput } from "@liratek/core/validators/mobileAuth";

import { request, SHOP_HOST_MODE, shopHostUrl, type ApiResult } from "./client";

export interface SignedInUser {
  id: number;
  username: string;
  role: "admin" | "staff";
}

export interface SignedInShop {
  slug: string;
  name: string;
  status?: string;
}

export interface MobileSession {
  token: string;
  user: SignedInUser;
  shop: SignedInShop;
}

/** POST /api/mobile/auth/login — the shop is found by address, then the user inside it only. */
export async function loginWithShop(input: MobileLoginInput): Promise<ApiResult<MobileSession>> {
  if (SHOP_HOST_MODE) return loginThroughShopHost(input);
  return request<MobileSession>("POST", "/api/mobile/auth/login", { body: input, auth: false });
}

interface WebLoginData {
  token: string;
  user: SignedInUser;
}

/**
 * DEVELOPMENT ONLY: the web login on https://<shop>.liratek.shop. It has no
 * admin-only rule, so the phone enforces it here and ends a staff session.
 */
async function loginThroughShopHost(input: MobileLoginInput): Promise<ApiResult<MobileSession>> {
  const slug = input.shop.trim().toLowerCase();
  const result = await request<WebLoginData>("POST", "/api/auth/login", {
    body: { username: input.username, password: input.password, rememberMe: true },
    auth: false,
    baseUrl: shopHostUrl(slug),
  });
  if (!result.success) return result;
  if (result.data.user.role !== "admin") {
    return { success: false, error: "ADMIN_ONLY" };
  }
  return { success: true, data: { token: result.data.token, user: result.data.user, shop: { slug, name: slug } } };
}

/** The web's own "Create your shop" request (POST /api/auth/signup/request); the link opens on the web. */
export function requestSignupLink(input: MobileSignupLinkInput): Promise<ApiResult<unknown>> {
  return request<unknown>("POST", "/api/auth/signup/request", { body: input, auth: false });
}

/** Ends only this phone's session (the web sessions are untouched). */
export function logout(): Promise<ApiResult<unknown>> {
  return request<unknown>("POST", "/api/auth/logout");
}
