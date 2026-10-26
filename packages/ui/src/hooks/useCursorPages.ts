/**
 * useCursorPages — the data side of a "load more as you scroll" table
 * (LIRA-348). Pair it with `DataTable`'s `loadMore` prop:
 *
 *   const pages = useCursorPages(fetchPage, filtersKey);
 *   <DataTable data={pages.rows} loading={pages.loading}
 *     loadMore={{ hasMore: pages.hasMore,
 *                 isLoadingMore: pages.isLoadingMore,
 *                 onLoadMore: pages.loadMore }} … />
 *
 * `fetchPage(cursor)` returns one page and the cursor of the page after it
 * (`undefined` = nothing more). The cursor is whatever the read pages by —
 * keyset on the table's own order, never an offset, so a row written while
 * the operator scrolls cannot repeat or skip a row.
 *
 * `resetKey` is a primitive built from the filters: when it changes the
 * pages start over from the first. A response for an older key is dropped,
 * so a slow page can never land on top of a newer filter's rows.
 *
 * `fetchPage` is read through a ref (rule 25): an inline function — or one
 * closing over `useApi()` — never re-fires the load by changing identity.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface CursorPage<T, C> {
  rows: T[];
  /** The cursor of the next page; `undefined` when there is nothing more. */
  nextCursor?: C | undefined;
}

export interface CursorPagesResult<T> {
  rows: T[];
  /** The first page is loading (the table shows its loading row). */
  loading: boolean;
  /** A further page is loading (the rows already shown stay). */
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  /**
   * Load every remaining page (an export uses it, so it covers the whole
   * filter). Stops at `LOAD_ALL_MAX_ROWS` rows as a safety net.
   */
  loadAll: () => Promise<void>;
  /** Start over from the first page (e.g. after a write). */
  reload: () => Promise<void>;
}

/** The most rows `loadAll` brings in — a safety net, not a real limit. */
export const LOAD_ALL_MAX_ROWS = 10000;

export function useCursorPages<T, C>(
  fetchPage: (cursor: C | undefined) => Promise<CursorPage<T, C>>,
  resetKey: string,
  onError?: (error: unknown) => void,
): CursorPagesResult<T> {
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Which load is current: bumped on every reload, so an answer for an
  // older one is ignored.
  const generation = useRef(0);
  const nextCursor = useRef<C | undefined>(undefined);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    busy.current = true;
    nextCursor.current = undefined;
    setLoading(true);
    setIsLoadingMore(false);
    try {
      const page = await fetchRef.current(undefined);
      if (gen !== generation.current) return;
      nextCursor.current = page.nextCursor;
      setRows(page.rows);
      setHasMore(page.nextCursor !== undefined);
    } catch (error) {
      if (gen !== generation.current) return;
      setRows([]);
      setHasMore(false);
      onErrorRef.current?.(error);
    } finally {
      if (gen === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor.current;
    if (busy.current || cursor === undefined) return;
    const gen = generation.current;
    busy.current = true;
    setIsLoadingMore(true);
    try {
      const page = await fetchRef.current(cursor);
      if (gen !== generation.current) return;
      nextCursor.current = page.nextCursor;
      setRows((prev) => [...prev, ...page.rows]);
      setHasMore(page.nextCursor !== undefined);
    } catch (error) {
      if (gen !== generation.current) return;
      // Keep what is shown; the operator can try again.
      onErrorRef.current?.(error);
    } finally {
      if (gen === generation.current) {
        busy.current = false;
        setIsLoadingMore(false);
      }
    }
  }, []);

  const rowCount = useRef(0);
  rowCount.current = rows.length;
  const loadAll = useCallback(async () => {
    // Wait for a page already in flight, then keep loading until the end.
    while (busy.current) await new Promise((r) => setTimeout(r, 25));
    const gen = generation.current;
    let loaded = rowCount.current;
    while (
      gen === generation.current &&
      nextCursor.current !== undefined &&
      loaded < LOAD_ALL_MAX_ROWS
    ) {
      const cursor = nextCursor.current;
      busy.current = true;
      setIsLoadingMore(true);
      try {
        const page = await fetchRef.current(cursor);
        if (gen !== generation.current) return;
        nextCursor.current = page.nextCursor;
        loaded += page.rows.length;
        setRows((prev) => [...prev, ...page.rows]);
        setHasMore(page.nextCursor !== undefined);
      } catch (error) {
        if (gen === generation.current) onErrorRef.current?.(error);
        return;
      } finally {
        if (gen === generation.current) {
          busy.current = false;
          setIsLoadingMore(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [resetKey, reload]);

  return { rows, loading, isLoadingMore, hasMore, loadMore, loadAll, reload };
}
