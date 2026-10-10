import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

interface Refreshable {
  isStale: boolean;
  refetch: () => unknown;
}

/**
 * A tab screen stays mounted after its first visit, so switching back to it
 * fires no mount and no refetch (research R5). On every focus after the first,
 * refetch the queries whose data is older than the fresh window.
 */
export function useRefreshOnFocus(queries: Refreshable[]): void {
  const ref = useRef(queries);
  useEffect(() => {
    ref.current = queries;
  });
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      for (const q of ref.current) if (q.isStale) void q.refetch();
    }, []),
  );
}
