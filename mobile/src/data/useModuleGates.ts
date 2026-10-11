import { useQuery } from "@tanstack/react-query";

import { getEnabledModules } from "@/api/modules";
import { gateFrom, type GateState } from "@/utils/moduleGates";

import { queryKeys } from "./queryKeys";
import { unwrap } from "./unwrap";
import { useShopSlug } from "./useShop";

/**
 * The shop's module switches as gates (LIRA-307). Closed until the list is
 * fetched in this run of the app (owner decision D3): the query cache lives in
 * memory only, so a cold start offline shows nothing gated. A failed refetch
 * keeps the list already verified in this run. Refetched whenever the app
 * comes back to the foreground (focusManager in the root layout).
 */
export function useModuleGates(): GateState & { refetch: () => Promise<unknown> } {
  const slug = useShopSlug();
  const query = useQuery({
    queryKey: queryKeys.modules(slug),
    queryFn: async () => unwrap(await getEnabledModules()),
    enabled: !!slug,
    staleTime: 0,
  });
  return { ...gateFrom(query.data), refetch: query.refetch };
}
