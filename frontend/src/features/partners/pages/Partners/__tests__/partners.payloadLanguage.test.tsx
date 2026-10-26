/** @jest-environment jsdom */
/**
 * LIRA-331 (T049, rule 28d) — the Partners page sends the SAME payload in
 * Arabic as in English. Every write the page makes is driven once with the
 * language "en" and once with "ar"; the mocked API calls must be deeply
 * equal, so a label that leaks into a payload fails here.
 *
 * Writes walked: settle (USD legs + forgive + reason + notes; Waive; LBP;
 * paper "cash moved" off), Add Credit / Debt (USD debit with cash moved, LBP
 * credit), write-off, add partner, edit partner, deactivate, activate.
 *
 * Not failing-first: a guard against future drift, written before the
 * conversion and run green against the English-only screen (11/11), then
 * re-run green after it. Each Arabic run also asserts an Arabic label is on
 * screen, so the comparison is between two really different languages.
 *
 * Renders the REAL page and the real CounterpartySettleModal /
 * MultiPaymentInput. Controls are found by test id or by data (the partner
 * name, the currency codes), never by a label. `useApi` returns ONE stable
 * object (rule 25).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { partnerSettleDaysSchema, partnerSettleSchema } from "@liratek/core";
import { i18n } from "@/i18n/setup";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Partners from "../index";
import {
  endRun,
  firstPaymentAmount,
  setGuardLanguage,
  settleConfirmButton,
  snapshotCalls,
  type GuardLanguage,
} from "@/features/suppliers/testing/payloadLanguage";

const mockApi = {
  getActiveServiceProviders: jest.fn(),
  partners: {
    getAllBalances: jest.fn(),
    getLedger: jest.fn(),
    recordTransaction: jest.fn(),
    settle: jest.fn(),
    writeOff: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    activate: jest.fn(),
    getBalance: jest.fn(),
    getSettleOpenRows: jest.fn(),
    getSettleMonthRows: jest.fn(),
    getSettleDayDetail: jest.fn(),
    settleDays: jest.fn(),
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi, appEvents: { emit: jest.fn() } };
});

// LIRA-346 — Settle opens the by-day sheet (TanStack queries); the old
// balance-based modal is reached through "Settle by amount (old way)".
jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return { ...actual, localDay: () => "2026-10-26" };
});

/** One open partner row: For +$100 on 20 Oct (the partner owes the shop). */
const OPEN_FOR_ROW = {
  kind: "LEDGER" as const,
  id: 11,
  partner_id: 1,
  currency: "USD" as const,
  transaction_type: "FOR_POS",
  direction: "DEBIT" as const,
  reference_table: null,
  reference_id: null,
  notes: null,
  source_txn_id: null,
  created_at: "2026-10-20 09:00:00",
  shop_day: "2026-10-20",
  amount_usd: 100,
  amount_lbp: 0,
  covered_usd: 0,
  covered_lbp: 0,
  remaining_usd: 100,
  remaining_lbp: 0,
  row_scope: "DAY" as const,
  unit_class: "DAY" as const,
  relief_origin: null,
  relief_ref: null,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Partners />
    </QueryClientProvider>,
  );
}

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

const PARTNER = {
  id: 1,
  name: "Acme Partner",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  usd: 100,
  lbp: 500000,
  usdt: 0,
};

type Write =
  | "settle"
  | "settleDays"
  | "recordTransaction"
  | "writeOff"
  | "create"
  | "update"
  | "deactivate"
  | "activate";

interface Scenario {
  name: string;
  write: Write;
  partner?: typeof PARTNER;
  drive: () => Promise<void>;
  check: (calls: unknown[][]) => void;
}

const click = (el: Element) => fireEvent.click(el);
const type = (el: Element, value: string) =>
  fireEvent.change(el, { target: { value } });

async function openPartner() {
  click(await screen.findByText("Acme Partner"));
}

async function openSettle() {
  await openPartner();
  click(await screen.findByTestId("partner-action-settle"));
  // LIRA-346: Settle opens the by-day sheet; the old balance-based modal
  // is one link away ("Settle by amount (old way)").
  click(await screen.findByTestId("partner-settle-by-amount"));
  await screen.findByTestId("counterparty-settle-modal");
}

/** Picks a currency in a headless `Select` (trigger + option are codes). */
async function pickCurrency(code: "USD" | "LBP") {
  const other = code === "USD" ? "LBP" : "USD";
  click(screen.getByRole("button", { name: other }));
  click(await screen.findByRole("option", { name: code }));
  await screen.findByRole("button", { name: code });
}

