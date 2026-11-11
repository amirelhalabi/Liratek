/**
 * AccountSettleSheet — 8 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 8).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountSettleSheet } from "../AccountSettleSheet";
import {
  coveredPickerShowsAllTypes,
  isCoveredTypeTicked,
  toggleCoveredType,
} from "../../testing/coveredTypesPicker";
import {
  type AccountBalance,
  type AccountUnsettledRow,
} from "../../hooks/useSuppliers";
import {
  supplierSettleAccountSchema,
  buildDaySelections,
  openDaysBefore,
} from "@liratek/core";
import {
  queueRow,
  OMT_ACCOUNT,
  SIX_USD_ROWS,
  LBP_ROW,
} from "../../testing/accountSettleFixtures";
import { localDay } from "@/shared/utils/localDay";

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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockSettleSupplierAccount as unknown as jest.Mock).mockReset();
  (mockGetSupplierAccountUnsettled as unknown as jest.Mock).mockReset();
  (mockApi.getSupplierAccountMonthRows as unknown as jest.Mock).mockReset();
  (
    mockApi.getSupplierAccountMonthRows as unknown as jest.Mock
  ).mockImplementation(async () => []);
  (mockApi.getSupplierAccountDayDetail as unknown as jest.Mock).mockReset();
  (
    mockApi.getSupplierAccountDayDetail as unknown as jest.Mock
  ).mockImplementation(async () => []);
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("AccountSettleSheet.coveredTypes (LIRA-256)", () => {
  beforeAll(resetBetweenFiles);

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

  const SP = "supplier-account-settle-covered";

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
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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
    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
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
    return mockSettleSupplierAccount.mock.calls[0][1] as Record<
      string,
      unknown
    >;
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
      await waitFor(async () =>
        expect(await previewIds()).toEqual(["10", "30"]),
      );
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
      await waitFor(async () =>
        expect(await previewIds()).toEqual(["10", "11"]),
      );

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
      await waitFor(async () =>
        expect(await previewIds()).toEqual(["10", "11"]),
      );
      await toggleCoveredType(SP, "INTRA");
      await waitFor(async () => expect(await previewIds()).toEqual(["10"]));
      expect(window.localStorage.getItem("liratek:omt-covered-types:1")).toBe(
        JSON.stringify(["INTRA"]),
      );
    });
  });
});

describe("AccountSettleSheet.lira310Waive (LIRA-310)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-310 follow-up — owner decision 2026-10-12: NO Waive anywhere on the
   * Suppliers page, including the OMT account settle sheet.
   *
   * Guards (LIRA-322 rewrite, rule 24 — intent kept):
   *   - $3 short of $1,225: the Remaining row shows but carries no Waive
   *     button, and nothing waived is sent. Since LIRA-322 the short amount is
   *     a partial payment (Settle is enabled), so the guard is on the payload:
   *     no `waive` and no legacy `discount`;
   *   - a full payment sends no waive/discount either (names checked through
   *     the core schema, `supplierSettleAccountSchema` — rule 24);
   *   - no Waive on an overpay.
   *
   * Real MultiPaymentInput, only `useApi` mocked (a stable object, rule 25).
   */

  const ACCOUNT: AccountBalance = {
    account_supplier_id: 1,
    account_name: "OMT",
    total_usd: 1225,
    total_lbp: 0,
    children: [
      {
        supplier_id: 1,
        name: "OMT",
        provider: "OMT",
        drawer_name: "OMT_System",
        total_usd: 1225,
        total_lbp: 0,
        is_parent: true,
      },
    ],
  };

  const ROW_A = queueRow({
    kind: "LEDGER",
    id: 10,
    created_at: "2026-09-01 00:00:00",
    amount_usd: 1050,
    entry_type: "TOP_UP",
    service_type: null,
  });
  const ROW_B = queueRow({
    kind: "LEDGER",
    id: 11,
    created_at: "2026-09-02 00:00:00",
    amount_usd: 175,
    entry_type: "TOP_UP",
    service_type: null,
  });

  function renderSheet() {
    mockGetSupplierAccountUnsettled.mockResolvedValue([ROW_A, ROW_B]);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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

  async function pay(value: string) {
    renderSheet();
    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    fireEvent.change(within(usd).getAllByTestId(/^payment-amount-/)[0], {
      target: { value },
    });
    return usd;
  }

  async function submitAndGetPayload() {
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
    const [accountId, payload] = mockSettleSupplierAccount.mock.calls[0];
    // Names from the core schema (rule 24).
    const parsed = supplierSettleAccountSchema.parse({
      ...payload,
      account_supplier_id: accountId,
    });
    return { payload: payload as Record<string, unknown>, parsed };
  }

  describe("AccountSettleSheet — no Waive on the Suppliers page (owner 2026-10-12)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 1 });
    });

    it("$3 short of $1,225: the Remaining row shows, no Waive button, and nothing waived is sent", async () => {
      const usd = await pay("1222");
      expect(
        await within(usd).findByTestId("remaining-row"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();

      const { payload, parsed } = await submitAndGetPayload();
      expect(parsed.per_currency?.USD?.waive).toBeUndefined();
      expect(parsed.per_currency?.USD?.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 1222 },
      ]);
      expect(payload).not.toHaveProperty("discount");
    });

    it("a full payment sends no waive and no discount", async () => {
      await pay("1225");
      const { payload, parsed } = await submitAndGetPayload();
      expect(parsed.per_currency?.USD?.waive).toBeUndefined();
      expect(parsed.discount).toBeUndefined();
      expect(payload).not.toHaveProperty("discount");
    });

    it("no Waive on an overpay either", async () => {
      await pay("1300");
      await waitFor(() =>
        expect(screen.getByTestId("return-change")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    });
  });
});

