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
 *
 * LIRA-322 rewrite (rule 24 — intent kept): nothing is pre-ticked any more
 * (the amount decides what closes); a waiting WU transfer is now out of the
 * settlement's scope — out of the preview, out of `expected_owed` — and can't
 * be picked in "Pick transfers".
 *
 * LIRA-343 rewrite (rule 24 — intent kept): the top-level "Pick transfers"
 * list is gone (it returns inside a day's details, US4), so "unpickable" is
 * now checked where it matters: a waiting row is never in the `selections`
 * the sheet sends, while every in-scope row is.
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
import {
  coveredPickerShowsAllTypes,
  isCoveredTypeTicked,
  toggleCoveredType,
} from "../../testing/coveredTypesPicker";
import type {
  AccountBalance,
  AccountUnsettledRow,
} from "../../hooks/useSuppliers";
import { supplierSettleAccountSchema } from "@liratek/core";
import { queueRow } from "../../testing/accountSettleFixtures";

const SP = "supplier-account-settle-covered";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  // LIRA-343 — the calendar's month read. Empty here: these cases test the
  // money, and the open queue (not this read) decides the picked days.
  getSupplierAccountMonthRows: jest.fn(async () => []),
  getSupplierAccountDayDetail: jest.fn(async () => []),
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
): AccountUnsettledRow =>
  queueRow({
    id,
    created_at: created,
    amount_usd: usd,
    omt_service_type: type,
    commission_model: model,
  });
const ROW_INTRA = fsRow(10, "INTRA", 1, "2026-09-01 00:00:00", 468);
const ROW_WU = fsRow(11, "WESTERN_UNION", 1, "2026-09-02 00:00:00", 526);
const ROW_WU_LEGACY = fsRow(
  12,
  "WESTERN_UNION",
  0,
  "2026-08-01 00:00:00",
  104.5,
);
const ROW_IPICK = queueRow({
  kind: "LEDGER",
  id: 30,
  supplier_id: 3,
  source_provider: "iPick",
  source_name: "iPick",
  created_at: "2026-09-03 00:00:00",
  amount_usd: 200,
  entry_type: "TOP_UP",
  service_type: null,
  omt_service_type: null,
  commission_model: null,
});

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

const previewIds = async () =>
  within(await screen.findByTestId("supplier-account-settle-section-usd"))
    .getAllByTestId("supplier-account-settle-preview-row")
    .map((r) => r.getAttribute("data-row-id"));
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

  it("with [INTRA] remembered: the WU row waits (out of scope, unpickable); the payload carries the choice and expected_owed omits WU", async () => {
    window.localStorage.setItem(
      "liratek:omt-covered-types:1",
      JSON.stringify(["INTRA"]),
    );
    renderSheet([ROW_INTRA, ROW_WU, ROW_IPICK]);
    await waitFor(async () => expect(await previewIds()).toEqual(["10", "30"]));
    expect(
      screen.getByTestId("supplier-account-settle-owed-usd").textContent,
    ).toBe("$668.00");

    expect(await isCoveredTypeTicked(SP, "INTRA")).toBe(true);

    await payUsd("668");
    const payload = await submitAndGetPayload();
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: 1,
      ...payload,
    });
    expect(parsed[KEY]).toEqual(["INTRA"]);
    expect(parsed.expected_owed?.usd).toBeCloseTo(668, 2);
    // The waiting WU row (11) is never selected; the others are.
    expect(parsed.selections).toEqual([
      { kind: "FINANCIAL_SERVICE", id: 10 },
      { kind: "LEDGER", id: 30 },
    ]);
  });

  it("switching to 'All types' brings the WU row back in scope and the payload has NO covered key", async () => {
    window.localStorage.setItem(
      "liratek:omt-covered-types:1",
      JSON.stringify(["INTRA"]),
    );
    renderSheet([ROW_INTRA, ROW_WU]);
    await waitFor(async () => expect(await previewIds()).toEqual(["10"]));
    // Unticking the only ticked type returns to "All types".
    await toggleCoveredType(SP, "INTRA");
    expect(coveredPickerShowsAllTypes(SP)).toBe(true);
    await waitFor(async () => expect(await previewIds()).toEqual(["10", "11"]));

    await payUsd("994");
    const payload = await submitAndGetPayload();
    expect(KEY in payload).toBe(false);
    expect(payload.selections).toEqual([
      { kind: "FINANCIAL_SERVICE", id: 10 },
      { kind: "FINANCIAL_SERVICE", id: 11 },
    ]);
  });

  it("an old-style (model 0) WU row is never restricted", async () => {
    window.localStorage.setItem(
      "liratek:omt-covered-types:1",
      JSON.stringify(["INTRA"]),
    );
    renderSheet([ROW_WU_LEGACY]);
    await waitFor(async () => expect(await previewIds()).toEqual(["12"]));
  });

  it("ticking a type on the sheet re-derives the scope and remembers it", async () => {
    renderSheet([ROW_INTRA, ROW_WU]);
    await waitFor(async () => expect(await previewIds()).toEqual(["10", "11"]));
    await toggleCoveredType(SP, "INTRA");
    await waitFor(async () => expect(await previewIds()).toEqual(["10"]));
    expect(window.localStorage.getItem("liratek:omt-covered-types:1")).toBe(
      JSON.stringify(["INTRA"]),
    );
  });
});
