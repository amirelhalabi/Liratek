/**
 * Client Repository
 *
 * Handles all database operations for clients.
 * Extends BaseRepository for standard CRUD operations.
 *
 * Note: The clients table doesn't have is_active column, so soft delete is not used.
 */
import { BaseRepository, type FindOptions, type PaginatedResult } from "./BaseRepository.js";
export interface ClientEntity {
    id: number;
    full_name: string;
    phone_number: string;
    notes: string | null;
    whatsapp_opt_in: number;
    created_at: string;
}
export interface CreateClientData {
    full_name: string;
    phone_number: string;
    notes?: string;
    whatsapp_opt_in?: boolean | number;
}
export interface UpdateClientData {
    full_name?: string;
    phone_number?: string;
    notes?: string;
    whatsapp_opt_in?: boolean | number;
}
export declare class ClientRepository extends BaseRepository<ClientEntity> {
    constructor();
    /**
     * Get all clients with optional search filter
     */
    findAllClients(search?: string): ClientEntity[];
    /**
     * Get paginated clients with search filter
     */
    findClientsPaginated(options?: FindOptions & {
        search?: string;
    }): PaginatedResult<ClientEntity>;
    /**
     * Find client by phone number
     */
    findByPhone(phoneNumber: string): ClientEntity | null;
    /**
     * Check if phone number already exists
     */
    phoneExists(phoneNumber: string, excludeId?: number): boolean;
    /**
     * Create a new client
     */
    createClient(data: CreateClientData): {
        id: number;
    };
    /**
     * Update an existing client
     */
    updateClient(id: number, data: UpdateClientData): boolean;
    /**
     * Update client with all fields explicitly (for handler compatibility)
     */
    updateClientFull(id: number, data: {
        full_name: string;
        phone_number: string;
        notes?: string | null;
        whatsapp_opt_in: boolean | number;
    }): boolean;
    /**
     * Check if client has sales history (used before hard delete)
     */
    hasSalesHistory(id: number): boolean;
    /**
     * Delete client (hard delete) - checks for sales history first
     */
    deleteClient(id: number): boolean;
    /**
     * Search clients by name or phone
     */
    search(term: string, options?: {
        limit?: number;
    }): ClientEntity[];
    /**
     * Get client debt balance
     */
    getDebtBalance(clientId: number): number;
    /**
     * Get clients with outstanding debt
     */
    findClientsWithDebt(): (ClientEntity & {
        debt_total: number;
    })[];
    /**
     * Get clients who have opted in for WhatsApp
     */
    findWhatsAppOptedIn(): ClientEntity[];
}
export declare function getClientRepository(): ClientRepository;
/** Reset the singleton (for testing) */
export declare function resetClientRepository(): void;
