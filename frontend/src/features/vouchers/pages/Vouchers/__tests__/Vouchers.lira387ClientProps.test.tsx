/** @jest-environment jsdom */

/**
 * LIRA-387 F4 (owner 2026-11-11: "keep it consistent in all the payment
 * rows") — the voucher sale's payment box got no client props: with a
 * registered client picked and Customer Account chosen it showed a false red
 * "Client is required"; picking did not switch to the account (POS, Loto,
 * Custom Services do); a shortfall never went on the account. The page now
 * takes the shared builder's props (`clientPaymentProps`). Change left with
 * the customer can NOT go to the account here — the server refuses it
 * (VoucherRepository.sellVoucher) — so the builder is told so.
 *
 * The real page, the real `usePaymentMethods` and the real shared
 * `MultiPaymentInput`; only the API is mocked. Payloads are parsed through
 * the real core schema (rule 24).
 * Rule 17: run against the unfixed page first and seen failing.
 * Harness copied from Vouchers.sellCancel.test.tsx.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { voucherCreateSchema } from "@liratek/core";
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

function methodSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector(
    'select[data-testid^="payment-method-"]',
  ) as HTMLSelectElement | null;
  if (!select) throw new Error("payment method select not rendered");
  return select;
}

async function pickAliAndAmount(container: HTMLElement, amount: string) {
  const search = container.querySelector('input[type="text"]') as HTMLInputElement;
  fireEvent.change(search, { target: { value: "Ali" } });
  fireEvent.click(await screen.findByText("Ali Hassan", {}, { timeout: 2000 }));
  fireEvent.change(screen.getByTestId("voucher-amount"), {
    target: { value: amount },
  });
  await screen.findByTestId("multi-payment-input");
  await waitFor(() =>
    expect(
      Array.from(methodSelect(container).options).map((o) => o.value),
    ).toContain("OMT"),
  );
}

function setPaymentAmount(container: HTMLElement, value: string) {
  const field = container.querySelector(
    'input[data-testid^="payment-amount-"]',
  ) as HTMLInputElement;
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

describe("Voucher sale — a picked client's payment box (LIRA-387 F4)", () => {
  it("picking a client switches the payment to Customer Account", async () => {
    const { container } = render(<VouchersPage />);
    await pickAliAndAmount(container, "50");
    await waitFor(() =>
      expect(methodSelect(container).value).toBe("CUSTOMER_ACCOUNT"),
    );
  });

  it("Customer Account with a picked client shows no 'client needed' box", async () => {
    const { container } = render(<VouchersPage />);
    await pickAliAndAmount(container, "50");
    fireEvent.change(methodSelect(container), {
      target: { value: "CUSTOMER_ACCOUNT" },
    });
    await waitFor(() =>
      expect(methodSelect(container).value).toBe("CUSTOMER_ACCOUNT"),
    );
    expect(screen.queryByTestId("client-needed")).toBeNull();
  });

  it("a cash shortfall goes on the account and the sale carries both legs", async () => {
    const { container } = render(<VouchersPage />);
    await pickAliAndAmount(container, "50");
    fireEvent.change(methodSelect(container), { target: { value: "CASH" } });
    setPaymentAmount(container, "30");
    const submit = screen.getByTestId("voucher-create-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const parsed = voucherCreateSchema.parse(mockCreate.mock.calls[0][0]);
    expect(parsed.clientId).toBe(ALI.id);
    expect(parsed.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "CASH", amount: 30 }),
        expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 20 }),
      ]),
    );
  });
});