async function runIn(
  lang: GuardLanguage,
  scenario: Scenario,
): Promise<unknown[][]> {
  jest.clearAllMocks();
  mockApi.getActiveServiceProviders.mockResolvedValue([
    { code: "WHISH", label: "Whish" },
    { code: "OMT", label: "OMT" },
  ]);
  mockApi.partners.getAllBalances.mockResolvedValue([
    scenario.partner ?? PARTNER,
  ]);
  mockApi.partners.getLedger.mockResolvedValue({
    entries: [],
    balance: { usd: 100, lbp: 500000, usdt: 0 },
    breakdown: null,
  });
  mockApi.partners.getSettleOpenRows.mockResolvedValue([OPEN_FOR_ROW]);
  mockApi.partners.getSettleMonthRows.mockResolvedValue([OPEN_FOR_ROW]);
  mockApi.partners.getSettleDayDetail.mockResolvedValue([]);
  for (const w of [
    "settle",
    "settleDays",
    "recordTransaction",
    "writeOff",
    "create",
    "update",
    "deactivate",
    "activate",
  ] as const) {
    mockApi.partners[w].mockResolvedValue({ success: true, data: { id: 9 } });
  }
  await setGuardLanguage(lang);
  try {
    renderPage();
    // Proves the switch happened: the page header renders in Arabic.
    if (lang === "ar") {
      expect(await screen.findByText("إظهار غير النشطين")).toBeInTheDocument();
    } else {
      expect(await screen.findByText("Show inactive")).toBeInTheDocument();
    }
    await scenario.drive();
    const mock = mockApi.partners[scenario.write];
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    return snapshotCalls(mock.mock.calls as unknown[][]);
  } finally {
    endRun();
  }
}

const settlePayload = (calls: unknown[][]) =>
  partnerSettleSchema.parse(calls[0]![0]);

