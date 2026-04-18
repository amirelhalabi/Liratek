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
  getDebtRepository,
  type ClientEntity,
  type CreateClientData,
} from "../repositories/index.js";
import { NotFoundError, getRepoConstraintCode } from "../utils/errors.js";
import { clientLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface ClientResult {
  success: boolean;
  id?: number;
  error?: string;
}

/** A single debt/payment entry from the Excel import */
export interface ImportedDebtEntry {
  date: string | null;
  amount_usd: number;
  amount_lbp: number;
  description: string;
  type: "debt" | "payment";
}

/** A client with their debt entries from the Excel import */
export interface ImportedClientData {
  name: string;
  phone: string;
  entries: ImportedDebtEntry[];
}

/** Result of the bulk import */
export interface ImportResult {
  clientsCreated: number;
  clientsSkipped: number;
  clientsDiscarded: number;
  entriesImported: number;
  errors: string[];
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
  createClient(data: CreateClientData, userId: number): ClientResult {
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

      const result = this.clientRepo.createClient(createData, userId);
      return { success: true, id: result.id };
    } catch (error) {
      const repoCode = getRepoConstraintCode(error);
      if (repoCode === "DUPLICATE_PHONE") {
        return { success: false, error: "Phone number already registered" };
      }
      clientLogger.error({ error, data }, "Create client error");
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
    userId: number,
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
      this.clientRepo.updateClientFull(
        id,
        {
          full_name: data.full_name,
          phone_number: data.phone_number,
          whatsapp_opt_in: data.whatsapp_opt_in,
          ...(data.notes != null ? { notes: data.notes } : {}),
        },
        userId,
      );
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
  deleteClient(id: number, userId: number): ClientResult {
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
      this.clientRepo.deleteClient(id, userId);
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

  // ---------------------------------------------------------------------------
  // Bulk Import from Excel
  // ---------------------------------------------------------------------------

  /**
   * Import clients and their debt history from parsed Excel data.
   * - Creates clients that don't exist yet (matched by phone)
   * - Skips clients without a phone number (logs warning)
   * - Inserts debt_ledger entries for each client's history
   */
  importClientsWithDebts(
    data: ImportedClientData[],
    userId: number,
  ): ImportResult {
    const debtRepo = getDebtRepository();
    const result: ImportResult = {
      clientsCreated: 0,
      clientsSkipped: 0,
      clientsDiscarded: 0,
      entriesImported: 0,
      errors: [],
    };

    for (const clientData of data) {
      const name = clientData.name?.trim();
      const phone = clientData.phone?.trim();

      // Discard clients without phone
      if (!phone) {
        clientLogger.warn(
          { clientName: name },
          `DISCARDED: Client "${name}" has no phone number — skipping`,
        );
        result.clientsDiscarded++;
        continue;
      }

      // Discard clients without name
      if (!name) {
        clientLogger.warn(
          { phone },
          `DISCARDED: Client with phone "${phone}" has no name — skipping`,
        );
        result.clientsDiscarded++;
        continue;
      }

      try {
        // Find or create client by phone
        let client = this.clientRepo.findByPhone(phone);
        if (client) {
          clientLogger.info(
            { clientId: client.id, name },
            `Client "${name}" already exists (phone: ${phone}) — importing entries only`,
          );
          result.clientsSkipped++;
        } else {
          const createResult = this.clientRepo.createClient(
            { full_name: name, phone_number: phone },
            userId,
          );
          client = this.clientRepo.findById(createResult.id) ?? null;
          if (!client) {
            result.errors.push(`Failed to create client "${name}"`);
            continue;
          }
          clientLogger.info(
            { clientId: client.id, name },
            `Created client "${name}" (phone: ${phone})`,
          );
          result.clientsCreated++;
        }

        // Import debt entries
        for (const entry of clientData.entries) {
          try {
            const isPayment = entry.type === "payment";
            debtRepo.insertRawEntry({
              client_id: client.id,
              transaction_type: isPayment ? "Repayment" : "Imported Debt",
              amount_usd: isPayment ? -entry.amount_usd : entry.amount_usd,
              amount_lbp: isPayment ? -entry.amount_lbp : entry.amount_lbp,
              note: entry.description || null,
              created_by: userId,
              created_at: entry.date || undefined,
            });
            result.entriesImported++;
          } catch (entryError) {
            const msg = `Failed to import entry for "${name}": ${(entryError as Error).message}`;
            clientLogger.error({ error: entryError, name }, msg);
            result.errors.push(msg);
          }
        }
      } catch (clientError) {
        const msg = `Failed to process client "${name}": ${(clientError as Error).message}`;
        clientLogger.error({ error: clientError, name }, msg);
        result.errors.push(msg);
      }
    }

    clientLogger.info(
      {
        created: result.clientsCreated,
        skipped: result.clientsSkipped,
        discarded: result.clientsDiscarded,
        entries: result.entriesImported,
        errors: result.errors.length,
      },
      "Excel import completed",
    );

    return result;
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
