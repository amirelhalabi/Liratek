/** @jest-environment jsdom */

/**
 * LIRA-256 — the OMT account settle sheet honours the statement's covered
 * OMT commission types. With a choice set, new-style (commission_model = 1)
 * OMT transfers of other types start unticked, are disabled and read
 * "Waiting — not in this statement"; the payload carries
 * `covered_omt_service_types` only when the choice is not "All types".
 * Old-style (model 0) rows and LEDGER rows are never restricted.
 *
 * Rule 25: ONE stable `useApi` object. Rule 24: payload keys are checked
 * against `supplierSettleAccountSchema.shape`.
 *
 * RULE 17 — run red before the sheet change (no picker; the WU row started
 * ticked; the payload never carried the key).
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type {
  AccountBalance,
  AccountUnsettledRow,
} from "../../hooks/useSuppliers";
import { supplierSettleAccountSchema } from "@liratek/core";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
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

const ACCOUNT: AccountBalance = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 1000,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 800,
      total_lbp: 0,
      is_parent: true,
    },
    {
      supplier_id: 3,
      name: "iPick",
      provider: "iPick",
      drawer_name: "iPick",
      total_usd: 200,
      total_lbp: 0,
      is_parent: false,
    },
  ],
};

const fsRow = (
  id: number,
  type: string | null,
  model: number,
  created: string,
  usd: number,
): AccountUnsettledRow => ({
  kind: "FINANCIAL_SERVICE",
  id,
  supplier_id: 1,
  source_provider: "OMT",
  source_name: "OMT",
  created_at: created,
  amount_usd: usd,
  amount_lbp: 0,
  entry_type: null,
  service_type: "SEND",
  commission_usd: 0,
  commission_lbp: 0,
  omt_service_type: type,
  commission_model: model,
});
const ROW_INTRA = fsRow(10, "INTRA", 1, "2026-09-01T00:00:00Z", 468);
const ROW_WU = fsRow(11, "WESTERN_UNION", 1, "2026-09-02T00:00:00Z", 526);
const ROW_WU_LEGACY = fsRow(
  12,
  "WESTERN_UNION",
  0,
  "2026-08-01T00:00:00Z",
  104.5,
);
const ROW_IPICK: AccountUnsettledRow = {
  kind: "LEDGER",
  id: 30,
  supplier_id: 3,
  source_provider: "iPick",
  source_name: "iPick",
  created_at: "2026-09-03T00:00:00Z",
  amount_usd: 200,
  amount_lbp: 0,
  entry_type: "TOP_UP",
  service_type: null,
  commission_usd: 0,
  commission_lbp: 0,
  omt_service_type: null,
  commission_model: null,
};

function renderSheet(rows: AccountUnsettledRow[]) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
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

const rowById = async (id: number) =>
  (await screen.findAllByTestId("supplier-account-settle-row")).find(
    (r) => r.getAttribute("data-row-id") === String(id),
  )!;
const toggleOf = async (id: number) =>
  within(await rowById(id)).getByTestId("supplier-account-settle-row-toggle");

async function submitAndGetPayload(): Promise<Record<string, unknown>> {
  const submit = await screen.findByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
  );
  return mockSettleSupplierAccount.mock.calls[0][1] as Record<string, unknown>;
}

describe("AccountSettleSheet — LIRA-256 covered types", () => {
  const KEY = "covered_omt_service_types";
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 1 });
    window.localStorage.clear();
  });

  it("the key name comes from the schema (rule 24)", () => {
    expect(Object.keys(supplierSettleAccountSchema.shape)).toContain(KEY);
  });

  it("with [INTRA] remembered: INTRA + LEDGER rows ticked, the WU row disabled and waiting; payload carries the choice and omits WU", async () => {
    window.localStorage.setItem(
      "liratek:omt-covered-types:1",
      JSON.stringify(["INTRA"]),
    );
    renderSheet([ROW_INTRA, ROW_WU, ROW_IPICK]);
    await waitFor(async () => expect(await toggleOf(10)).toBeChecked());
    expect(await toggleOf(30)).toBeChecked();
    const wuToggle = await toggleOf(11);
    expect(wuToggle).not.toBeChecked();
    expect(wuToggle).toBeDisabled();
    expect(
      within(await rowById(11)).getByText(/Waiting — not in this statement/),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("supplier-account-settle-covered-INTRA"),
    ).toBeChecked();

    const payload = await submitAndGetPayload();
    expect(payload[KEY]).toEqual(["INTRA"]);
    expect(payload.selections).toEqual([
      { kind: "FINANCIAL_SERVICE", id: 10 },
      { kind: "LEDGER", id: 30 },
    ]);
  });

  it("switching to 'All types' enables the WU row and the payload has NO covered key", async () => {
    window.localStorage.setItem(
      "liratek:omt-covered-types:1",
      JSON.stringify(["INTRA"]),
    );
    renderSheet([ROW_INTRA, ROW_WU]);
    await waitFor(async () => expect(await toggleOf(11)).toBeDisabled());
    fireEvent.click(screen.getByTestId("supplier-account-settle-covered-all"));
    await waitFor(async () => expect(await toggleOf(11)).not.toBeDisabled());
    expect(await toggleOf(11)).toBeChecked();
    const payload = await submitAndGetPayload();
    expect(KEY in payload).toBe(false);
  });

  it("an old-style (model 0) WU row is never disabled", async () => {
    window.localStorage.setItem(
      "liratek:omt-covered-types:1",
      JSON.stringify(["INTRA"]),
    );
    renderSheet([ROW_WU_LEGACY]);
    const t = await toggleOf(12);
    expect(t).not.toBeDisabled();
    await waitFor(() => expect(t).toBeChecked());
  });

  it("ticking a type on the sheet re-derives the selection and remembers it", async () => {
    renderSheet([ROW_INTRA, ROW_WU]);
    await waitFor(async () => expect(await toggleOf(11)).toBeChecked());
    fireEvent.click(
      screen.getByTestId("supplier-account-settle-covered-INTRA"),
    );
    await waitFor(async () => expect(await toggleOf(11)).not.toBeChecked());
    expect(await toggleOf(11)).toBeDisabled();
    expect(await toggleOf(10)).toBeChecked();
    expect(window.localStorage.getItem("liratek:omt-covered-types:1")).toBe(
      JSON.stringify(["INTRA"]),
    );
  });
});
