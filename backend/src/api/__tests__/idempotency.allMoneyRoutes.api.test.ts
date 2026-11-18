/**
 * LIRA-401 — every money POST books ONCE per Idempotency-Key.
 *
 * Table-driven over the spec's "Routes to guard" list
 * (specs/401-idempotent-money-writes/spec.md). For each route:
 *   - the same body + the same key twice → the booking method runs ONCE, the
 *     second reply equals the first, and the replay writes no second audit;
 *   - two different keys → it books twice (the guard does not over-merge);
 *   - a malformed key → refused with INVALID_IDEMPOTENCY_KEY, nothing booked.
 * The four routes whose booking awaits also get a "two taps in flight at
 * once" row — sequential requests would pass even with a broken async guard.
 *
 * Real routers and a REAL in-memory SQLite database built from
 * create_db.sql, so `idempotency_keys` and its unique index are real (the
 * jest-mapped better-sqlite3 mock returns nothing from `.get()` and could
 * never replay). Faked: authentication (fixed admin, tenant 1), the audit
 * writer (counted), socket events, and — because this suite is about the
 * guard, not about each payload's shape — request validation (pass-through
 * `validateRequest` and pass-through copies of the schemas some routes parse
 * inline). The booking method of each route is spied on and returns a fresh
 * reply per call, so a second booking is visible both in the call count and
 * in the reply.
 *
 * Written FIRST and run against the unguarded routes (rule 17).
 */

import { jest } from "@jest/globals";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, _res: any, next: any) => {
    req.user = {
      userId: 7,
      username: "owner",
      role: "admin",
      tenantId: 1,
      sessionToken: "s",
    };
    next();
  };
  const requireRole = () => (_req: any, _res: any, next: any) => next();
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));
jest.mock("../../websocket/io.js", () => ({ emitEvent: jest.fn() }));

jest.mock("../../middleware/validation.js", () => {
  const pass = () => (_req: any, _res: any, next: any) => next();
  return { validateRequest: pass, validateParams: pass, validateQuery: pass };
});

// Schemas some routes parse inline (not through validateRequest). Replaced by
// a pass-through so every row can use a minimal body.
const INLINE_SCHEMAS = [
  "saleRefundSchema",
  "saleRefundItemSchema",
  "saleUndoItemRefundSchema",
  "selfChargeTelecomItemSchema",
  "lotoSellSchema",
  "lotoFeeSchema",
  "lotoCashPrizeSchema",
  "lotoCheckpointCreateSchema",
  "lotoCheckpointsSettleBatchSchema",
  "lotoCheckpointSettleSchema",
  "rechargeBasketCheckoutSchema",
  "rechargePartnerOrderSchema",
  "sessionCheckoutSchema",
  "transactionVoidSchema",
  "sessionItemRefundSchema",
  "stockAdjustSchema",
  "receiveStockSchema",
  "holdMoneyCreateSchema",
  "holdMoneyCollectSchema",
  "holdMoneyVoidPickupSchema",
] as const;

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  const passThrough = {
    safeParse: (data: unknown) => ({ success: true, data }),
    parse: (data: unknown) => data,
  };
  const overrides: Record<string, unknown> = {};
  for (const name of INLINE_SCHEMAS) overrides[name] = passThrough;
  return { ...actual, ...overrides };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express, { type Express } from "express";
import request from "supertest";
import { auditRest } from "../../middleware/audit.js";
import {
  IDEMPOTENT_MONEY_ROUTES,
  IDEMPOTENT_ROUTE_FILES,
} from "../idempotentMoneyRoutes.js";

type Core = typeof import("@liratek/core");

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: Core;

/** One guarded route. `target` names the object + method that books. */
interface MoneyRoute {
  /** The spec's literal, e.g. "POST /api/sales/:id/refund". */
  name: string;
  /** Concrete URL to call. */
  url: string;
  body: Record<string, unknown>;
  target: (c: Core) => [object, string];
  /** The booking's return value for call n (0, 1, …). Fresh per call. */
  reply: (n: number) => unknown;
  /** The booking returns a promise (async route). */
  async?: boolean;
}

const ok = (n: number) => ({ success: true, id: 100 + n });

