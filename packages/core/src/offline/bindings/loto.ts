/**
 * Offline bindings — loto family (LIRA-306, T097). Each calls the SAME core
 * service the REST route calls (backend/src/api/loto.ts), with the actor from
 * the event instead of the JWT (E2, O-new-7):
 *   - POST /api/loto/sell            → sellTicket({ ...body, userId })
 *   - PUT  /api/loto/:id             → updateTicket(id, body)
 *   - POST /api/loto/cash-prizes     → recordCashPrize({ ...body, userId })
 *   - POST /api/loto/update-metadata → updateLotoMetadata(id, { note }, username)
 *
 * `loto:update-metadata` has no monthly-fee side effect on either transport
 * (`checkAndRecordMonthlyFee` runs only at desktop start-up), so none here.
 * Thrown service errors become the route's `{ success: false, error }`.
 */
import { getLotoService, type SellTicketData } from "../../services/LotoService.js";
import type { LotoTicketUpdateInput } from "../../validators/loto.js";
import { actorUsername } from "./exchange.js";
import type { BindingResult, OfflineBinding } from "./types.js";

function refusal(error: unknown, fallback: string): BindingResult {
  return { success: false, error: error instanceof Error ? error.message : fallback };
}

const sell: OfflineBinding = {
  channel: "loto:sell",
  run: (payload, ctx) => {
    try {
      const ticket = getLotoService().sellTicket({
        ...(payload as unknown as SellTicketData),
        userId: ctx.actorUserId,
      });
      return { success: true, ticket };
    } catch (error) {
      return refusal(error, "Failed to sell ticket");
    }
  },
  mainRow: (r) => {
    const id = (r.ticket as { id?: unknown } | undefined)?.id;
    return typeof id === "number" ? { table: "loto_tickets", id } : null;
  },
};

const update: OfflineBinding = {
  channel: "loto:update",
  run: (payload) => {
    try {
      const { id, ...body } = payload as unknown as { id: number } & LotoTicketUpdateInput;
      const ticket = getLotoService().updateTicket(id, body);
      return { success: true, ticket };
    } catch (error) {
      return refusal(error, "Failed to update ticket");
    }
  },
};

const cashPrize: OfflineBinding = {
  channel: "loto:cash-prize:create",
  run: (payload, ctx) => {
    try {
      const prize = getLotoService().recordCashPrize({
        ...(payload as { prize_amount: number }),
        userId: ctx.actorUserId,
      });
      return { success: true, prize };
    } catch (error) {
      return refusal(error, "Failed to record cash prize");
    }
  },
  mainRow: (r) => {
    const id = (r.prize as { id?: unknown } | undefined)?.id;
    return typeof id === "number" ? { table: "loto_cash_prizes", id } : null;
  },
};

const updateMetadata: OfflineBinding = {
  channel: "loto:update-metadata",
  run: (payload, ctx) => {
    const p = payload as { id: number; note?: string };
    const result = getLotoService().updateLotoMetadata(p.id, { note: p.note }, actorUsername(ctx.actorUserId));
    return result.success ? { success: true, data: result.entity } : { success: false, error: result.error };
  },
};

export const LOTO_BINDINGS: readonly OfflineBinding[] = [sell, update, cashPrize, updateMetadata];
