/** @jest-environment jsdom */

/**
 * Settle Account — "Set custom time".
 *
 * The shop paid OMT on Tuesday 27 and records it on Wednesday 28:
 * - the sheet offers the shared "Set custom time" control;
 * - with a custom time, the default pick is the open days BEFORE that time's
 *   shop day (not before today), and the settle call carries
 *   `transaction_time`;
 * - without one, nothing changes (no `transaction_time` key).
 *
 * Rule 25: ONE stable module-level `useApi` object. Rule 24: the key name
 * comes from `supplierSettleAccountSchema.shape`, and the payload is parsed
 * through the schema.
 *
 * Rule 17: run red before the sheet change (recorded in the hand-off).
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supplierSettleAccountSchema } from "@liratek/core";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type {
  AccountBalance,
  AccountUnsettledRow,
} from "../../hooks/useSuppliers";
import { queueRow } from "../../testing/accountSettleFixtures";

// Today = Wednesday 28 Oct 2026 (the no-argument call); a given date keeps
// the real conversion, so the custom time's own day is computed for real.
jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return {
    ...actual,
    localDay: (d?: Date) => (d ? actual.localDay(d) : "2026-10-28"),
  };
});

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountMonthRows: jest.fn(async () => []),
  getSupplierAccountDayDetail: jest.fn(async () => []),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  // Rule 25: ONE stable object, never a fresh literal per useApi() call.
  return { ...actual, useApi: () => mockApi };
});

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

const TIME_KEY = Object.keys(supplierSettleAccountSchema.shape).find(
  (k) => k === "transaction_time",
) as string;

const ACCOUNT: AccountBalance = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 180,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 180,
      total_lbp: 0,
      is_parent: true,
    },
  ],
};

const day = (id: number, shopDay: string, usd: number): AccountUnsettledRow =>
  queueRow({
    id,
    created_at: `${shopDay} 09:00:00`,
    shop_day: shopDay,
    amount_usd: usd,
  });
const SAT24 = day(1, "2026-10-24", 100);
const MON26 = day(2, "2026-10-26", 50);
const TUE27 = day(3, "2026-10-27", 30);

function renderSheet() {
  mockGetSupplierAccountUnsettled.mockResolvedValue([SAT24, MON26, TUE27]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={ACCOUNT}
        onClose={jest.fn()}
        onSettled={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

async function payUsd(value: string) {
  const usd = await screen.findByTestId("supplier-account-settle-section-usd");
  fireEvent.change(within(usd).getAllByTestId(/^payment-amount-/)[0], {
    target: { value },
  });
}

async function submitAndGetPayload(): Promise<Record<string, unknown>> {
  const submit = await screen.findByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
  );
  return mockSettleSupplierAccount.mock.calls[0][1] as Record<string, unknown>;
}

describe("AccountSettleSheet — Set custom time", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 1 });
    window.localStorage.clear();
  });

  it("the key name comes from the schema (rule 24)", () => {
    expect(TIME_KEY).toBe("transaction_time");
  });

  it("shows the Set custom time control", async () => {
    renderSheet();
    await screen.findByTestId("supplier-account-settle-section-usd");
    expect(screen.getByTestId("txn-time-toggle")).toBeInTheDocument();
  });

  it("with a custom time on Tuesday 27: picks the open days before the 27th and sends transaction_time", async () => {
    renderSheet();
    await screen.findByTestId("supplier-account-settle-section-usd");
    fireEvent.click(screen.getByTestId("txn-time-toggle"));
    fireEvent.change(screen.getByTestId("txn-time-input"), {
      target: { value: "2026-10-27T10:00" },
    });
    await payUsd("150");
    const payload = await submitAndGetPayload();

    const sent = supplierSettleAccountSchema.parse({
      account_supplier_id: 1,
      ...payload,
    }) as Record<string, unknown>;
    expect(sent[TIME_KEY]).toBe(new Date("2026-10-27T10:00").toISOString());
    // Saturday 24 + Monday 26 (before the 27th) — Tuesday 27 is not picked.
    const ids = (sent.selections as { id: number }[]).map((s) => s.id).sort();
    expect(ids).toEqual([SAT24.id, MON26.id]);
    expect(sent.expected_owed).toEqual({ usd: 150, lbp: 0 });
  });

  it("without a custom time: the days before today, and no transaction_time", async () => {
    renderSheet();
    await payUsd("180");
    const payload = await submitAndGetPayload();
    expect(payload).not.toHaveProperty(TIME_KEY);
    const ids = (payload.selections as { id: number }[]).map((s) => s.id).sort();
    expect(ids).toEqual([SAT24.id, MON26.id, TUE27.id]);
  });
});
