/**
 * Names of the phone's cached reads (LIRA-300 data-model). Every key starts
 * with the signed-in shop's slug, so one shop's numbers can never be served
 * to another shop's sign-in, even if a cache clear were missed.
 */
export const queryKeys = {
  balances: (shop: string) => [shop, "balances"] as const,
  sinceLastCountAll: (shop: string) => [shop, "sinceLastCount"] as const,
  sinceLastCount: (shop: string, drawers: readonly string[]) => [shop, "sinceLastCount", drawers.join(",")] as const,
  recentAll: (shop: string) => [shop, "recent"] as const,
  recent: (shop: string, limit: number) => [shop, "recent", limit] as const,
  debtors: (shop: string) => [shop, "debtors"] as const,
  clientBalance: (shop: string, clientId: number) => [shop, "clientBalance", clientId] as const,
};
