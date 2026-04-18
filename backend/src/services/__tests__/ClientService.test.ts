/**
 * ClientService Unit Tests
 *
 * Tests all business logic in ClientService with mocked repository.
 */

import { jest } from "@jest/globals";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getClientRepository: jest.fn(),
    ClientRepository: jest.fn(),
  };
});

import {
  ClientService,
  resetClientService,
  getClientService,
  ClientRepository,
  NotFoundError,
} from "@liratek/core";

describe("ClientService", () => {
  let service: ClientService;
  let mockRepo: jest.Mocked<ClientRepository>;

  beforeEach(() => {
    // Reset singleton
    resetClientService();

    // Create mock repository with all methods
    mockRepo = {
      findAllClients: jest.fn(),
      findById: jest.fn(),
      findByPhone: jest.fn(),
      search: jest.fn(),
      phoneExists: jest.fn(),
      createClient: jest.fn(),
      exists: jest.fn(),
      updateClientFull: jest.fn(),
      delete: jest.fn(),
      deleteClient: jest.fn(),
      hasSalesHistory: jest.fn(),
      getDebtBalance: jest.fn(),
      findClientsWithDebt: jest.fn(),
      findWhatsAppOptedIn: jest.fn(),
    } as unknown as jest.Mocked<ClientRepository>;

    // Inject mock via constructor
    service = new ClientService(mockRepo);
  });

  // ===========================================================================
  // Client Queries
  // ===========================================================================

  describe("getClients", () => {
    it("returns all clients without filter", () => {
      const mockClients = [
        { id: 1, full_name: "John Doe", phone_number: "123" },
        { id: 2, full_name: "Jane Doe", phone_number: "456" },
      ];
      mockRepo.findAllClients.mockReturnValue(mockClients as any);

      const result = service.getClients();

      expect(mockRepo.findAllClients).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(mockClients);
    });

    it("passes search term to repository", () => {
      mockRepo.findAllClients.mockReturnValue([]);

      service.getClients("john");

      expect(mockRepo.findAllClients).toHaveBeenCalledWith("john");
    });
  });

  describe("getClientById", () => {
    it("returns client when found", () => {
      const mockClient = { id: 1, full_name: "John Doe", phone_number: "123" };
      mockRepo.findById.mockReturnValue(mockClient as any);

      const result = service.getClientById(1);

      expect(mockRepo.findById).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockClient);
    });

    it("returns null when client not found", () => {
      mockRepo.findById.mockReturnValue(null);

      const result = service.getClientById(999);

      expect(result).toBeNull();
    });
  });

  describe("getClientByIdOrFail", () => {
    it("returns client when found", () => {
      const mockClient = { id: 1, full_name: "John Doe", phone_number: "123" };
      mockRepo.findById.mockReturnValue(mockClient as any);

      const result = service.getClientByIdOrFail(1);

      expect(result).toEqual(mockClient);
    });

    it("throws NotFoundError when client not found", () => {
      mockRepo.findById.mockReturnValue(null);

      expect(() => service.getClientByIdOrFail(999)).toThrow(NotFoundError);
    });
  });

  describe("getClientByPhone", () => {
    it("returns client when found", () => {
      const mockClient = { id: 1, full_name: "John Doe", phone_number: "123" };
      mockRepo.findByPhone.mockReturnValue(mockClient as any);

      const result = service.getClientByPhone("123");

      expect(mockRepo.findByPhone).toHaveBeenCalledWith("123");
      expect(result).toEqual(mockClient);
    });

    it("returns null for empty phone", () => {
      const result = service.getClientByPhone("");

      expect(mockRepo.findByPhone).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("trims whitespace from phone", () => {
      mockRepo.findByPhone.mockReturnValue(null);

      service.getClientByPhone("  123  ");

      expect(mockRepo.findByPhone).toHaveBeenCalledWith("123");
    });
  });

  describe("searchClients", () => {
    it("returns matching clients", () => {
      const mockClients = [
        { id: 1, full_name: "John Doe", phone_number: "123" },
      ];
      mockRepo.search.mockReturnValue(mockClients as any);

      const result = service.searchClients("john");

      expect(mockRepo.search).toHaveBeenCalledWith("john", undefined);
      expect(result).toEqual(mockClients);
    });

    it("returns empty array for empty search term", () => {
      const result = service.searchClients("");

      expect(mockRepo.search).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("passes limit option to repository", () => {
      mockRepo.search.mockReturnValue([]);

      service.searchClients("john", { limit: 10 });

      expect(mockRepo.search).toHaveBeenCalledWith("john", { limit: 10 });
    });
  });

  // ===========================================================================
  // Client CRUD
  // ===========================================================================

  describe("createClient", () => {
    it("creates client successfully", () => {
      mockRepo.phoneExists.mockReturnValue(false);
      mockRepo.createClient.mockReturnValue({ id: 1 });

      const result = service.createClient(
        {
          full_name: "John Doe",
          phone_number: "123456789",
        },
        1,
      );

      expect(result).toEqual({ success: true, id: 1 });
      expect(mockRepo.createClient).toHaveBeenCalledWith(
        {
          full_name: "John Doe",
          phone_number: "123456789",
          notes: undefined,
          whatsapp_opt_in: undefined,
        },
        1,
      );
    });

    it("returns error for missing name", () => {
      const result = service.createClient(
        {
          full_name: "",
          phone_number: "123",
        },
        1,
      );

      expect(result).toEqual({
        success: false,
        error: "Client name is required",
      });
      expect(mockRepo.createClient).not.toHaveBeenCalled();
    });

    it("returns error for missing phone", () => {
      const result = service.createClient(
        {
          full_name: "John",
          phone_number: "",
        },
        1,
      );

      expect(result).toEqual({
        success: false,
        error: "Phone number is required",
      });
    });

    it("returns error for duplicate phone", () => {
      mockRepo.phoneExists.mockReturnValue(true);

      const result = service.createClient(
        {
          full_name: "John",
          phone_number: "123",
        },
        1,
      );

      expect(result).toEqual({
        success: false,
        error: "Phone number already registered",
      });
    });

    it("handles repository error", () => {
      mockRepo.phoneExists.mockReturnValue(false);
      mockRepo.createClient.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.createClient(
        {
          full_name: "John",
          phone_number: "123",
        },
        1,
      );

      expect(result).toEqual({ success: false, error: "DB error" });
    });

    it("handles DUPLICATE_PHONE error code from repository", () => {
      mockRepo.phoneExists.mockReturnValue(false);
      const duplicateError = new Error("Duplicate phone") as any;
      duplicateError.code = "DUPLICATE_PHONE";
      mockRepo.createClient.mockImplementation(() => {
        throw duplicateError;
      });

      const result = service.createClient(
        {
          full_name: "John",
          phone_number: "123",
        },
        1,
      );

      expect(result).toEqual({
        success: false,
        error: "Phone number already registered",
      });
    });
  });

  describe("updateClient", () => {
    it("updates client successfully", () => {
      mockRepo.exists.mockReturnValue(true);
      mockRepo.phoneExists.mockReturnValue(false);
      mockRepo.updateClientFull.mockReturnValue(true);

      const result = service.updateClient(
        1,
        {
          full_name: "John Updated",
          phone_number: "123",
          notes: "Updated notes",
          whatsapp_opt_in: true,
        },
        1,
      );

      expect(result).toEqual({ success: true });
      expect(mockRepo.updateClientFull).toHaveBeenCalledWith(
        1,
        {
          full_name: "John Updated",
          phone_number: "123",
          notes: "Updated notes",
          whatsapp_opt_in: true,
        },
        1,
      );
    });

    it("returns error for missing client ID", () => {
      const result = service.updateClient(
        0,
        {
          full_name: "John",
          phone_number: "123",
          whatsapp_opt_in: false,
        },
        1,
      );

      expect(result).toEqual({ success: false, error: "Client ID required" });
    });

    it("returns error when client not found", () => {
      mockRepo.exists.mockReturnValue(false);

      const result = service.updateClient(
        999,
        {
          full_name: "John",
          phone_number: "123",
          whatsapp_opt_in: false,
        },
        1,
      );

      expect(result).toEqual({ success: false, error: "Client not found" });
    });

    it("returns error for duplicate phone", () => {
      mockRepo.exists.mockReturnValue(true);
      mockRepo.phoneExists.mockReturnValue(true);

      const result = service.updateClient(
        1,
        {
          full_name: "John",
          phone_number: "456",
          whatsapp_opt_in: false,
        },
        1,
      );

      expect(result).toEqual({
        success: false,
        error: "Phone number already in use by another client",
      });
    });

    it("handles DUPLICATE_PHONE error code from repository", () => {
      mockRepo.exists.mockReturnValue(true);
      mockRepo.phoneExists.mockReturnValue(false);
      const duplicateError = new Error("Duplicate phone") as any;
      duplicateError.code = "DUPLICATE_PHONE";
      mockRepo.updateClientFull.mockImplementation(() => {
        throw duplicateError;
      });

      const result = service.updateClient(
        1,
        {
          full_name: "John",
          phone_number: "456",
          whatsapp_opt_in: false,
        },
        1,
      );

      expect(result).toEqual({
        success: false,
        error: "Phone number already in use by another client",
      });
    });

    it("handles generic repository error", () => {
      mockRepo.exists.mockReturnValue(true);
      mockRepo.phoneExists.mockReturnValue(false);
      mockRepo.updateClientFull.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = service.updateClient(
        1,
        {
          full_name: "John",
          phone_number: "123",
          whatsapp_opt_in: false,
        },
        1,
      );

      expect(result).toEqual({ success: false, error: "Database error" });
    });
  });

  describe("deleteClient", () => {
    it("deletes client successfully", () => {
      mockRepo.hasSalesHistory.mockReturnValue(false);
      mockRepo.deleteClient.mockReturnValue(true);

      const result = service.deleteClient(1, 1);

      expect(result).toEqual({ success: true });
      expect(mockRepo.deleteClient).toHaveBeenCalledWith(1, 1);
    });

    it("returns error for missing client ID", () => {
      const result = service.deleteClient(0, 1);

      expect(result).toEqual({ success: false, error: "Client ID required" });
    });

    it("returns error when client has sales history", () => {
      mockRepo.hasSalesHistory.mockReturnValue(true);

      const result = service.deleteClient(1, 1);

      expect(result).toEqual({
        success: false,
        error: "Cannot delete client with existing sales history",
      });
      expect(mockRepo.deleteClient).not.toHaveBeenCalled();
    });

    it("handles repository error", () => {
      mockRepo.hasSalesHistory.mockReturnValue(false);
      mockRepo.deleteClient.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.deleteClient(1, 1);

      expect(result).toEqual({ success: false, error: "DB error" });
    });
  });

  // ===========================================================================
  // Debt & Financial Queries
  // ===========================================================================

  describe("getClientDebtBalance", () => {
    it("returns debt balance from repository", () => {
      mockRepo.getDebtBalance.mockReturnValue(1500);

      const result = service.getClientDebtBalance(1);

      expect(mockRepo.getDebtBalance).toHaveBeenCalledWith(1);
      expect(result).toBe(1500);
    });
  });

  describe("getClientsWithDebt", () => {
    it("returns clients with debt", () => {
      const mockClients = [
        { id: 1, full_name: "Debtor", phone_number: "123", debt_total: 500 },
      ];
      mockRepo.findClientsWithDebt.mockReturnValue(mockClients as any);

      const result = service.getClientsWithDebt();

      expect(mockRepo.findClientsWithDebt).toHaveBeenCalled();
      expect(result).toEqual(mockClients);
    });
  });

  describe("getWhatsAppOptedInClients", () => {
    it("returns opted-in clients", () => {
      const mockClients = [
        { id: 1, full_name: "John", phone_number: "123", whatsapp_opt_in: 1 },
      ];
      mockRepo.findWhatsAppOptedIn.mockReturnValue(mockClients as any);

      const result = service.getWhatsAppOptedInClients();

      expect(mockRepo.findWhatsAppOptedIn).toHaveBeenCalled();
      expect(result).toEqual(mockClients);
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("getClientService", () => {
    it("returns singleton instance", () => {
      resetClientService();

      const instance1 = getClientService();
      const instance2 = getClientService();

      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(ClientService);
    });

    it("creates new instance after reset", () => {
      const instance1 = getClientService();
      resetClientService();
      const instance2 = getClientService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
