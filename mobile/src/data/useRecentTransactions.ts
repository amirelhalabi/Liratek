import {
  DEFAULT_HIDDEN_TRANSACTION_TYPES,
  isHiddenByDefault,
} from "@liratek/core/utils/transactionVisibility";
import { useQuery } from "@tanstack/react-query";

import { getRecentTransactions } from "@/api/reads";
import { queryKeys } from "@/data/queryKeys";
import { useShopSlug } from "@/data/useShop";
import { unwrap } from "@/data/unwrap";

const LIMIT = 50;
/**
 * Rows fetched per shown row. System-written rows (auto supplier entries,
 * auto expenses) are hidden after the fetch, as on the web Transactions page,
 * so ask for more than we show or a burst of them would leave the list short.
 */
const OVERFETCH = 3;

/**
 * The Activity list: the same rows the web Transactions page shows with no
 * filter (core's `isHiddenByDefault`). The details sheet reads the same cache
 * entry, so opening it costs no request. `search` is the server's search
 * (summary, client name, cashier), over all history, not just the latest rows.
 */
export function useRecentTransactions(search = "") {
  const slug = useShopSlug();
  const term = search.trim();
  return useQuery({
    // The search term is part of the key, so the details sheet (given the
    // same term) reads the exact cache entry the tapped row came from.
    queryKey: [...queryKeys.recent(slug, LIMIT), term],
    queryFn: async () => {
      const rows = unwrap(
        await getRecentTransactions(
          LIMIT * OVERFETCH,
          DEFAULT_HIDDEN_TRANSACTION_TYPES,
          term,
        ),
      );
      return rows.filter((r) => !isHiddenByDefault(r)).slice(0, LIMIT);
    },
    enabled: !!slug,
    // Keep the current rows on screen while a new search loads.
    placeholderData: (previous) => previous,
  });
}
