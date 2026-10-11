/**
 * Offline bindings — clients (LIRA-306 US1). Same service and the same field
 * mapping as the desktop IPC handlers (`clientHandlers.ts`), which use the
 * lifted `clientWriteSchema`; the web route calls the same
 * `ClientService.createClient/updateClient`.
 */
import { getClientService } from "../../services/ClientService.js";
import type { BindingResult, OfflineBinding } from "./types.js";

interface ClientPayload {
  id?: number;
  full_name: string;
  phone_number: string;
  notes?: string | null;
  whatsapp_opt_in: boolean | 0 | 1;
}

function fields(p: ClientPayload) {
  return {
    full_name: p.full_name,
    phone_number: p.phone_number,
    whatsapp_opt_in: p.whatsapp_opt_in,
    ...(p.notes != null ? { notes: p.notes } : {}),
  };
}

/**
 * Replay-only rule (FR-030, O-new-4): a customer created offline whose phone
 * already exists in the shop (created online, or by another PC, meanwhile)
 * is LINKED to the existing customer — the engine maps the PC's client to
 * it (`linked_existing`) and notes it — instead of refused. Only on replay;
 * the web keeps refusing a duplicate phone.
 */
const clientsCreate: OfflineBinding = {
  channel: "clients:create",
  run: (payload, ctx) => {
    const p = payload as unknown as ClientPayload;
    const result = getClientService().createClient(fields(p) as never, ctx.actorUserId) as unknown as BindingResult;
    if (result.success) return result;
    const existing = p.phone_number ? getClientService().getClientByPhone(p.phone_number.trim()) : null;
    if (!existing) return result;
    return {
      success: true,
      id: existing.id,
      offline: {
        linkExisting: { table: "clients", id: existing.id },
        notes: [
          {
            kind: "customer_linked",
            details: { phone: p.phone_number, offlineName: p.full_name, existingId: existing.id, existingName: existing.full_name },
          },
        ],
      },
    };
  },
  mainRow: (r) => (typeof r.id === "number" ? { table: "clients", id: r.id } : null),
};

const clientsUpdate: OfflineBinding = {
  channel: "clients:update",
  run: (payload, ctx) => {
    const p = payload as unknown as ClientPayload;
    if (!p.id) return { success: false, error: "Client ID required" };
    return getClientService().updateClient(p.id, fields(p) as never, ctx.actorUserId) as unknown as BindingResult;
  },
};

export const CLIENT_BINDINGS: readonly OfflineBinding[] = [clientsCreate, clientsUpdate];
