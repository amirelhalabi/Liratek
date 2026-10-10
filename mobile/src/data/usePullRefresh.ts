import { useCallback, useEffect, useRef, useState } from "react";

/** Pull-to-refresh for a page: reload all its queries, spinner while they run (FR-011). */
export function usePullRefresh(refetches: (() => Promise<unknown>)[]): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const ref = useRef(refetches);
  useEffect(() => {
    ref.current = refetches;
  });
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all(ref.current.map((r) => r())).finally(() => setRefreshing(false));
  }, []);
  return { refreshing, onRefresh };
}
