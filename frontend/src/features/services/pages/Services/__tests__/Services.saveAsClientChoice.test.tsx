/** @jest-environment jsdom */

/**
 * Shop-day 2026-10-16 (bug 1) — the Services page's "Save as client" choice
 * reaches the server. Unchecked, the payload says `saveAsClient: false`, so
 * the repository links an existing client by phone but never creates one
 * (it used to create one anyway — Fadi Nassar, txn 10901). Checked, the
 * client the hook saved rides the payload as `clientId` (rule 11).
 *
 * Field names are read back through the shared schema (rule 24 / 23), so a
 * key the server would strip fails here.
 *
 * NOT proven failing-first (rule 17): written after the page change. The
 * failing-first proof of the rule is the core test
 * FinancialServiceRepository.saveAsClientOptOut.test.ts.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import Services from "../index";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getSuppliers: jest.fn().mockResolvedValue([]),
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  partners: { getAll: jest.fn().mockResolvedValue([]) },
  addOMTTransaction: mockAddOMTTransaction,
};
const mockSeen: {
  onExtraChange?: ((extra: number) => void) | undefined;
  showDiscount?: boolean | undefined;
  payer?: string | undefined;
} = {};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25).
  useApi: () => mockApi,
  MultiPaymentInput: (props: {
    onChange: (lines: unknown[]) => void;
    onExtraChange?: (extra: number) => void;
    showDiscount?: boolean;
    payer?: string;
  }) => {
    mockSeen.onExtraChange = props.onExtraChange;
    mockSeen.showDiscount = props.showDiscount;
    mockSeen.payer = props.payer;
    return (
      <div data-testid="stub-multi-payment-input">
        <button
          data-testid="mpi-extra-1"
          onClick={() => {
            props.onExtraChange?.(1);
            props.onChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 102 },
            ]);
          }}
        />
        <button
          data-testid="mpi-no-extra"
          onClick={() =>
            props.onChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 101 },
            ])
          }
        />
      </div>
    );
  },
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

const mockSave: { checked: boolean; clientId: number | null } = {
  checked: false,
  clientId: null,
};
const mockTrySaveAsClient = jest.fn(async () => ({
  clientId: mockSave.checked ? mockSave.clientId : null,
}));
jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => ({
    saveAsClient: mockSave.checked,
    setSaveAsClient: jest.fn(),
    showCheckbox: true,
    trySaveAsClient: mockTrySaveAsClient,
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
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
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

function input(id: string): HTMLInputElement {
  const el = document.getElementById(id) as HTMLInputElement | null;
  expect(el).not.toBeNull();
  return el as HTMLInputElement;
}

async function recordSend(): Promise<Record<string, unknown>> {
  await renderPage();
  const typeSelect = Array.from(document.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === "CASH_TO_BUSINESS"),
  ) as HTMLSelectElement | undefined;
  expect(typeSelect).toBeDefined();
  fireEvent.change(typeSelect as HTMLSelectElement, {
    target: { value: "CASH_TO_BUSINESS" },
  });
  fireEvent.change(input("service-amount"), { target: { value: "100" } });
  fireEvent.change(input("service-omt-fee"), { target: { value: "1" } });
  fireEvent.change(input("service-sender-name"), {
    target: { value: "Fadi Nassar" },
  });
  fireEvent.change(input("service-sender-phone"), {
    target: { value: "03778899" },
  });
  fireEvent.click(screen.getByTestId("mpi-no-extra"));
  fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return createFinancialServiceSchema.parse(
    mockAddOMTTransaction.mock.calls[0][0],
  );
}

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
  mockTrySaveAsClient.mockClear();
  mockSave.checked = false;
  mockSave.clientId = null;
});

describe("Services page — the 'Save as client' choice reaches the server", () => {
  it("unchecked: the payload says not to save, and carries no client id", async () => {
    const sent = await recordSend();
    expect(sent.saveAsClient).toBe(false);
    expect(sent.clientId).toBeUndefined();
    expect(sent.senderName).toBe("Fadi Nassar");
  });

  it("checked: the saved client's id rides the payload", async () => {
    mockSave.checked = true;
    mockSave.clientId = 77;
    const sent = await recordSend();
    expect(mockTrySaveAsClient).toHaveBeenCalledTimes(1);
    expect(sent.saveAsClient).toBe(true);
    expect(sent.clientId).toBe(77);
  });
});
