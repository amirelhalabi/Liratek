import { useAuth } from "@/auth/AuthContext";

/** The signed-in shop's slug: the first part of every cache key. Empty while signed out (queries stay disabled). */
export function useShopSlug(): string {
  return useAuth().shop?.slug ?? "";
}
