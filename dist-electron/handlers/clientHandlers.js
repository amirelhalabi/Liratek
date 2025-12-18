"use strict";
/**
 * Client IPC Handlers
 *
 * Thin wrapper over ClientService for IPC communication.
 * Handles: Authorization, IPC message routing to service
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClientHandlers = registerClientHandlers;
const electron_1 = require("electron");
const services_1 = require("../services");
const session_1 = require("../session");
function registerClientHandlers() {
    const clientService = (0, services_1.getClientService)();
    // Get all clients (with search)
    electron_1.ipcMain.handle('clients:get-all', (_event, search) => {
        return clientService.getClients(search);
    });
    // Get single client
    electron_1.ipcMain.handle('clients:get-one', (_event, id) => {
        return clientService.getClientById(id);
    });
    // Create client
    electron_1.ipcMain.handle('clients:create', (_event, client) => {
        return clientService.createClient({
            full_name: client.full_name,
            phone_number: client.phone_number,
            notes: client.notes,
            whatsapp_opt_in: client.whatsapp_opt_in,
        });
    });
    // Update client
    electron_1.ipcMain.handle('clients:update', (_event, client) => {
        if (!client.id) {
            return { success: false, error: 'Client ID required' };
        }
        return clientService.updateClient(client.id, {
            full_name: client.full_name,
            phone_number: client.phone_number,
            notes: client.notes,
            whatsapp_opt_in: client.whatsapp_opt_in,
        });
    });
    // Delete client (admin only)
    electron_1.ipcMain.handle('clients:delete', (event, id) => {
        // Auth check
        const auth = (0, session_1.requireRole)(event.sender.id, ['admin']);
        if (!auth.ok) {
            return { success: false, error: auth.error };
        }
        return clientService.deleteClient(id);
    });
}
