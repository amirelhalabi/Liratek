/** @jest-environment jsdom */

/**
 * Services page — a session-basket OMT/WHISH RECEIVE fee-on-top
 * (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.5/§4 Phase F).
 *
 * Phase 0 (§2 bug 1, P0) made a session RECEIVE ship `omtFee: 0` — a
 * necessary STOPGAP because the session basket path didn't wire fee
 * collection through yet (the fee would have stamped profit and booked the
 * supplier ledger for a fee no drawer ever received). Phase F replaces that
 * stopgap with REAL wiring: `splitBasketCashSides` (binanceCart.ts) now pools
 * a fee-on-top RECEIVE's fee into the basket's CHARGE bucket, collected by
 * the pooled session payment lines — so the fee no longer needs to be zeroed
 * out. This file asserts the NEW contract:
 *
 *  1. Fee-on-top (includingFees unchecked, the default): `formData.omtFee`
 *     ships AS ENTERED/resolved (no longer zeroed), and the cart item's
 *     `amount` is the FULL requested payout `-(x)` — the fee is collected
 *     separately, never subtracted from the payout.
 *  2. Fee-included (includingFees checked): `formData.omtFee` +
 *     `formData.includingFees` both ship as entered, and the cart item's
 *     `amount` is the NETTED payout `-(x - f)`.
 *
 * rule 17 — proven failing-first against the PRE-Phase-F code: test 1 failed
 * because `formData.omtFee` read `0` (zeroed by the since-removed payload
 * guard) instead of `1`; test 2 failed because the "Fee included in payout"
 * checkbox didn't even render inside a session (gated out by the
 * since-removed `!(serviceType === "RECEIVE" && activeSession)` guard) —
 * `screen.getByTestId("service-including-fees-toggle")` threw
 * "Unable to find an element". Both captured pre-fix by the orchestrator
 * before this update landed.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Services from "../index";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetSuppliers = jest.fn().mockResolvedValue([]);
const mockGetSupplierBalances = jest.fn().mockResolvedValue([]);
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);
const mockAddToCart = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getOMTHistory: mockGetOMTHistory,
    getOMTAnalytics: mockGetOMTAnalytics,
    getSuppliers: mockGetSuppliers,
    getSupplierBalances: mockGetSupplierBalances,
    partners: { getAll: mockPartnersGetAll },
    addOMTTransaction: mockAddOMTTransaction,
  }),
  MultiPaymentInput: () => <div data-testid="stub-multi-payment-input" />,
  DecimalInput: ({
    id,
    value,
    onChange,
    placeholder,
    className,
  }: {
    id?: string;
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={value === 0 ? "" : String(value)}
      placeholder={placeholder}
      className={className}
      onChange={(e) =>
        onChange(parseFloat(e.target.value.replace(/,/g, "")) || 0)
      }
    />
  ),
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  DataTable: () => <div data-testid="data-table" />,
  TopUpModal: () => null,
}));

// Active session — the RECEIVE-in-session combination this contract covers.
// Only `customer_name`/`customer_phone` are read by index.tsx from this
// object; `addToCart` is what captures the cart payload we assert against.
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: {
      id: 1,
      customer_name: "Jane Doe",
      customer_phone: "70111222",
    },
    linkTransaction: jest.fn(),
    addToCart: mockAddToCart,
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => ({
    saveAsClient: false,
    setSaveAsClient: jest.fn(),
    showCheckbox: false,
    trySaveAsClient: jest.fn().mockResolvedValue({ clientId: null }),
    resetSaveAsClient: jest.fn(),
  }),
}));

jest.mock("@/shared/components/SaveAsClientCheckbox", () => ({
  SaveAsClientCheckbox: () => null,
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

async function renderPage() {
  render(<Services />);
  await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
}

function switchToOmtReceive() {
  const omtReceiveButton = screen
    .getAllByRole("button")
    .find(
      (b) =>
        (b.textContent ?? "").includes("OMT") &&
        (b.textContent ?? "").includes("↓"),
    );
  expect(omtReceiveButton).toBeDefined();
  fireEvent.click(omtReceiveButton!);
}

describe("Services page — session RECEIVE fee-on-top is REAL (BIDIRECTIONAL_PAYMENT_LEGS_PLAN §4 Phase F)", () => {
  beforeEach(() => {
    mockAddToCart.mockClear();
    mockAddOMTTransaction.mockClear();
  });

  it("fee-on-top: ships the resolved $1 tier fee as-entered, and the cart amount is the FULL payout (-$100, fee collected separately)", async () => {
    await renderPage();
    switchToOmtReceive();

    // $100 OMT INTRA USD → INTRA_FEE_TIERS resolves a non-zero $1 tier fee.
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));

    const cartItem = mockAddToCart.mock.calls[0][0] as {
      amount: number;
      formData: Record<string, unknown>;
    };

    // The fee rides through exactly as resolved — no longer zeroed.
    expect(cartItem.formData.omtFee).toBe(1);
    expect(cartItem.formData.includingFees).toBe(false);
    // Fee-on-top: the customer still receives the FULL requested $100 in
    // cash; the $1 fee is collected separately via the pooled charge bucket
    // (splitBasketCashSides), never subtracted from this payout.
    expect(cartItem.amount).toBe(-100);
  });

  it("fee-included: ships includingFees=true, and the cart amount is the NETTED payout (-$99 = -(100 - 1))", async () => {
    await renderPage();
    switchToOmtReceive();

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );

    // This checkbox used to be gated out entirely inside an active session
    // (`!(serviceType === "RECEIVE" && activeSession)`) — Phase F renders it
    // unconditionally.
    fireEvent.click(screen.getByTestId("service-including-fees-toggle"));

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));

    const cartItem = mockAddToCart.mock.calls[0][0] as {
      amount: number;
      formData: Record<string, unknown>;
    };

    expect(cartItem.formData.omtFee).toBe(1);
    expect(cartItem.formData.includingFees).toBe(true);
    // Fee-included: the $1 fee is deducted from the $100 requested amount —
    // the customer receives $99, and there is nothing left to collect
    // separately.
    expect(cartItem.amount).toBe(-99);
  });
});
