/**
 * VoucherService Unit Tests
 *
 * Tests business logic in VoucherService with a mocked VoucherRepository.
 * The client-existence check goes through the real ClientRepository, so the
 * shared better-sqlite3 mock DB is primed for those lookups.
 */

import { jest } from "@jest/globals";
import { VoucherService, VoucherRepository } from "@liratek/core";
import { resetAllMocks, mockStatement } from "../../__mocks__/better-sqlite3";

jest.mock("better-sqlite3");

function makeVoucher(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    code: "GIFT-ABCD-1234",
    client_id: 7,
    client_name: "Jane",
    client_phone: "111",
    amount: 20,
    currency_code: "USD",
    expiry_date: null,
    status: "pending",
    redeemed_at: null,
    redeemed_by: null,
    redeemed_in_transaction: null,
    redeemed_transaction_id: null,
    redeemed_session_id: null,
    cancelled_at: null,
    cancelled_by: null,
    note: null,
    created_by: 1,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

/** Prime the shared mock DB so the next client lookup returns a client row. */
function primeClientLookup(client: Record<string, unknown> | null) {
  const testDb = (globalThis as any).__LIRATEK_TEST_DB__;
  (testDb.prepare as any).mockImplementation((sql: string) => {
    const stmt = { ...mockStatement, _sql: sql };
    if (/from clients/i.test(sql)) {
      stmt.get = jest.fn(() => client ?? undefined);
    }
    return stmt;
  });
}

describe("VoucherService", () => {
  let service: VoucherService;
  let mockRepo: jest.Mocked<VoucherRepository>;

  beforeEach(() => {
    resetAllMocks();
    mockRepo = {
      sellVoucher: jest.fn(),
      getByCode: jest.fn(),
      getAll: jest.fn(),
      generateUniqueCode: jest.fn(() => "GIFT-ABCD-1234"),
      cancelWithRefund: jest.fn(),
      findById: jest.fn(),
      redeemByCode: jest.fn(),
    } as unknown as jest.Mocked<VoucherRepository>;

    service = new VoucherService(mockRepo);
  });

  describe("createVoucher", () => {
    it("creates a voucher for a valid client and amount", () => {
      primeClientLookup({ id: 7, full_name: "Jane", phone_number: "111" });
      mockRepo.sellVoucher.mockReturnValue({
        voucher: makeVoucher(),
        transactionId: 41,
      } as never);
      const payments = [
        { method: "CASH" as const, currency_code: "USD" as const, amount: 20 },
      ];

      const result = service.createVoucher(
        { clientId: 7, amount: 20, payments, exchange_rate: 89000 },
        1,
      );

      expect(result.success).toBe(true);
      expect(result.voucher?.code).toBe("GIFT-ABCD-1234");
      // LIRA-339: the sale is a money flow — the legs and rate reach the
      // repository, and the VOUCHER_SALE id comes back.
      expect(result.transactionId).toBe(41);
      expect(mockRepo.sellVoucher.mock.calls[0][1]).toEqual(payments);
      expect(mockRepo.sellVoucher.mock.calls[0][2]).toMatchObject({
        exchangeRate: 89000,
      });
      expect(mockRepo.generateUniqueCode).toHaveBeenCalled();
    });

    it("rejects a non-positive amount", () => {
      const result = service.createVoucher({ clientId: 7, amount: 0 }, 1);
      expect(result.success).toBe(false);
      expect(mockRepo.sellVoucher).not.toHaveBeenCalled();
    });

    it("rejects when the client does not exist", () => {
      primeClientLookup(null);
      const result = service.createVoucher({ clientId: 99, amount: 20 }, 1);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  describe("validateVoucher", () => {
    it("returns the voucher when pending", () => {
      mockRepo.getByCode.mockReturnValue(makeVoucher() as never);
      const result = service.validateVoucher("gift-abcd-1234");
      expect(result.success).toBe(true);
      // codes are normalized to upper-case before lookup (assert only the
      // first arg — getByCode also takes an optional `day` the caller may
      // omit, so pinning the full arg list is brittle to that parameter)
      expect(mockRepo.getByCode.mock.calls[0][0]).toBe("GIFT-ABCD-1234");
    });

    it("rejects an unknown code", () => {
      mockRepo.getByCode.mockReturnValue(null);
      const result = service.validateVoucher("NOPE");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it("rejects an already-redeemed voucher", () => {
      mockRepo.getByCode.mockReturnValue(
        makeVoucher({ status: "redeemed" }) as never,
      );
      const result = service.validateVoucher("GIFT-ABCD-1234");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/redeemed/i);
    });

    it("rejects an expired voucher", () => {
      mockRepo.getByCode.mockReturnValue(
        makeVoucher({ status: "expired" }) as never,
      );
      const result = service.validateVoucher("GIFT-ABCD-1234");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/expired/i);
    });
  });

  describe("cancelVoucher", () => {
    it("cancels a pending voucher and refunds it ({} = cash part in cash)", () => {
      const refunded = {
        cash: { usd: 20, lbp: 0 },
        toAccount: { usd: 0, lbp: 0 },
      };
      mockRepo.findById.mockReturnValue(makeVoucher() as never);
      mockRepo.cancelWithRefund.mockReturnValue({
        voucher: makeVoucher({ status: "cancelled" }),
        transactionId: 42,
        refunded,
      } as never);

      const result = service.cancelVoucher(1, {}, 1);
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe(42);
      expect(result.refunded).toEqual(refunded);
      expect(mockRepo.cancelWithRefund).toHaveBeenCalledWith(1, [], {
        cancelledBy: 1,
        exchangeRate: undefined,
        clientDay: undefined,
      });
    });

    it("refuses to cancel a non-pending voucher", () => {
      mockRepo.findById.mockReturnValue(
        makeVoucher({ status: "redeemed" }) as never,
      );

      const result = service.cancelVoucher(1, {}, 1);
      expect(result.success).toBe(false);
      expect(mockRepo.cancelWithRefund).not.toHaveBeenCalled();
    });
  });
});
