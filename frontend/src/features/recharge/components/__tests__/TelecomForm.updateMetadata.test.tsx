/** @jest-environment jsdom */

/**
 * LIRA-109 — TelecomForm's `onUpdateMetadata` handler (passed to the History
 * modal's inline edit feature, ~TelecomForm.tsx:1198) must go through the
 * dual-mode adapter (`useApi().updateRechargeMetadata`), never a raw
 * `window.api.recharge.updateMetadata` call. In a real browser `window.api`
 * is undefined, so the raw call threw before `onRefreshHistory` ever ran and
 * the edit silently failed — this was the last unmigrated recharge call site
 * (LIRA-103 already fixed history + drawer-balances).
 *
 * `window.api` is deliberately left UNDEFINED in this file (mirrors
 * Recharge.historyDrawerBalancesRest.test.tsx's LIRA-103 pattern): if the
 * call site regressed back to `window.api.recharge.updateMetadata`, the
 * access would throw synchronously (`window.api` is undefined), which
 * HistoryModal's `saveEdit` catches and surfaces as an inline error instead
 * of ever calling the mock below — so `mockUpdateRechargeMetadata` would
 * never be invoked and the "Save" click would leave the row stuck in edit
 * mode. Both assertions below fail in that scenario.
 *
 * Rule 17 — proven failing-first: reverting the call site
 * (`api.updateRechargeMetadata` -> `window.api.recharge.updateMetadata`)
 * makes every test in this file fail. Captured real output (2026-08-08):
 *
 *   FAIL src/features/recharge/components/__tests__/TelecomForm.updateMetadata.test.tsx
 *     × routes the History modal's save through api.updateRechargeMetadata, never window.api (1213 ms)
 *     × edits phone_number and client_name too, all three fields reaching the adapter in one call (1115 ms)
 *   Tests:       2 failed, 2 total
 *
 * Both failures are the SAME `waitFor(() =>
 * expect(mockUpdateRechargeMetadata).toHaveBeenCalledWith(...))` timing out —
 * the mock is never invoked because `window.api` is undefined in this test
 * file, so `window.api.recharge.updateMetadata(...)` throws synchronously
 * ("Cannot read properties of undefined (reading 'recharge')"), which
 * HistoryModal's `saveEdit` catches into `editError` instead of ever calling
 * the mock. Reverted back to the fix immediately after capturing this.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TelecomForm } from "../TelecomForm";
import type { FinancialTransaction } from "../../types";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetActiveCarrierLines = jest.fn().mockResolvedValue([]);
const mockUpdateRechargeMetadata = jest.fn().mockResolvedValue({
  success: true,
  data: { id: 7, phone_number: "70999999" },
});

// A STABLE object (module-level, not a fresh literal per call) — mirrors the
// real ApiProvider's single adapter instance (see
// Recharge.historyDrawerBalancesRest.test.tsx for the same convention).
const mockApi = {
  getAllSettings: mockGetAllSettings,
  getActiveCarrierLines: mockGetActiveCarrierLines,
  updateRechargeMetadata: mockUpdateRechargeMetadata,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

// Deliberately NO window.api — proves the call site under test never falls
// back to window.api.recharge.updateMetadata (see file header).

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 91000, buyRate: 90000 }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const historyRow: FinancialTransaction = {
  id: 7,
  provider: "MTC",
  service_type: "SEND",
  amount: 5,
  currency: "USD",
  cost: 4,
  commission: 1,
  client_name: "Old Name",
  phone_number: "03000091",
  note: "old note",
  edited_by: null,
  edited_at: null,
  default_price_to_client: null,
  paid_by: "CASH",
  reference_number: "03000091",
  created_at: "2026-08-08T00:00:00.000Z",
};

// Minimal-but-complete TelecomForm props — CREDIT_TRANSFER tab, no active
// session, no shop-line match, so the plain form (not the buy-back/redirect
// branches) renders alongside the History modal under test.
function buildProps(
  overrides: Partial<React.ComponentProps<typeof TelecomForm>> = {},
) {
  return {
    isMTC: true,
    rechargeType: "CREDIT_TRANSFER" as const,
    setRechargeType: jest.fn(),
    isSubmitting: false,
    handleQuickAmount: jest.fn(),
    showHistory: true,
    setShowHistory: jest.fn(),
    rechargeHistory: [historyRow],
    telecomAmount: "",
    setTelecomAmount: jest.fn(),
    onTelecomAmountChange: jest.fn(),
    telecomPrice: "",
    setTelecomPrice: jest.fn(),
    phoneNumber: "",
    setPhoneNumber: jest.fn(),
    paidBy: "CASH",
    setPaidBy: jest.fn(),
    methods: [{ code: "CASH", label: "Cash" }],
    showClientSearch: false,
    setShowClientSearch: jest.fn(),
    telecomClientId: null,
    setTelecomClientId: jest.fn(),
    telecomClientName: "",
    setTelecomClientName: jest.fn(),
    telecomClientPhone: "",
    setTelecomClientPhone: jest.fn(),
    searchClients: jest.fn(),
    clientSearchResults: [],
    selectClient: jest.fn(),
    activeProvider: "MTC",
    activeConfig: undefined,
    handleTelecomSubmit: jest.fn(),
    giftTierKey: "" as const,
    setGiftTierKey: jest.fn(),
    giftAmountUsd: "",
    setGiftAmountUsd: jest.fn(),
    giftPriceLbp: "",
    setGiftPriceLbp: jest.fn(),
    giftCostLbp: "",
    setGiftCostLbp: jest.fn(),
    handleAlfaGiftSubmit: jest.fn(),
    paymentLines: [],
    setPaymentLines: jest.fn(),
    clientName: "",
    setClientName: jest.fn(),
    telecomDaysCostUsd: "",
    setTelecomDaysCostUsd: jest.fn(),
    isShopLineMatch: false,
    onRefreshHistory: jest.fn(),
    ...overrides,
  };
}

describe("TelecomForm onUpdateMetadata (LIRA-109)", () => {
  beforeEach(() => {
    mockUpdateRechargeMetadata.mockClear();
  });

  it("routes the History modal's save through api.updateRechargeMetadata, never window.api", async () => {
    const onRefreshHistory = jest.fn();
    render(<TelecomForm {...buildProps({ onRefreshHistory })} />);

    // Wait for CarrierLinesPanel's mount fetch so its loading state settles
    // before interacting with the History modal.
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());

    fireEvent.click(screen.getByTitle("Edit metadata"));

    const noteInput = screen.getByPlaceholderText("Add a note (optional)");
    fireEvent.change(noteInput, { target: { value: "corrected note" } });

    fireEvent.click(screen.getByTitle("Save"));

    await waitFor(() =>
      expect(mockUpdateRechargeMetadata).toHaveBeenCalledWith({
        id: 7,
        phone_number: "03000091",
        client_name: "Old Name",
        note: "corrected note",
      }),
    );
    expect(mockUpdateRechargeMetadata).toHaveBeenCalledTimes(1);

    // onRefreshHistory only fires on result.success — proves the handler
    // reached the (mocked) adapter and got a success envelope back. (Fires
    // twice: once from TelecomForm's own onUpdateMetadata handler, once more
    // from HistoryModal's saveEdit calling its onRefresh prop — pre-existing
    // double-refresh, unrelated to this ticket's fix; not asserting an exact
    // count to avoid coupling this test to that incidental detail.)
    await waitFor(() => expect(onRefreshHistory).toHaveBeenCalled());

    // Row leaves edit mode (saveEdit's success branch), confirming the
    // update actually resolved through the mock rather than throwing.
    await waitFor(() =>
      expect(screen.getByTitle("Edit metadata")).toBeInTheDocument(),
    );
  });

  it("edits phone_number and client_name too, all three fields reaching the adapter in one call", async () => {
    render(<TelecomForm {...buildProps()} />);
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());

    fireEvent.click(screen.getByTitle("Edit metadata"));

    fireEvent.change(screen.getByPlaceholderText("Phone number"), {
      target: { value: "70999999" },
    });
    fireEvent.change(screen.getByPlaceholderText("Client name"), {
      target: { value: "New Name" },
    });

    fireEvent.click(screen.getByTitle("Save"));

    await waitFor(() =>
      expect(mockUpdateRechargeMetadata).toHaveBeenCalledWith({
        id: 7,
        phone_number: "70999999",
        client_name: "New Name",
        note: "old note",
      }),
    );
  });
});
