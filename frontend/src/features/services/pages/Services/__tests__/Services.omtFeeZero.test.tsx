/** @jest-environment jsdom */

/**
 * OMT SEND: typing 0 in "OMT fee (charged by OMT)" waives the fee. Only an
 * EMPTY box falls back to the automatic tier fee. The fee box turned a typed
 * 0 into "" (`n ? String(n) : ""`), so 0 was read as "use auto" and the
 * $15 Western Union fee on $400 was still charged (owner-reported
 * 2026-10-29). Uses the REAL DecimalInput: the bug lived in how the box
 * reports a typed 0. Field names come from the shared schema (rule 24).
 * Written after the fix — not proven failing-first (rule 17).
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
const mockSeen: { total?: number | undefined } = {};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25).
  useApi: () => mockApi,
  MultiPaymentInput: (props: {
    onChange: (lines: unknown[]) => void;
    totals: { amount: number }[];
  }) => {
    mockSeen.total = props.totals[0]?.amount;
    return (
      <button
        data-testid="mpi-pay-total"
        onClick={() =>
          props.onChange([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "USD",
              amount: props.totals[0]?.amount ?? 0,
            },
          ])
        }
      />
    );
  },
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

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
  delete mockSeen.total;
});

async function setUpWesternUnion400(): Promise<HTMLInputElement> {
  render(<Services />);
  await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
  const select = Array.from(document.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === "WESTERN_UNION"),
  ) as HTMLSelectElement | undefined;
  expect(select).toBeDefined();
  fireEvent.change(select as HTMLSelectElement, {
    target: { value: "WESTERN_UNION" },
  });
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value: "400" } },
  );
  return screen.getByTestId("service-omt-fee-input") as HTMLInputElement;
}

async function submitSend(): Promise<
  ReturnType<typeof createFinancialServiceSchema.parse>
> {
  fireEvent.click(screen.getByTestId("mpi-pay-total"));
  fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return createFinancialServiceSchema.parse(
    mockAddOMTTransaction.mock.calls[0][0],
  );
}

describe("Services page — OMT fee typed as 0", () => {
  it("an empty fee box charges the automatic fee", async () => {
    await setUpWesternUnion400();
    await waitFor(() => expect(mockSeen.total).toBe(415));
    const sent = await submitSend();
    expect(sent.omtFee).toBe(15);
  });

  it("a typed 0 waives the fee in the payment total and the payload", async () => {
    const feeBox = await setUpWesternUnion400();
    fireEvent.focus(feeBox);
    fireEvent.change(feeBox, { target: { value: "0" } });
    fireEvent.blur(feeBox);
    // The box keeps showing 0, not the "(auto)" placeholder.
    expect(feeBox.value).toBe("0");
    await waitFor(() => expect(mockSeen.total).toBe(400));
    const sent = await submitSend();
    expect(sent.omtFee).toBe(0);
  });
});
