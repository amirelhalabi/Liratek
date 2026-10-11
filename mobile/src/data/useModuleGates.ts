import { useQuery } from "@tanstack/react-query";

import { getEnabledModules } from "@/api/modules";
import { contentAccess, gateFrom, type ContentAccess, type GateState } from "@/utils/moduleGates";

import { queryKeys } from "./queryKeys";
import { errorCodeOf, unwrap } from "./unwrap";
import { useShopSlug } from "./useShop";

/** While the check fails, retry this often; while it works, re-check this often to notice a lost connection. */
const RETRY_MS = 5_000;
const RECHECK_MS = 30_000;

/**
 * The shop's module switches (LIRA-307) and whether tab content may show.
 * Only a switch turned off on the web hides a tab; until the list is known
 * every tab shows. Tab content needs a connection: `access` is "offline" when
 * the last check could not reach the server. The list lives in memory only and
 * a failed re-check keeps the one already known. Re-checked on foreground
 * (focusManager in the root layout), every 30 s, and every 5 s while failing.
 */
export function useModuleGates(): GateState & { access: ContentAccess; refetch: () => Promise<unknown> } {
  const slug = useShopSlug();
  const query = useQuery({
    queryKey: queryKeys.modules(slug),
    queryFn: async () => unwrap(await getEnabledModules()),
    enabled: !!slug,
    staleTime: 0,
    refetchInterval: (q) => (q.state.status === "error" ? RETRY_MS : RECHECK_MS),
  });
  const access = contentAccess({
    hasList: query.data !== undefined,
    errorCode: query.error ? errorCodeOf(query.error) : null,
  });
  return { ...gateFrom(query.data), access, refetch: query.refetch };
}
