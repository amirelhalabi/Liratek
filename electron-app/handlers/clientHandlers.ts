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
    clientLogger.debug({ name: client.full_name }, "Creating client");
    const result = clientService.createClient(
      {
        full_name: client.full_name,
        phone_number: client.phone_number,
        whatsapp_opt_in: client.whatsapp_opt_in,
        ...(client.notes != null ? { notes: client.notes } : {}),
      },
      auth.userId,
    );
    audit(event.sender.id, {
      action: "create",
      entity_type: "client",
      entity_id: String((result as any)?.id ?? ""),
      summary: `Created client "${client.full_name}"`,
    });
    return result;
  });

  // Update client
  ipcMain.handle("clients:update", (event, client: ClientData) => {
    const auth = requireRole(event.sender.id, ["admin", "staff"]);
    if (!auth.ok) return { success: false, error: auth.error };
    if (!client.id) {
      return { success: false, error: "Client ID required" };
    }
    const result = clientService.updateClient(
      client.id,
      {
        full_name: client.full_name,
        phone_number: client.phone_number,
        whatsapp_opt_in: client.whatsapp_opt_in,
        ...(client.notes != null ? { notes: client.notes } : {}),
      },
      auth.userId,
    );
    audit(event.sender.id, {
      action: "update",
      entity_type: "client",
      entity_id: String(client.id),
      summary: `Updated client "${client.full_name}"`,
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
