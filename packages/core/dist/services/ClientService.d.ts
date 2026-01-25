/**
 * Client Service
 *
 * Business logic layer for client operations.
 * Uses ClientRepository for data access.
 *
 * This service encapsulates:
 * - Client CRUD operations
 * - Client search and lookup
 * - Debt balance queries
 * - Validation logic
 */
import { ClientRepository, type ClientEntity, type CreateClientData } from "../repositories/index.js";
export interface ClientResult {
    success: boolean;
    id?: number;
    error?: string;
}
export declare class ClientService {
    private clientRepo;
    constructor(clientRepo?: ClientRepository);
    /**
     * Get all clients with optional search filter
     */
    getClients(search?: string): ClientEntity[];
    /**
     * Get a single client by ID
     */
    getClientById(id: number): ClientEntity | null;
    /**
     * Get a client by ID, throw if not found
     */
    getClientByIdOrFail(id: number): ClientEntity;
    /**
     * Get a client by phone number
     */
    getClientByPhone(phone: string): ClientEntity | null;
    /**
     * Search clients by name or phone
     */
    searchClients(term: string, options?: {
        limit?: number;
    }): ClientEntity[];
    /**
     * Create a new client
     */
    createClient(data: CreateClientData): ClientResult;
    /**
     * Update an existing client
     */
    updateClient(id: number, data: {
        full_name: string;
        phone_number: string;
        notes?: string | null;
        whatsapp_opt_in: boolean | number;
    }): ClientResult;
    /**
     * Delete a client (checks for sales history first)
     */
    deleteClient(id: number): ClientResult;
    /**
     * Get client's current debt balance
     */
    getClientDebtBalance(clientId: number): number;
    /**
     * Get all clients with outstanding debt
     */
    getClientsWithDebt(): (ClientEntity & {
        debt_total: number;
    })[];
    /**
     * Get clients who opted in for WhatsApp notifications
     */
    getWhatsAppOptedInClients(): ClientEntity[];
}
export declare function getClientService(): ClientService;
/** Reset the singleton (for testing) */
export declare function resetClientService(): void;