describe("AccountSettleSheet.lira322Commission (LIRA-322)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-322 (US3, T035 — finding F4) — commission entered at settlement is
   * per currency and travels as `per_currency.USD.commission` (the legacy
   * flat `commission_usd` is refused next to `per_currency`).
   *
   * Owner decision 2026-10-15 (replaces FR-013a): "Pay the amount in full;
   * don't let the commission amount affect the payment leg amount." The
   * commission never covers a transfer, never changes the box totals and is
   * never shown as "Extra … goes on the account" — the server credits it to
   * the account after the payment.
   *
   * Not proven failing-first: the 2026-10-15 cases were written after the
   * allocator change (frontend jest resolves @liratek/core from source, so
   * the unfixed allocator was no longer reachable without re-breaking it —
   * rule 17 forbids that). The same behaviour is proven failing-first in
   * core (accountSettleAllocation + lira322CommissionToAccount).
   */

  /** The six transfers carry commission at settlement (model 1). */
  const MODEL1_ROWS: AccountUnsettledRow[] = SIX_USD_ROWS.map((r) => ({
    ...r,
    commission_model: 1,
  }));

  function renderSheet(rows: AccountUnsettledRow[]) {
    mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={OMT_ACCOUNT}
          onClose={jest.fn()}
          onSettled={jest.fn()}
        />
      </QueryClientProvider>,
    );
  }

  function amountInput(section: HTMLElement): HTMLInputElement {
    return within(section).getAllByTestId(
      /^payment-amount-/,
    )[0] as HTMLInputElement;
  }

  function statuses(section: HTMLElement) {
    return within(section)
      .getAllByTestId("supplier-account-settle-preview-row")
      .map((r) => r.getAttribute("data-status"));
  }

  describe("AccountSettleSheet — commission per currency (LIRA-322 F4)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
    });

    it("Cash $497 + commission $0.70 closes all six, shows no extra, and sends per_currency.USD.commission", async () => {
      renderSheet(MODEL1_ROWS);

      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      fireEvent.change(
        within(usd).getByTestId("supplier-account-settle-commission-usd"),
        { target: { value: "0.70" } },
      );
      // The commission does not touch the line amount (owner 2026-10-15).
      fireEvent.change(amountInput(usd), { target: { value: "497" } });
      expect(amountInput(usd).value).toBe("497");

      await waitFor(() =>
        expect(statuses(usd)).toEqual(Array(6).fill("closes")),
      );
      expect(
        within(usd).getByTestId("supplier-account-settle-still-owed-usd")
          .textContent,
      ).toBe("$0.00");
      // No "Extra $0.70 goes on the account" caused by the commission.
      expect(
        screen.queryByTestId("supplier-account-settle-extra-usd"),
      ).toBeNull();

      const submit = screen.getByTestId("supplier-account-settle-submit");
      await waitFor(() => expect(submit).not.toBeDisabled());
      fireEvent.click(submit);
      await waitFor(() =>
        expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
      );

      const [accountSupplierId, payload] =
        mockSettleSupplierAccount.mock.calls[0];
      const parsed = supplierSettleAccountSchema.parse({
        account_supplier_id: accountSupplierId,
        ...payload,
      });
      expect(parsed.per_currency?.USD?.commission).toBeCloseTo(0.7, 2);
      expect(parsed.per_currency?.USD?.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 497 },
      ]);
      expect(payload).not.toHaveProperty("commission_usd");
      expect(payload).not.toHaveProperty("commission_lbp");
    });

    it("Cash $496.30 + commission $0.70: the commission covers nothing — the newest $21 stays part-paid", async () => {
      renderSheet(MODEL1_ROWS);

      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      fireEvent.change(amountInput(usd), { target: { value: "496.30" } });
      fireEvent.change(
        within(usd).getByTestId("supplier-account-settle-commission-usd"),
        { target: { value: "0.70" } },
      );

      await waitFor(() =>
        expect(statuses(usd)).toEqual([
          "closes",
          "closes",
          "closes",
          "closes",
          "closes",
          "part-paid",
        ]),
      );
      expect(
        within(usd).getByTestId("supplier-account-settle-still-owed-usd")
          .textContent,
      ).toBe("$0.70");
      expect(
        within(usd).queryByTestId(
          "supplier-account-settle-commission-warning-usd",
        ),
      ).toBeNull();
    });

    it("Cash $496.30 with no commission leaves the newest $21 part-paid ($0.70 owed)", async () => {
      renderSheet(MODEL1_ROWS);

      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      fireEvent.change(amountInput(usd), { target: { value: "496.30" } });

      await waitFor(() =>
        expect(statuses(usd)).toEqual([
          "closes",
          "closes",
          "closes",
          "closes",
          "closes",
          "part-paid",
        ]),
      );
      expect(
        within(usd).getByTestId("supplier-account-settle-still-owed-usd")
          .textContent,
      ).toBe("$0.70");
    });
  });
});

