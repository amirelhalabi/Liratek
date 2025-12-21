/**
 * DebtService Unit Tests
 *
 * Tests all business logic in DebtService with mocked repository.
 */

import { DebtService, resetDebtService } from "../DebtService";
import { DebtRepository } from "../../database/repositories";

// Mock the repository module
jest.mock("../../database/repositories", () => ({
  getDebtRepository: jest.fn(),
  DebtRepository: jest.fn(),
}));

describe("DebtService", () => {
  let service: DebtService;
  let mockRepo: jest.Mocked<DebtRepository>;

  beforeEach(() => {
    resetDebtService();

    // Create mock repository
    mockRepo = {
      findAllDebtors: jest.fn(),
      findClientHistory: jest.fn(),
      getClientDebtTotal: jest.fn(),
      addRepayment: jest.fn(),
      getDebtSummary: jest.fn(),
    } as unknown as jest.Mocked<DebtRepository>;

    service = new DebtService(mockRepo);
  });

  // ===========================================================================
  // Debtor Queries
  // ===========================================================================

  describe("getDebtors", () => {
    it("returns all debtors from repository", () => {
      const mockDebtors = [
        { client_id: 1, client_name: "John", total_debt_usd: 100 },
        { client_id: 2, client_name: "Jane", total_debt_usd: 200 },
      ];
      mockRepo.findAllDebtors.mockReturnValue(mockDebtors as any);

      const result = service.getDebtors();

      expect(mockRepo.findAllDebtors).toHaveBeenCalled();
      expect(result).toEqual(mockDebtors);
    });
  });

  describe("getClientHistory", () => {
    it("returns debt history for client", () => {
      const mockHistory = [
        { id: 1, client_id: 1, type: "sale", amount_usd: 50 },
        { id: 2, client_id: 1, type: "repayment", amount_usd: -25 },
      ];
      mockRepo.findClientHistory.mockReturnValue(mockHistory as any);

      const result = service.getClientHistory(1);

      expect(mockRepo.findClientHistory).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockHistory);
    });

    it("returns empty array for invalid client ID", () => {
      const result = service.getClientHistory(0);

      expect(mockRepo.findClientHistory).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe("getClientTotal", () => {
    it("returns total debt for client", () => {
      mockRepo.getClientDebtTotal.mockReturnValue(1500);

      const result = service.getClientTotal(1);

      expect(mockRepo.getClientDebtTotal).toHaveBeenCalledWith(1);
      expect(result).toBe(1500);
    });

    it("returns 0 for invalid client ID", () => {
      const result = service.getClientTotal(0);

      expect(mockRepo.getClientDebtTotal).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });
  });

  // ===========================================================================
  // Repayment Operations
  // ===========================================================================

  describe("addRepayment", () => {
    it("processes repayment successfully", () => {
      mockRepo.addRepayment.mockReturnValue({ id: 123 });

      const result = service.addRepayment({
        clientId: 1,
        amountUSD: 50,
        amountLBP: 0,
        note: "Partial payment",
        userId: 10,
      });

      expect(mockRepo.addRepayment).toHaveBeenCalledWith({
        client_id: 1,
        amount_usd: 50,
        amount_lbp: 0,
        note: "Partial payment",
        created_by: 10,
      });
      expect(result).toEqual({ success: true, id: 123 });
    });

    it("logs repayment on success", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      mockRepo.addRepayment.mockReturnValue({ id: 456 });

      service.addRepayment({
        clientId: 1,
        amountUSD: 100,
        amountLBP: 500000,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[DEBT] Repayment of $100 and 500000 LBP for client 1",
        ),
      );
      consoleSpy.mockRestore();
    });

    it("returns error for missing client ID", () => {
      const result = service.addRepayment({
        clientId: 0,
        amountUSD: 50,
        amountLBP: 0,
      });

      expect(result).toEqual({
        success: false,
        error: "Client ID is required",
      });
      expect(mockRepo.addRepayment).not.toHaveBeenCalled();
    });

    it("returns error for zero repayment amount", () => {
      const result = service.addRepayment({
        clientId: 1,
        amountUSD: 0,
        amountLBP: 0,
      });

      expect(result).toEqual({
        success: false,
        error: "Repayment amount must be greater than zero",
      });
      expect(mockRepo.addRepayment).not.toHaveBeenCalled();
    });

    it("handles negative amounts as zero (must be positive)", () => {
      const result = service.addRepayment({
        clientId: 1,
        amountUSD: -50,
        amountLBP: -1000,
      });

      expect(result).toEqual({
        success: false,
        error: "Repayment amount must be greater than zero",
      });
    });

    it("handles repository error", () => {
      mockRepo.addRepayment.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = service.addRepayment({
        clientId: 1,
        amountUSD: 50,
        amountLBP: 0,
      });

      expect(result).toEqual({ success: false, error: "DB error" });
    });

    it("handles null note correctly", () => {
      mockRepo.addRepayment.mockReturnValue({ id: 789 });

      service.addRepayment({
        clientId: 1,
        amountUSD: 25,
        amountLBP: 0,
      });

      expect(mockRepo.addRepayment).toHaveBeenCalledWith({
        client_id: 1,
        amount_usd: 25,
        amount_lbp: 0,
        note: null,
        created_by: null,
      });
    });
  });

  // ===========================================================================
  // Dashboard Queries
  // ===========================================================================

  describe("getDebtSummary", () => {
    it("returns debt summary from repository", () => {
      const mockSummary = {
        totalDebtUSD: 5000,
        totalDebtLBP: 2000000,
        debtorCount: 15,
        topDebtors: [{ client_name: "John", total_debt: 500 }],
      };
      mockRepo.getDebtSummary.mockReturnValue(mockSummary as any);

      const result = service.getDebtSummary();

      expect(mockRepo.getDebtSummary).toHaveBeenCalledWith(5);
      expect(result).toEqual(mockSummary);
    });
  });
});
