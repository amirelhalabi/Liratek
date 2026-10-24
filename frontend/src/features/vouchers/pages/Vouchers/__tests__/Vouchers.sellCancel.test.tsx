/** @jest-environment jsdom */

/**
 * LIRA-339 (T060) — a voucher is SOLD for money and a cancel REFUNDS what the
 * sale took in. The real page, the real `usePaymentMethods` and the real
 * shared `MultiPaymentInput` run here; only the API is mocked.
 *
 * Payload field names are never hand-typed (rule 24): every payload is
 * parsed through the core schema it is sent to, and its keys are checked
 * against that schema's own shape.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { voucherCancelSchema, voucherCreateSchema } from "@liratek/core";
import { VouchersPage } from "../index";

type Method = {
  id: number;
  code: string;
  label: string;
  drawer_name: string;
  affects_drawer: number;
  sort_order: number;
  is_active: number;
  is_system: number;
  created_at: string;
};

const METHODS: Method[] = [
  ["CASH", "Cash", "General"],
  ["OMT", "OMT", "OMT_System"],
  ["WHISH", "Whish", "Whish_App"],
  ["CUSTOMER_ACCOUNT", "Customer Account", ""],
  ["GIFT_CARD", "Gift Card", ""],
].map(([code, label, drawer], i) => ({
  id: i + 1,
  code,
  label,
  drawer_name: drawer,
  affects_drawer: code === "CUSTOMER_ACCOUNT" || code === "GIFT_CARD" ? 0 : 1,
  sort_order: i,
  is_active: 1,
  is_system: 1,
  created_at: "2026-10-24 00:00:00",
}));

const mockCreate = jest.fn();
const mockCancel = jest.fn();
const mockGetAll = jest.fn();
const mockGetClients = jest.fn();

// Rule 25 — ONE stable useApi() reference for the whole file.
const mockApi = {
  getActivePaymentMethods: jest.fn().mockResolvedValue(METHODS),
  vouchers: {
    getAll: (...a: unknown[]) => mockGetAll(...a),
    create: (...a: unknown[]) => mockCreate(...a),
    cancel: (...a: unknown[]) => mockCancel(...a),
  },
  getClients: (...a: unknown[]) => mockGetClients(...a),
  createClient: jest.fn(),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
    // The page's own face-value field (MultiPaymentInput imports its
    // DecimalInput directly, so this mock never reaches the payment lines).
    DecimalInput: ({
      onChange,
      "data-testid": testId,
    }: {
      onChange: (n: number) => void;
      "data-testid"?: string;
    }) => (
      <input
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    ),
  };
});

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 89500 }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

const ALI = { id: 7, full_name: "Ali Hassan", phone_number: "03123456" };

beforeEach(() => {
  mockGetAll.mockResolvedValue({ success: true, vouchers: [] });
  mockCreate.mockResolvedValue({ success: false, error: "stop" });
  mockCancel.mockResolvedValue({ success: true });
  mockGetClients.mockResolvedValue([ALI]);
});

afterEach(() => jest.clearAllMocks());

function methodLabels(container: HTMLElement): string[] {
  const select = container.querySelector(
    'select[data-testid^="payment-method-"]',
  ) as HTMLSelectElement | null;
  if (!select) throw new Error("payment method select not rendered");
  return Array.from(select.options).map((o) => o.textContent ?? "");
}

async function pickAliAndAmount(container: HTMLElement, amount: string) {
  const search = container.querySelector('input[type="text"]') as HTMLInputElement;
  fireEvent.change(search, { target: { value: "Ali" } });
  fireEvent.click(await screen.findByText("Ali Hassan", {}, { timeout: 2000 }));
  fireEvent.change(screen.getByTestId("voucher-amount"), {
    target: { value: amount },
  });
  await screen.findByTestId("multi-payment-input");
  await waitFor(() => expect(methodLabels(container)).toContain("OMT"));
}

function expectSchemaKeys(payload: object, shape: object) {
  for (const k of Object.keys(payload)) expect(Object.keys(shape)).toContain(k);
}

describe("Create — the voucher is sold", () => {
  it("sends ONE payload with the payment legs and the tender rate", async () => {
    const { container } = render(<VouchersPage />);
    await pickAliAndAmount(container, "50");
    const submit = screen.getByTestId("voucher-create-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const payload = mockCreate.mock.calls[0][0];
    expectSchemaKeys(payload, voucherCreateSchema.shape);
    const parsed = voucherCreateSchema.parse(payload);
    expect(parsed.clientId).toBe(7);
    expect(parsed.amount).toBe(50);
    expect(parsed.currency).toBe("USD");
    expect(parsed.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 50 },
    ]);
    expect(parsed.exchange_rate).toBe(89000);
  });

  it("keeps Save disabled until the legs cover the face value", async () => {
    const { container } = render(<VouchersPage />);
    await pickAliAndAmount(container, "50");
    const amountField = container.querySelector(
      'input[data-testid^="payment-amount-"]',
    ) as HTMLInputElement;
    fireEvent.focus(amountField);
    fireEvent.change(amountField, { target: { value: "20" } });
    fireEvent.blur(amountField);
    const submit = screen.getByTestId("voucher-create-submit");
    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.focus(amountField);
    fireEvent.change(amountField, { target: { value: "50" } });
    fireEvent.blur(amountField);
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  it("offers Customer account with name + phone, never Gift card", async () => {
    const { container } = render(<VouchersPage />);
    await pickAliAndAmount(container, "50");
    const labels = methodLabels(container);
    expect(labels).toContain("Customer Account");
    expect(labels).not.toContain("Gift Card");
  });

  it("does not offer Customer account without a phone", async () => {
    mockGetClients.mockResolvedValue([]);
    const { container } = render(<VouchersPage />);
    const search = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(search, { target: { value: "New Person" } });
    fireEvent.change(screen.getByTestId("voucher-amount"), {
      target: { value: "50" },
    });
    await screen.findByTestId("multi-payment-input");
    await waitFor(() => expect(methodLabels(container)).toContain("OMT"));
    const labels = methodLabels(container);
    expect(labels).not.toContain("Customer Account");
    expect(labels).not.toContain("Gift Card");
  });
});

const SOLD = {
  id: 11,
  code: "VCH-SOLD",
  client_id: 7,
  client_name: "Ali Hassan",
  amount: 50,
  currency_code: "USD",
  expiry_date: null,
  status: "pending",
  sale_usd: 50,
  sale_lbp: 0,
  sale_account_usd: 20,
  sale_account_lbp: 0,
};

describe("Cancel — refund what the sale took in", () => {
  it("pays back the cash part and shows the account part", async () => {
    mockGetAll.mockResolvedValue({ success: true, vouchers: [SOLD] });
    const { container } = render(<VouchersPage />);
    fireEvent.click(await screen.findByTestId("voucher-cancel-11"));
    const sheet = await screen.findByTestId("voucher-cancel-sheet");
    expect(
      within(sheet).getByText(/\$20\.00 back to the customer's account/),
    ).toBeInTheDocument();
    await waitFor(() => expect(methodLabels(sheet)).toContain("OMT"));
    expect(methodLabels(sheet)).not.toContain("Customer Account");
    expect(methodLabels(sheet)).not.toContain("Gift Card");
    const confirm = within(sheet).getByTestId("voucher-cancel-confirm");
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    const [id, data] = mockCancel.mock.calls[0];
    expect(id).toBe(11);
    expectSchemaKeys(data, voucherCancelSchema.shape);
    const parsed = voucherCancelSchema.parse(data);
    expect(parsed.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 30 },
    ]);
    expect(parsed.exchange_rate).toBe(89000);
    expect(parsed.client_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(container).toBeTruthy();
  });

  it("a legacy (never sold) voucher refunds nothing", async () => {
    const legacy = {
      ...SOLD,
      id: 12,
      code: "VCH-OLD",
      sale_usd: undefined,
      sale_lbp: undefined,
      sale_account_usd: undefined,
      sale_account_lbp: undefined,
    };
    mockGetAll.mockResolvedValue({ success: true, vouchers: [legacy] });
    render(<VouchersPage />);
    fireEvent.click(await screen.findByTestId("voucher-cancel-12"));
    const sheet = await screen.findByTestId("voucher-cancel-sheet");
    expect(
      within(sheet).getByText("No refund: this voucher was not sold"),
    ).toBeInTheDocument();
    expect(within(sheet).queryByTestId("multi-payment-input")).toBeNull();
    fireEvent.click(within(sheet).getByTestId("voucher-cancel-confirm"));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    const parsed = voucherCancelSchema.parse(mockCancel.mock.calls[0][1]);
    expect(parsed.payments ?? []).toEqual([]);
  });

  it("an expired unused voucher can still be cancelled for a refund", async () => {
    mockGetAll.mockResolvedValue({
      success: true,
      vouchers: [{ ...SOLD, id: 13, status: "expired" }],
    });
    render(<VouchersPage />);
    expect(await screen.findByTestId("voucher-cancel-13")).toBeInTheDocument();
  });
});