describe("AccountSettleSheet.lira322Currency (LIRA-322)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-322 (US1, T017) — the Settle Account sheet settles one currency at a
   * time. With $497 and 900,000 LBP owed it shows two separate amounts (never
   * one merged, converted figure), and paying only USD sends only a USD
   * section.
   *
   * Owner 2026-10-15 (one-box follow-up): both currencies share ONE payment
   * box — a USD line and an LBP line, pre-filled with what is owed — whose
   * Total / Paid / Remaining rows keep each currency in its own currency
   * (`perCurrencyTotals`). Lines go back to their own currency's section;
   * change goes to the section of the currency that was overpaid. These
   * one-box cases were written AFTER the sheet change — not proven
   * failing-first (the box-level behaviour they rely on is, in
   * MultiPaymentInput.perCurrencyTotals.test.tsx).
   *
   * Renders the REAL sheet + REAL `MultiPaymentInput` (jest maps @liratek/ui
   * to its source); only `useApi` is replaced, by ONE stable object (rule 25).
   * Every payload is parsed through the core schema (rule 24), so a field the
   * schema does not know, or a legacy key next to `per_currency`, fails here.
   */

  function renderSheet(rows: AccountUnsettledRow[]) {
    mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={OMT_ACCOUNT}
          onClose={jest.fn()}
          onSettled={jest.fn()}
        />
      </QueryClientProvider>,
    );
  }

  const BOTH = "supplier-account-settle-section-usd-lbp";

  /** The one box's lines, in seed order: [USD, LBP]. */
  function lineInputs(box: HTMLElement): HTMLInputElement[] {
    return within(box).getAllByTestId(/^payment-amount-/) as HTMLInputElement[];
  }

  function setLines(box: HTMLElement, usd: string, lbp: string): void {
    const [usdInput, lbpInput] = lineInputs(box);
    fireEvent.change(usdInput, { target: { value: usd } });
    fireEvent.change(lbpInput, { target: { value: lbp } });
  }

  async function submitOnce() {
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
  }

  function parsedPayload() {
    const [accountSupplierId, payload] =
      mockSettleSupplierAccount.mock.calls[0];
    return {
      raw: payload as Record<string, unknown>,
      parsed: supplierSettleAccountSchema.parse({
        account_supplier_id: accountSupplierId,
        ...payload,
      }),
    };
  }

  describe("AccountSettleSheet — one currency at a time (LIRA-322 US1)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
    });

    it("shows $497.00 and 900,000 LBP as two separate amounts in one header, never a merged figure", async () => {
      renderSheet([...SIX_USD_ROWS, LBP_ROW]);

      const box = await screen.findByTestId(BOTH);
      expect(
        within(box).getByTestId("supplier-account-settle-owed-usd").textContent,
      ).toBe("$497.00");
      expect(
        within(box).getByTestId("supplier-account-settle-owed-lbp").textContent,
      ).toBe("900,000 LBP");
      expect(box.textContent).toContain("You pay OMT$497.00 · 900,000 LBP");
      expect(screen.queryByTestId("supplier-account-settle-net")).toBeNull();
    });

    it("renders ONE payment box with a USD line and an LBP line, pre-filled with what is owed", async () => {
      renderSheet([...SIX_USD_ROWS, LBP_ROW]);

      const box = await screen.findByTestId(BOTH);
      expect(
        screen.queryByTestId("supplier-account-settle-section-usd"),
      ).toBeNull();
      expect(
        screen.queryByTestId("supplier-account-settle-section-lbp"),
      ).toBeNull();
      expect(within(box).getAllByTestId("payment-summary")).toHaveLength(1);

      const currencies = (
        within(box).getAllByTestId(/^payment-currency-/) as HTMLSelectElement[]
      ).map((s) => s.value);
      expect(currencies).toEqual(["USD", "LBP"]);
      expect(lineInputs(box).map((i) => i.value)).toEqual(["497", "900,000"]);
      // The box's own rows keep each currency in its own currency.
      expect(within(box).getByTestId("payment-summary").textContent).toContain(
        "Total Amount$497.00 · 900,000 LBP",
      );
    });

    it("confirming straight away settles both currencies in full, each in its own section", async () => {
      renderSheet([...SIX_USD_ROWS, LBP_ROW]);
      await screen.findByTestId(BOTH);

      await submitOnce();
      const { parsed } = parsedPayload();
      expect(parsed.per_currency?.USD).toEqual({
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 497 }],
      });
      expect(parsed.per_currency?.LBP).toEqual({
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "LBP", amount: 900000 }],
      });
    });

    it("paying only Cash $497 (LBP line cleared) sends a USD section only, with expected_owed for both currencies and no legacy keys", async () => {
      renderSheet([...SIX_USD_ROWS, LBP_ROW]);

      const box = await screen.findByTestId(BOTH);
      setLines(box, "497", "0");
      // The unpaid LBP is shown by itself, never netted into a $ figure.
      await waitFor(() =>
        expect(within(box).getByTestId("remaining-amount").textContent).toBe(
          "900,000 LBP",
        ),
      );

      await submitOnce();
      const { raw, parsed } = parsedPayload();
      expect(parsed.account_supplier_id).toBe(1);
      expect(parsed.per_currency?.USD).toEqual({
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 497 }],
      });
      expect(parsed.per_currency && "LBP" in parsed.per_currency).toBe(false);
      expect(parsed.expected_owed?.usd).toBeCloseTo(497, 2);
      expect(parsed.expected_owed?.lbp).toBe(900000);
      // Legacy whole-row keys are never sent (the schema refuses them anyway).
      for (const key of ["direction", "amount_usd", "amount_lbp"]) {
        expect(raw).not.toHaveProperty(key);
      }
      // LIRA-343 — `selections` is now always sent: the picked days' open
      // rows (every open day before today by default), from the ONE builder.
      expect(parsed.selections).toEqual(
        buildDaySelections([...SIX_USD_ROWS, LBP_ROW], {
          pickedDays: openDaysBefore([...SIX_USD_ROWS, LBP_ROW], localDay()),
        }).selections,
      );
      expect(parsed.selections).toHaveLength(7);
    });

    it("Confirm is enabled with money in one currency only, and disabled with none", async () => {
      renderSheet([...SIX_USD_ROWS, LBP_ROW]);

      const box = await screen.findByTestId(BOTH);
      const submit = screen.getByTestId("supplier-account-settle-submit");
      setLines(box, "0", "0");
      await waitFor(() => expect(submit).toBeDisabled());

      fireEvent.change(lineInputs(box)[1], { target: { value: "900000" } });
      await waitFor(() => expect(submit).not.toBeDisabled());
    });

    it("$600 + LBP cleared: the $103 USD overpay is change in the USD section; LBP is not sent", async () => {
      renderSheet([...SIX_USD_ROWS, LBP_ROW]);

      const box = await screen.findByTestId(BOTH);
      setLines(box, "600", "0");
      await waitFor(() =>
        expect(within(box).getByTestId("change-due").textContent).toContain(
          "$103.00",
        ),
      );

      await submitOnce();
      const { parsed } = parsedPayload();
      expect(parsed.per_currency?.USD?.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 600 },
        { method: "CASH", currency_code: "USD", amount: 103, direction: "OUT" },
      ]);
      expect(parsed.per_currency && "LBP" in parsed.per_currency).toBe(false);
    });

    it("an LBP overpay handed back in $ is change in the LBP section, never subtracted from USD", async () => {
      renderSheet([...SIX_USD_ROWS, LBP_ROW]);

      const box = await screen.findByTestId(BOTH);
      setLines(box, "497", "989000");
      await waitFor(() =>
        expect(within(box).getByTestId("return-change")).toBeInTheDocument(),
      );
      fireEvent.click(within(box).getByTestId("return-all-usd"));

      await submitOnce();
      const { parsed } = parsedPayload();
      expect(parsed.per_currency?.USD?.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 497 },
      ]);
      expect(parsed.per_currency?.LBP?.payments).toEqual([
        { method: "CASH", currency_code: "LBP", amount: 989000 },
        { method: "CASH", currency_code: "USD", amount: 1, direction: "OUT" },
      ]);
    });

    it("both currencies overpaid: each change leg goes to its own currency's section", async () => {
      renderSheet([...SIX_USD_ROWS, LBP_ROW]);

      const box = await screen.findByTestId(BOTH);
      setLines(box, "500", "989000");
      await waitFor(() =>
        expect(within(box).getByTestId("change-due").textContent).toContain(
          "$4.00",
        ),
      );

      await submitOnce();
      const { parsed } = parsedPayload();
      expect(parsed.per_currency?.USD?.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 500 },
        { method: "CASH", currency_code: "USD", amount: 3, direction: "OUT" },
      ]);
      expect(parsed.per_currency?.LBP?.payments).toEqual([
        { method: "CASH", currency_code: "LBP", amount: 989000 },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 89000,
          direction: "OUT",
        },
      ]);
    });

    // Which currencies go in `per_currency` decides which ledger moves. Both
    // cases below were written after the code — not proven failing-first.
    it("pure netting: a USD credit that closes a debt with the line cleared sends USD with no payments, and no LBP key", async () => {
      const debt = queueRow({
        id: 301,
        created_at: "2026-10-01 10:00:00",
        amount_usd: 152,
      });
      const credit = queueRow({
        kind: "LEDGER",
        id: 302,
        created_at: "2026-10-02 10:00:00",
        amount_usd: -60,
        entry_type: "PAYMENT",
        service_type: null,
        omt_service_type: null,
        commission_model: null,
      });
      renderSheet([debt, credit]);

      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      fireEvent.change(lineInputs(usd)[0], { target: { value: "0" } });
      await waitFor(() =>
        expect(
          within(usd)
            .getAllByTestId("supplier-account-settle-preview-row")
            .map((r) => r.getAttribute("data-status")),
        ).toEqual(["part-paid", "closes"]),
      );
      await submitOnce();

      const { parsed } = parsedPayload();
      expect(parsed.per_currency?.USD).toEqual({
        direction: "PAY",
        payments: [],
      });
      expect(parsed.per_currency && "LBP" in parsed.per_currency).toBe(false);
    });

    it("FR-002: money in USD only leaves LBP out of the payload even when LBP netting could close something", async () => {
      const lbpCredit = queueRow({
        kind: "LEDGER",
        id: 202,
        created_at: "2026-10-08 10:00:00",
        amount_lbp: -100000,
        entry_type: "PAYMENT",
        service_type: null,
        omt_service_type: null,
        commission_model: null,
      });
      renderSheet([...SIX_USD_ROWS, LBP_ROW, lbpCredit]);

      const box = await screen.findByTestId(BOTH);
      setLines(box, "497", "0");

      const lbpPreview = within(box).getByTestId(
        "supplier-account-settle-preview-lbp",
      );
      await waitFor(() =>
        expect(
          within(lbpPreview)
            .getAllByTestId("supplier-account-settle-preview-row")
            .map((r) => r.getAttribute("data-status")),
        ).toEqual(["untouched", "untouched"]),
      );

      await submitOnce();
      const { parsed } = parsedPayload();
      expect(Object.keys(parsed.per_currency ?? {})).toEqual(["USD"]);
      expect(parsed.expected_owed?.lbp).toBe(800000);
    });

    it("OMT pays you in both currencies: one box, COLLECT in both sections, 'OMT still owes' rows per currency", async () => {
      const credit = (id: number, over: Partial<AccountUnsettledRow>) =>
        queueRow({
          kind: "LEDGER",
          id,
          created_at: `2026-10-0${id - 400} 10:00:00`,
          entry_type: "PAYMENT",
          service_type: null,
          omt_service_type: null,
          commission_model: null,
          ...over,
        });
      renderSheet([
        credit(401, { amount_usd: -40 }),
        credit(402, { amount_lbp: -500000 }),
      ]);

      const box = await screen.findByTestId(BOTH);
      expect(box.textContent).toContain("OMT pays you$40.00 · 500,000 LBP");
      // Pre-filled in full: nothing left, said per currency.
      expect(within(box).getByTestId("owed-after-row").textContent).toBe(
        "OMT still owes$0.00 · 0 LBP",
      );
      fireEvent.change(lineInputs(box)[1], { target: { value: "300000" } });
      await waitFor(() =>
        expect(within(box).getByTestId("remaining-row").textContent).toBe(
          "OMT still owes200,000 LBP",
        ),
      );

      await submitOnce();
      const { parsed } = parsedPayload();
      expect(parsed.per_currency?.USD).toEqual({
        direction: "COLLECT",
        payments: [{ method: "CASH", currency_code: "USD", amount: 40 }],
      });
      expect(parsed.per_currency?.LBP).toEqual({
        direction: "COLLECT",
        payments: [{ method: "CASH", currency_code: "LBP", amount: 300000 }],
      });
    });

    // LIRA-343 (FR-010): every payment box is pre-filled per currency with
    // what the picked days owe, so the small opposite-direction box is no
    // longer empty (rule 24: the "starts empty" assertion was rewritten).
    it("mixed directions (shop owes $, OMT owes LBP): the LBP side keeps its own small box, pre-filled", async () => {
      const lbpCredit = queueRow({
        kind: "LEDGER",
        id: 203,
        created_at: "2026-10-08 10:00:00",
        amount_lbp: -500000,
        entry_type: "PAYMENT",
        service_type: null,
        omt_service_type: null,
        commission_model: null,
      });
      renderSheet([...SIX_USD_ROWS, lbpCredit]);

      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      const lbp = screen.getByTestId("supplier-account-settle-section-lbp");
      expect(screen.queryByTestId(BOTH)).toBeNull();
      expect(usd.textContent).toContain("You pay OMT");
      expect(lbp.textContent).toContain("OMT pays you");
      // Both boxes pre-filled with what is owed in their own currency.
      expect(lineInputs(usd)[0].value).toBe("497");
      expect(lineInputs(lbp)[0].value).toBe("500,000");
    });
  });
});