const ROUTES: MoneyRoute[] = [
  // ── debts ──
  {
    name: "POST /api/debts/repayments",
    url: "/api/debts/repayments",
    body: { clientId: 3, amountUSD: 20, amountLBP: 0 },
    target: (c) => [c.getDebtService(), "addRepayment"],
    reply: ok,
  },
  {
    name: "POST /api/debts/cash-out",
    url: "/api/debts/cash-out",
    body: { clientId: 3, amountUSD: 5, amountLBP: 0 },
    target: (c) => [c.getDebtService(), "cashOut"],
    reply: ok,
  },
  {
    name: "POST /api/debts/account-entry",
    url: "/api/debts/account-entry",
    body: { clientId: 3, direction: "IN", amountUSD: 5, amountLBP: 0 },
    target: (c) => [c.getDebtService(), "addAccountCashEntry"],
    reply: ok,
  },
  {
    name: "POST /api/debts/credit",
    url: "/api/debts/credit",
    body: { clientId: 3, amountUsd: 5, amountLbp: 0 },
    target: (c) => [c.getDebtService(), "addCredit"],
    reply: ok,
  },
  {
    name: "POST /api/debts/use-credit",
    url: "/api/debts/use-credit",
    body: { clientId: 3, amountUsd: 5, amountLbp: 0 },
    target: (c) => [c.getDebtService(), "useCredit"],
    reply: ok,
  },
  {
    name: "POST /api/debts/write-off",
    url: "/api/debts/write-off",
    body: { clientId: 3, amountUSD: 5, amountLBP: 0 },
    target: (c) => [c.getDebtService(), "writeOffDebt"],
    reply: ok,
  },
  // ── sales ──
  {
    name: "POST /api/sales/process",
    url: "/api/sales/process",
    body: { status: "completed", items: [] },
    target: (c) => [c.getSalesService(), "processSale"],
    reply: ok,
  },
  {
    name: "POST /api/sales/:id/refund",
    url: "/api/sales/5/refund",
    body: {},
    target: (c) => [c.getTransactionService(), "refundBySaleId"],
    reply: (n) => 500 + n,
  },
  {
    name: "POST /api/sales/:id/refund-item",
    url: "/api/sales/5/refund-item",
    body: { saleItemId: 1, refundQuantity: 1 },
    target: (c) => [c.getSalesService(), "refundSaleItem"],
    reply: ok,
  },
  {
    name: "POST /api/sales/undo-item-refund",
    url: "/api/sales/undo-item-refund",
    body: { refundTransactionId: 9 },
    target: (c) => [c.getSalesService(), "undoItemRefund"],
    reply: ok,
  },
  // ── services ──
  {
    name: "POST /api/services/transactions",
    url: "/api/services/transactions",
    body: { provider: "OMT", serviceType: "SEND", amount: 50, currency: "USD" },
    target: (c) => [c.getFinancialService(), "addTransaction"],
    reply: ok,
  },
  {
    name: "POST /api/services/self-charge",
    url: "/api/services/self-charge",
    body: { mobileServiceItemId: 1 },
    target: (c) => [c.getFinancialService(), "selfChargeTelecomItem"],
    reply: ok,
  },
  // ── custom services ──
  {
    name: "POST /api/custom-services",
    url: "/api/custom-services",
    body: { description: "Screen" },
    target: (c) => [c.getCustomServiceService(), "addService"],
    reply: ok,
  },
  {
    name: "POST /api/custom-services/fulfillment",
    url: "/api/custom-services/fulfillment",
    body: { id: 1, fulfillment_status: "DONE" },
    target: (c) => [c.getCustomServiceService(), "advanceFulfillmentStatus"],
    reply: (n) => ({ success: true, entity: { id: 1, n } }),
  },
  // ── recharge ──
  {
    name: "POST /api/recharge/process",
    url: "/api/recharge/process",
    body: { provider: "MTC", type: "CREDIT", amount: 5 },
    target: (c) => [c.getRechargeService(), "processRecharge"],
    reply: ok,
  },
  {
    name: "POST /api/recharge/top-up-app",
    url: "/api/recharge/top-up-app",
    body: { provider: "WHISH_APP", amount: 5, currency: "USD" },
    target: (c) => [c.getRechargeService(), "topUpApp"],
    reply: ok,
  },
  {
    name: "POST /api/recharge/top-up-from-supplier",
    url: "/api/recharge/top-up-from-supplier",
    body: { provider: "IPICK", amount: 5, currency: "USD" },
    target: (c) => [c.getRechargeService(), "topUpFromSupplier"],
    reply: ok,
  },
  {
    name: "POST /api/recharge/cashout-to-supplier",
    url: "/api/recharge/cashout-to-supplier",
    body: { provider: "OMT_APP", amount: 5, currency: "USD" },
    target: (c) => [c.getRechargeService(), "cashoutToSupplier"],
    reply: ok,
  },
  {
    name: "POST /api/recharge/top-up-from-partner",
    url: "/api/recharge/top-up-from-partner",
    body: { provider: "WHISH_APP", partnerId: 1, amount: 5, currency: "USD" },
    target: (c) => [c.getRechargeService(), "topUpFromPartner"],
    reply: ok,
  },
  {
    name: "POST /api/recharge/top-up-from-client",
    url: "/api/recharge/top-up-from-client",
    body: { amount: 5, currency: "USD", fee: 0, payments: [{ amount: 5 }] },
    target: (c) => [c.getRechargeService(), "topUpFromClient"],
    reply: ok,
  },
  // ── recharge basket ──
  {
    name: "POST /api/recharge-basket/checkout",
    url: "/api/recharge-basket/checkout",
    body: { cartItems: [] },
    target: (c) => [c.getRechargeBasketService(), "checkout"],
    reply: (n) => ({ success: true, sessionId: 200 + n, results: [] }),
    async: true,
  },
  {
    name: "POST /api/recharge-basket/partner-order",
    url: "/api/recharge-basket/partner-order",
    body: { partnerId: 1 },
    target: (c) => [c.getRechargePartnerOrderService(), "submit"],
    reply: (n) => ({ success: true, ids: [300 + n] }),
  },
  // ── exchange ──
  {
    name: "POST /api/exchange/transactions",
    url: "/api/exchange/transactions",
    body: { amountIn: 10, fromCurrency: "USD", toCurrency: "LBP" },
    target: (c) => [c.getExchangeService(), "addDirectTransaction"],
    reply: ok,
  },
  {
    name: "POST /api/exchange-lots/adjust",
    url: "/api/exchange-lots/adjust",
    body: { qty: 1, currencyCode: "EUR", unitCostUsd: 1.1 },
    target: (c) => [c.getExchangeLotService(), "adjustPosition"],
    reply: ok,
  },
  // ── expenses ──
  {
    name: "POST /api/expenses",
    url: "/api/expenses",
    body: { category: "Rent", amount_usd: 5 },
    target: (c) => [c.getExpenseService(), "addExpense"],
    reply: ok,
  },
  {
    name: "POST /api/expenses/stock-use",
    url: "/api/expenses/stock-use",
    body: { source: "inventory", item_id: 1, quantity: 1 },
    target: (c) => [c.getExpenseService(), "addStockExpense"],
    reply: ok,
  },
  // ── loto (services return the raw row; the route builds the envelope) ──
  {
    name: "POST /api/loto/sell",
    url: "/api/loto/sell",
    body: { amount: 1 },
    target: (c) => [c.getLotoService(), "sellTicket"],
    reply: (n) => ({ id: 400 + n }),
  },
  {
    name: "POST /api/loto/fees",
    url: "/api/loto/fees",
    body: { amount: 1 },
    target: (c) => [c.getLotoService(), "recordMonthlyFee"],
    reply: (n) => ({ id: 410 + n }),
  },
  {
    name: "POST /api/loto/fees/:id/pay",
    url: "/api/loto/fees/4/pay",
    body: {},
    target: (c) => [c.getLotoService(), "markFeePaid"],
    reply: (n) => ({ id: 4, n }),
  },
  {
    name: "POST /api/loto/cash-prizes",
    url: "/api/loto/cash-prizes",
    body: { amount: 1 },
    target: (c) => [c.getLotoService(), "recordCashPrize"],
    reply: (n) => ({ id: 420 + n }),
  },
  {
    name: "POST /api/loto/cash-prizes/:id/reimburse",
    url: "/api/loto/cash-prizes/4/reimburse",
    body: {},
    target: (c) => [c.getLotoService(), "markCashPrizeReimbursed"],
    reply: (n) => ({ id: 4, n }),
  },
  {
    name: "POST /api/loto/checkpoints",
    url: "/api/loto/checkpoints",
    body: { checkpointDate: "2026-11-18" },
    target: (c) => [c.getLotoService(), "createCheckpoint"],
    reply: (n) => ({ id: 430 + n }),
  },
  {
    name: "POST /api/loto/checkpoints/settle-batch",
    url: "/api/loto/checkpoints/settle-batch",
    body: { checkpointIds: [1, 2], totalSales: 1, totalCommission: 0 },
    target: (c) => [c.getLotoService(), "settleCheckpoints"],
    reply: (n) => [{ id: 1, n }],
  },
  {
    name: "POST /api/loto/checkpoints/:id/settle",
    url: "/api/loto/checkpoints/4/settle",
    body: { totalSales: 1, totalCommission: 0, totalPrizes: 0 },
    target: (c) => [c.getLotoService(), "settleCheckpoint"],
    reply: (n) => ({ id: 4, n }),
  },
  // ── maintenance ──
  {
    name: "POST /api/maintenance/jobs",
    url: "/api/maintenance/jobs",
    body: { device_name: "Phone" },
    target: (c) => [c.MaintenanceService.prototype, "saveJob"],
    reply: ok,
  },
  // ── partners ──
  {
    name: "POST /api/partners/transactions",
    url: "/api/partners/transactions",
    body: { partnerId: 1, direction: "IN", amount: 5, currency: "USD" },
    target: (c) => [c.getPartnerService(), "recordPartnerTransaction"],
    reply: (n) => ({ id: 600 + n }),
  },
  {
    name: "POST /api/partners/settle",
    url: "/api/partners/settle",
    body: { partnerId: 1, amount: 5, currency: "USD" },
    target: (c) => [c.getPartnerService(), "settle"],
    reply: (n) => ({ id: 610 + n }),
  },
  {
    name: "POST /api/partners/settle-days",
    url: "/api/partners/settle-days",
    body: { partnerId: 1, selections: [] },
    target: (c) => [c.getPartnerService(), "settleDays"],
    reply: ok,
  },
  {
    name: "POST /api/partners/write-off",
    url: "/api/partners/write-off",
    body: { partnerId: 1, amount_usd: 5, amount_lbp: 0 },
    target: (c) => [c.getPartnerService(), "writeOff"],
    reply: ok,
  },
  // ── suppliers (`:id` is copied into the body by the route) ──
  {
    name: "POST /api/suppliers/:id/ledger",
    url: "/api/suppliers/2/ledger",
    body: { entry_type: "PAYMENT", amount_usd: 5, amount_lbp: 0 },
    target: (c) => [c.getSupplierService(), "addLedgerEntry"],
    reply: ok,
  },
  {
    name: "POST /api/suppliers/:id/settle",
    url: "/api/suppliers/2/settle",
    body: { financial_service_ids: [1] },
    target: (c) => [c.getSupplierService(), "settleTransactions"],
    reply: ok,
  },
  {
    name: "POST /api/suppliers/:id/settle-account",
    url: "/api/suppliers/2/settle-account",
    body: { selections: [] },
    target: (c) => [c.getSupplierService(), "settleAccount"],
    reply: ok,
  },
  {
    name: "POST /api/suppliers/:id/remove-account-credit",
    url: "/api/suppliers/2/remove-account-credit",
    body: { ledger_row_id: 1, reason: "x" },
    target: (c) => [c.getSupplierService(), "removeAccountCredit"],
    reply: ok,
  },
  {
    name: "POST /api/suppliers/:id/cashflow",
    url: "/api/suppliers/2/cashflow",
    body: { direction: "PAY", payments: [] },
    target: (c) => [c.getSupplierService(), "recordSupplierCashflow"],
    reply: ok,
  },
  // createPurchase returns the raw entity (no `success` key) — the reply stays raw.
  {
    name: "POST /api/suppliers/:id/purchases",
    url: "/api/suppliers/2/purchases",
    body: { total_usd: 5 },
    target: (c) => [c.getSupplierService(), "createPurchase"],
    reply: (n) => ({ id: 700 + n, total_usd: 5 }),
  },
  {
    name: "POST /api/suppliers/:id/record-debt",
    url: "/api/suppliers/2/record-debt",
    body: { amount_usd: 5, amount_lbp: 0 },
    target: (c) => [c.getSupplierService(), "recordDebt"],
    reply: ok,
  },
  // ── sessions ──
  {
    name: "POST /api/sessions/checkout",
    url: "/api/sessions/checkout",
    body: { sessionId: 1, cartItems: [] },
    target: (c) => [c.getSessionCheckoutService(), "checkout"],
    reply: (n) => ({ success: true, itemCount: n }),
    async: true,
  },
  {
    name: "POST /api/sessions/:id/cart",
    url: "/api/sessions/1/cart",
    body: { item_id: "x" },
    target: (c) => [c.CustomerSessionService.prototype, "addCartItem"],
    reply: ok,
  },
  {
    name: "POST /api/sessions/:id/close",
    url: "/api/sessions/1/close",
    body: {},
    target: (c) => [c.CustomerSessionService.prototype, "closeSession"],
    reply: (n) => ({ success: true, n }),
    async: true,
  },
  {
    name: "POST /api/sessions/link-transaction",
    url: "/api/sessions/link-transaction",
    body: { sessionId: 1, transactionType: "SALE", transactionId: 5 },
    target: (c) => [
      c.CustomerSessionService.prototype,
      "linkTransactionToSession",
    ],
    reply: (n) => ({ success: true, linked: true, n }),
    async: true,
  },
  // ── closing ──
  {
    name: "POST /api/closing/checkpoint",
    url: "/api/closing/checkpoint",
    body: { drawer_name: "General" },
    target: (c) => [c.getClosingService(), "createCheckpoint"],
    reply: ok,
  },
  {
    name: "POST /api/closing/differences/close",
    url: "/api/closing/differences/close",
    body: { difference_id: 1 },
    target: (c) => [c.getClosingService(), "closeCheckpointDifference"],
    reply: ok,
  },
  // ── vouchers ──
  {
    name: "POST /api/vouchers",
    url: "/api/vouchers",
    body: { amount: 5 },
    target: (c) => [c.getVoucherService(), "createVoucher"],
    reply: (n) => ({
      success: true,
      voucher: { id: 800 + n, code: `V${n}`, amount: 5 },
    }),
  },
  {
    name: "POST /api/vouchers/:id/cancel",
    url: "/api/vouchers/8/cancel",
    body: {},
    target: (c) => [c.getVoucherService(), "cancelVoucher"],
    reply: ok,
  },
  // ── transactions (throwing services; the route builds the envelope) ──
  {
    name: "POST /api/transactions/:id/void",
    url: "/api/transactions/9/void",
    body: {},
    target: (c) => [c.getTransactionService(), "voidTransaction"],
    reply: (n) => 900 + n,
  },
  {
    name: "POST /api/transactions/:id/refund",
    url: "/api/transactions/9/refund",
    body: {},
    target: (c) => [c.getTransactionService(), "refundTransaction"],
    reply: (n) => 910 + n,
  },
  {
    name: "POST /api/transactions/checkout-group/:groupId/void",
    url: "/api/transactions/checkout-group/g-1/void",
    body: {},
    target: (c) => [c.getTransactionService(), "voidCheckoutGroup"],
    reply: (n) => ({
      memberCount: 2,
      voidedTransactionIds: [n],
      reversalIds: [n],
    }),
  },
  {
    name: "POST /api/transactions/session-basket/:sessionId/void",
    url: "/api/transactions/session-basket/3/void",
    body: {},
    target: (c) => [c.getTransactionService(), "voidSessionBasket"],
    reply: (n) => ({
      itemCount: 1,
      reversedTransactionIds: [n],
      reversalIds: [n],
    }),
  },
  {
    name: "POST /api/transactions/session-basket/:sessionId/refund",
    url: "/api/transactions/session-basket/3/refund",
    body: {},
    target: (c) => [c.getTransactionService(), "refundSessionBasket"],
    reply: (n) => ({
      itemCount: 1,
      reversedTransactionIds: [n],
      reversalIds: [n],
    }),
  },
  {
    name: "POST /api/transactions/session-basket/:sessionId/items/refund",
    url: "/api/transactions/session-basket/3/items/refund",
    body: { transactionId: 5 },
    target: (c) => [c.getTransactionService(), "refundSessionBasketItem"],
    reply: (n) => ({ refundTransactionId: 950 + n }),
  },
  // ── inventory ──
  {
    name: "POST /api/inventory/products/:id/stock",
    url: "/api/inventory/products/6/stock",
    body: { delta: 1, reason: "count" },
    target: (c) => [c.getInventoryService(), "adjustStockDelta"],
    reply: ok,
  },
  {
    name: "POST /api/inventory/products/:id/receive-stock",
    url: "/api/inventory/products/6/receive-stock",
    body: { quantity: 1, unit_cost_usd: 2 },
    target: (c) => [c.getInventoryService(), "receiveStock"],
    reply: ok,
  },
  // ── owner follow-up 2026-11-18: money writes found outside the first list ──
  {
    name: "POST /api/drawer-topup",
    url: "/api/drawer-topup",
    body: { amount_usd: 5, amount_lbp: 0 },
    target: (c) => [c.getDrawerTopUpService(), "addTopUp"],
    reply: ok,
  },
  {
    name: "POST /api/drawer-topup/from-drawer",
    url: "/api/drawer-topup/from-drawer",
    body: { source_drawer: "OMT_System", amount_usd: 5, amount_lbp: 0 },
    target: (c) => [c.getDrawerTopUpService(), "topUpFromDrawer"],
    reply: ok,
  },
  {
    name: "POST /api/drawer-topup/transfer",
    url: "/api/drawer-topup/transfer",
    body: {
      fromDrawer: "General",
      toDrawer: "OMT_System",
      amount_usd: 5,
      amount_lbp: 0,
    },
    target: (c) => [c.getDrawerTopUpService(), "transferBetweenDrawers"],
    reply: ok,
  },
  {
    name: "POST /api/drawer-cashout",
    url: "/api/drawer-cashout",
    body: { amount_usd: 5, amount_lbp: 0 },
    target: (c) => [c.getDrawerCashoutService(), "addCashout"],
    reply: ok,
  },
  {
    name: "POST /api/hold-money",
    url: "/api/hold-money",
    body: { client_name: "Rami", usd_amount: 5, lbp_amount: 0 },
    target: (c) => [c.getHoldMoneyService(), "createHold"],
    reply: ok,
  },
  {
    name: "POST /api/hold-money/:id/collect",
    url: "/api/hold-money/4/collect",
    body: { usd_amount: 5, lbp_amount: 0 },
    target: (c) => [c.getHoldMoneyService(), "collectHold"],
    reply: ok,
  },
  {
    name: "POST /api/hold-money/pickups/:pickupId/void",
    url: "/api/hold-money/pickups/4/void",
    body: {},
    target: (c) => [c.getHoldMoneyService(), "voidPickup"],
    reply: ok,
  },
  {
    name: "POST /api/wallet-exchange",
    url: "/api/wallet-exchange",
    body: {
      drawerName: "Whish_App",
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 5,
      rate: 89500,
    },
    target: (c) => [c.getWalletExchangeService(), "exchange"],
    reply: (n) => ({ success: true, id: 100 + n, amountOut: 447500 }),
  },
  {
    name: "POST /api/carrier-lines/record-usage",
    url: "/api/carrier-lines/record-usage",
    body: { carrierLineId: 1 },
    target: (c) => [c.getCarrierLineService(), "recordUsage"],
    reply: (n) => ({ success: true, data: { expenseId: n, creditsUsed: 1 } }),
  },
  {
    name: "POST /api/carrier-lines",
    url: "/api/carrier-lines",
    body: { carrier: "alfa", phone_number: "03123456" },
    target: (c) => [c.getCarrierLineService(), "create"],
    reply: ok,
  },
  {
    name: "POST /api/resale-lines/:productId/write-off",
    url: "/api/resale-lines/6/write-off",
    body: { product_id: 6 },
    target: (c) => [c.getResaleLineService(), "writeOff"],
    reply: (n) => ({ success: true, data: { expense_id: n } }),
  },
  {
    name: "POST /api/resale-lines/:productId/recharge",
    url: "/api/resale-lines/6/recharge",
    body: { product_id: 6, source: "shop_line" },
    target: (c) => [c.getResaleLineService(), "recharge"],
    reply: (n) => ({ success: true, data: { transaction_id: n, cost_usd: 1 } }),
  },
  {
    name: "POST /api/resale-lines/:productId/give-back",
    url: "/api/resale-lines/6/give-back",
    body: { product_id: 6 },
    target: (c) => [c.getResaleLineService(), "giveBack"],
    reply: (n) => ({
      success: true,
      data: { transaction_id: n, credits_sent: 1, price_drop_usd: 0 },
    }),
  },
  {
    name: "POST /api/wrong-numbers",
    url: "/api/wrong-numbers",
    body: { provider: "alfa", wrong_number: "03111111" },
    target: (c) => [c.getWrongNumberService(), "recordWrongNumber"],
    reply: (n) => ({
      success: true,
      data: { id: n, expense_transaction_id: n },
    }),
  },
  {
    name: "POST /api/wrong-numbers/:id/credits",
    url: "/api/wrong-numbers/7/credits",
    body: { wrong_number_card_id: 7, amount_usd: 1, carrier_line_id: 1 },
    target: (c) => [c.getWrongNumberService(), "recordCreditsReceived"],
    reply: (n) => ({ success: true, data: { transaction_id: n } }),
  },
  {
    name: "POST /api/sessions/start",
    url: "/api/sessions/start",
    body: { customer_name: "Rami" },
    target: (c) => [c.CustomerSessionService.prototype, "startSession"],
    reply: (n) => ({ success: true, sessionId: 500 + n }),
    async: true,
  },
];

