/**
 * Offline bindings — maintenance + warranty family (LIRA-306, T093). Each
 * calls the SAME core service the REST route calls, with the actor from the
 * event instead of the JWT (E2, O-new-7):
 *   - POST   /api/maintenance/jobs            → saveJob(body, userId)
 *   - DELETE /api/maintenance/jobs/:id        → deleteJob(id)
 *   - POST   /api/maintenance/update-metadata → updateMaintenanceMetadata(id, fields, username)
 *   - POST   /api/warranty/claims             → createClaim(body, {userId, role})
 *   - POST   /api/warranty/claims/:id/void    → voidClaim({claim_id}, {userId, role})
 * The warranty actor's ROLE comes from the user record (the JWT's claim on
 * the web), never the payload — REPLACE/REFUND/void stay admin-only.
 */
import {
  getMaintenanceService,
  type SaveJobParams,
} from "../../services/MaintenanceService.js";
import { getWarrantyService } from "../../services/WarrantyService.js";
import { getUserRepository } from "../../repositories/UserRepository.js";
import type {
  CreateWarrantyClaimData,
  VoidWarrantyClaimInput,
} from "../../validators/warranty.js";
import { actorUsername } from "./exchange.js";
import type { BindingResult, OfflineBinding } from "./types.js";

/** The warranty service's actor: the event's user and that user's role. */
function warrantyActor(userId: number): { userId: number; role: string } {
  const user = getUserRepository().findById(userId) as { role?: string } | null;
  return { userId, role: user?.role ?? "staff" };
}

const save: OfflineBinding = {
  channel: "maintenance:save",
  run: (payload, ctx) =>
    getMaintenanceService().saveJob(
      payload as unknown as SaveJobParams,
      ctx.actorUserId,
    ) as unknown as BindingResult,
  mainRow: (r) =>
    typeof r.id === "number" ? { table: "maintenance", id: r.id } : null,
};

const remove: OfflineBinding = {
  channel: "maintenance:delete",
  run: (payload) =>
    getMaintenanceService().deleteJob((payload as { id: number }).id),
};

const updateMetadata: OfflineBinding = {
  channel: "maintenance:update-metadata",
  run: (payload, ctx) => {
    const p = payload as {
      id: number;
      client_name?: string;
      device_name?: string;
      issue_description?: string;
      note?: string;
    };
    const result = getMaintenanceService().updateMaintenanceMetadata(
      p.id,
      {
        client_name: p.client_name,
        device_name: p.device_name,
        issue_description: p.issue_description,
        note: p.note,
      },
      actorUsername(ctx.actorUserId),
    );
    return result.success
      ? { success: true, data: result.entity }
      : { success: false, error: result.error };
  },
};

const claim: OfflineBinding = {
  channel: "warranty:claim",
  run: (payload, ctx) =>
    getWarrantyService().createClaim(
      payload as unknown as CreateWarrantyClaimData,
      warrantyActor(ctx.actorUserId),
    ) as unknown as BindingResult,
  mainRow: (r) => {
    const id = (r.data as { claim?: { id?: unknown } } | undefined)?.claim?.id;
    return typeof id === "number" ? { table: "warranty_claims", id } : null;
  },
};

const voidClaim: OfflineBinding = {
  channel: "warranty:void-claim",
  run: (payload, ctx) =>
    getWarrantyService().voidClaim(
      payload as unknown as VoidWarrantyClaimInput,
      warrantyActor(ctx.actorUserId),
    ) as unknown as BindingResult,
};

export const MAINTENANCE_BINDINGS: readonly OfflineBinding[] = [
  save,
  remove,
  updateMetadata,
  claim,
  voidClaim,
];
