/**
 * Client IPC Handlers
 *
 * Thin wrapper over ClientService for IPC communication.
 * Handles: Authorization, IPC message routing to service
 */

import { ipcMain } from "electron";
import {
  getClientService,
  clientLogger,
  type ImportedClientData,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import { ClientCreateSchema, validatePayload } from "../schemas/index.js";

interface ClientData {
  id?: number;
  full_name: string;
  phone_number: string;
  notes?: string;
  whatsapp_opt_in: boolean | number;
}

export function registerClientHandlers(): void {
  const clientService = getClientService();

  // Get all clients (with search)
  ipcMain.handle("clients:get-all", (_event, search?: string) => {
    return clientService.getClients(search);
  });

  // Get single client
  ipcMain.handle("clients:get-one", (_event, id: number) => {
    return clientService.getClientById(id);
  });

  // Create client
  ipcMain.handle("clients:create", (event, client: ClientData) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(ClientCreateSchema, client);
    if (!v.ok) return { success: false, error: v.error };

    clientLogger.debug({ name: v.data.full_name }, "Creating client");
    const result = clientService.createClient(
      {
        full_name: v.data.full_name,
        phone_number: v.data.phone_number,
        whatsapp_opt_in: v.data.whatsapp_opt_in,
        ...(v.data.notes != null ? { notes: v.data.notes } : {}),
      },
      auth.userId,
    );
    audit(event.sender.id, {
      action: "create",
      entity_type: "client",
      entity_id: String((result as any)?.id ?? ""),
      summary: `Created client "${v.data.full_name}"`,
    });
    return result;
  });

  // Update client
  ipcMain.handle("clients:update", (event, client: ClientData) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(ClientCreateSchema, client);
    if (!v.ok) return { success: false, error: v.error };

    if (!v.data.id) {
      return { success: false, error: "Client ID required" };
    }
    const result = clientService.updateClient(
      v.data.id,
      {
        full_name: v.data.full_name,
        phone_number: v.data.phone_number,
        whatsapp_opt_in: v.data.whatsapp_opt_in,
        ...(v.data.notes != null ? { notes: v.data.notes } : {}),
      },
      auth.userId,
    );
    audit(event.sender.id, {
      action: "update",
      entity_type: "client",
      entity_id: String(v.data.id),
      summary: `Updated client "${v.data.full_name}"`,
    });
    return result;
  });

  // Delete client (admin only)
  ipcMain.handle("clients:delete", (event, id: number) => {
    // Auth check
    const auth = requireRole(event.sender.id, ["admin"]);
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    clientLogger.info({ clientId: id }, "Deleting client");
    const result = clientService.deleteClient(id, auth.userId);
    audit(event.sender.id, {
      action: "delete",
      entity_type: "client",
      entity_id: String(id),
      summary: `Deleted client #${id}`,
    });
    return result;
  });

  // Import clients & debts from Excel (admin only)
  ipcMain.handle(
    "clients:import-debts",
    (event, data: ImportedClientData[]) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      clientLogger.info(
        { clientCount: data.length },
        "Starting Excel debt import",
      );

      try {
        const result = clientService.importClientsWithDebts(data, auth.userId);
        audit(event.sender.id, {
          action: "create",
          entity_type: "client_import",
          summary: `Imported ${result.clientsCreated} clients, ${result.entriesImported} debt entries`,
        });
        return { success: true, result };
      } catch (error) {
        clientLogger.error({ error }, "Excel debt import failed");
        return {
          success: false,
          error: error instanceof Error ? error.message : "Import failed",
        };
      }
    },
  );
}