const MOUNTS: Array<[string, string]> = Object.entries(
  IDEMPOTENT_ROUTE_FILES,
).map(([mount, file]) => [mount, `../${file}.js`]);

beforeAll(async () => {
  process.env.JWT_SECRET =
    "idempotency-all-routes-secret-0123456789-0123456789";
  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  core = (await import("@liratek/core")) as Core;
  db.exec(
    fs.readFileSync(
      path.join(__dirname, "../../../../electron-app/create_db.sql"),
      "utf8",
    ),
  );

  app = express();
  app.use(express.json());
  // Production gets tenant context from authenticateJWT; here it is fixed.
  app.use((_req, _res, next) => core.runWithTenant(1, () => next()));
  for (const [mount, file] of MOUNTS) {
    const router = ((await import(file)) as { default: express.Router })
      .default;
    app.use(mount, router);
  }
});

afterAll(() => db.close());

beforeEach(() => {
  jest.restoreAllMocks();
  (auditRest as jest.Mock).mockClear();
});

let keySeq = 0;
/** A fresh valid key per call, so rows never collide with each other. */
function newKey(): string {
  keySeq += 1;
  return `lira401-key-${String(keySeq).padStart(4, "0")}`;
}

/** Spies on the route's booking method; each call returns a fresh reply. */
function spyOnBooking(route: MoneyRoute, delayMs = 0) {
  const [obj, method] = route.target(core);
  let n = 0;
  return jest
    .spyOn(obj as Record<string, () => unknown>, method)
    .mockImplementation((() => {
      const value = route.reply(n++);
      if (!route.async) return value;
      return new Promise((resolve) =>
        setTimeout(() => resolve(value), delayMs),
      );
    }) as () => unknown);
}

