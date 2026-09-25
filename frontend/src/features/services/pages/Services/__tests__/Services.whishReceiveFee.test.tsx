/** @jest-environment jsdom */

/**
 * Services page — WHISH system RECEIVE fee handling.
 *
 * D1 (owner decision, OWNER_NOTES_2026-09-21.md §2b, 2026-09-23): "Whish
 * system RECEIVE — fee optional; on top → feePayments/fee leg; deducted →
 * includingFees: true." Unlike OMT system RECEIVE (informational only, see
 * Services.feeCounterFlow.test.tsx), a Whish RECEIVE fee DOES move the
 * drawer and is booked as shop profit — the same on-top/deducted mechanism
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase C already built for OMT, now
 * reused here instead (WHISH-only after D1's rewrite of showFeeCounterFlow/
 * feeCounterFlowActive/the "Including Fees Checkbox" render gate).
 *
 * Before D1, WHISH had NO fee UI on this page at all (LIRA-023 "Whish System
 * has no fees" — hidden unconditionally for both SEND and RECEIVE). This file
 * is new coverage, not a rewrite of a prior WHISH-fee test.
 *
 * `useShopBase` here is mocked the OPPOSITE way from
 * Services.feeCounterFlow.test.tsx (baseSystem "WHISH", partnerSystem "OMT")
 * so WHISH is the shop's freely-reachable base system — matching the app's
 * real gating (`prov === partnerSystem` requires an active partner to even
 * open that tab) without needing to seed a partner list.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEffect } from "react";
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

// Stable reference — see Services.feeCounterFlow.test.tsx's identical note:
// a fresh object per render re-fires loadData's effect and wipes in-progress
// form state (rule 25).
const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: mockGetSupplierBalances,
  partners: { getAll: mockPartnersGetAll },
  addOMTTransaction: mockAddOMTTransaction,
};

let mockActiveSession: {
  id: number;
  customer_name?: string;
  customer_phone?: string;
} | null = null;

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  MultiPaymentInput: ({
    counterFlow,
  }: {
    onChange: (lines: unknown[]) => void;
    counterFlow?: {
      totalAmount: number;
      currency: string;
      onChange: (lines: unknown[]) => void;
      hasClient?: boolean;
    };
  }) => (
    <div data-testid="stub-multi-payment-input">
      {counterFlow && (
        <>
          <span data-testid="counter-flow-has-client">
            {String(counterFlow.hasClient)}
          </span>
          <button
            data-testid="mpi-seed-counter-flow"
            onClick={() =>
              counterFlow.onChange([
                {
                  id: "FEE1",
                  method: "CASH",
                  currencyCode: counterFlow.currency,
                  amount: counterFlow.totalAmount,
                },
              ])
            }
          />
        </>
      )}
    </div>
  ),
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

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession,
    linkTransaction: jest.fn(),
    addToCart: mockAddToCart,
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "WHISH", label: "Whish Wallet" },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

// Flipped from Services.feeCounterFlow.test.tsx (see file docblock): WHISH
// is the base system here, so its tab needs no active partner to open.
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "WHISH",
    partnerSystem: "OMT",
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
  ClientAutocompleteInput: ({
    id,
    value,
    onChange,
    placeholder,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <input
      id={id}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// The THROUGH-mode selector never mounts in this file — provider stays
// "WHISH" (base system, no partner gate) throughout.
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: ({
    onSelect,
  }: {
    selectedPartnerId: number | null;
    onSelect: (id: number) => void;
    required?: boolean;
    autoSelectSingle?: boolean;
    systemFilter?: string;
  }) => {
    useEffect(() => {
      onSelect(1);
    }, [onSelect]);
    return null;
  },
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

/** Switch the page to WHISH RECEIVE. */
function switchToWhishReceive() {
  const whishReceiveButton = screen
    .getAllByRole("button")
    .find(
      (b) =>
        (b.textContent ?? "").includes("WHISH") &&
        (b.textContent ?? "").includes("↓"),
    );
  expect(whishReceiveButton).toBeDefined();
  fireEvent.click(whishReceiveButton!);
}

