import { QueryClient } from "@tanstack/react-query";

import { NO_CONNECTION, UNAUTHORIZED } from "@/api/client";

import { errorCodeOf } from "./unwrap";

// A 401 already sends the owner to sign-in, and with no connection a retry
// only delays the "could not refresh" notice (research R6).
const NOT_RETRIED = new Set([UNAUTHORIZED, NO_CONNECTION]);

/**
 * The phone's one cache (LIRA-300). Data counts as fresh for 30 s; stale data
 * is refetched when its screen is shown again (useRefreshOnFocus) or when the
 * app comes back to the foreground (focusManager wired in the root layout —
 * so refetchOnWindowFocus stays at its default, true).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 600_000,
      retry: (failureCount, error) => failureCount < 1 && !NOT_RETRIED.has(errorCodeOf(error)),
    },
  },
});

/** Sign-out and 401: stop reads in flight first, or one could write the old shop's data back after the clear. */
export async function resetCache(): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.clear();
}