describe("AccountSettleSheet.lira322Preview (LIRA-322)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-322 (US2, T025) — before confirming, each currency section previews
   * what the money will close, oldest first: Cash $300 against the six USD
   * transfers closes $152 and $101, part-pays the next $101 ($47 applied, $54
   * still owed) and leaves three untouched; $197 is still owed after. The LBP
   * section is not affected by USD money. An amount above what is owed says
   * the extra goes on the account.
   *
   * Owner 2026-10-15 (one-box follow-up): $ and LBP share ONE payment box, so
   * the $300 case types $300 on the USD line and leaves the LBP line at its
   * pre-filled 900,000 LBP (the mock's screen B): the LBP transfer closes and
   * "Still owed after" reads "$197.00 · 0 LBP". Rewritten after the sheet
   * change — not proven failing-first.
   */

  function renderSheet(rows: AccountUnsettledRow[]) {
    mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={OMT_ACCOUNT}
          onClose={jest.fn()}
          onSettled={jest.fn()}
        />
      </QueryClientProvider>,
    );
  }

  function amountInput(section: HTMLElement): HTMLInputElement {
    return within(section).getAllByTestId(
      /^payment-amount-/,
    )[0] as HTMLInputElement;
  }

  function previewStatuses(preview: HTMLElement) {
    return within(preview)
      .getAllByTestId("supplier-account-settle-preview-row")
      .map((r) => [
        r.getAttribute("data-row-id"),
        r.getAttribute("data-status"),
      ]);
  }

  describe("AccountSettleSheet — per-currency preview (LIRA-322 US2)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
    });

    it("Cash $300 + 900,000 LBP: 2 close, 1 part-paid ($47 of $101 · $54 owed), 3 untouched, $197.00 · 0 LBP still owed", async () => {
      renderSheet([...SIX_USD_ROWS, LBP_ROW]);

      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd-lbp",
      );
      // Line 1 is USD; line 2 (LBP) stays pre-filled with 900,000.
      fireEvent.change(amountInput(usd), { target: { value: "300" } });

      const preview = within(usd).getByTestId(
        "supplier-account-settle-preview-usd",
      );
      await waitFor(() =>
        expect(previewStatuses(preview)).toEqual([
          ["101", "closes"],
          ["102", "closes"],
          ["103", "part-paid"],
          ["104", "untouched"],
          ["105", "untouched"],
          ["106", "untouched"],
        ]),
      );
      const partial = within(preview)
        .getAllByTestId("supplier-account-settle-preview-row")
        .find((r) => r.getAttribute("data-status") === "part-paid")!;
      expect(partial.textContent).toContain("$47 of $101 · $54 owed");
      expect(
        within(usd).getByTestId("supplier-account-settle-still-owed-usd")
          .textContent,
      ).toBe("$197.00");
      // The box's own Remaining row names only the short currency.
      expect(within(usd).getByTestId("remaining-amount").textContent).toBe(
        "$197.00",
      );

      const lbpPreview = within(usd).getByTestId(
        "supplier-account-settle-preview-lbp",
      );
      expect(previewStatuses(lbpPreview)).toEqual([["201", "closes"]]);
      expect(
        within(usd).getByTestId("supplier-account-settle-still-owed-lbp")
          .textContent,
      ).toBe("0 LBP");
    });

    it("an amount above what is owed says the extra goes on the account", async () => {
      renderSheet([...SIX_USD_ROWS]);

      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      fireEvent.change(amountInput(usd), { target: { value: "507.11" } });
      // "Account": nothing is handed back (the default hands the change back).
      await waitFor(() =>
        expect(within(usd).getByTestId("return-change")).toBeInTheDocument(),
      );
      fireEvent.click(within(usd).getByTestId("change-destination-account"));

      await waitFor(() =>
        expect(
          within(usd).getByTestId("supplier-account-settle-extra-usd")
            .textContent,
        ).toMatch(/\$10\.11.*goes on the account/),
      );
      expect(
        within(usd).getByTestId("supplier-account-settle-still-owed-usd")
          .textContent,
      ).toBe("$0.00");
    });
  });
});

