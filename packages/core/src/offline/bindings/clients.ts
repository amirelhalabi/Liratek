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

const clientsCreate: OfflineBinding = {
  channel: "clients:create",
  run: (payload, ctx) =>
    getClientService().createClient(fields(payload as unknown as ClientPayload) as never, ctx.actorUserId) as unknown as BindingResult,
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
