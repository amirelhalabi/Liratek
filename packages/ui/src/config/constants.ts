// Exchange rate constant
/** @deprecated Use useExchangeRate() hook or load from rates table instead. Kept as fallback only. */
export const EXCHANGE_RATE = 89000; // 1 USD = 89,000 LBP

// Drawer constants
//
// OMT_System is the physical cash drawer at the shop's money-transfer
// counter (Primary Cash Drawer plan §1) — not a spendable balance held
// inside the provider's own system (the PR #66 float model the owner
// rejected). The drawer NAME is unchanged either way.
//
// @deprecated `DRAWER_A` hardcodes OMT as the assumed primary system. It
// does not derive from `shop_base_system` (see `useShopBase()` /
// `primaryCashDrawerName()` in `@liratek/core`), so it silently names the
// wrong drawer for a Whish-primary shop. Prefer resolving the primary cash
// drawer from `shop_base_system` at the call site instead of importing this.
export const DRAWER_A = "OMT_System";
export const DRAWER_B = "General";
