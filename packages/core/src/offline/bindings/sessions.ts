/**
 * Offline bindings — sessions / baskets family (LIRA-306 T081). Each calls
 * the SAME core service method its REST route calls
 * (`backend/src/api/sessions.ts`, the basket reversals in
 * `backend/src/api/transactions.ts`), with the actor from the event
 * (O-new-7): `started_by` / `closed_by` / checkout `username` are the event
 * actor's username, `userId` the event actor — never payload fields.
 *
 * The services are `async` but only await synchronous work (microtask
 * resolution) — the replay's no-yield sentinel would roll back anything else.
 */
import { CustomerSessionService } from "../../services/CustomerSessionService.js";
import { getSessionCheckoutService, type CheckoutRequest } from "../../services/SessionCheckoutService.js";
import { getTransactionService } from "../../services/TransactionService.js";
import type {
  LinkSessionTransactionInput,
  SessionCartAddInput,
  StartSessionInput,
  UpdateSessionInput,
} from "../../validators/session.js";
import type { SessionItemRefundInput } from "../../validators/transaction.js";
import { actorUsername } from "./actor.js";
import type { BindingResult, OfflineBinding } from "./types.js";

/** Same construction as the REST router (`new CustomerSessionService()`); stateless. */
const sessions = () => new CustomerSessionService();
const sessionIdOf = (p: Record<string, unknown>) => Number(p.sessionId);

/** POST /api/sessions/start */
const start: OfflineBinding = {
  channel: "session:start",
  run: (payload, ctx) => {
    const p = payload as unknown as StartSessionInput;
    return sessions().startSession({
      customer_name: p.customer_name,
      customer_phone: p.customer_phone,
      customer_notes: p.customer_notes,
      started_by: actorUsername(ctx.actorUserId),
      user_id: ctx.actorUserId,
    }) as unknown as Promise<BindingResult>;
  },
  mainRow: (r) => (typeof r.sessionId === "number" ? { table: "customer_sessions", id: r.sessionId } : null),
};

/** PUT /api/sessions/:id */
const update: OfflineBinding = {
  channel: "session:update",
  run: (payload, ctx) => {
    const p = payload as unknown as UpdateSessionInput;
    return sessions().updateSession(
      sessionIdOf(payload),
      { customer_name: p.customer_name, customer_phone: p.customer_phone, customer_notes: p.customer_notes },
      ctx.actorUserId,
    ) as unknown as Promise<BindingResult>;
  },
};

/** POST /api/sessions/:id/close — closed by the event's actor. */
const close: OfflineBinding = {
  channel: "session:close",
  run: (payload, ctx) =>
    sessions().closeSession(sessionIdOf(payload), actorUsername(ctx.actorUserId)) as unknown as Promise<BindingResult>,
};

/** DELETE /api/sessions/:id */
const remove: OfflineBinding = {
  channel: "session:delete",
  run: (payload) => sessions().deleteSession(sessionIdOf(payload)) as unknown as Promise<BindingResult>,
};

/** POST /api/sessions/link-transaction */
const link: OfflineBinding = {
  channel: "session:linkTransaction",
  run: (payload) => {
    const p = payload as unknown as LinkSessionTransactionInput;
    const s = sessions();
    return (
      p.sessionId
        ? s.linkTransactionToSession(p.sessionId, p.transactionType, p.transactionId, p.amountUsd || 0, p.amountLbp || 0, p.profitUsd ?? 0, p.profitLbp ?? 0)
        : s.linkTransactionToActiveSession(p.transactionType, p.transactionId, p.amountUsd || 0, p.amountLbp || 0, p.profitUsd ?? 0, p.profitLbp ?? 0)
    ) as unknown as Promise<BindingResult>;
  },
};

/** POST /api/sessions/checkout — `userId`/`username` from the event actor. */
const checkout: OfflineBinding = {
  channel: "session:checkout",
  run: (payload, ctx) =>
    getSessionCheckoutService().checkout(
      { ...(payload as unknown as CheckoutRequest), userId: ctx.actorUserId },
      { username: actorUsername(ctx.actorUserId) },
    ) as unknown as Promise<BindingResult>,
};

/** POST /api/sessions/:id/cart */
const cartAdd: OfflineBinding = {
  channel: "session:cart:add",
  run: (payload, ctx) => {
    const p = payload as unknown as SessionCartAddInput;
    return sessions().addCartItem(
      sessionIdOf(payload),
      {
        item_id: p.item_id,
        module: p.module,
        label: p.label,
        amount: p.amount,
        currency: p.currency,
        form_data: p.form_data,
        ipc_channel: p.ipc_channel,
      },
      ctx.actorUserId,
    ) as unknown as BindingResult;
  },
};

/** DELETE /api/sessions/:id/cart/:itemId */
const cartRemove: OfflineBinding = {
  channel: "session:cart:remove",
  run: (payload) => sessions().removeCartItem(sessionIdOf(payload), String(payload.itemId)) as unknown as BindingResult,
};

/** DELETE /api/sessions/:id/cart */
const cartClear: OfflineBinding = {
  channel: "session:cart:clear",
  run: (payload) => sessions().clearCart(sessionIdOf(payload)) as unknown as BindingResult,
};

/** POST /api/transactions/checkout-group/:groupId/void (admin) */
const voidCheckoutGroup: OfflineBinding = {
  channel: "transactions:void-checkout-group",
  run: (payload, ctx) => ({ success: true, ...getTransactionService().voidCheckoutGroup(String(payload.groupId), ctx.actorUserId) }),
};

/** POST /api/transactions/session-basket/:sessionId/void (admin) */
const voidBasket: OfflineBinding = {
  channel: "transactions:void-session-basket",
  run: (payload, ctx) => ({ success: true, ...getTransactionService().voidSessionBasket(sessionIdOf(payload), ctx.actorUserId) }),
};

/** POST /api/transactions/session-basket/:sessionId/refund (admin) */
const refundBasket: OfflineBinding = {
  channel: "transactions:refund-session-basket",
  run: (payload, ctx) => ({ success: true, ...getTransactionService().refundSessionBasket(sessionIdOf(payload), ctx.actorUserId) }),
};

/** POST /api/transactions/session-basket/:sessionId/items/refund (admin) */
const refundBasketItem: OfflineBinding = {
  channel: "transactions:refund-session-basket-item",
  run: (payload, ctx) => ({
    success: true,
    ...getTransactionService().refundSessionBasketItem({
      ...(payload as unknown as SessionItemRefundInput),
      userId: ctx.actorUserId,
    }),
  }),
};

export const SESSIONS_BINDINGS: readonly OfflineBinding[] = [
  start,
  update,
  close,
  remove,
  link,
  checkout,
  cartAdd,
  cartRemove,
  cartClear,
  voidCheckoutGroup,
  voidBasket,
  refundBasket,
  refundBasketItem,
];
