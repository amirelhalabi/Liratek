/**
 * LIRA-333 (FR-001) — which saved sale the POS "Sale completed" strip shows.
 *
 * Shown on a completed sale; a later completed sale replaces it; hidden by
 * its close button or when the next sale starts — i.e. the cart gets its
 * first item (scanning, resuming a draft and opening checkout all need a
 * non-empty cart, so this one rule covers them). It only remembers the id:
 * it never opens WhatsApp by itself (FR-004).
 */
import { useCallback, useEffect, useState } from "react";

export function useCompletedSaleStrip(cartCount: number) {
  const [completedSaleId, setCompletedSaleId] = useState<number | null>(null);

  useEffect(() => {
    if (cartCount > 0) setCompletedSaleId(null);
  }, [cartCount]);

  const show = useCallback((saleId: number) => setCompletedSaleId(saleId), []);
  const hide = useCallback(() => setCompletedSaleId(null), []);

  return { completedSaleId, show, hide };
}
