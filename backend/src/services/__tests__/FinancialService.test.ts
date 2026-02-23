/**
 * FinancialService — Comprehensive Unit Tests
 *
 * Covers:
 *   1. Zod validator (createFinancialServiceSchema):
 *      - phoneNumber, omtServiceType, BINANCE provider, DEBT refinement
 *   2. Service ↔ Repository delegation:
 *      - addTransaction for all providers (OMT, WHISH, BOB, IPEC, KATCH, WISH_APP)
 *      - getHistory with/without provider filter
 *      - getAnalytics happy path + error
 *   3. SQL-level correctness (mock DB):
 *      - INSERT includes phone_number & omt_service_type columns
 *      - SELECT includes phone_number & omt_service_type columns
 *      - Returned records carry T-30 fields
 *   4. Singleton pattern
 *   5. Error handling
 */

import { jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mock @liratek/core for delegation tests (Section 2 & 4)
// ---------------------------------------------------------------------------

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getFinancialServiceRepository: jest.fn(),
    FinancialServiceRepository: jest.fn(),
  };
});

import {
  FinancialService,
  getFinancialService,
  resetFinancialService,
  FinancialServiceRepository,
  getFinancialServiceRepository,
  createFinancialServiceSchema,
  type CreateFinancialServiceData,
  type FinancialServiceEntity,
  type FinancialServiceAnalytics,
} from "@liratek/core";

// ---------------------------------------------------------------------------
// Mock DB helpers (Section 3)
// ---------------------------------------------------------------------------

import { resetAllMocks, mockDatabase } from "../../__mocks__/better-sqlite3";

/** Create a mock that tracks per-prepare run/all/get calls */
function createTrackingMock() {
  const stmts: Array<{
    _sql: string;
    run: jest.Mock;
    all: jest.Mock;
    get: jest.Mock;
  }> = [];

  (mockDatabase.prepare as any).mockImplementation((sql: string) => {
    const stmt = {
      _sql: sql,
      run: jest.fn((..._args: any[]) => {
        if (sql.trim().toUpperCase().startsWith("INSERT")) {
          return { changes: 1, lastInsertRowid: 1 };
        }
        return { changes: 1 };
      }),
      all: jest.fn(() => []),
      get: jest.fn(() => undefined),
    };
    stmts.push(stmt);
    return stmt;
  });

  return {
    stmts,
    findStmt: (substring: string) =>
      stmts.find((s) => s._sql.includes(substring)),
    findAllStmts: (substring: string) =>
      stmts.filter((s) => s._sql.includes(substring)),
  };
}

// =============================================================================
// 1. Zod Validator — createFinancialServiceSchema
// =============================================================================