describe("AccountSettleSheet.lira345Supplier (LIRA-345)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-345 — the Settle Account sheet for a supplier outside the OMT
   * account (Katsh here): its own name everywhere, no OMT statement-type
   * picker, no commission field when the supplier has no commission to
   * settle, and a stale refusal recognised whatever the supplier's name.
   *
   * RULE 17 — written before the sheet took `showStatementTypes` /
   * `showCommission` and the name-agnostic stale check; the first run's
   * failures are recorded in the LIRA-345 hand-off report.
   */

  const KATSH = { account_supplier_id: 7, account_name: "Katsh" };

  /** A Katsh top-up still owed (a DAY row on 3 Oct). */
  const TOP_UP: AccountUnsettledRow = queueRow({
    kind: "LEDGER",
    id: 501,
    supplier_id: 7,
    source_provider: "Katsh",
    source_name: "Katsh",
    created_at: "2026-10-03 09:00:00",
    amount_usd: 500,
    entry_type: "TOP_UP",
    service_type: null,
    commission_usd: 0,
    omt_service_type: null,
    commission_model: null,
  });

  function renderSheet() {
    mockGetSupplierAccountUnsettled.mockResolvedValue([
      { ...TOP_UP, shop_day: "2026-10-03" },
    ]);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={KATSH}
          showStatementTypes={false}
          showCommission={false}
          onClose={jest.fn()}
          onSettled={jest.fn()}
        />
      </QueryClientProvider>,
    );
  }

  describe("AccountSettleSheet — a supplier outside the OMT account (LIRA-345)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("names the supplier and hides the OMT statement types and the commission field", async () => {
      renderSheet();
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      expect(screen.getByText("Settle Katsh account")).toBeInTheDocument();
      expect(
        screen.queryByTestId("supplier-account-settle-covered"),
      ).toBeNull();
      expect(
        within(usd).queryByTestId("supplier-account-settle-commission-usd"),
      ).toBeNull();
      expect(screen.queryByText(/OMT/)).toBeNull();
    });

    it("a stale refusal naming Katsh keeps the operator's picked days (FR-021)", async () => {
      mockSettleSupplierAccount.mockResolvedValue({
        success: false,
        error:
          "Katsh's balance changed since you opened this sheet. Check the new amounts. (expected $500.00 + 0 LBP, found $800.00 + 0 LBP)",
      });
      renderSheet();
      // After the refusal the queue has a new open day (4 Oct). The stale
      // path freezes the picks, so it is NOT added to them; any other error
      // leaves the default pick, which would take it.
      mockGetSupplierAccountUnsettled.mockResolvedValue([
        { ...TOP_UP, shop_day: "2026-10-03" },
        {
          ...TOP_UP,
          id: 502,
          created_at: "2026-10-04 09:00:00",
          shop_day: "2026-10-04",
          amount_usd: 300,
          remaining_usd: 300,
        },
      ]);
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      const amount = within(usd).getAllByTestId(
        /^payment-amount-/,
      )[0] as HTMLInputElement;
      fireEvent.change(amount, { target: { value: "500" } });
      const submit = screen.getByTestId("supplier-account-settle-submit");
      await waitFor(() => expect(submit).not.toBeDisabled());
      const fetchesBefore = mockGetSupplierAccountUnsettled.mock.calls.length;
      fireEvent.click(submit);

      expect(
        (await screen.findByTestId("supplier-account-settle-error"))
          .textContent,
      ).toMatch(/^Katsh's balance changed/);
      await waitFor(() =>
        expect(
          mockGetSupplierAccountUnsettled.mock.calls.length,
        ).toBeGreaterThan(fetchesBefore),
      );
      await waitFor(() =>
        expect(screen.getByText("1 day picked")).toBeInTheDocument(),
      );
      expect(screen.queryByText("2 days picked")).toBeNull();
    });
  });
});

