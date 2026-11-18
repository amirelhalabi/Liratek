/**
 * LIRA-401 — the money POST routes that MUST go through the Idempotency-Key
 * guard (`sendIdempotent` / `guardIdempotent` and their async twins in
 * middleware/idempotency.ts). The list is the spec's "Routes to guard"
 * (specs/401-idempotent-money-writes/spec.md), written as
 * "POST <mount><route pattern>".
 *
 * Two tests read it: idempotency.allMoneyRoutes.api.test.ts (behaviour: each
 * route books once per key) and idempotency.guard.test.ts (source: each
 * route's handler calls the guard). A new money POST is added HERE, in the
 * same change that adds the route.
 */

/** Mount path → route file (backend/src/api/<file>.ts), as server.ts mounts them. */
export const IDEMPOTENT_ROUTE_FILES: Readonly<Record<string, string>> = {
  "/api/debts": "debts",
  "/api/sales": "sales",
  "/api/services": "services",
  "/api/custom-services": "customServices",
  "/api/recharge": "recharge",
  "/api/recharge-basket": "rechargeBasket",
  "/api/exchange": "exchange",
  "/api/exchange-lots": "exchangeLots",
  "/api/expenses": "expenses",
  "/api/loto": "loto",
  "/api/maintenance": "maintenance",
  "/api/partners": "partners",
  "/api/suppliers": "suppliers",
  "/api/sessions": "sessions",
  "/api/closing": "closing",
  "/api/vouchers": "vouchers",
  "/api/transactions": "transactions",
  "/api/inventory": "inventory",
  "/api/drawer-topup": "drawerTopUp",
  "/api/drawer-cashout": "drawerCashout",
  "/api/hold-money": "holdMoney",
  "/api/wallet-exchange": "walletExchange",
  "/api/carrier-lines": "carrierLines",
  "/api/resale-lines": "resaleLines",
  "/api/wrong-numbers": "wrongNumbers",
};

export const IDEMPOTENT_MONEY_ROUTES: readonly string[] = [
  "POST /api/debts/repayments",
  "POST /api/debts/cash-out",
  "POST /api/debts/account-entry",
  "POST /api/debts/credit",
  "POST /api/debts/use-credit",
  "POST /api/debts/write-off",
  "POST /api/sales/process",
  "POST /api/sales/:id/refund",
  "POST /api/sales/:id/refund-item",
  "POST /api/sales/undo-item-refund",
  "POST /api/services/transactions",
  "POST /api/services/self-charge",
  "POST /api/custom-services",
  "POST /api/custom-services/fulfillment",
  "POST /api/recharge/process",
  "POST /api/recharge/top-up-app",
  "POST /api/recharge/top-up-from-supplier",
  "POST /api/recharge/cashout-to-supplier",
  "POST /api/recharge/top-up-from-partner",
  "POST /api/recharge/top-up-from-client",
  "POST /api/recharge-basket/checkout",
  "POST /api/recharge-basket/partner-order",
  "POST /api/exchange/transactions",
  "POST /api/exchange-lots/adjust",
  "POST /api/expenses",
  "POST /api/expenses/stock-use",
  "POST /api/loto/sell",
  "POST /api/loto/fees",
  "POST /api/loto/fees/:id/pay",
  "POST /api/loto/cash-prizes",
  "POST /api/loto/cash-prizes/:id/reimburse",
  "POST /api/loto/checkpoints",
  "POST /api/loto/checkpoints/settle-batch",
  "POST /api/loto/checkpoints/:id/settle",
  "POST /api/maintenance/jobs",
  "POST /api/partners/transactions",
  "POST /api/partners/settle",
  "POST /api/partners/settle-days",
  "POST /api/partners/write-off",
  "POST /api/suppliers/:id/ledger",
  "POST /api/suppliers/:id/settle",
  "POST /api/suppliers/:id/settle-account",
  "POST /api/suppliers/:id/remove-account-credit",
  "POST /api/suppliers/:id/cashflow",
  "POST /api/suppliers/:id/purchases",
  "POST /api/suppliers/:id/record-debt",
  "POST /api/sessions/checkout",
  "POST /api/sessions/:id/cart",
  "POST /api/sessions/:id/close",
  "POST /api/sessions/link-transaction",
  "POST /api/closing/checkpoint",
  "POST /api/closing/differences/close",
  "POST /api/vouchers",
  "POST /api/vouchers/:id/cancel",
  "POST /api/transactions/:id/void",
  "POST /api/transactions/:id/refund",
  "POST /api/transactions/checkout-group/:groupId/void",
  "POST /api/transactions/session-basket/:sessionId/void",
  "POST /api/transactions/session-basket/:sessionId/refund",
  "POST /api/transactions/session-basket/:sessionId/items/refund",
  "POST /api/inventory/products/:id/stock",
  "POST /api/inventory/products/:id/receive-stock",
  // Owner follow-up 2026-11-18: money writes found outside the first list.
  "POST /api/drawer-topup",
  "POST /api/drawer-topup/from-drawer",
  "POST /api/drawer-topup/transfer",
  "POST /api/drawer-cashout",
  "POST /api/hold-money",
  "POST /api/hold-money/:id/collect",
  "POST /api/hold-money/pickups/:pickupId/void",
  "POST /api/wallet-exchange",
  "POST /api/carrier-lines/record-usage",
  "POST /api/carrier-lines",
  "POST /api/resale-lines/:productId/write-off",
  "POST /api/resale-lines/:productId/recharge",
  "POST /api/resale-lines/:productId/give-back",
  "POST /api/wrong-numbers",
  "POST /api/wrong-numbers/:id/credits",
  "POST /api/sessions/start",
];

/** Splits "POST /api/sales/:id/refund" into its mount and route path ("/" for a root route). */
export function splitMoneyRoute(name: string): { mount: string; path: string } {
  const url = name.replace(/^POST /, "");
  const mount = Object.keys(IDEMPOTENT_ROUTE_FILES)
    .filter((m) => url === m || url.startsWith(`${m}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!mount) throw new Error(`No mount for ${name}`);
  return { mount, path: url.slice(mount.length) || "/" };
}