describe("Services page — WHISH system RECEIVE fee is optional and drawer-affecting (D1, 2026-09-23)", () => {
  beforeEach(() => {
    mockActiveSession = null;
    mockAddOMTTransaction.mockClear();
    mockAddToCart.mockClear();
  });

  it("no fee entered: submits with no fee, no counter-flow, includingFees false", async () => {
    await renderPage();
    switchToWhishReceive();

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );

    expect(
      screen.queryByTestId("mpi-seed-counter-flow"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.includingFees).toBe(false);
    expect(payload).not.toHaveProperty("feePayments");
  });

  it("fee $5 on top, non-session: counter-flow seeds feePayments with the fee amount", async () => {
    await renderPage();
    switchToWhishReceive();

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.change(
      document.getElementById("service-whish-fee") as HTMLInputElement,
      { target: { value: "5" } },
    );

    // Simulate MultiPaymentInput's mount-seeding effect for the counter-flow
    // section (real behavior proven in MultiPaymentInput.test.tsx).
    fireEvent.click(screen.getByTestId("mpi-seed-counter-flow"));

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.whishFee).toBe(5);
    expect(payload.includingFees).toBe(false);
    expect(payload.feePayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 5 },
    ]);
  });

  it("fee $5 deducted (includingFees checked): no counter-flow, includingFees:true, no feePayments", async () => {
    await renderPage();
    switchToWhishReceive();

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.change(
      document.getElementById("service-whish-fee") as HTMLInputElement,
      { target: { value: "5" } },
    );
    fireEvent.click(screen.getByTestId("service-including-fees-toggle"));

    expect(
      screen.queryByTestId("mpi-seed-counter-flow"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.whishFee).toBe(5);
    expect(payload.includingFees).toBe(true);
    expect(payload).not.toHaveProperty("feePayments");
  });

  it("active session: no counter-flow, cart formData carries no feePayments", async () => {
    mockActiveSession = {
      id: 1,
      customer_name: "Jane Doe",
      customer_phone: "70111222",
    };
    await renderPage();
    switchToWhishReceive();

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.change(
      document.getElementById("service-whish-fee") as HTMLInputElement,
      { target: { value: "5" } },
    );

    expect(
      screen.queryByTestId("mpi-seed-counter-flow"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));

    const cartItem = mockAddToCart.mock.calls[0][0] as {
      formData: Record<string, unknown>;
    };
    expect(cartItem.formData).not.toHaveProperty("feePayments");
  });

  it('"For Partner" toggle ON: counter-flow hidden, no feePayments sent', async () => {
    await renderPage();
    switchToWhishReceive();

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.change(
      document.getElementById("service-whish-fee") as HTMLInputElement,
      { target: { value: "5" } },
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /For Partner/i }));

    expect(
      screen.queryByTestId("mpi-seed-counter-flow"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.partnerMode).toBe("FOR");
    expect(payload.partnerId).toBe(1);
    expect(payload).not.toHaveProperty("feePayments");
  });

  // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §10.3: the counter-flow's
  // CUSTOMER_ACCOUNT gate must use the canonical name-AND-phone rule
  // (`canChargeToCustomerAccount`) — moved here from
  // Services.feeCounterFlow.test.tsx (D1 relocates the counter-flow
  // mechanism from OMT to WHISH RECEIVE).
  describe("counter-flow hasClient gate (§10.3 — name-AND-phone, not name-OR-phone)", () => {
    async function setUpReceiveWithFee() {
      await renderPage();
      switchToWhishReceive();
      fireEvent.change(
        document.getElementById("service-amount") as HTMLInputElement,
        { target: { value: "100" } },
      );
      fireEvent.change(
        document.getElementById("service-whish-fee") as HTMLInputElement,
        { target: { value: "5" } },
      );
    }

    it("receiver name only (no phone) → hasClient is false", async () => {
      await setUpReceiveWithFee();

      fireEvent.change(
        document.getElementById("service-receiver-name") as HTMLInputElement,
        { target: { value: "Jane Doe" } },
      );

      expect(screen.getByTestId("counter-flow-has-client")).toHaveTextContent(
        "false",
      );
    });

    it("receiver phone only (no name) → hasClient is false", async () => {
      await setUpReceiveWithFee();

      fireEvent.change(
        document.getElementById("service-receiver-phone") as HTMLInputElement,
        { target: { value: "70111222" } },
      );

      expect(screen.getByTestId("counter-flow-has-client")).toHaveTextContent(
        "false",
      );
    });

    it("receiver name AND phone → hasClient is true", async () => {
      await setUpReceiveWithFee();

      fireEvent.change(
        document.getElementById("service-receiver-name") as HTMLInputElement,
        { target: { value: "Jane Doe" } },
      );
      fireEvent.change(
        document.getElementById("service-receiver-phone") as HTMLInputElement,
        { target: { value: "70111222" } },
      );

      expect(screen.getByTestId("counter-flow-has-client")).toHaveTextContent(
        "true",
      );
    });
  });
});
