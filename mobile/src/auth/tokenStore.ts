import * as SecureStore from "expo-secure-store";

// The phone keeps its own token, separate from any web session: signing in
// on the phone never touches the owner's browser sessions (spec, Sessions).
const TOKEN_KEY = "liratek.token";
const SHOP_KEY = "liratek.shop";

export interface StoredShop {
  slug: string;
  name: string;
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/** Remembered after a password sign-in so the shop field is pre-filled. */
export async function getShop(): Promise<StoredShop | null> {
  const raw = await SecureStore.getItemAsync(SHOP_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as StoredShop).slug === "string" &&
      typeof (parsed as StoredShop).name === "string"
    ) {
      return parsed as StoredShop;
    }
  } catch {
    // A corrupt entry is treated as "no shop remembered".
  }
  return null;
}

export async function setShop(shop: StoredShop): Promise<void> {
  await SecureStore.setItemAsync(SHOP_KEY, JSON.stringify(shop));
}