function post(route: MoneyRoute, key?: string) {
  const r = request(app).post(route.url);
  if (key) r.set("Idempotency-Key", key);
  return r.send(route.body);
}

/** Every reply a fresh booking can give is a success envelope or a raw entity. */
function isSuccessReply(body: unknown): boolean {
  return !(
    typeof body === "object" &&
    body !== null &&
    (body as { success?: unknown }).success === false
  );
}

describe("LIRA-401: every money POST books once per Idempotency-Key", () => {
  it("covers exactly the 78 routes of the spec list", () => {
    expect(IDEMPOTENT_MONEY_ROUTES).toHaveLength(78);
    expect(ROUTES.map((r) => r.name)).toEqual([...IDEMPOTENT_MONEY_ROUTES]);
  });

  describe.each(ROUTES.map((r) => [r.name, r] as const))(
    "%s",
    (_name, route) => {
      it("same key twice → booked ONCE, second reply equals the first, no second audit", async () => {
        const spy = spyOnBooking(route);
        const key = newKey();
        const first = await post(route, key);
        // Sanity: the request reached the booking and succeeded, so a count of
        // 1 below means "replayed", never "rejected before booking".
        expect(spy).toHaveBeenCalledTimes(1);
        expect(first.status).toBeLessThan(300);
        expect(isSuccessReply(first.body)).toBe(true);
        const auditsAfterFirst = (auditRest as jest.Mock).mock.calls.length;

        const second = await post(route, key);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(second.status).toBe(first.status);
        expect(second.body).toEqual(first.body);
        expect((auditRest as jest.Mock).mock.calls.length).toBe(
          auditsAfterFirst,
        );
      });

      it("two different keys → booked twice", async () => {
        const spy = spyOnBooking(route);
        const a = await post(route, newKey());
        const b = await post(route, newKey());
        expect(spy).toHaveBeenCalledTimes(2);
        expect(isSuccessReply(a.body)).toBe(true);
        expect(isSuccessReply(b.body)).toBe(true);
      });

      it("malformed key → INVALID_IDEMPOTENCY_KEY, nothing booked", async () => {
        const spy = spyOnBooking(route);
        const res = await post(route, "bad key!");
        expect(res.body).toEqual({
          success: false,
          error: "INVALID_IDEMPOTENCY_KEY",
        });
        expect(spy).not.toHaveBeenCalled();
      });
    },
  );

  describe.each(ROUTES.filter((r) => r.async).map((r) => [r.name, r] as const))(
    "%s (booking awaits)",
    (_name, route) => {
      it("two taps in flight at once → booked ONCE, both get the same reply", async () => {
        const spy = spyOnBooking(route, 25);
        const key = newKey();
        const [a, b] = await Promise.all([post(route, key), post(route, key)]);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(isSuccessReply(a.body)).toBe(true);
        expect(b.body).toEqual(a.body);
      });
    },
  );

  it("the same key on two different ids of one route is two submissions", async () => {
    const spy = jest
      .spyOn(core.getTransactionService(), "refundBySaleId")
      .mockReturnValue(77 as never);
    const key = newKey();
    await request(app)
      .post("/api/sales/1/refund")
      .set("Idempotency-Key", key)
      .send({});
    await request(app)
      .post("/api/sales/2/refund")
      .set("Idempotency-Key", key)
      .send({});
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("scopes keys by route pattern + params; the LIRA-289 route names are unchanged", async () => {
    const run = jest.spyOn(core.getIdempotencyService(), "run");
    jest
      .spyOn(core.getDebtService(), "addRepayment")
      .mockReturnValue({ success: true } as never);
    jest
      .spyOn(core.getFinancialService(), "addTransaction")
      .mockReturnValue({ success: true } as never);
    jest
      .spyOn(core.getTransactionService(), "refundBySaleId")
      .mockReturnValue(1 as never);
    jest
      .spyOn(core.getExpenseService(), "addExpense")
      .mockReturnValue({ success: true } as never);
    await request(app)
      .post("/api/debts/repayments")
      .set("Idempotency-Key", newKey())
      .send({});
    await request(app)
      .post("/api/services/transactions")
      .set("Idempotency-Key", newKey())
      .send({});
    await request(app)
      .post("/api/sales/42/refund")
      .set("Idempotency-Key", newKey())
      .send({});
    await request(app)
      .post("/api/expenses/")
      .set("Idempotency-Key", newKey())
      .send({});
    expect(run.mock.calls.map((c) => c[0].route)).toEqual([
      "POST /api/debts/repayments",
      "POST /api/services/transactions",
      "POST /api/sales/:id/refund id=42",
      "POST /api/expenses",
    ]);
  });
});
