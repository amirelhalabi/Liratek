/**
 * Review-list item kinds (LIRA-306, R13) — PURE, browser-safe.
 * The same 14 values as the `offline_review_items.kind` CHECK (v210).
 */
export const OFFLINE_REVIEW_KINDS = [
  "possible_duplicate",
  "certain_duplicate",
  "held_checkpoint",
  "waiting",
  "refused",
  "stock_count_off",
  "ticks_dropped",
  "customer_linked",
  "clock_corrected",
  "closed_day_changed",
  "came_out_differently",
  "user_switched_off",
  "pc_data_mismatch",
  "rate_changed",
] as const;

export type OfflineReviewKind = (typeof OFFLINE_REVIEW_KINDS)[number];

/** Plain words for shop owners (the review page groups by these). */
export const OFFLINE_REVIEW_KIND_LABELS: Record<OfflineReviewKind, string> = {
  possible_duplicate: "Possible duplicate — held until you decide",
  certain_duplicate: "Same transfer already booked — skipped",
  held_checkpoint: "Drawer count or checkpoint taken offline — held",
  waiting: "Waits on another item",
  refused: "Could not be booked",
  stock_count_off: "Stock count was off",
  ticks_dropped: "Ticked items were already paid — booked against the oldest debts",
  customer_linked: "Customer already existed — linked",
  clock_corrected: "PC clock was wrong — time corrected",
  closed_day_changed: "A day that was already closed changed",
  came_out_differently: "Booked, but came out differently online",
  user_switched_off: "Done by a user who is switched off now",
  pc_data_mismatch: "The PC's data does not match what it sent",
  rate_changed: "Exchange rate changed during the outage",
};

/** Kinds that hold an event (Apply / Dismiss); the rest are notes. */
export const OFFLINE_HOLDING_KINDS: readonly OfflineReviewKind[] = [
  "possible_duplicate",
  "held_checkpoint",
  "waiting",
  "refused",
];

export const OFFLINE_EVENT_STATUSES = [
  "received",
  "booked",
  "skipped",
  "held",
  "refused",
  "applied",
  "dismissed",
] as const;
export type OfflineEventStatus = (typeof OFFLINE_EVENT_STATUSES)[number];
