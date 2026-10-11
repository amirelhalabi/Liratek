/**
 * Offline bindings — drawers / hold-money family (LIRA-306, T101). Each calls
 * the SAME core service the REST route calls, with the actor from the event
 * instead of the JWT (E2, O-new-7); the ReplayEngine has already checked the
 * actor's role (drawer-cashout:create is admin-only):
 *   - POST /api/drawer-cashout              → addCashout(body, userId)
 *   - POST /api/drawer-topup                → addTopUp(body, userId)
 *   - POST /api/drawer-topup/from-drawer    → topUpFromDrawer(body, userId)
 *   - POST /api/drawer-topup/transfer       → transferBetweenDrawers({ camelCase…, createdBy: userId })
 *   - POST /api/hold-money                  → createHold(body, userId)
 *   - POST /api/hold-money/:id/collect      → collectHold({ ...body, id }, userId)
 *   - POST /api/hold-money/pickups/:id/void → voidPickup(pickup_id, userId)
 * (`voucher:cancel` is online-only, O-impl-C-1 — no binding.)
 */
import { getDrawerCashoutService } from "../../services/DrawerCashoutService.js";
import { getDrawerTopUpService } from "../../services/DrawerTopUpService.js";
import { getHoldMoneyService } from "../../services/HoldMoneyService.js";
import type { CreateDrawerTransferInput } from "../../validators/drawerTransfer.js";
import type { BindingResult, OfflineBinding } from "./types.js";

type CashoutService = ReturnType<typeof getDrawerCashoutService>;
type TopUpService = ReturnType<typeof getDrawerTopUpService>;
type HoldService = ReturnType<typeof getHoldMoneyService>;
type First<F> = F extends (a: infer A, ...r: never[]) => unknown ? A : never;

/** The REST routes answer a thrown error with its message. */
function guarded(fn: () => unknown): BindingResult {
  try {
    return fn() as BindingResult;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

const cashout: OfflineBinding = {
  channel: "drawer-cashout:create",
  run: (payload, ctx) =>
    guarded(() => getDrawerCashoutService().addCashout(payload as unknown as First<CashoutService["addCashout"]>, ctx.actorUserId)),
};

const topUp: OfflineBinding = {
  channel: "drawer-topup:create",
  run: (payload, ctx) =>
    guarded(() => getDrawerTopUpService().addTopUp(payload as unknown as First<TopUpService["addTopUp"]>, ctx.actorUserId)),
};

const topUpFromDrawer: OfflineBinding = {
  channel: "drawer-topup:create-from-drawer",
  run: (payload, ctx) =>
    guarded(() =>
      getDrawerTopUpService().topUpFromDrawer(payload as unknown as First<TopUpService["topUpFromDrawer"]>, ctx.actorUserId),
    ),
};

const transfer: OfflineBinding = {
  channel: "drawer-topup:transfer",
  run: (payload, ctx) => {
    const { fromDrawer, toDrawer, amount_usd, amount_lbp, notes, transaction_time } =
      payload as unknown as CreateDrawerTransferInput;
    return guarded(() =>
      getDrawerTopUpService().transferBetweenDrawers({
        fromDrawer,
        toDrawer,
        amountUsd: amount_usd,
        amountLbp: amount_lbp,
        notes,
        transactionTime: transaction_time,
        createdBy: ctx.actorUserId,
      } as First<TopUpService["transferBetweenDrawers"]>),
    );
  },
};

const createHold: OfflineBinding = {
  channel: "hold-money:create",
  run: (payload, ctx) =>
    guarded(() => getHoldMoneyService().createHold(payload as unknown as First<HoldService["createHold"]>, ctx.actorUserId)),
  mainRow: (r) => (typeof r.id === "number" ? { table: "hold_money", id: r.id } : null),
};

const collectHold: OfflineBinding = {
  channel: "hold-money:collect",
  run: (payload, ctx) =>
    guarded(() => getHoldMoneyService().collectHold(payload as unknown as First<HoldService["collectHold"]>, ctx.actorUserId)),
};

const voidPickup: OfflineBinding = {
  channel: "hold-money:void-pickup",
  run: (payload, ctx) =>
    guarded(() => getHoldMoneyService().voidPickup((payload as { pickup_id: number }).pickup_id, ctx.actorUserId)),
};

export const DRAWERS_BINDINGS: readonly OfflineBinding[] = [
  cashout,
  topUp,
  topUpFromDrawer,
  transfer,
  createHold,
  collectHold,
  voidPickup,
];