describe("AccountSettleSheet.staleQueueRefetch (LIRA-189)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Diagnostic/regression guard for the LIRA-189 e2e flake on
   * lira-189-omt-account-settlement.spec.ts:604 ("A net-negative account
   * (cashout credit alone, no debt) offers the COLLECT direction" — net
   * readout expected -337.34, received 0).
   *
   * Root-cause reasoning (confirmed here by actually running it, not just
   * reading the source — fable-brain §6.5/§28): `useSupplierAccountUnsettledQuery`
   * (queryKey `["supplier-account-unsettled", accountId]`) is shared between
   * `SupplierAccountCard` (rendered continuously while the Companies tab is
   * open) and `AccountSettleSheet` (mounted only while the sheet is open).
   * The app-wide `staleTime` is 30s (`App.tsx`). The failing e2e spec seeds
   * its cashout row via a RAW `window.api.omt.*` call — the same class of
   * change `useSuppliers.ts`'s own `useRefreshSupplierAccountQueries` doc
   * comment already names as a gap ("a top-up made from Recharge... still
   * leaves the account card stale ... until the 30s staleTime lapses") —
   * which never invalidates this query. If the sheet reuses a NOT-stale
   * cached queue from before that seed, the freshly-seeded row is invisible
   * to the sheet: `isolateSelection` (the spec's checkbox-driving helper)
   * has nothing matching to check, the selection stays empty, and every
   * total — selected-total AND net alike — reads $0.00. That is what the
   * fix (`AccountSettleSheet` now passes `refetchOnMount: "always"` to this
   * query) closes: this test proves the mechanism by reusing ONE QueryClient
   * across two mounts, exactly like the shared Electron app instance the e2e
   * suite runs against.
   *
   * Failing-first proof (rule 17): temporarily reverting the second render's
   * options to omit `refetchOnMount: "always"` (i.e. simulating the pre-fix
   * `AccountSettleSheet`) makes this test fail with the second mount still
   * showing the STALE row set — reproducing "Received: 0" in miniature. That
   * revert was applied, observed failing, then reverted back; see the PR/
   * handover notes for the transcript. The assertions below run against the
   * FIXED component/hook.
   *
   * LIRA-322 rewrite (rule 24 — intent kept): the sheet no longer has a
   * tick list or a merged "net" figure; the seeded row must show up in the
   * USD section's preview, which now reads "OMT pays you $337.34". The
   * `useApi` mock is now ONE stable object (rule 25). A second case guards
   * FR-021: when the server refuses a stale preview, the sheet refetches the
   * queue, shows the message and keeps the amount the operator typed (written
   * with the change — not proven failing-first).
   */

  const ACCOUNT: AccountBalance = {
    account_supplier_id: 1,
    account_name: "OMT",
    total_usd: 0,
    total_lbp: 0,
    children: [
      {
        supplier_id: 1,
        name: "OMT",
        provider: "OMT",
        drawer_name: "OMT_System",
        total_usd: 0,
        total_lbp: 0,
        is_parent: true,
      },
    ],
  };

  /** The queue as it existed BEFORE the out-of-band seed (e.g. empty, like
   *  right after a prior test's settle emptied it out). */
  const ROWS_BEFORE_SEED: AccountUnsettledRow[] = [];

  /** A cashout credit row that appears ONLY after an out-of-band raw-IPC
   *  seed — analogous to the e2e spec's `seedOmtAppCashout`. */
  const ROW_CASHOUT = queueRow({
    kind: "LEDGER",
    id: 999,
    supplier_id: 2,
    source_provider: "OMT_APP",
    source_name: "OMT App",
    created_at: "2026-09-20 00:00:00",
    amount_usd: -337.34,
    entry_type: "PAYMENT",
    service_type: null,
    commission_usd: 0.34,
    omt_service_type: null,
    commission_model: null,
  });
  const ROWS_AFTER_SEED: AccountUnsettledRow[] = [ROW_CASHOUT];

  describe("AccountSettleSheet — settle sheet must not settle against a stale queue", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      cleanup();
    });

    it("shows a row seeded AFTER the query was last cached, on a fresh sheet mount reusing the SAME QueryClient (production staleTime)", async () => {
      // Mirrors App.tsx's real QueryClient config (rule 28 — reproduce the
      // actual environment, not a jest-friendly staleTime of 0) and is reused
      // across both mounts below, exactly like the one long-lived renderer.
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      });

      // First mount — populates the shared cache with the empty queue.
      mockGetSupplierAccountUnsettled.mockResolvedValueOnce(ROWS_BEFORE_SEED);
      const { unmount } = render(
        <QueryClientProvider client={queryClient}>
          <AccountSettleSheet
            account={ACCOUNT}
            onClose={jest.fn()}
            onSettled={jest.fn()}
          />
        </QueryClientProvider>,
      );
      await waitFor(() => {
        expect(
          screen.getByText(/Nothing to settle on the OMT account/i),
        ).toBeInTheDocument();
      });
      unmount();

      // Out-of-band seed: nothing invalidates the query cache.
      mockGetSupplierAccountUnsettled.mockResolvedValueOnce(ROWS_AFTER_SEED);

      // Second mount, same QueryClient, well within the 30s staleTime.
      render(
        <QueryClientProvider client={queryClient}>
          <AccountSettleSheet
            account={ACCOUNT}
            onClose={jest.fn()}
            onSettled={jest.fn()}
          />
        </QueryClientProvider>,
      );

      // `refetchOnMount: "always"` forces a real refetch despite the "fresh"
      // cache — the seeded row must be RENDERED in the preview.
      const row = await waitFor(
        () => {
          const found = screen.getByTestId(
            "supplier-account-settle-preview-row",
          );
          expect(found).toHaveAttribute("data-row-id", "999");
          return found;
        },
        { timeout: 3000 },
      );
      expect(row).toBeInTheDocument();

      const usd = screen.getByTestId("supplier-account-settle-section-usd");
      expect(usd.textContent).toContain("OMT pays you");
      expect(
        within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
      ).toBe("$337.34");
    });

    it("FR-021: a stale refusal refetches the queue, shows the message and keeps the typed amount", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      mockGetSupplierAccountUnsettled.mockResolvedValue(ROWS_AFTER_SEED);
      mockSettleSupplierAccount.mockResolvedValue({
        success: false,
        error:
          "OMT's balance changed since you opened this sheet. Check the new amounts. (expected $-337.34 + 0 LBP, found $-300.00 + 0 LBP)",
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

      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      const amount = within(usd).getAllByTestId(
        /^payment-amount-/,
      )[0] as HTMLInputElement;
      fireEvent.change(amount, { target: { value: "337.34" } });
      const submit = screen.getByTestId("supplier-account-settle-submit");
      await waitFor(() => expect(submit).not.toBeDisabled());
      const fetchesBefore = mockGetSupplierAccountUnsettled.mock.calls.length;
      fireEvent.click(submit);

      expect(
        (await screen.findByTestId("supplier-account-settle-error"))
          .textContent,
      ).toMatch(/^OMT's balance changed since you opened this sheet\./);
      await waitFor(() =>
        expect(
          mockGetSupplierAccountUnsettled.mock.calls.length,
        ).toBeGreaterThan(fetchesBefore),
      );
      const amountAfter = within(
        screen.getByTestId("supplier-account-settle-section-usd"),
      ).getAllByTestId(/^payment-amount-/)[0] as HTMLInputElement;
      expect(amountAfter.value.replace(/,/g, "")).toBe("337.34");
    });
  });
});

