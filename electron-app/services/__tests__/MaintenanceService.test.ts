/**
 * MaintenanceService Unit Tests
 */

import { MaintenanceService, SaveJobParams } from "../MaintenanceService";
import { MaintenanceRepository } from "@liratek/core";

// Mock the repository
jest.mock("@liratek/core", () => ({
  ...jest.requireActual("@liratek/core"),
  MaintenanceRepository: jest.fn(),
}));

describe("MaintenanceService", () => {
  let service: MaintenanceService;
  let mockRepo: jest.Mocked<MaintenanceRepository>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock repository
    mockRepo = {
      withTransaction: jest.fn((fn: () => unknown) => fn()),
      findOrCreateClient: jest.fn(),
      createJob: jest.fn(),
      updateJob: jest.fn(),
      getJobs: jest.fn(),
      deleteJob: jest.fn(),
      logActivity: jest.fn(),
    } as unknown as jest.Mocked<MaintenanceRepository>;

    // Make the constructor return our mock
    (MaintenanceRepository as jest.Mock).mockImplementation(() => mockRepo);

    service = new MaintenanceService();
  });

  // ===========================================================================
  // saveJob Tests
  // ===========================================================================

  describe("saveJob", () => {
    describe("creating new jobs", () => {
      it("should create a new job when no id is provided", () => {
        const params: SaveJobParams = {
          device_name: "iPhone 14",
          issue_description: "Cracked screen",
          price_usd: 150,
          status: "In Progress",
        };

        mockRepo.createJob.mockReturnValue(1);

        const result = service.saveJob(params);

        expect(result).toEqual({ success: true, id: 1 });
        expect(mockRepo.createJob).toHaveBeenCalledWith(
          expect.objectContaining({
            device_name: "iPhone 14",
            issue_description: "Cracked screen",
            price_usd: 150,
            status: "In Progress",
          }),
        );
        expect(mockRepo.logActivity).toHaveBeenCalledWith(
          1,
          "Maintenance Job Created",
          expect.objectContaining({
            drawer: "General",
            device: "iPhone 14",
            price_usd: 150,
          }),
        );
      });

      it("should auto-create client if name provided but no id", () => {
        const params: SaveJobParams = {
          client_name: "John Doe",
          client_phone: "1234567890",
          device_name: "Samsung S23",
          price_usd: 100,
        };

        mockRepo.findOrCreateClient.mockReturnValue(5);
        mockRepo.createJob.mockReturnValue(2);

        const result = service.saveJob(params);

        expect(result).toEqual({ success: true, id: 2 });
        expect(mockRepo.findOrCreateClient).toHaveBeenCalledWith(
          "John Doe",
          "1234567890",
        );
        expect(mockRepo.createJob).toHaveBeenCalledWith(
          expect.objectContaining({
            client_id: 5,
            client_name: "John Doe",
            device_name: "Samsung S23",
          }),
        );
      });

      it("should handle client auto-creation failure gracefully", () => {
        const params: SaveJobParams = {
          client_name: "Jane Doe",
          device_name: "Pixel 7",
          price_usd: 80,
        };

        mockRepo.findOrCreateClient.mockImplementation(() => {
          throw new Error("Database error");
        });
        mockRepo.createJob.mockReturnValue(3);

        const result = service.saveJob(params);

        // Should still succeed with null client_id
        expect(result).toEqual({ success: true, id: 3 });
        expect(mockRepo.createJob).toHaveBeenCalledWith(
          expect.objectContaining({
            client_id: null,
            device_name: "Pixel 7",
          }),
        );
      });

      it("should use client_id when provided", () => {
        const params: SaveJobParams = {
          client_id: 10,
          client_name: "Existing Client",
          device_name: "OnePlus 11",
          price_usd: 120,
        };

        mockRepo.createJob.mockReturnValue(4);

        const result = service.saveJob(params);

        expect(result).toEqual({ success: true, id: 4 });
        expect(mockRepo.findOrCreateClient).not.toHaveBeenCalled();
        expect(mockRepo.createJob).toHaveBeenCalledWith(
          expect.objectContaining({
            client_id: 10,
          }),
        );
      });
    });

    describe("updating existing jobs", () => {
      it("should update an existing job when id is provided", () => {
        const params: SaveJobParams = {
          id: 1,
          device_name: "iPhone 14 Pro",
          price_usd: 200,
          status: "In Progress",
        };

        const result = service.saveJob(params);

        expect(result).toEqual({ success: true, id: 1 });
        expect(mockRepo.updateJob).toHaveBeenCalledWith(
          1,
          expect.objectContaining({
            device_name: "iPhone 14 Pro",
            price_usd: 200,
          }),
        );
        expect(mockRepo.createJob).not.toHaveBeenCalled();
      });

      it("should log activity when job is delivered and paid", () => {
        const params: SaveJobParams = {
          id: 1,
          device_name: "iPhone 14 Pro",
          final_amount_usd: 200,
          status: "Delivered_Paid",
        };

        const result = service.saveJob(params);

        expect(result).toEqual({ success: true, id: 1 });
        expect(mockRepo.logActivity).toHaveBeenCalledWith(
          1,
          "Maintenance Job Completed",
          expect.objectContaining({
            drawer: "General",
            device: "iPhone 14 Pro",
            amount_usd: 200,
            status: "Delivered_Paid",
          }),
        );
      });

      it("should log activity when job is delivered", () => {
        const params: SaveJobParams = {
          id: 2,
          device_name: "Samsung Tab",
          final_amount_usd: 50,
          status: "Delivered",
        };

        const result = service.saveJob(params);

        expect(result).toEqual({ success: true, id: 2 });
        expect(mockRepo.logActivity).toHaveBeenCalledWith(
          1,
          "Maintenance Job Completed",
          expect.objectContaining({
            status: "Delivered",
          }),
        );
      });

      it("should not log completion for in-progress status", () => {
        const params: SaveJobParams = {
          id: 3,
          device_name: "MacBook Pro",
          status: "In Progress",
        };

        service.saveJob(params);

        // Should not log activity for updates that aren't completion
        expect(mockRepo.logActivity).not.toHaveBeenCalled();
      });
    });

    describe("default values", () => {
      it("should apply default values for optional fields", () => {
        const params: SaveJobParams = {
          device_name: "Basic Phone",
        };

        mockRepo.createJob.mockReturnValue(10);

        service.saveJob(params);

        expect(mockRepo.createJob).toHaveBeenCalledWith({
          client_id: null,
          client_name: null,
          device_name: "Basic Phone",
          issue_description: null,
          cost_usd: 0,
          price_usd: 0,
          discount_usd: 0,
          final_amount_usd: 0,
          paid_usd: 0,
          paid_lbp: 0,
          exchange_rate: 0,
          status: "In Progress",
          note: null,
        });
      });
    });

    describe("error handling", () => {
      it("should return error when transaction fails", () => {
        mockRepo.withTransaction.mockImplementation(() => {
          throw new Error("Transaction failed");
        });

        const params: SaveJobParams = {
          device_name: "Failing Device",
        };

        const result = service.saveJob(params);

        expect(result).toEqual({
          success: false,
          error: "Transaction failed",
        });
      });

      it("should return error when createJob fails", () => {
        mockRepo.withTransaction.mockImplementation((fn: () => unknown) =>
          fn(),
        );
        mockRepo.createJob.mockImplementation(() => {
          throw new Error("Insert failed");
        });

        const params: SaveJobParams = {
          device_name: "Error Device",
        };

        const result = service.saveJob(params);

        expect(result).toEqual({
          success: false,
          error: "Insert failed",
        });
      });
    });
  });

  // ===========================================================================
  // getJobs Tests
  // ===========================================================================

  describe("getJobs", () => {
    it("should return all jobs when no filter is provided", () => {
      const mockJobs = [
        {
          id: 1,
          device_name: "Phone 1",
          status: "In Progress",
          client_id: null,
          client_name: null,
          issue_description: null,
          cost_usd: 0,
          price_usd: 100,
          discount_usd: 0,
          final_amount_usd: 100,
          paid_usd: 0,
          paid_lbp: 0,
          exchange_rate: 90000,
          note: null,
          created_at: "2025-01-15",
          updated_at: "2025-01-15",
        },
        {
          id: 2,
          device_name: "Phone 2",
          status: "Delivered",
          client_id: null,
          client_name: null,
          issue_description: null,
          cost_usd: 0,
          price_usd: 150,
          discount_usd: 0,
          final_amount_usd: 150,
          paid_usd: 150,
          paid_lbp: 0,
          exchange_rate: 90000,
          note: null,
          created_at: "2025-01-15",
          updated_at: "2025-01-15",
        },
      ];
      mockRepo.getJobs.mockReturnValue(mockJobs);

      const result = service.getJobs();

      expect(result).toEqual(mockJobs);
      expect(mockRepo.getJobs).toHaveBeenCalledWith(undefined);
    });

    it("should return filtered jobs by status", () => {
      const mockJobs = [
        {
          id: 1,
          device_name: "Phone 1",
          status: "In Progress",
          client_id: null,
          client_name: null,
          issue_description: null,
          cost_usd: 0,
          price_usd: 100,
          discount_usd: 0,
          final_amount_usd: 100,
          paid_usd: 0,
          paid_lbp: 0,
          exchange_rate: 90000,
          note: null,
          created_at: "2025-01-15",
          updated_at: "2025-01-15",
        },
      ];
      mockRepo.getJobs.mockReturnValue(mockJobs);

      const result = service.getJobs("In Progress");

      expect(result).toEqual(mockJobs);
      expect(mockRepo.getJobs).toHaveBeenCalledWith("In Progress");
    });

    it("should return empty array on error", () => {
      mockRepo.getJobs.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = service.getJobs();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // deleteJob Tests
  // ===========================================================================

  describe("deleteJob", () => {
    it("should delete a job successfully", () => {
      mockRepo.deleteJob.mockReturnValue(undefined);

      const result = service.deleteJob(1);

      expect(result).toEqual({ success: true });
      expect(mockRepo.deleteJob).toHaveBeenCalledWith(1);
    });

    it("should return error when delete fails", () => {
      mockRepo.deleteJob.mockImplementation(() => {
        throw new Error("Delete failed");
      });

      const result = service.deleteJob(999);

      expect(result).toEqual({
        success: false,
        error: "Delete failed",
      });
    });
  });
});
