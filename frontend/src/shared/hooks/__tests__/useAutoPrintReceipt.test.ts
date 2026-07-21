/**
 * useAutoPrintReceipt (LIRA-069 W1.d) — the ONE auto-print-on-success
 * implementation every module's success handler calls into.
 *
 * Per the ticket: "Component test: mock the print path, assert it fires on
 * success for an included module and does NOT fire for an excluded provider
 * or when a session is active."
 */
import { renderHook } from "@testing-library/react";
import { useAutoPrintReceipt } from "../useAutoPrintReceipt";

const mockGetTransactionBySource = jest.fn();
const mockPrintServiceReceiptByTransaction = jest.fn();

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({
    name: "Corner Tech",
    phone: "01-234567",
    location: "Beirut",
    logo: "",
  }),
}));

jest.mock("@/api/backendApi", () => ({
  getTransactionBySource: (...args: unknown[]) =>
    mockGetTransactionBySource(...args),
}));

jest.mock("@/shared/utils/serviceReceipt", () => ({
  printServiceReceiptByTransaction: (...args: unknown[]) =>
    mockPrintServiceReceiptByTransaction(...args),
}));

describe("useAutoPrintReceipt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTransactionBySource.mockResolvedValue({ id: 999 });
    mockPrintServiceReceiptByTransaction.mockResolvedValue({ ok: true });
  });

  it("fires the print path on success for an included module (RECHARGE)", async () => {
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "RECHARGE",
      sourceTable: "recharges",
      sourceId: 42,
      hasActiveSession: false,
    });

    expect(mockGetTransactionBySource).toHaveBeenCalledWith("recharges", 42);
    expect(mockPrintServiceReceiptByTransaction).toHaveBeenCalledWith(
      999,
      expect.objectContaining({ name: "Corner Tech" }),
    );
  });

  it("fires for an included FINANCIAL_SERVICE row (iPick — always receiptable)", async () => {
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "FINANCIAL_SERVICE",
      provider: "iPick",
      sourceTable: "financial_services",
      sourceId: 7,
      hasActiveSession: false,
    });

    expect(mockGetTransactionBySource).toHaveBeenCalledWith(
      "financial_services",
      7,
    );
    expect(mockPrintServiceReceiptByTransaction).toHaveBeenCalled();
  });

  it("fires for a Whish App Bill (item_key set) but not a transfer (no item_key)", async () => {
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "FINANCIAL_SERVICE",
      provider: "WHISH_APP",
      itemKey: "bill-123",
      sourceTable: "financial_services",
      sourceId: 8,
      hasActiveSession: false,
    });
    expect(mockPrintServiceReceiptByTransaction).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockGetTransactionBySource.mockResolvedValue({ id: 999 });

    await result.current({
      type: "FINANCIAL_SERVICE",
      provider: "WHISH_APP",
      // no itemKey — a transfer
      sourceTable: "financial_services",
      sourceId: 9,
      hasActiveSession: false,
    });
    expect(mockGetTransactionBySource).not.toHaveBeenCalled();
    expect(mockPrintServiceReceiptByTransaction).not.toHaveBeenCalled();
  });

  it("does NOT fire for an excluded provider (OMT System) even though the type is FINANCIAL_SERVICE", async () => {
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "FINANCIAL_SERVICE",
      provider: "OMT",
      sourceTable: "financial_services",
      sourceId: 5,
      hasActiveSession: false,
    });

    expect(mockGetTransactionBySource).not.toHaveBeenCalled();
    expect(mockPrintServiceReceiptByTransaction).not.toHaveBeenCalled();
  });

  it("does NOT fire for Binance (SEND/RECEIVE) even though it's FINANCIAL_SERVICE", async () => {
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "FINANCIAL_SERVICE",
      provider: "BINANCE",
      sourceTable: "financial_services",
      sourceId: 6,
      hasActiveSession: false,
    });

    expect(mockGetTransactionBySource).not.toHaveBeenCalled();
    expect(mockPrintServiceReceiptByTransaction).not.toHaveBeenCalled();
  });

  it("does NOT fire when a customer session is active, even for an included module", async () => {
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "RECHARGE",
      sourceTable: "recharges",
      sourceId: 42,
      hasActiveSession: true,
    });

    expect(mockGetTransactionBySource).not.toHaveBeenCalled();
    expect(mockPrintServiceReceiptByTransaction).not.toHaveBeenCalled();
  });

  it("does NOT fire when sourceId is null/undefined (no created row to look up)", async () => {
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "RECHARGE",
      sourceTable: "recharges",
      sourceId: undefined,
      hasActiveSession: false,
    });
    await result.current({
      type: "RECHARGE",
      sourceTable: "recharges",
      sourceId: null,
      hasActiveSession: false,
    });

    expect(mockGetTransactionBySource).not.toHaveBeenCalled();
    expect(mockPrintServiceReceiptByTransaction).not.toHaveBeenCalled();
  });

  it("does NOT print when the source lookup resolves to null (e.g. a voided row)", async () => {
    mockGetTransactionBySource.mockResolvedValue(null);
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "MAINTENANCE",
      sourceTable: "maintenance",
      sourceId: 3,
      hasActiveSession: false,
    });

    expect(mockGetTransactionBySource).toHaveBeenCalledWith("maintenance", 3);
    expect(mockPrintServiceReceiptByTransaction).not.toHaveBeenCalled();
  });

  it("swallows a lookup/print failure without throwing (best-effort)", async () => {
    mockGetTransactionBySource.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useAutoPrintReceipt());

    await expect(
      result.current({
        type: "CUSTOM_SERVICE",
        sourceTable: "custom_services",
        sourceId: 1,
        hasActiveSession: false,
      }),
    ).resolves.toBeUndefined();
  });
});
