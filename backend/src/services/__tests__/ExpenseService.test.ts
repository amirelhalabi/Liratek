/**
 * ExpenseService Unit Tests
 */

import { jest } from "@jest/globals";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getExpenseRepository: jest.fn(),
  };
});

import {
  ExpenseService,
  getExpenseService,
  resetExpenseService,
  ExpenseEntity,
  CreateExpenseData,
  getExpenseRepository,
} from "@liratek/core";

describe("ExpenseService", () => {
  let service: ExpenseService;
  let mockRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetExpenseService();

    // Create mock repository
    mockRepo = {
      createExpense: jest.fn(),
      getTodayExpenses: jest.fn(),
      getExpenseById: jest.fn(),
      deleteExpense: jest.fn(),
      logActivity: jest.fn(),
    };

    (getExpenseRepository as jest.Mock).mockReturnValue(mockRepo);

    service = new ExpenseService(mockRepo);
  });

  // ===========================================================================
  // addExpense Tests
  // ===========================================================================

  describe("addExpense", () => {
    it("should add an expense successfully", () => {
      const expenseData: CreateExpenseData = {
        category: "Utilities",
        amount_usd: 50,
        amount_lbp: 0,
        description: "Electricity bill",
        expense_date: "2025-01-15",
      };
      mockRepo.createExpense.mockReturnValue(1);

      const result = service.addExpense(expenseData);

      expect(result).toEqual({ success: true, id: 1 });
      expect(mockRepo.createExpense).toHaveBeenCalledWith(expenseData);
      expect(mockRepo.logActivity).toHaveBeenCalledWith(1, "Add Expense", {
        category: "Utilities",
        paid_by_method: "CASH",
        amount_usd: 50,
        amount_lbp: 0,
      });
    });

    it("should add expense with LBP amount", () => {
      const expenseData: CreateExpenseData = {
        category: "Supplies",
        amount_usd: 0,
        amount_lbp: 900000,
        description: "Office supplies",
        expense_date: "2025-01-15",
      };
      mockRepo.createExpense.mockReturnValue(2);

      const result = service.addExpense(expenseData);

      expect(result).toEqual({ success: true, id: 2 });
    });

    it("should add expense with both currencies", () => {
      const expenseData: CreateExpenseData = {
        category: "Maintenance",
        amount_usd: 30,
        amount_lbp: 450000,
        description: "Building repair",
        expense_date: "2025-01-15",
      };
      mockRepo.createExpense.mockReturnValue(3);

      const result = service.addExpense(expenseData);

      expect(result).toEqual({ success: true, id: 3 });
    });

    it("should return error on failure", () => {
      const expenseData: CreateExpenseData = {
        category: "Error",
        amount_usd: 100,
        amount_lbp: 0,
        description: "Test",
        expense_date: "2025-01-15",
      };
      mockRepo.createExpense.mockImplementation(() => {
        throw new Error("Insert failed");
      });

      const result = service.addExpense(expenseData);

      expect(result).toEqual({
        success: false,
        error: "Insert failed",
      });
    });

    it("should handle expense with description", () => {
      const expenseData: CreateExpenseData = {
        category: "Rent",
        amount_usd: 500,
        amount_lbp: 0,
        description: "Monthly rent",
        expense_date: "2025-01-15",
      };
      mockRepo.createExpense.mockReturnValue(4);

      const result = service.addExpense(expenseData);

      expect(result).toEqual({ success: true, id: 4 });
    });

    it("should log activity even if expense has zero USD", () => {
      const expenseData: CreateExpenseData = {
        category: "Food",
        amount_usd: 0,
        amount_lbp: 100000,
        description: "Lunch",
        expense_date: "2025-01-15",
      };
      mockRepo.createExpense.mockReturnValue(5);

      service.addExpense(expenseData);

      expect(mockRepo.logActivity).toHaveBeenCalledWith(1, "Add Expense", {
        category: "Food",
        paid_by_method: "CASH",
        amount_usd: 0,
        amount_lbp: 100000,
      });
    });
  });

  // ===========================================================================
  // getTodayExpenses Tests
  // ===========================================================================

  describe("getTodayExpenses", () => {
    it("should return today expenses", () => {
      const mockExpenses: ExpenseEntity[] = [
        {
          id: 1,
          category: "Utilities",
          amount_usd: 50,
          amount_lbp: 0,
          description: "Internet",
          expense_date: "2025-01-15",
          created_at: "2025-01-15 10:00:00",
        },
        {
          id: 2,
          category: "Food",
          amount_usd: 20,
          amount_lbp: 0,
          description: "Snacks",
          expense_date: "2025-01-15",
          created_at: "2025-01-15 12:00:00",
        },
      ];
      mockRepo.getTodayExpenses.mockReturnValue(mockExpenses);

      const result = service.getTodayExpenses();

      expect(result).toEqual(mockExpenses);
      expect(mockRepo.getTodayExpenses).toHaveBeenCalled();
    });

    it("should return empty array when no expenses today", () => {
      mockRepo.getTodayExpenses.mockReturnValue([]);

      const result = service.getTodayExpenses();

      expect(result).toEqual([]);
    });

    it("should return empty array on error", () => {
      mockRepo.getTodayExpenses.mockImplementation(() => {
        throw new Error("Query failed");
      });

      const result = service.getTodayExpenses();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // deleteExpense Tests
  // ===========================================================================

  describe("deleteExpense", () => {
    it("should delete an expense successfully", () => {
      const mockExpense: ExpenseEntity = {
        id: 1,
        category: "Utilities",
        amount_usd: 50,
        amount_lbp: 0,
        description: "Old bill",
        expense_date: "2025-01-15",
        created_at: "2025-01-15",
      };
      mockRepo.getExpenseById.mockReturnValue(mockExpense);
      mockRepo.deleteExpense.mockReturnValue(undefined);

      const result = service.deleteExpense(1);

      expect(result).toEqual({ success: true });
      expect(mockRepo.deleteExpense).toHaveBeenCalledWith(1);
      expect(mockRepo.logActivity).toHaveBeenCalledWith(1, "Delete Expense", {
        category: "Utilities",
        amount_usd: 50,
      });
    });

    it("should delete without logging if expense not found", () => {
      mockRepo.getExpenseById.mockReturnValue(undefined);
      mockRepo.deleteExpense.mockReturnValue(undefined);

      const result = service.deleteExpense(999);

      expect(result).toEqual({ success: true });
      expect(mockRepo.logActivity).not.toHaveBeenCalled();
    });

    it("should return error on delete failure", () => {
      mockRepo.getExpenseById.mockReturnValue({
        id: 1,
        category: "Test",
        amount_usd: 10,
        amount_lbp: 0,
        description: "",
        expense_date: "2025-01-15",
        created_at: "2025-01-15",
      });
      mockRepo.deleteExpense.mockImplementation(() => {
        throw new Error("Delete failed");
      });

      const result = service.deleteExpense(1);

      expect(result).toEqual({
        success: false,
        error: "Delete failed",
      });
    });

    it("should handle expense with LBP in log", () => {
      const mockExpense: ExpenseEntity = {
        id: 2,
        category: "Transport",
        amount_usd: 0,
        amount_lbp: 500000,
        description: "Taxi",
        expense_date: "2025-01-15",
        created_at: "2025-01-15",
      };
      mockRepo.getExpenseById.mockReturnValue(mockExpense);
      mockRepo.deleteExpense.mockReturnValue(undefined);

      service.deleteExpense(2);

      expect(mockRepo.logActivity).toHaveBeenCalledWith(1, "Delete Expense", {
        category: "Transport",
        amount_usd: 0,
      });
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      resetExpenseService();
      const instance1 = getExpenseService();
      const instance2 = getExpenseService();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getExpenseService();
      resetExpenseService();
      const instance2 = getExpenseService();

      expect(instance1).not.toBe(instance2);
    });
  });
});