describe("createFinancialServiceSchema", () => {
  const basePayload = {
    provider: "OMT" as const,
    serviceType: "SEND" as const,
    amount: 100,
    commission: 5,
  };

  // -------------------------------------------------------------------------
  // phoneNumber
  // -------------------------------------------------------------------------

  describe("phoneNumber field", () => {
    it("accepts a valid phone number", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        phoneNumber: "+961 71 123 456",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.phoneNumber).toBe("+961 71 123 456");
      }
    });

    it("accepts missing phone number (optional)", () => {
      const result = createFinancialServiceSchema.safeParse(basePayload);
      expect(result.success).toBe(true);
    });

    it("rejects phone numbers exceeding 30 chars", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        phoneNumber: "A".repeat(31),
      });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // omtServiceType
  // -------------------------------------------------------------------------

  describe("omtServiceType field", () => {
    const validTypes = [
      "BILL_PAYMENT",
      "CASH_TO_BUSINESS",
      "MINISTRY_OF_INTERIOR",
      "CASH_OUT",
      "MINISTRY_OF_FINANCE",
      "INTRA",
      "ONLINE_BROKERAGE",
      "WESTERN_UNION",
    ];

    it.each(validTypes)("accepts valid OMT service type: %s", (type) => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        omtServiceType: type,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.omtServiceType).toBe(type);
      }
    });

    it("rejects an invalid OMT service type", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        omtServiceType: "INVALID_TYPE",
      });
      expect(result.success).toBe(false);
    });

    it("accepts missing omtServiceType (optional)", () => {
      const result = createFinancialServiceSchema.safeParse(basePayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.omtServiceType).toBeUndefined();
      }
    });

    it("validates all 8 OMT service types exist", () => {
      expect(validTypes).toHaveLength(8);
    });
  });

  // -------------------------------------------------------------------------
  // Combined fields
  // -------------------------------------------------------------------------

  describe("combined phone + OMT service type", () => {
    it("accepts both phoneNumber and omtServiceType together", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        phoneNumber: "03123456",
        omtServiceType: "CASH_OUT",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.phoneNumber).toBe("03123456");
        expect(result.data.omtServiceType).toBe("CASH_OUT");
      }
    });
  });

  // -------------------------------------------------------------------------
  // BINANCE provider
  // -------------------------------------------------------------------------

  describe("BINANCE provider", () => {
    it("accepts BINANCE as a valid provider", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        provider: "BINANCE",
      });
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // DEBT refinement
  // -------------------------------------------------------------------------

  describe("DEBT refinement", () => {
    it("rejects DEBT payment without clientId", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        paidByMethod: "DEBT",
      });
      expect(result.success).toBe(false);
    });

    it("accepts DEBT payment with clientId", () => {
      const result = createFinancialServiceSchema.safeParse({
        ...basePayload,
        paidByMethod: "DEBT",
        clientId: 1,
      });
      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// 2. Service ↔ Repository Delegation
// =============================================================================

describe("FinancialService (delegation)", () => {
  let service: FinancialService;
  let mockRepo: jest.Mocked<FinancialServiceRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetFinancialService();

    mockRepo = {
      createTransaction: jest.fn(),
      getHistory: jest.fn(),
      getAnalytics: jest.fn(),
    } as unknown as jest.Mocked<FinancialServiceRepository>;

    (getFinancialServiceRepository as jest.Mock).mockReturnValue(mockRepo);
    service = new FinancialService(mockRepo);
  });

  // -------------------------------------------------------------------------
  // addTransaction — all providers
  // -------------------------------------------------------------------------

  describe("addTransaction", () => {
    const omtData: CreateFinancialServiceData = {
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      commission: 5,
      note: "Money transfer to Lebanon",
    };

    it("should delegate OMT transaction to repo", () => {
      mockRepo.createTransaction.mockReturnValue({
        id: 1,
        drawer: "OMT_System",
      });
      const result = service.addTransaction(omtData);
      expect(result).toEqual({ success: true, id: 1 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(omtData);
    });

    it("should delegate WHISH transaction to repo", () => {
      const data: CreateFinancialServiceData = {
        provider: "WHISH",
        serviceType: "RECEIVE",
        amount: 50,
        commission: 3,
      };
      mockRepo.createTransaction.mockReturnValue({
        id: 2,
        drawer: "Whish_System",
      });
      const result = service.addTransaction(data);
      expect(result).toEqual({ success: true, id: 2 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(data);
    });

    it("should delegate BOB transaction to repo", () => {
      const data: CreateFinancialServiceData = {
        provider: "BOB",
        serviceType: "SEND",
        amount: 200,
        commission: 10,
      };
      mockRepo.createTransaction.mockReturnValue({
        id: 3,
        drawer: "General",
      });
      const result = service.addTransaction(data);
      expect(result).toEqual({ success: true, id: 3 });
    });

    it("should delegate IPEC transaction to repo", () => {
      const data: CreateFinancialServiceData = {
        provider: "IPEC",
        serviceType: "SEND",
        amount: 150,
        commission: 7,
      };
      mockRepo.createTransaction.mockReturnValue({ id: 4, drawer: "IPEC" });
      const result = service.addTransaction(data);
      expect(result).toEqual({ success: true, id: 4 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(data);
    });

    it("should delegate KATCH transaction to repo", () => {
      const data: CreateFinancialServiceData = {
        provider: "KATCH",
        serviceType: "RECEIVE",
        amount: 80,
        commission: 4,
      };
      mockRepo.createTransaction.mockReturnValue({ id: 5, drawer: "Katch" });
      const result = service.addTransaction(data);
      expect(result).toEqual({ success: true, id: 5 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(data);
    });

    it("should delegate WISH_APP transaction to repo", () => {
      const data: CreateFinancialServiceData = {
        provider: "WISH_APP",
        serviceType: "SEND",
        amount: 20,
        commission: 1,
      };
      mockRepo.createTransaction.mockReturnValue({
        id: 6,
        drawer: "Whish_App",
      });
      const result = service.addTransaction(data);
      expect(result).toEqual({ success: true, id: 6 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(data);
    });

    it("should pass T-30 fields (phoneNumber, omtServiceType) through to repo", () => {
      const data: CreateFinancialServiceData = {
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        commission: 5,
        phoneNumber: "+961 3 123 456",
        omtServiceType: "BILL_PAYMENT",
      };
      mockRepo.createTransaction.mockReturnValue({
        id: 7,
        drawer: "OMT_System",
      });
      const result = service.addTransaction(data);
      expect(result).toEqual({ success: true, id: 7 });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: "+961 3 123 456",
          omtServiceType: "BILL_PAYMENT",
        }),
      );
    });

    it("should return error when createTransaction throws", () => {
      mockRepo.createTransaction.mockImplementation(() => {
        throw new Error("Database error");
      });
      const result = service.addTransaction(omtData);
      expect(result).toEqual({ success: false, error: "Database error" });
    });
  });

  // -------------------------------------------------------------------------
  // getHistory
  // -------------------------------------------------------------------------

  describe("getHistory", () => {
    const mockHistory: Partial<FinancialServiceEntity>[] = [
      {
        id: 1,
        provider: "OMT",
        service_type: "SEND",
        amount: 100,
        currency: "USD",
        commission: 5,
        phone_number: "03123456",
        omt_service_type: "BILL_PAYMENT",
        created_at: "2026-02-22",
      },
      {
        id: 2,
        provider: "WHISH",
        service_type: "RECEIVE",
        amount: 50,
        currency: "USD",
        commission: 3,
        phone_number: "71999888",
        omt_service_type: null,
        created_at: "2026-02-22",
      },
    ];

    it("should return all history when no provider filter", () => {
      mockRepo.getHistory.mockReturnValue(
        mockHistory as FinancialServiceEntity[],
      );
      const result = service.getHistory();
      expect(result).toEqual(mockHistory);
      expect(mockRepo.getHistory).toHaveBeenCalledWith(undefined);
    });

    it("should filter history by provider", () => {
      mockRepo.getHistory.mockReturnValue([
        mockHistory[0] as FinancialServiceEntity,
      ]);
      const result = service.getHistory("OMT");
      expect(result).toHaveLength(1);
      expect(mockRepo.getHistory).toHaveBeenCalledWith("OMT");
    });

    it("should return empty array on error", () => {
      mockRepo.getHistory.mockImplementation(() => {
        throw new Error("Query failed");
      });
      const result = service.getHistory();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getAnalytics
  // -------------------------------------------------------------------------

  describe("getAnalytics", () => {
    it("should return analytics data from repo", () => {
      const mockAnalytics: FinancialServiceAnalytics = {
        today: {
          commission: 50,
          count: 10,
          byCurrency: [{ currency: "USD", commission: 50, count: 10 }],
        },
        month: {
          commission: 500,
          count: 100,
          byCurrency: [{ currency: "USD", commission: 500, count: 100 }],
        },
        byProvider: [
          { provider: "OMT", commission: 300, currency: "USD", count: 60 },
          { provider: "WHISH", commission: 150, currency: "USD", count: 30 },
        ],
      };
      mockRepo.getAnalytics.mockReturnValue(mockAnalytics);
      const result = service.getAnalytics();
      expect(result).toEqual(mockAnalytics);
      expect(mockRepo.getAnalytics).toHaveBeenCalled();
    });

    it("should return safe defaults on error", () => {
      mockRepo.getAnalytics.mockImplementation(() => {
        throw new Error("Analytics query failed");
      });
      const result = service.getAnalytics();
      expect(result).toEqual({
        today: { commission: 0, byCurrency: [], count: 0 },
        month: { commission: 0, byCurrency: [], count: 0 },
        byProvider: [],
      });
    });
  });

  // -------------------------------------------------------------------------
  // Singleton
  // -------------------------------------------------------------------------

  describe("singleton pattern", () => {
    it("should return same instance on multiple calls", () => {
      resetFinancialService();
      const instance1 = getFinancialService();
      const instance2 = getFinancialService();
      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getFinancialService();
      resetFinancialService();
      const instance2 = getFinancialService();
      expect(instance1).not.toBe(instance2);
    });
  });
});

// =============================================================================
// 3. SQL-Level Correctness (Mock DB)
// =============================================================================

describe("FinancialService (SQL-level)", () => {
  let service: FinancialService;

  beforeEach(() => {
    resetAllMocks();
    (globalThis as any).__LIRATEK_TEST_DB__ = mockDatabase;

    // Mock db.transaction to just execute the function
    (mockDatabase as any).transaction = jest.fn(
      (fn: (...a: unknown[]) => unknown) => {
        return (...args: unknown[]) => fn(...args);
      },
    );

    resetFinancialService();
    service = new FinancialService();
  });

  // -------------------------------------------------------------------------
  // addTransaction — SQL INSERT includes T-30 columns
  // -------------------------------------------------------------------------

  describe("addTransaction — SQL INSERT", () => {
    it("INSERT includes phone_number column", () => {
      const tracker = createTrackingMock();

      service.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        commission: 5,
        phoneNumber: "+961 3 123 456",
      });

      const insertStmt = tracker.findStmt("INSERT INTO financial_services");
      expect(insertStmt).toBeDefined();
      expect(insertStmt!._sql).toContain("phone_number");
      expect(insertStmt!._sql).toContain("omt_service_type");
      expect(insertStmt!.run.mock.calls[0]).toContain("+961 3 123 456");
    });

    it("INSERT includes omt_service_type value", () => {
      const tracker = createTrackingMock();

      service.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        commission: 5,
        omtServiceType: "BILL_PAYMENT",
      });

      const insertStmt = tracker.findStmt("INSERT INTO financial_services");
      expect(insertStmt).toBeDefined();
      expect(insertStmt!.run.mock.calls[0]).toContain("BILL_PAYMENT");
    });

    it("stores both phone_number and omt_service_type together", () => {
      const tracker = createTrackingMock();

      service.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 200,
        commission: 10,
        phoneNumber: "03999888",
        omtServiceType: "CASH_TO_BUSINESS",
      });

      const insertStmt = tracker.findStmt("INSERT INTO financial_services");
      expect(insertStmt).toBeDefined();
      const runCall = insertStmt!.run.mock.calls[0];
      expect(runCall).toContain("03999888");
      expect(runCall).toContain("CASH_TO_BUSINESS");
    });

    it("stores null when phone_number and omt_service_type not provided", () => {
      const tracker = createTrackingMock();

      service.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        commission: 5,
      });

      const insertStmt = tracker.findStmt("INSERT INTO financial_services");
      expect(insertStmt).toBeDefined();
      // INSERT has 15 values — phone_number is 12th (index 11), omt_service_type is 13th (index 12)
      const runCall = insertStmt!.run.mock.calls[0];
      expect(runCall[11]).toBeNull();
      expect(runCall[12]).toBeNull();
    });

    it("returns success with id", () => {
      createTrackingMock();

      const result = service.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        commission: 5,
        phoneNumber: "71123456",
        omtServiceType: "INTRA",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
    });

    it("returns error on DB failure", () => {
      (mockDatabase.prepare as any).mockImplementation(() => {
        throw new Error("Database locked");
      });

      const result = service.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        commission: 5,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Database locked");
    });
  });

  // -------------------------------------------------------------------------
  // getHistory — SQL SELECT includes T-30 columns
  // -------------------------------------------------------------------------

  describe("getHistory — SQL SELECT", () => {
    it("SELECT includes phone_number and omt_service_type columns", () => {
      const tracker = createTrackingMock();

      service.getHistory();

      const selectStmt = tracker.findStmt("SELECT");
      expect(selectStmt).toBeDefined();
      expect(selectStmt!._sql).toContain("phone_number");
      expect(selectStmt!._sql).toContain("omt_service_type");
    });

    it("returns records with phone_number and omt_service_type", () => {
      (mockDatabase.prepare as any).mockImplementation((sql: string) => ({
        _sql: sql,
        run: jest.fn(() => ({ changes: 0 })),
        get: jest.fn(() => undefined),
        all: jest.fn(() => [
          {
            id: 1,
            provider: "OMT",
            service_type: "SEND",
            amount: 100,
            currency: "USD",
            commission: 5,
            phone_number: "03123456",
            omt_service_type: "BILL_PAYMENT",
            created_at: "2026-02-22T10:00:00Z",
          },
          {
            id: 2,
            provider: "WHISH",
            service_type: "RECEIVE",
            amount: 50,
            currency: "USD",
            commission: 3,
            phone_number: "71999888",
            omt_service_type: null,
            created_at: "2026-02-22T11:00:00Z",
          },
        ]),
      }));

      const history = service.getHistory();

      expect(history).toHaveLength(2);
      expect(history[0].phone_number).toBe("03123456");
      expect(history[0].omt_service_type).toBe("BILL_PAYMENT");
      expect(history[1].phone_number).toBe("71999888");
      expect(history[1].omt_service_type).toBeNull();
    });

    it("SQL includes WHERE clause when filtering by provider", () => {
      const tracker = createTrackingMock();

      service.getHistory("OMT");

      const selectStmt = tracker.findStmt("SELECT");
      expect(selectStmt).toBeDefined();
      expect(selectStmt!._sql).toContain("WHERE provider = ?");
      expect(selectStmt!.all.mock.calls[0]).toContain("OMT");
    });

    it("returns empty array on DB error", () => {
      (mockDatabase.prepare as any).mockImplementation(() => {
        throw new Error("IO error");
      });
      expect(service.getHistory()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getAnalytics — SQL-level error handling
  // -------------------------------------------------------------------------

  describe("getAnalytics — SQL-level", () => {
    it("returns safe defaults on DB error", () => {
      (mockDatabase.prepare as any).mockImplementation(() => {
        throw new Error("DB error");
      });

      const analytics = service.getAnalytics();
      expect(analytics.today.commission).toBe(0);
      expect(analytics.today.count).toBe(0);
      expect(analytics.month.commission).toBe(0);
      expect(analytics.month.count).toBe(0);
      expect(analytics.byProvider).toEqual([]);
    });
  });
});
