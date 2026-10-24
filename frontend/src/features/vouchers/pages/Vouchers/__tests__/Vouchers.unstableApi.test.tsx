/**
 * Rule 25 — the Vouchers page reads `api` through a ref, so a `useApi()`
 * whose identity changes on every render does not re-load the list on every
 * render. This mock is DELIBERATELY unstable (a fresh object per call).
 */
import { act, render, screen } from "@testing-library/react";
import { VouchersPage } from "../index";

const mockGetAll = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Fresh object literal every call — the identity churn production hides.
  useApi: () => ({
    getActivePaymentMethods: jest.fn().mockResolvedValue([]),
    vouchers: {
      getAll: (...a: unknown[]) => mockGetAll(...a),
      create: jest.fn(),
      cancel: jest.fn(),
    },
    getClients: jest.fn().mockResolvedValue([]),
    createClient: jest.fn(),
  }),
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 89500 }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

it("loads the voucher list once despite an unstable useApi() identity", async () => {
  mockGetAll.mockResolvedValue({ success: true, vouchers: [] });
  render(<VouchersPage />);
  // The component actually rendered (rule 28a), then let effects settle.
  expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });
  expect(mockGetAll).toHaveBeenCalledTimes(1);
});
