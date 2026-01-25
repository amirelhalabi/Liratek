/**
 * ClientHandlers Unit Tests
 *
 * Tests IPC handler registration and delegation to ClientService.
 */

import { ipcMain } from "electron";
import { registerClientHandlers } from "../clientHandlers";
import { getClientService } from "../../services";
import { requireRole } from "../../session";

// Mock dependencies
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
  },
}));

jest.mock("../../services", () => ({
  getClientService: jest.fn(),
  resetClientService: jest.fn(),
}));

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

describe("ClientHandlers", () => {
  let mockService: any;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    // Capture registered handlers
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    // Mock service
    mockService = {
      getClients: jest.fn().mockReturnValue([{ id: 1, full_name: "John Doe" }]),
      getClientById: jest
        .fn()
        .mockReturnValue({ id: 1, full_name: "John Doe" }),
      createClient: jest.fn().mockReturnValue({ success: true, id: 1 }),
      updateClient: jest.fn().mockReturnValue({ success: true }),
      deleteClient: jest.fn().mockReturnValue({ success: true }),
    };
    (getClientService as jest.Mock).mockReturnValue(mockService);

    // Default: user is admin
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 1 });

    registerClientHandlers();
  });

  describe("Handler Registration", () => {
    it("should register all client handlers", () => {
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "clients:get-all",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "clients:get-one",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "clients:create",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "clients:update",
        expect.any(Function),
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        "clients:delete",
        expect.any(Function),
      );
    });
  });

  describe("clients:get-all", () => {
    it("should get all clients without search", async () => {
      const handler = handlers.get("clients:get-all")!;
      const result = await handler({}, undefined);

      expect(mockService.getClients).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([{ id: 1, full_name: "John Doe" }]);
    });

    it("should get clients with search filter", async () => {
      const handler = handlers.get("clients:get-all")!;
      await handler({}, "john");

      expect(mockService.getClients).toHaveBeenCalledWith("john");
    });
  });

  describe("clients:get-one", () => {
    it("should get client by ID", async () => {
      const handler = handlers.get("clients:get-one")!;
      const result = await handler({}, 1);

      expect(mockService.getClientById).toHaveBeenCalledWith(1);
      expect(result).toEqual({ id: 1, full_name: "John Doe" });
    });
  });

  describe("clients:create", () => {
    it("should create a client", async () => {
      const handler = handlers.get("clients:create")!;
      const clientData = {
        full_name: "Jane Doe",
        phone_number: "123456789",
        notes: "Test client",
        whatsapp_opt_in: true,
      };

      const result = await handler({}, clientData);

      expect(mockService.createClient).toHaveBeenCalledWith({
        full_name: "Jane Doe",
        phone_number: "123456789",
        notes: "Test client",
        whatsapp_opt_in: true,
      });
      expect(result).toEqual({ success: true, id: 1 });
    });
  });

  describe("clients:update", () => {
    it("should update a client", async () => {
      const handler = handlers.get("clients:update")!;
      const clientData = {
        id: 1,
        full_name: "John Updated",
        phone_number: "987654321",
        notes: "Updated",
        whatsapp_opt_in: false,
      };

      const result = await handler({}, clientData);

      expect(mockService.updateClient).toHaveBeenCalledWith(1, {
        full_name: "John Updated",
        phone_number: "987654321",
        notes: "Updated",
        whatsapp_opt_in: false,
      });
      expect(result).toEqual({ success: true });
    });

    it("should return error when client ID is missing", async () => {
      const handler = handlers.get("clients:update")!;
      const result = await handler({}, { full_name: "Test" });

      expect(result).toEqual({ success: false, error: "Client ID required" });
      expect(mockService.updateClient).not.toHaveBeenCalled();
    });
  });

  describe("clients:delete", () => {
    it("should delete a client when admin", async () => {
      const handler = handlers.get("clients:delete")!;
      const result = await handler({ sender: { id: 1 } }, 1);

      expect(requireRole).toHaveBeenCalledWith(1, ["admin"]);
      expect(mockService.deleteClient).toHaveBeenCalledWith(1);
      expect(result).toEqual({ success: true });
    });

    it("should reject non-admin users", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: false,
        error: "Admin required",
      });

      const handler = handlers.get("clients:delete")!;
      const result = await handler({ sender: { id: 1 } }, 1);

      expect(result).toEqual({ success: false, error: "Admin required" });
      expect(mockService.deleteClient).not.toHaveBeenCalled();
    });
  });
});