describe("AccountSettleSheet (LIRA-189)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189) — `AccountSettleSheet`: the OMT
   * open-credit account's one-call settle sheet (rule 16). INTERACTION-layer
   * test — renders the REAL `MultiPaymentInput` (jest maps "@liratek/ui" to
   * packages/ui/src; only `useApi` is overridden, by ONE stable object — rule
   * 25), so a broken payload shape fails here.
   *
   * LIRA-322 rewrite (rule 24 — intent kept, assertions moved to the
   * amount-first sheet): rows are previewed oldest first; credits net against
   * debts in their own currency; the deferred cash-out commission shows when
   * the credit closes; a currency OMT owes the shop is a COLLECT section; one
   * call carries the legs; an UNDERpay is now a partial payment (no longer a
   * block); an overpay is still allowed; a hand-typed rate is sent. Payloads
   * are parsed through `supplierSettleAccountSchema` (rule 24).
   */

  const ACCOUNT: AccountBalance = {
    account_supplier_id: 1,
    account_name: "OMT",
    total_usd: 1124.9,
    total_lbp: 0,
    children: [
      {
        supplier_id: 1,
        name: "OMT",
        provider: "OMT",
        drawer_name: "OMT_System",
        total_usd: 1050,
        total_lbp: 0,
        is_parent: true,
      },
      {
        supplier_id: 2,
        name: "OMT App",
        provider: "OMT_APP",
        drawer_name: "OMT_App",
        total_usd: -100.1,
        total_lbp: 0,
        is_parent: false,
      },
      {
        supplier_id: 3,
        name: "iPick",
        provider: "iPick",
        drawer_name: "iPick",
        total_usd: 175,
        total_lbp: 0,
        is_parent: false,
      },
    ],
  };

  const ROW_OMT = queueRow({
    id: 10,
    created_at: "2026-09-01 00:00:00",
    amount_usd: 1050,
  });

  const ROW_IPICK = queueRow({
    kind: "LEDGER",
    id: 30,
    supplier_id: 3,
    source_provider: "iPick",
    source_name: "iPick",
    created_at: "2026-09-03 00:00:00",
    amount_usd: 175,
    entry_type: "TOP_UP",
    service_type: null,
    omt_service_type: null,
    commission_model: null,
  });

  /** A cash-out credit — negative, carries the deferred cash-out commission
   *  (D14) recognised when the credit closes. */
  const ROW_CASHOUT = queueRow({
    kind: "LEDGER",
    id: 20,
    supplier_id: 2,
    source_provider: "OMT_APP",
    source_name: "OMT App",
    created_at: "2026-09-05 00:00:00",
    amount_usd: -100.1,
    entry_type: "PAYMENT",
    service_type: null,
    commission_usd: 0.1,
    omt_service_type: null,
    commission_model: null,
  });

  /** A lira transfer — makes the account owed in USD and LBP. */
  const ROW_LBP = queueRow({
    id: 40,
    created_at: "2026-09-04 00:00:00",
    amount_lbp: 900000,
  });

  function renderSheet(rows: AccountUnsettledRow[]) {
    mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onClose = jest.fn();
    const onSettled = jest.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={ACCOUNT}
          onClose={onClose}
          onSettled={onSettled}
        />
      </QueryClientProvider>,
    );
    return { onClose, onSettled };
  }

  const usdSection = () =>
    screen.findByTestId("supplier-account-settle-section-usd");

  function amountInput(section: HTMLElement): HTMLInputElement {
    return within(section).getAllByTestId(
      /^payment-amount-/,
    )[0] as HTMLInputElement;
  }

  function previewRows(section: HTMLElement) {
    return within(section)
      .getAllByTestId("supplier-account-settle-preview-row")
      .map((r) => [
        r.getAttribute("data-row-id"),
        r.getAttribute("data-status"),
      ]);
  }

  async function submitAndParse() {
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
    const [accountSupplierId, payload] =
      mockSettleSupplierAccount.mock.calls[0];
    expect(accountSupplierId).toBe(1);
    return supplierSettleAccountSchema.parse({
      account_supplier_id: accountSupplierId,
      ...payload,
    });
  }

  describe("AccountSettleSheet (LIRA-189, amount-first since LIRA-322)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 555 });
    });

    // LIRA-343 rewrite (rule 24): "nothing is ticked by hand" was the
    // LIRA-322 Pick transfers override, now removed. Its intent — the default
    // settles every open row with no hand-picking — is kept: every open day
    // before today is picked, so every row is in `selections`, and the old
    // toggle must not come back at the top level.
    it("previews every open row oldest first, and every open day is picked without a tap", async () => {
      renderSheet([ROW_CASHOUT, ROW_OMT, ROW_IPICK]);

      const usd = await usdSection();
      // Oldest first: ROW_OMT (09-01), ROW_IPICK (09-03), ROW_CASHOUT (09-05).
      expect(previewRows(usd).map(([id]) => id)).toEqual(["10", "30", "20"]);
      expect(
        screen.queryByTestId("supplier-account-settle-pick-toggle"),
      ).not.toBeInTheDocument();
      fireEvent.change(amountInput(usd), { target: { value: "1124.90" } });
      const parsed = await submitAndParse();
      expect(parsed.selections).toEqual([
        { kind: "FINANCIAL_SERVICE", id: 10 },
        { kind: "LEDGER", id: 30 },
        { kind: "LEDGER", id: 20 },
      ]);
    });

    it("nets a credit row against the debt rows: You pay OMT $1124.90", async () => {
      renderSheet([ROW_OMT, ROW_IPICK, ROW_CASHOUT]);

      const usd = await usdSection();
      expect(usd.textContent).toContain("You pay OMT");
      expect(
        within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
      ).toBe("$1124.90");
    });

    it("the credit closes by netting, and its deferred cash-out commission shows", async () => {
      renderSheet([ROW_OMT, ROW_IPICK, ROW_CASHOUT]);

      const usd = await usdSection();
      fireEvent.change(amountInput(usd), { target: { value: "100" } });

      await waitFor(() =>
        expect(previewRows(usd)).toEqual([
          ["10", "part-paid"],
          ["30", "untouched"],
          ["20", "closes"],
        ]),
      );
      expect(
        within(usd).getByTestId(
          "supplier-account-settle-deferred-commission-usd",
        ).textContent,
      ).toBe("$0.10");
    });

    it("a currency where OMT owes the shop is a COLLECT section: OMT pays you $100.10", async () => {
      renderSheet([ROW_CASHOUT]);

      const usd = await usdSection();
      expect(usd.textContent).toContain("OMT pays you");
      expect(
        within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
      ).toBe("$100.10");

      fireEvent.change(amountInput(usd), { target: { value: "100.10" } });
      const parsed = await submitAndParse();
      expect(parsed.per_currency?.USD?.direction).toBe("COLLECT");
      expect(parsed.expected_owed?.usd).toBeCloseTo(-100.1, 2);
    });

    it("submits ONE call with the money as payment legs (rule 16)", async () => {
      const { onSettled } = renderSheet([ROW_OMT, ROW_IPICK]);

      const usd = await usdSection();
      fireEvent.change(amountInput(usd), { target: { value: "1225" } });
      const parsed = await submitAndParse();

      expect(parsed.per_currency?.USD).toEqual({
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 1225 }],
      });
      expect(parsed.expected_owed?.usd).toBeCloseTo(1225, 2);
      await waitFor(() => expect(onSettled).toHaveBeenCalled());
    });

    // LIRA-322 (US2) replaces §9.3's "a selected row is all-or-nothing": an
    // amount below what is owed is a partial payment, never a block.
    it("an underpay is accepted as a partial payment — no mismatch, Confirm enabled", async () => {
      renderSheet([ROW_OMT, ROW_IPICK]);

      const usd = await usdSection();
      fireEvent.change(amountInput(usd), { target: { value: "500" } });

      await waitFor(() =>
        expect(previewRows(usd)).toEqual([
          ["10", "part-paid"],
          ["30", "untouched"],
        ]),
      );
      expect(
        screen.queryByTestId("supplier-account-settle-mismatch"),
      ).not.toBeInTheDocument();
      const parsed = await submitAndParse();
      expect(parsed.per_currency?.USD?.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 500 },
      ]);
    });

    // LIRA-315 — an overpay is allowed: the change box decides what happens.
    it("does NOT block an overpay — the change box shows and Confirm stays enabled", async () => {
      renderSheet([ROW_OMT, ROW_IPICK]);

      const usd = await usdSection();
      fireEvent.change(amountInput(usd), { target: { value: "1500" } });

      await waitFor(() =>
        expect(within(usd).getByTestId("return-change")).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId("supplier-account-settle-submit"),
      ).not.toBeDisabled();
    });

    // Owner decision 2026-10-07: a rate the cashier types by hand is sent and
    // stamped on the SUPPLIER_SETTLEMENT row (stamp-only).
    it("sends a hand-typed rate as exchange_rate", async () => {
      // Owner decision 2026-11-01: the rate box shows only when the window
      // mixes USD and LBP. OMT never converts, so a USD-only box has no rate
      // box at all; the rate is typed when OMT is owed in both currencies.
      renderSheet([ROW_OMT, ROW_IPICK, ROW_LBP]);

      const box = await screen.findByTestId(
        "supplier-account-settle-section-usd-lbp",
      );
      fireEvent.change(amountInput(box), { target: { value: "1225" } });
      fireEvent.change(within(box).getByTestId("payment-exchange-rate"), {
        target: { value: "87000" },
      });
      const parsed = await submitAndParse();
      expect(parsed.exchange_rate).toBe(87000);
    });

    it("a USD-only box shows no rate box", async () => {
      renderSheet([ROW_OMT, ROW_IPICK]);

      const usd = await usdSection();
      expect(
        within(usd).queryByTestId("payment-exchange-rate"),
      ).not.toBeInTheDocument();
    });
  });
});
