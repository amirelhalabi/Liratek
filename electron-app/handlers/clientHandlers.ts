/**
 * Client IPC Handlers
 *
 * Thin wrapper over ClientService for IPC communication.
 * Handles: Authorization, IPC message routing to service
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getClientService } from "../services/index.js";
import { requireRole } from "../session.js";
import { clientLogger } from "../utils/logger.js";

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
  ipcMain.handle("clients:create", (_event, client: ClientData) => {
    clientLogger.debug({ name: client.full_name }, "Creating client");
    return clientService.createClient({
      full_name: client.full_name,
      phone_number: client.phone_number,
      whatsapp_opt_in: client.whatsapp_opt_in,
      ...(client.notes != null ? { notes: client.notes } : {}),
    });
  });

  // Update client
  ipcMain.handle("clients:update", (_event, client: ClientData) => {
    if (!client.id) {
      return { success: false, error: "Client ID required" };
    }
    return clientService.updateClient(client.id, {
      full_name: client.full_name,
      phone_number: client.phone_number,
      whatsapp_opt_in: client.whatsapp_opt_in,
      ...(client.notes != null ? { notes: client.notes } : {}),
    });
  });

  // Delete client (admin only)
  ipcMain.handle("clients:delete", (event: IpcMainInvokeEvent, id: number) => {
    // Auth check
    const auth = requireRole(event.sender.id, ["admin"]);
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    clientLogger.info({ clientId: id }, "Deleting client");
    return clientService.deleteClient(id);
  });
}
