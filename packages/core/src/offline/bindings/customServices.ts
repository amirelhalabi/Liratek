/**
 * Offline bindings — custom-services family (LIRA-306, T095). Each calls the
 * SAME core service the REST route calls (backend/src/api/customServices.ts):
 *   - POST   /api/custom-services                 → addService(body)
 *   - DELETE /api/custom-services/:id             → deleteService(id)
 *   - POST   /api/custom-services/update-metadata → updateCustomServiceMetadata(id, {…}, username)
 *   - POST   /api/custom-services/fulfillment     → advanceFulfillmentStatus(id, status)
 *   - POST   /api/custom-services/work-status     → setWorkStatus(id, status)
 *
 * Actor: `addService`/`deleteService` take no user on either transport today
 * (creator = the repository's fallback admin; the void is credited to the
 * row's creator) — kept for parity. update-metadata stamps the event actor's
 * username, never a payload field.
 */
import { getCustomServiceService } from "../../services/CustomServiceService.js";
import type { CreateCustomServiceInput } from "../../validators/customService.js";
import type { FulfillmentStatus } from "../../utils/insuranceFulfillment.js";
import type { WorkStatus } from "../../utils/customServiceWorkStatus.js";
import { actorUsername } from "./exchange.js";
import type { BindingResult, OfflineBinding } from "./types.js";

const add: OfflineBinding = {
  channel: "custom-services:add",
  run: (payload) =>
    getCustomServiceService().addService(payload as unknown as CreateCustomServiceInput) as unknown as BindingResult,
  mainRow: (r) => (typeof r.id === "number" ? { table: "custom_services", id: r.id } : null),
};

const remove: OfflineBinding = {
  channel: "custom-services:delete",
  run: (payload) => getCustomServiceService().deleteService((payload as { id: number }).id),
};

const updateMetadata: OfflineBinding = {
  channel: "custom-services:update-metadata",
  run: (payload, ctx) => {
    const p = payload as {
      id: number;
      description?: string;
      client_name?: string;
      phone_number?: string;
      note?: string;
      category?: string;
    };
    const result = getCustomServiceService().updateCustomServiceMetadata(
      p.id,
      {
        description: p.description,
        client_name: p.client_name,
        phone_number: p.phone_number,
        note: p.note,
        category: p.category,
      },
      actorUsername(ctx.actorUserId),
    );
    return result.success ? { success: true, data: result.entity } : { success: false, error: result.error };
  },
};

const advanceFulfillment: OfflineBinding = {
  channel: "custom-services:advance-fulfillment",
  run: (payload) => {
    const p = payload as { id: number; fulfillment_status: FulfillmentStatus };
    const result = getCustomServiceService().advanceFulfillmentStatus(p.id, p.fulfillment_status);
    return result.success ? { success: true, data: result.entity } : (result as unknown as BindingResult);
  },
};

const setWorkStatus: OfflineBinding = {
  channel: "custom-services:set-work-status",
  run: (payload) => {
    const p = payload as { id: number; work_status: WorkStatus };
    const result = getCustomServiceService().setWorkStatus(p.id, p.work_status);
    return result.success ? { success: true, data: result.entity } : (result as unknown as BindingResult);
  },
};

// LIRA-360 — "Won't renew"; the actor is the event's, never the payload's.
const dismissInsuranceRenewal: OfflineBinding = {
  channel: "custom-services:dismiss-insurance-renewal",
  run: (payload, ctx) =>
    getCustomServiceService().dismissInsuranceRenewal(
      (payload as { id: number }).id,
      actorUsername(ctx.actorUserId),
    ),
};

export const CUSTOM_SERVICES_BINDINGS: readonly OfflineBinding[] = [
  add,
  remove,
  updateMetadata,
  advanceFulfillment,
  setWorkStatus,
  dismissInsuranceRenewal,
];
