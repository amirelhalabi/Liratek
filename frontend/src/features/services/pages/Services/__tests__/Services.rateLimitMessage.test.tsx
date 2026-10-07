/** @jest-environment jsdom */

/**
 * LIRA-282 — when the server refuses a load with HTTP 429 (rate limit), the
 * Services page must show the server's clear message ("Too many requests —
 * please wait a minute and try again.") instead of the vague "Failed to load
 * data. Tap refresh to retry.", which told a cashier nothing about what to
 * do. Any OTHER load failure keeps the generic message.
 *
 * `requestJson` (api/httpClient.ts) throws a plain `ApiError`
 * `{ status, message, details }` on any non-2xx — reproduced here as the
 * rejection value of one of the page's load calls.
 *
 * The useApi mock returns ONE stable object (CLAUDE.md rule 25): `loadData`
 * depends on `api`, so a fresh literal per call would re-fire it forever.
 */

import { render, screen } from "@testing-library/react";
import Services from "../index";

const RATE_LIMIT_MESSAGE =
  "Too many requests — please wait a minute and try again.";

const mockGetOMTHistory = jest.fn();
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetSuppliers = jest.fn().mockResolvedValue([]);
const mockGetSupplierBalances = jest.fn().mockResolvedValue([]);
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);

const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: mockGetSupplierBalances,
  partners: { getAll: mockPartnersGetAll },
  addOMTTransaction: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Stub exposing the onChange/onReturnChange callbacks the page wires —
  // a single button injects ONE payment line (no split, no voucher).
  MultiPaymentInput: ({
    onChange,
  }: {
    onChange: (lines: unknown[]) => void;
  }) => (
    <div
      data-testid="stub-multi-payment-input"
      data-has-onchange={!!onChange}
    />
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

describe("Services page — load failure message (LIRA-282)", () => {
  beforeEach(() => {
    mockGetOMTHistory.mockReset();
  });

  it("shows the server's rate-limit message when a load is refused with 429", async () => {
    mockGetOMTHistory.mockRejectedValue({
      status: 429,
      message: RATE_LIMIT_MESSAGE,
      details: { success: false, error: RATE_LIMIT_MESSAGE },
    });
    render(<Services />);

    expect(await screen.findByText(RATE_LIMIT_MESSAGE)).toBeTruthy();
    expect(
      screen.queryByText("Failed to load data. Tap refresh to retry."),
    ).toBeNull();
  });

  it("keeps the generic message for any other failure", async () => {
    mockGetOMTHistory.mockRejectedValue({
      status: 500,
      message: "SQLITE_BUSY: database is locked",
    });
    render(<Services />);

    expect(
      await screen.findByText("Failed to load data. Tap refresh to retry."),
    ).toBeTruthy();
    expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
  });
});
