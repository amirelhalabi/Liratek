/** @jest-environment jsdom */

/**
 * Services page — payment legs must be forwarded whenever ANY payment line
 * exists, never gated on split (S1, PAYMENT_LEGS_INTEGRITY_PLAN wave 6).
 *
 * Pre-fix, the submit payload only included `payments` when
 * `isSplitPayment && paymentLines.length > 0` — a SINGLE-line payment (the
 * common case) silently dropped the tender's amount + currency; only the
 * method (`paidByMethod`) survived. The backend's fallback then assumed the
 * tender currency equalled the service currency — the owner-reported Whish
 * App LBP-as-USD bug, reproduced here on an OMT INTRA SEND: a single LBP cash
 * leg on an LBP send must reach `addOMTTransaction` as a real `payments[]`
 * leg carrying its own method/currency/amount, not just a scalar.
 *
 * Proven failing-first (rule 17): reverting the `isSplitPayment &&` gate at
 * index.tsx:833 makes this test's `payments` assertion fail (payload falls
 * to the `paidByMethod`-only branch instead).
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
  // Stub exposing the onChange/onReturnChange callbacks the page wires —
  // a single button injects ONE payment line (no split, no voucher).
  MultiPaymentInput: ({
    onChange,
  }: {
    onChange: (lines: unknown[]) => void;
  }) => (
    <div data-testid="stub-multi-payment-input">
      <button
        data-testid="mpi-inject-single-lbp-cash"
        onClick={() =>
          onChange([
            { id: "L1", method: "CASH", currencyCode: "LBP", amount: 900000 },
          ])
        }
      />
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
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
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

describe("Services page — payment legs never gated on split (S1)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("forwards a SINGLE-line LBP cash payment as a real leg on an OMT INTRA send", async () => {
    await renderPage();

    // Default state: provider OMT, omtServiceType INTRA, serviceType SEND.
    // Toggle to LBP and enter the send amount.
    fireEvent.click(screen.getByRole("button", { name: "LBP" }));
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "900000" } },
    );

    // Inject ONE payment line (no split) — the common single-tender case.
    fireEvent.click(screen.getByTestId("mpi-inject-single-lbp-cash"));

    fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    // The bug: pre-fix, a single (non-split) line fell through to
    // `{ paidByMethod }` — no `payments` key, so the tender's own
    // amount/currency never reached the backend.
    expect(payload.payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "LBP",
        amount: 900000,
      }),
    ]);
  });
});