const SCENARIOS: Scenario[] = [
  {
    name: "Settle by day (LIRA-346) — USD $80 cash, $20 forgiven with a reason, notes",
    write: "settleDays",
    drive: async () => {
      await openPartner();
      click(await screen.findByTestId("partner-action-settle"));
      await screen.findByTestId("partner-settle-payer-usd");
      type(firstPaymentAmount(), "80");
      type(screen.getByTestId("partner-settle-forgive-input"), "20");
      type(
        await screen.findByTestId("partner-settle-forgive-reason"),
        "Goodwill",
      );
      type(screen.getByTestId("partner-settle-notes"), "Week 43");
      const submit = screen.getByTestId("partner-settle-submit");
      await waitFor(() => expect(submit).not.toBeDisabled());
      click(submit);
    },
    check: (calls) => {
      const p = partnerSettleDaysSchema.parse(calls[0]![0]);
      expect(p.selections).toEqual([11]);
      expect(p.include_account_credits).toBe(true);
      expect(p.per_currency.USD).toEqual({
        payer: "PARTNER",
        payments: [{ method: "CASH", currency_code: "USD", amount: 80 }],
        forgive: { amount: 20, reason: "Goodwill" },
      });
      expect(p.per_currency.LBP).toBeUndefined();
      expect(p.notes).toBe("Week 43");
    },
  },
  {
    name: "Settle USD — $80 cash, $20 forgiven with a reason, notes",
    write: "settle",
    drive: async () => {
      await openSettle();
      type(firstPaymentAmount(), "80");
      type(screen.getByTestId("partner-settle-forgive-input"), "20");
      type(
        await screen.findByTestId("partner-settle-forgive-reason"),
        "Goodwill",
      );
      type(screen.getByTestId("partner-settle-notes"), "Week 41");
      click(settleConfirmButton());
    },
    check: (calls) => {
      const p = settlePayload(calls);
      expect(p.amount).toBe(80);
      expect(p.currency).toBe("USD");
      expect(p.settlementMethod).toBe("CASH");
      expect(p.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 80 },
      ]);
      expect(p.discount).toEqual({
        amount_usd: 20,
        amount_lbp: 0,
        reason: "Goodwill",
      });
      expect(p.notes).toBe("Week 41");
    },
  },
  {
    name: "Settle USD — $98 paid, Waive the $2 gap",
    write: "settle",
    drive: async () => {
      await openSettle();
      type(firstPaymentAmount(), "98");
      click(await screen.findByTestId("waive-remaining"));
      await waitFor(() =>
        expect(
          (
            screen.getByTestId(
              "partner-settle-forgive-input",
            ) as HTMLInputElement
          ).value,
        ).toBe("2"),
      );
      click(settleConfirmButton());
    },
    check: (calls) => {
      const p = settlePayload(calls);
      expect(p.amount).toBe(98);
      expect(p.discount).toEqual({ amount_usd: 2, amount_lbp: 0 });
    },
  },
  {
    name: "Settle LBP — 500,000 LBP cash",
    write: "settle",
    drive: async () => {
      await openSettle();
      await pickCurrency("LBP");
      await screen.findByDisplayValue("500,000");
      click(settleConfirmButton());
    },
    check: (calls) => {
      const p = settlePayload(calls);
      expect(p.currency).toBe("LBP");
      expect(p.amount).toBe(500000);
      expect(p.payments).toEqual([
        { method: "CASH", currency_code: "LBP", amount: 500000 },
      ]);
    },
  },
  {
    name: "Settle on paper (cash moved off) — $60",
    write: "settle",
    drive: async () => {
      await openSettle();
      click(
        within(
          screen.getByTestId("partner-settle-cash-moved-toggle"),
        ).getByRole("checkbox"),
      );
      type(await screen.findByTestId("partner-settle-paper-amount"), "60");
      click(settleConfirmButton());
    },
    check: (calls) => {
      const p = settlePayload(calls);
      expect(p.settlementMethod).toBe("CLIENT_ACCOUNT");
      expect(p.amount).toBe(60);
      expect(p.payments).toBeUndefined();
    },
  },
  {
    name: "Add Credit / Debt — USD debit, cash moved, notes",
    write: "recordTransaction",
    drive: async () => {
      await openPartner();
      click(await screen.findByTestId("partner-action-add-credit"));
      type(await screen.findByTestId("partner-record-amount"), "25");
      click(screen.getByTestId("partner-record-direction-debit"));
      click(
        within(screen.getByTestId("partner-cash-moved-toggle")).getByRole(
          "checkbox",
        ),
      );
      type(screen.getByTestId("partner-record-notes"), "Advance");
      click(screen.getByTestId("partner-record-submit"));
    },
    check: (calls) => {
      expect(calls[0]![0]).toEqual({
        partnerId: 1,
        transactionType: "ADJUSTMENT",
        amount: 25,
        currency: "USD",
        direction: "DEBIT",
        notes: "Advance",
        moveCash: true,
      });
    },
  },
  {
    name: "Add Credit / Debt — LBP credit on paper",
    write: "recordTransaction",
    drive: async () => {
      await openPartner();
      click(await screen.findByTestId("partner-action-add-credit"));
      await pickCurrency("LBP");
      type(screen.getByTestId("partner-record-amount"), "50000");
      click(screen.getByTestId("partner-record-direction-credit"));
      click(screen.getByTestId("partner-record-submit"));
    },
    check: (calls) => {
      expect(calls[0]![0]).toEqual({
        partnerId: 1,
        transactionType: "ADJUSTMENT",
        amount: 50000,
        currency: "LBP",
        direction: "CREDIT",
      });
    },
  },
  {
    name: "Write off — $30 with a reason",
    write: "writeOff",
    drive: async () => {
      await openPartner();
      click(await screen.findByTestId("partner-action-write-off"));
      type(await screen.findByTestId("partner-writeoff-amount"), "30");
      type(screen.getByTestId("partner-writeoff-reason"), "Bad debt");
      click(screen.getByTestId("partner-writeoff-submit"));
    },
    check: (calls) => {
      expect(calls[0]![0]).toEqual({
        partnerId: 1,
        amount_usd: 30,
        amount_lbp: 0,
        reason: "Bad debt",
      });
    },
  },
  {
    name: "Add partner — name, phone, notes, default system",
    write: "create",
    drive: async () => {
      click(await screen.findByTestId("partner-add"));
      type(await screen.findByTestId("partner-form-name"), "New Partner");
      type(screen.getByTestId("partner-form-phone"), "+961 70 000 000");
      type(screen.getByTestId("partner-form-notes"), "Met at fair");
      click(screen.getByTestId("partner-form-submit"));
    },
    check: (calls) => {
      expect(calls[0]![0]).toEqual({
        name: "New Partner",
        phone: "+961 70 000 000",
        notes: "Met at fair",
        system_association: "WHISH",
      });
    },
  },
  {
    name: "Edit partner — rename",
    write: "update",
    drive: async () => {
      await openPartner();
      click(await screen.findByTestId("partner-action-edit"));
      type(await screen.findByTestId("partner-form-name"), "Acme Renamed");
      click(screen.getByTestId("partner-form-submit"));
    },
    check: (calls) => {
      expect(calls[0]).toEqual([
        1,
        { name: "Acme Renamed", system_association: "WHISH" },
      ]);
    },
  },
  {
    name: "Deactivate",
    write: "deactivate",
    drive: async () => {
      await openPartner();
      click(await screen.findByTestId("partner-action-deactivate"));
      click(await screen.findByTestId("partner-deactivate-confirm"));
    },
    check: (calls) => {
      expect(calls[0]).toEqual([1]);
    },
  },
  {
    name: "Activate",
    write: "activate",
    partner: { ...PARTNER, is_active: 0 },
    drive: async () => {
      click(await screen.findByTestId("partner-show-inactive"));
      await openPartner();
      click(await screen.findByTestId("partner-action-activate"));
    },
    check: (calls) => {
      expect(calls[0]).toEqual([1]);
    },
  },
];

describe("Partners page — the payload does not depend on the language (LIRA-331 T049)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      const en = await runIn("en", scenario);
      scenario.check(en);
      const ar = await runIn("ar", scenario);
      expect(ar).toEqual(en);
    },
  );
});
