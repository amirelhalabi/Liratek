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

import {
  ClientRepository,
  getClientRepository,
  type ClientEntity,
  type CreateClientData,
} from "../database/repositories";
import { NotFoundError, getRepoConstraintCode } from "../utils/errors";

// =============================================================================
// Types
// =============================================================================

export interface ClientResult {
  success: boolean;
  id?: number;
  error?: string;
}

// =============================================================================
// Client Service Class
// =============================================================================

export class ClientService {
  private clientRepo: ClientRepository;

  constructor(clientRepo?: ClientRepository) {
    this.clientRepo = clientRepo ?? getClientRepository();
  }

  // ---------------------------------------------------------------------------
  // Client Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all clients with optional search filter
   */
  getClients(search?: string): ClientEntity[] {
    return this.clientRepo.findAllClients(search);
  }

  /**
   * Get a single client by ID
   */
  getClientById(id: number): ClientEntity | null {
    return this.clientRepo.findById(id);
  }

  /**
   * Get a client by ID, throw if not found
   */
  getClientByIdOrFail(id: number): ClientEntity {
    const client = this.clientRepo.findById(id);
    if (!client) {
      throw new NotFoundError("Client", id);
    }
    return client;
  }

  /**
   * Get a client by phone number
   */
  getClientByPhone(phone: string): ClientEntity | null {
    if (!phone?.trim()) {
      return null;
    }
    return this.clientRepo.findByPhone(phone.trim());
  }

  /**
   * Search clients by name or phone
   */
  searchClients(term: string, options?: { limit?: number }): ClientEntity[] {
    if (!term?.trim()) {
      return [];
    }
    return this.clientRepo.search(term.trim(), options);
  }

  // ---------------------------------------------------------------------------
  // Client CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a new client
   */
  createClient(data: CreateClientData): ClientResult {
    // Validate required fields
    if (!data.full_name?.trim()) {
      return { success: false, error: "Client name is required" };
    }
    if (!data.phone_number?.trim()) {
      return { success: false, error: "Phone number is required" };
    }

    // Check for duplicate phone
    if (this.clientRepo.phoneExists(data.phone_number.trim())) {
      return { success: false, error: "Phone number already registered" };
    }

    try {
      const createData = {
        full_name: data.full_name.trim(),
        phone_number: data.phone_number.trim(),
        ...(data.whatsapp_opt_in != null
          ? { whatsapp_opt_in: data.whatsapp_opt_in }
          : {}),
        ...(data.notes != null ? { notes: data.notes.trim() } : {}),
      };

      const result = this.clientRepo.createClient(createData);
      return { success: true, id: result.id };
    } catch (error) {
      const repoCode = getRepoConstraintCode(error);
      if (repoCode === "DUPLICATE_PHONE") {
        return { success: false, error: "Phone number already registered" };
      }
      console.error("Create client error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update an existing client
   */
  updateClient(
    id: number,
    data: {
      full_name: string;
      phone_number: string;
      notes?: string | null;
      whatsapp_opt_in: boolean | number;
    },
  ): ClientResult {
    if (!id) {
      return { success: false, error: "Client ID required" };
    }

    // Check if client exists
    if (!this.clientRepo.exists(id)) {
      return { success: false, error: "Client not found" };
    }

    // Check for duplicate phone (excluding this client)
    if (this.clientRepo.phoneExists(data.phone_number, id)) {
      return {
        success: false,
        error: "Phone number already in use by another client",
      };
    }

    try {
      this.clientRepo.updateClientFull(id, {
        full_name: data.full_name,
        phone_number: data.phone_number,
        whatsapp_opt_in: data.whatsapp_opt_in,
        ...(data.notes != null ? { notes: data.notes } : {}),
      });
      return { success: true };
    } catch (error) {
      const repoCode = getRepoConstraintCode(error);
      if (repoCode === "DUPLICATE_PHONE") {
        return {
          success: false,
          error: "Phone number already in use by another client",
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a client (checks for sales history first)
   */
  deleteClient(id: number): ClientResult {
    if (!id) {
      return { success: false, error: "Client ID required" };
    }

    // Check for existing sales
    if (this.clientRepo.hasSalesHistory(id)) {
      return {
        success: false,
        error: "Cannot delete client with existing sales history",
      };
    }

    try {
      this.clientRepo.delete(id);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Debt & Financial Queries
  // ---------------------------------------------------------------------------

  /**
   * Get client's current debt balance
   */
  getClientDebtBalance(clientId: number): number {
    return this.clientRepo.getDebtBalance(clientId);
  }

  /**
   * Get all clients with outstanding debt
   */
  getClientsWithDebt(): (ClientEntity & { debt_total: number })[] {
    return this.clientRepo.findClientsWithDebt();
  }

  /**
   * Get clients who opted in for WhatsApp notifications
   */
  getWhatsAppOptedInClients(): ClientEntity[] {
    return this.clientRepo.findWhatsAppOptedIn();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let clientServiceInstance: ClientService | null = null;

export function getClientService(): ClientService {
  if (!clientServiceInstance) {
    clientServiceInstance = new ClientService();
  }
  return clientServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetClientService(): void {
  clientServiceInstance = null;
}
