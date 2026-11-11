/** @jest-environment jsdom */

/**
 * LIRA-387 (owner 2026-11-11: "keep it consistent in all the payment rows")
 * — the OMT/Whish Services page's client rules.
 *
 * F3: picking a registered client copied only the name and phone; the id
 * never reached the payload (rule 11), so the server re-found the client by
 * phone and an edited phone booked the debt to a duplicate client. Picking
 * also did not switch a SEND to Customer Account (POS, Loto and Custom
 * Services do).
 * F2 (page half): a RECEIVE paid out to the receiver's account showed no
 * "client needed" state for a name without a phone.
 *
 * Payload names are read back through the real core schema (rule 24).
 * Rule 17: run against the unfixed page first and seen failing.
 * Harness copied from Services.saveAsClientChoice.test.tsx.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import Services from "../index";

const mockPicked = {
  id: 55,
  full_name: "Rami Haddad",
  phone_number: "70123456",
};

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
const mockPaymentProps: Array<Record<string, unknown>> = [];

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25).
  useApi: () => mockApi,
  // Records its props; lets the test pay by cash or put it all on account.
  MultiPaymentInput: (props: {
    onChange: (lines: unknown[]) => void;
    totals?: { amount: number; currency: string }[];
  }) => {
    mockPaymentProps.push(props as Record<string, unknown>);
    const total = props.totals?.[0]?.amount ?? 0;
    return (
      <div data-testid="stub-multi-payment-input">
        <button
          data-testid="mpi-cash"
          onClick={() =>
            props.onChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: total },
            ])
          }
        />
        <button
          data-testid="mpi-account"
          onClick={() =>
            props.onChange([
              {
                id: "L1",
                method: "CUSTOMER_ACCOUNT",
                currencyCode: "USD",
                amount: total,
              },
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
      { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
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
  // A plain input plus a "pick" button that selects the registered client
  // the way the real dropdown does (onClientSelect with the client row).
  ClientAutocompleteInput: ({
    id,
    value,
    onChange,
    onClientSelect,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
    onClientSelect?: (c: {
      id: number;
      full_name: string;
      phone_number: string;
    }) => void;
  }) => (
    <>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      <button
        data-testid={`pick-${id}`}
        onClick={() => {
          onChange(mockPicked.full_name);
          onClientSelect?.(mockPicked);
        }}
      />
    </>
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

const lastProps = () => mockPaymentProps[mockPaymentProps.length - 1];

async function startSend() {
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
}

async function submit(label: RegExp): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole("button", { name: label }));
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
  mockPaymentProps.length = 0;
});

describe("Services — a picked client (LIRA-387 F3)", () => {
  it("SEND: picking a client switches the payment to Customer Account", async () => {
    await startSend();
    fireEvent.click(screen.getByTestId("pick-service-sender-name"));
    expect(lastProps().initialMethod).toBe("CUSTOMER_ACCOUNT");
    expect(lastProps().hasClient).toBe(true);
  });

  it("SEND: the picked client's id rides the payload, even after the phone is edited", async () => {
    await startSend();
    fireEvent.click(screen.getByTestId("pick-service-sender-name"));
    fireEvent.change(input("service-sender-phone"), {
      target: { value: "70999999" },
    });
    fireEvent.click(screen.getByTestId("mpi-account"));
    const sent = await submit(/Record Send/i);
    expect(sent.clientId).toBe(mockPicked.id);
    expect(sent.senderClientId).toBe(mockPicked.id);
    expect(
      (sent.payments as { method: string }[]).some(
        (l) => l.method === "CUSTOMER_ACCOUNT",
      ),
    ).toBe(true);
  });

  it("SEND: retyping the name drops the picked client", async () => {
    await startSend();
    fireEvent.click(screen.getByTestId("pick-service-sender-name"));
    fireEvent.change(input("service-sender-name"), {
      target: { value: "Someone Else" },
    });
    fireEvent.click(screen.getByTestId("mpi-cash"));
    const sent = await submit(/Record Send/i);
    expect(sent.clientId).toBeUndefined();
    expect(sent.senderClientId).toBeUndefined();
  });

  it("SEND: a name without a phone is not a chargeable client", async () => {
    await startSend();
    fireEvent.change(input("service-sender-name"), {
      target: { value: "Walk In" },
    });
    expect(lastProps().hasClient).toBe(false);
    expect(lastProps().autoDebtRemainder).toBe(false);
  });
});

describe("Services — RECEIVE to the receiver's account (LIRA-387 F2, page half)", () => {
  async function startReceive() {
    await renderPage();
    // The OMT "↓" (receive) button, as Services.roundUp.test.tsx finds it.
    const receive = screen
      .getAllByRole("button")
      .find(
        (el) =>
          (el.textContent ?? "").includes("OMT") &&
          (el.textContent ?? "").includes("↓"),
      );
    if (!receive) throw new Error("no RECEIVE button");
    fireEvent.click(receive);
    await waitFor(() =>
      expect(document.getElementById("service-receiver-name")).not.toBeNull(),
    );
    fireEvent.change(input("service-amount"), { target: { value: "100" } });
  }

  it("an account payout line asks for a client while the receiver has no phone", async () => {
    await startReceive();
    fireEvent.change(input("service-receiver-name"), {
      target: { value: "Nour Saleh" },
    });
    fireEvent.click(screen.getByTestId("mpi-account"));
    expect(lastProps().requiresClientForDebt).toBe(true);
    expect(lastProps().hasClient).toBe(false);
    fireEvent.change(input("service-receiver-phone"), {
      target: { value: "71222333" },
    });
    expect(lastProps().hasClient).toBe(true);
  });

  it("a picked receiver's id rides the payload; picking does not switch the payout", async () => {
    await startReceive();
    fireEvent.click(screen.getByTestId("pick-service-receiver-name"));
    expect(lastProps().initialMethod).toBeUndefined();
    fireEvent.click(screen.getByTestId("mpi-account"));
    const sent = await submit(/Record Receive/i);
    expect(sent.clientId).toBe(mockPicked.id);
    expect(sent.receiverClientId).toBe(mockPicked.id);
  });
});
