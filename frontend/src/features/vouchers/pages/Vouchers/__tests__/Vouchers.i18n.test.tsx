/**
 * LIRA-331: the Vouchers page in Arabic, and the voucher it creates is the
 * same in both languages (research R9 — no translated text in saved data).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import { VouchersPage } from "../index";

const mockCreate = jest.fn();
const mockGetAll = jest.fn();
// Rule 25 — a stable useApi() reference.
const mockApi = {
  getActivePaymentMethods: jest.fn().mockResolvedValue([]),
  vouchers: {
    getAll: (...a: unknown[]) => mockGetAll(...a),
    create: (...a: unknown[]) => mockCreate(...a),
    cancel: jest.fn(),
  },
  getClients: jest.fn().mockResolvedValue([]),
  createClient: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  DecimalInput: ({
    onChange,
    placeholder,
    "data-testid": testId,
  }: {
    onChange: (n: number) => void;
    placeholder?: string;
    "data-testid"?: string;
  }) => (
    <input
      data-testid={testId}
      placeholder={placeholder}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  ),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 89500 }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

const SELECTED_CLIENT = { id: 7, full_name: "Ali Hassan", phone_number: "03123456" };

beforeEach(() => {
  mockGetAll.mockResolvedValue({ success: true, vouchers: [] });
  mockCreate.mockResolvedValue({ success: false, error: "stop" });
  mockApi.getClients.mockResolvedValue([SELECTED_CLIENT]);
});

afterEach(async () => {
  await i18n.changeLanguage("en");
  jest.clearAllMocks();
});

async function createVoucher(): Promise<unknown> {
  const { container, unmount } = render(<VouchersPage />);
  const search = container.querySelector(
    'input[type="text"]',
  ) as HTMLInputElement;
  fireEvent.change(search, { target: { value: "Ali" } });
  const option = await screen.findByText("Ali Hassan", {}, { timeout: 2000 });
  fireEvent.click(option);
  fireEvent.click(screen.getByText("LBP"));
  fireEvent.change(screen.getByTestId("voucher-amount"), {
    target: { value: "500000" },
  });
  fireEvent.change(container.querySelector('input[type="date"]')!, {
    target: { value: "2026-12-31" },
  });
  fireEvent.change(screen.getByTestId("voucher-note"), {
    target: { value: "gift" },
  });
  const submit = screen.getByTestId("voucher-create-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  const payload = mockCreate.mock.calls[0][0];
  unmount();
  mockCreate.mockClear();
  return payload;
}

it("creates the same voucher in English and Arabic", async () => {
  const en = await createVoucher();
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
  const ar = await createVoucher();
  expect(ar).toEqual(en);
  expect(en).toEqual({
    clientId: 7,
    amount: 500000,
    currency: "LBP",
    expiryDate: "2026-12-31",
    note: "gift",
    payments: [{ method: "CASH", currency_code: "LBP", amount: 500000 }],
    exchange_rate: 89000,
  });
});

it("shows Arabic when the language is ar", async () => {
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
  render(<VouchersPage />);
  expect(await screen.findByText("القسائم")).toBeInTheDocument();
  expect(screen.getAllByText("إنشاء قسيمة").length).toBeGreaterThan(0);
});
