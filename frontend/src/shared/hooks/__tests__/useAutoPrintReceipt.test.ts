/**
 * useAutoPrintReceipt (LIRA-069 W1.d) — DISABLED per owner request
 * (2026-07-28). The hook is now a stable no-op: it must never look up a
 * transaction or print, for ANY input (included/excluded provider, session
 * active or not, valid/missing sourceId). Manual reprint (TransactionsViewer
 * / History-modal Print buttons) is a separate code path, not covered here.
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

describe("useAutoPrintReceipt (disabled)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTransactionBySource.mockResolvedValue({ id: 999 });
    mockPrintServiceReceiptByTransaction.mockResolvedValue({ ok: true });
  });

  it("does NOT print for an otherwise-included module (RECHARGE, no session)", async () => {
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "RECHARGE",
      sourceTable: "recharges",
      sourceId: 42,
      hasActiveSession: false,
    });

    expect(mockGetTransactionBySource).not.toHaveBeenCalled();
    expect(mockPrintServiceReceiptByTransaction).not.toHaveBeenCalled();
  });

  it("does NOT print for an otherwise-included FINANCIAL_SERVICE row (iPick)", async () => {
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "FINANCIAL_SERVICE",
      provider: "iPick",
      sourceTable: "financial_services",
      sourceId: 7,
      hasActiveSession: false,
    });

    expect(mockGetTransactionBySource).not.toHaveBeenCalled();
    expect(mockPrintServiceReceiptByTransaction).not.toHaveBeenCalled();
  });

  it("does NOT print for a Whish App Bill (item_key set — previously always receiptable)", async () => {
    const { result } = renderHook(() => useAutoPrintReceipt());

    await result.current({
      type: "FINANCIAL_SERVICE",
      provider: "WHISH_APP",
      itemKey: "bill-123",
      sourceTable: "financial_services",
      sourceId: 8,
      hasActiveSession: false,
    });

    expect(mockGetTransactionBySource).not.toHaveBeenCalled();
    expect(mockPrintServiceReceiptByTransaction).not.toHaveBeenCalled();
  });

  it("does NOT print when a customer session is active", async () => {
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

  it("does NOT print when sourceId is null/undefined", async () => {
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

  it("resolves without throwing (best-effort no-op, never rejects)", async () => {
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
