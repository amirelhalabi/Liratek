import type { CatalogCurrency } from "@liratek/core";

/**
 * LIRA-324 — remembers, on THIS device only, the last LBP | USD choice on
 * Recharge → Whish App → Bills. A convenience only (CLAUDE.md browser-storage
 * rule): every read/write is wrapped in try/catch, and anything missing,
 * unknown or unreadable means LBP — the exact pre-feature behaviour.
 */
export const WHISH_BILLS_CURRENCY_KEY = "liratek:whish-bills-currency";

export function loadWhishBillsCurrency(): CatalogCurrency {
  try {
    const raw = window.localStorage.getItem(WHISH_BILLS_CURRENCY_KEY);
    return raw === "USD" ? "USD" : "LBP";
  } catch {
    return "LBP";
  }
}

export function saveWhishBillsCurrency(value: CatalogCurrency): void {
  try {
    window.localStorage.setItem(WHISH_BILLS_CURRENCY_KEY, value);
  } catch {
    // Best-effort only — blocked storage must never break the screen.
  }
}
