/**
 * LIRA-326 — the Mobile Recharge basket: what each provider grid has picked
 * and not yet paid, held above the forms (RechargeBasketContext) so it
 * survives switching tabs and leaving the page.
 */
import type { PaymentSheetItem } from "../components/PaymentSheet";
import type { ServiceItem } from "../hooks/useMobileServiceItems";

/** The providers whose card grids share the basket. */
export type BasketProvider = "iPick" | "Katsh" | "WHISH_APP";

/** One iPick / Katsh cart line (KatshForm's grid; both providers mix). */
export interface CatalogCartLine {
  item: ServiceItem;
  quantity: number;
  onlyDays: boolean;
  returnedCreditsUsd: number;
  /**
   * LIRA-090 B2: true when the operator explicitly changed the returnedCreditsUsd
   * field from the computed default. When false (default was shown but not touched),
   * the submit path omits `returnedCreditsUsd` and lets the repo compute its own
   * default from `mobileServiceItemId`. When true, forwards the typed value as an
   * explicit override that always wins (including 0 — "no credit returned").
   */
  returnedCreditsEdited: boolean;
  /**
   * Owner pricing model (2026-08-05): editable override for the Only-Days
   * sell price. Undefined = use the catalog default. Only ever set from a
   * panel that renders exclusively when the catalog already provides a
   * `sell_days_lbp`.
   */
  sellDaysLbpOverride?: number | undefined;
  /**
   * Owner pricing model (2026-08-05): editable override for the LBP price of
   * $1 of kept credit. Undefined = use the 3-level default.
   */
  creditPriceLbpOverride?: number | undefined;
}

/** One Whish App cart line (FinancialForm's grid). The item is already
 *  priced in the catalog's active currency (LIRA-324). */
export interface WhishCartLine {
  item: ServiceItem;
  quantity: number;
}

/**
 * One unit as a session `_batch` sub-item (`financial:create` formData). The
 * session checkout replays each through FinancialService, so this is exactly
 * what a single-unit sale of that item sends, without payment fields.
 */
export interface BasketSubItem {
  /** The line's OWN provider (never the tab it was paid from). A string, not
   *  `BasketProvider`: FinancialForm's other providers share the builder. */
  provider: string;
  serviceType: string;
  amount: number;
  cost: number;
  /** LIRA-327: a bill sends its price (= amount), like a bill paid alone. */
  price?: number;
  currency: "LBP" | "USD";
  commission: number;
  clientId?: number;
  clientName?: string;
  /** Card units only — a bill sends no item key (no item-cost auto-save). */
  itemKey?: string;
  itemCategory?: string;
  mobileServiceItemId?: number;
  returnedCreditsUsd?: number;
  /** Card units only — a bill sends no note, like a bill paid alone. */
  note?: string;
  /** LIRA-329 — this unit's share of the basket's typed discount. */
  typedDiscount?: { amount: number; currency: "LBP" | "USD" };
  /** Bug #4 — the "Set custom time" picked on the form (ISO), on a unit
   *  added to a customer session's basket. Absent = the checkout's time. */
  transaction_time?: string;
}

/** The providers whose bills can be staged on the Bill card (KatshForm). */
export type BillProvider = "iPick" | "Katsh";

/**
 * LIRA-327 — a staged bill, held in the basket (survives tab switches and
 * leaving Mobile Recharge, like the cards). It belongs to the tab it was
 * added on and is always booked under that provider.
 */
export interface BasketBill {
  id: string;
  provider: BillProvider;
  amount: number;
  currency: "LBP" | "USD";
}

/**
 * A cart line priced by the form that owns it, published to the basket so
 * another tab can list and pay it without knowing its pricing rules (Only
 * Days, the LBP | USD switch, …).
 */
export interface PricedLine {
  key: string;
  provider: BasketProvider;
  /** LIRA-327: "bill" = a staged bill — booked as its own BILL entry, never
   *  inside a provider's `_batch`. Absent = card units. */
  kind?: "bill";
  /** iPick / Katsh card lines: the line as today's partner order note names
   *  it (`<item> x<qty> [Only Days]`). */
  partnerNote?: string;
  /** `<catalog item name> x<qty>` — the session cart label's piece. */
  label: string;
  sheetItem: PaymentSheetItem;
  currency: "LBP" | "USD";
  /** Line total (unit price × quantity). */
  amount: number;
  cost: number;
  commission: number;
  /** One per unit. */
  subItems: BasketSubItem[];
}
