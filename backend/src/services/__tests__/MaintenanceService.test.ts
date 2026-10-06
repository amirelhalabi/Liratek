/**
 * MaintenanceService Unit Tests
 */

import { jest } from "@jest/globals";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    MaintenanceRepository: jest.fn(),
  };
});

import {
  MaintenanceService,
  SaveJobParams,
  MaintenanceRepository,
} from "@liratek/core";

describe("MaintenanceService", () => {
  let service: MaintenanceService;
  let mockRepo: any;

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
      // Parts/payments collaborators saveJob and getJobs now call; defaults
      // model a job with no parts and no prior payments, which is what
      // these tests assume.
      getParts: jest.fn(() => []),
      getPartsForJobs: jest.fn(() => new Map()),
      syncParts: jest.fn(),
      findById: jest.fn(() => undefined),
      isJobCharged: jest.fn(() => false),
      // LIRA-263 follow-up (phone kept on the job, v194) — new repo methods.
      setJobClientPhone: jest.fn(),
      getClientPhone: jest.fn(() => null),
      processPayments: jest.fn(),
    };

    // Make the constructor return our mock
    (MaintenanceRepository as jest.Mock).mockImplementation(() => mockRepo);

    service = new MaintenanceService(mockRepo);
  });

  // ===========================================================================
  // saveJob Tests
  // ===========================================================================

  describe("saveJob", () => {
    describe("creating new jobs", () => {
      it("should handle client auto-creation failure gracefully (with a phone present, so auto-create is attempted)", () => {
        const params: SaveJobParams = {
          client_name: "Jane Doe",
          client_phone: "5551234",
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
        expect(mockRepo.findOrCreateClient).toHaveBeenCalled();
        expect(mockRepo.createJob).toHaveBeenCalledWith(
          expect.objectContaining({
            client_id: null,
            device_name: "Pixel 7",
          }),
          undefined,
        );
      });

    });

    describe("default values", () => {
      it("should apply default values for optional fields", () => {
        const params: SaveJobParams = {
          device_name: "Basic Phone",
        };

        mockRepo.createJob.mockReturnValue(10);

        service.saveJob(params);

        expect(mockRepo.createJob).toHaveBeenCalledWith(
          {
            client_id: null,
            client_name: null,
            device_name: "Basic Phone",
            issue_description: null,
            cost_usd: 0,
            price_usd: 0,
            cost_lbp: 0,
            price_lbp: 0,
            discount_usd: 0,
            final_amount_usd: 0,
            final_amount_lbp: 0,
            currency: "USD",
            paid_usd: 0,
            paid_lbp: 0,
            exchange_rate: 0,
            status: "Received",
            paid_by: "CASH",
            note: null,
            transaction_time: undefined,
          },
          undefined,
        );
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

      expect(result).toEqual(mockJobs.map((j) => ({ ...j, parts: [] })));
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

      expect(result).toEqual(mockJobs.map((j) => ({ ...j, parts: [] })));
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
