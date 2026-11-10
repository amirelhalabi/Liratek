/** @jest-environment jsdom */

/**
 * LIRA-378 (owner 2026-11-09) — on the OMT Settle Account sheet, nothing
 * ticked in "Which OMT commission does this SMS include?" means OMT pays NO
 * commission in this SMS:
 *   - the sheet opens with nothing ticked, so the SMS box opens at the
 *     gross owed (776.50, not 772.30) and the commission line reads $0.00;
 *   - the payload says so explicitly: `covered_omt_service_types: []`;
 *   - every transfer's expected commission is shown as "stays owed";
 *   - "All types" is one tick (the group header), and restores 772.30.
 *
 * Why: Cornertech saved an untouched prefill twice (4 Nov, 9 Nov) — the
 * sheet deducted commission OMT had not paid, because "All types" was the
 * silent default.
 *
 * Field names in the payload come from the core schema (`parse`, rule 24).
 * RULE 17 — run before the sheet change: the first three cases failed
 * (SMS box opened at 772.30, payload had no covered key).
 */

import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supplierSettleAccountSchema } from "@liratek/core";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type { AccountUnsettledRow } from "../../hooks/useSuppliers";
import { OMT_ACCOUNT, queueRow } from "../../testing/accountSettleFixtures";
import { tickAllCoveredTypes } from "../../testing/coveredTypesPicker";

const SP = "supplier-account-settle-covered";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockGetOwedShares = jest.fn(async () => []);
// Module-level and stable (rule 25).
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountOwedShares: mockGetOwedShares,
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

const ledger = (id: number, usd: number, at: string): AccountUnsettledRow =>
  queueRow({
    id,
    kind: "LEDGER",
    created_at: at,
    amount_usd: usd,
    service_type: null,
    entry_type: "TOP_UP",
    omt_service_type: null,
    commission_model: null,
    source_provider: "iPick",
  });

const send = (
  id: number,
  usd: number,
  type: string,
  commission: number,
  at: string,
): AccountUnsettledRow =>
  queueRow({
    id,
    created_at: at,
    amount_usd: usd,
    omt_service_type: type,
    commission_model: 1,
    expected_commission_usd: commission,
    commission_accounted_usd: 0,
  });

/** The test shop on 2026-11-03: we owe OMT 776.50, expected commission 4.20. */
const PAY_ROWS: AccountUnsettledRow[] = [
  ledger(323, 200, "2026-10-16 08:00:00"),
  ledger(324, 200, "2026-10-16 08:05:00"),
  send(505, 204, "CASH_TO_BUSINESS", 1, "2026-10-16 09:00:00"),
  send(507, 50.5, "ONLINE_BROKERAGE", 3, "2026-10-16 09:10:00"),
  send(508, 101, "INTRA", 0.1, "2026-10-16 09:20:00"),
  send(818, 21, "INTRA", 0.1, "2026-10-26 09:00:00"),
];

function renderSheet(rows: AccountUnsettledRow[]) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={OMT_ACCOUNT}
        settlesFromSms
        onClose={jest.fn()}
        onSettled={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

const smsInput = () =>
  screen.getByTestId("supplier-account-settle-sms-usd") as HTMLInputElement;
const commissionLine = () =>
  screen.getByTestId("supplier-account-settle-sms-commission-usd").textContent;

async function submitAndParse() {
  const submit = screen.getByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() => expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1));
  const [accountSupplierId, payload] = mockSettleSupplierAccount.mock.calls[0];
  return supplierSettleAccountSchema.parse({
    account_supplier_id: accountSupplierId,
    ...payload,
  });
}

