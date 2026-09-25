/** @jest-environment jsdom */

/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch: implement first, verify at the end).
 *
 * OWNER_NOTES_REMAINING_BUILD.md #21, case 2 (LIRA-088, migration v182).
 *
 * The MTC/Alfa shop-line checkbox: shown on the Credit tab whenever the
 * typed phone number matches one of the shop's active lines
 * (`isShopLineMatch`), default ON (case 1, the existing credit buy-back).
 * Unticking it flips the form to case 2 — the customer used the shop's own
 * line for a call, an ordinary credit sale.
 *
 * This test drives `TelecomForm` directly (not the full Recharge page) —
 * `isShopLineMatch`/`shopLineBuyback` are controlled props from the parent
 * (Recharge/index.tsx owns the state), so the checkbox's checked value and
 * every UI branch gated on `isCreditBuyback` are asserted per prop
 * combination, and `setShopLineBuyback` is asserted to be the ONLY thing an
 * uncheck click calls (the component itself is controlled, it does not
 * flip its own display without a prop update).
 *
 * Rule 17 — proven failing-first: reverting `isCreditBuyback`'s derivation
 * from `rechargeType === "CREDIT_TRANSFER" && isShopLineMatch &&
 * shopLineBuyback` back to the pre-fix `rechargeType === "CREDIT_TRANSFER"
 * && isShopLineMatch` (dropping `&& shopLineBuyback`) makes the "unticked
 * checkbox still shows the ordinary sale UI" test below fail — the button
 * would keep reading "Proceed to Pay Out" and the profit preview would stay
 * hidden even with `shopLineBuyback={false}`.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TelecomForm } from "../TelecomForm";
import type { FinancialTransaction } from "../../types";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetActiveCarrierLines = jest.fn().mockResolvedValue([]);

const mockApi = {
  getAllSettings: mockGetAllSettings,
  getActiveCarrierLines: mockGetActiveCarrierLines,
  // m6 fix (2026-09-24 adversarial review): CarrierLinesPanel (rendered
  // alongside TelecomForm in this harness) calls this unconditionally on
  // mount — without it the call throws a TypeError ("not a function").
  getPendingCarrierLineOwedDeliveries: jest
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
  markCarrierLineOwedDeliverySent: jest
    .fn()
    .mockResolvedValue({ success: true, data: null }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

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

function buildProps(
  overrides: Partial<React.ComponentProps<typeof TelecomForm>> = {},
) {
  return {
    isMTC: true,
    rechargeType: "CREDIT_TRANSFER" as const,
    setRechargeType: jest.fn(),
    isSubmitting: false,
    handleQuickAmount: jest.fn(),
    showHistory: false,
    setShowHistory: jest.fn(),
    rechargeHistory: [] as FinancialTransaction[],
    telecomAmount: "3",
    setTelecomAmount: jest.fn(),
    onTelecomAmountChange: jest.fn(),
    telecomPrice: "270000",
    setTelecomPrice: jest.fn(),
    phoneNumber: "70123456",
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
    alfaCreditCostRate: 85000,
    telecomDaysCostUsd: "",
    setTelecomDaysCostUsd: jest.fn(),
    isShopLineMatch: false,
    shopLineBuyback: true,
    setShopLineBuyback: jest.fn(),
    // #28 (LIRA-218) — no primary line by default; individual tests override.
    primaryLine: null,
    ...overrides,
  };
}

describe("TelecomForm — shop-line checkbox (owner note #21, LIRA-088 case 2)", () => {
  it("renders NO checkbox and NO amber note when the phone does not match a shop line", async () => {
    render(<TelecomForm {...buildProps({ isShopLineMatch: false })} />);
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());

    expect(
      screen.queryByTestId("shop-line-buyback-checkbox"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("shop-line-buyback-note"),
    ).not.toBeInTheDocument();
  });

  it("default ON (case 1): checkbox is checked, buy-back note shown, submit button reads 'Proceed to Pay Out', profit preview hidden", async () => {
    render(
      <TelecomForm
        {...buildProps({ isShopLineMatch: true, shopLineBuyback: true })}
      />,
    );
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());

    const checkbox = screen.getByTestId(
      "shop-line-buyback-checkbox",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.getByTestId("shop-line-buyback-note").textContent).toMatch(
      /credit buy-back/i,
    );
    expect(
      screen.getByRole("button", { name: /proceed to pay out/i }),
    ).toBeInTheDocument();
    // Hidden for a buy-back — see the file header on `!isCreditBuyback` in
    // TelecomForm.tsx.
    expect(screen.queryByText("Profit")).not.toBeInTheDocument();
  });

  it("unticked (case 2): buy-back note swaps to the case-2 text, submit button reads 'Proceed to Pay', profit preview shows", async () => {
    render(
      <TelecomForm
        {...buildProps({ isShopLineMatch: true, shopLineBuyback: false })}
      />,
    );
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());

    const checkbox = screen.getByTestId(
      "shop-line-buyback-checkbox",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(screen.getByTestId("shop-line-buyback-note").textContent).toMatch(
      /charged to the customer/i,
    );
    expect(
      screen.getByRole("button", { name: /^proceed to pay$/i }),
    ).toBeInTheDocument();
    // Case 2 is an ordinary sale — the profit preview (hidden for buy-back)
    // is visible again.
    expect(screen.getByText("Profit")).toBeInTheDocument();
  });

  it("clicking the checkbox calls setShopLineBuyback with the new value — the component itself stays controlled", async () => {
    const setShopLineBuyback = jest.fn();
    render(
      <TelecomForm
        {...buildProps({
          isShopLineMatch: true,
          shopLineBuyback: true,
          setShopLineBuyback,
        })}
      />,
    );
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("shop-line-buyback-checkbox"));

    expect(setShopLineBuyback).toHaveBeenCalledWith(false);
    // Controlled: the DOM checkbox does NOT flip on its own without the
    // parent re-rendering with the new `shopLineBuyback` prop.
    expect(
      (screen.getByTestId("shop-line-buyback-checkbox") as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
