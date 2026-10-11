/**
 * Offline bindings — recharge + carrier lines family (LIRA-306 T085). Each
 * calls the SAME core service method its REST route calls
 * (`backend/src/api/recharge.ts`, `backend/src/api/carrierLines.ts`), with
 * the actor from the event (O-new-7) — a payload `userId` is overwritten.
 */
import { getRechargeService } from "../../services/RechargeService.js";
import { getCarrierLineService } from "../../services/CarrierLineService.js";
import type { RechargeData } from "../../repositories/RechargeRepository.js";
import type { RecordCarrierLineUsageInput, TopUpFromClientInput } from "../../validators/index.js";
import { actorUsername } from "./actor.js";
import type { BindingResult, OfflineBinding } from "./types.js";

/** POST /api/recharge/process → processRecharge({ ...body, userId }) */
const process: OfflineBinding = {
  channel: "recharge:process",
  run: (payload, ctx) =>
    getRechargeService().processRecharge({ ...(payload as unknown as RechargeData), userId: ctx.actorUserId }) as unknown as BindingResult,
};

/** POST /api/recharge/top-up-from-client → topUpFromClient({ ...body, userId }) */
const topUpFromClient: OfflineBinding = {
  channel: "recharge:top-up-from-client",
  run: (payload, ctx) =>
    getRechargeService().topUpFromClient({
      ...(payload as unknown as TopUpFromClientInput),
      userId: ctx.actorUserId,
    }) as unknown as BindingResult,
};

/** POST /api/recharge/update-metadata — `editedBy` = the actor's username. */
const updateMetadata: OfflineBinding = {
  channel: "recharge:update-metadata",
  run: (payload, ctx) => {
    const p = payload as { id: number; phone_number?: string; client_name?: string; note?: string };
    const result = getRechargeService().updateRechargeMetadata(
      p.id,
      { phone_number: p.phone_number, client_name: p.client_name, note: p.note },
      actorUsername(ctx.actorUserId),
    );
    return result.success ? { success: true, data: result.entity } : { success: false, error: result.error };
  },
};

/** POST /api/carrier-lines/record-usage → recordUsage(body, userId) */
const recordUsage: OfflineBinding = {
  channel: "carrier-lines:record-usage",
  run: (payload, ctx) =>
    getCarrierLineService().recordUsage(payload as unknown as RecordCarrierLineUsageInput, ctx.actorUserId) as unknown as BindingResult,
};

/** POST /api/carrier-lines/owed-deliveries/:id/mark-sent → markOwedDeliverySent(id, userId) */
const markOwedDeliverySent: OfflineBinding = {
  channel: "carrier-lines:mark-owed-delivery-sent",
  run: (payload, ctx) =>
    getCarrierLineService().markOwedDeliverySent(Number(payload.deliveryId), ctx.actorUserId) as unknown as BindingResult,
};

export const RECHARGE_BINDINGS: readonly OfflineBinding[] = [
  process,
  topUpFromClient,
  updateMetadata,
  recordUsage,
  markOwedDeliverySent,
];