describe("AccountSettleSheet — nothing ticked = OMT pays no commission (LIRA-378)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  it("opens with nothing ticked: SMS box at the gross 776.50, commission $0.00, 4.20 stays owed", async () => {
    renderSheet(PAY_ROWS);
    await screen.findByTestId("supplier-account-settle-section-usd");
    expect(smsInput().value).toBe("776.50");
    expect(commissionLine()).toContain("$0.00");
    expect(screen.getByTestId(SP).textContent).toContain("No commission");
    expect(screen.getByTestId("supplier-account-settle-sms-includes-none")).toBeTruthy();
    expect(screen.queryByTestId("supplier-account-settle-sms-includes")).toBeNull();
    expect(
      screen.getByTestId("supplier-account-settle-sms-stays-owed-usd").textContent,
    ).toContain("$4.20");
  });

  it("untouched: the payload says no commission — covered_omt_service_types: [] and commission 0", async () => {
    renderSheet(PAY_ROWS);
    await screen.findByTestId("supplier-account-settle-section-usd");
    const parsed = await submitAndParse();
    expect(parsed.covered_omt_service_types).toEqual([]);
    expect(parsed.per_currency?.USD?.sms_amount).toBe(776.5);
    expect(parsed.per_currency?.USD?.commission).toBe(0);
  });

  it("ticking All types (one tick) brings the expected commission back: SMS 772.30, $4.20", async () => {
    renderSheet(PAY_ROWS);
    await screen.findByTestId("supplier-account-settle-section-usd");
    await tickAllCoveredTypes(SP);
    await waitFor(() => expect(smsInput().value).toBe("772.30"));
    expect(commissionLine()).toContain("$4.20");
    expect(screen.queryByTestId("supplier-account-settle-sms-includes-none")).toBeNull();
    expect(screen.getByTestId("supplier-account-settle-sms-includes")).toBeTruthy();
    const parsed = await submitAndParse();
    expect(parsed.covered_omt_service_types).toHaveLength(9);
    expect(parsed.per_currency?.USD?.commission).toBe(4.2);
  });

  // Caught by lira-web-081: "See transactions" marked every transfer as
  // waiting for its type (unticked) once the default became `[]`. In SMS
  // mode the ticked types scope the commission only — every picked
  // transfer stays in, ticked.
  it("nothing ticked keeps every transfer in scope: See transactions shows them ticked, none waiting", async () => {
    renderSheet(PAY_ROWS);
    await screen.findByTestId("supplier-account-settle-section-usd");
    await act(async () => {
      fireEvent.click(screen.getByTestId("settle-see-transactions"));
    });
    const panel = await screen.findByTestId("settle-transactions-panel");
    for (const id of [505, 507, 508, 818]) {
      const row = within(panel).getByTestId(`settle-tx-row-FINANCIAL_SERVICE:${id}`);
      expect((within(row).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    }
    const statuses = within(screen.getByTestId("supplier-account-settle-section-usd"))
      .getAllByTestId("supplier-account-settle-preview-row")
      .map((r) => r.getAttribute("data-status"));
    expect(statuses.every((s) => s === "closes")).toBe(true);
  });

  it("a typed SMS below the gross with nothing ticked blocks Settle: the $6.50 is commission, so a type must be ticked", async () => {
    renderSheet(PAY_ROWS);
    await screen.findByTestId("supplier-account-settle-section-usd");
    await act(async () => {
      fireEvent.change(smsInput(), { target: { value: "770" } });
    });
    await waitFor(() => expect(commissionLine()).toContain("$6.50"));
    expect(
      screen.getByTestId("supplier-account-settle-sms-needs-types-usd").textContent,
    ).toContain("$6.50");
    expect(screen.getByTestId("supplier-account-settle-submit")).toBeDisabled();
    expect(mockSettleSupplierAccount).not.toHaveBeenCalled();
    // Ticking the types the SMS includes unblocks it. (A new choice re-opens
    // the box at its expected figure, as it always did, so 770 is retyped.)
    await tickAllCoveredTypes(SP);
    await waitFor(() =>
      expect(screen.queryByTestId("supplier-account-settle-sms-needs-types-usd")).toBeNull(),
    );
    await act(async () => {
      fireEvent.change(smsInput(), { target: { value: "770" } });
    });
    await waitFor(() => expect(commissionLine()).toContain("$6.50"));
    expect(screen.queryByTestId("supplier-account-settle-sms-needs-types-usd")).toBeNull();
    const parsed = await submitAndParse();
    expect(parsed.covered_omt_service_types).toHaveLength(9);
    expect(parsed.per_currency?.USD?.commission).toBe(6.5);
  });
});
