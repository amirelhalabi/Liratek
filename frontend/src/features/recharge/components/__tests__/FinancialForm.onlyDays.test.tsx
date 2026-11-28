/** @jest-environment jsdom */
/**
 * LIRA-406 — Whish App "Only Days": an MTC / Alfa card on the Whish App grid
 * can be sold for its days only, exactly like Katsh / iPick. The walk-in
 * checkout sends, per unit, the Only Days price, the GROSS card cost and the
 * credit-return fields the server books the returned credit from.
 *
 * Field names come from the core schema (rule 24: every payload is parsed
 * through `createFinancialServiceSchema.strict()`). `useApi` returns ONE
 * module-level object (rule 25). Harness follows FinancialForm.transactionDetails.
 *
 * Rule 17: written before the Whish App grid had Only Days and seen failing
 * (no "Only Days" checkbox on the card).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import { FinancialForm } from "../FinancialForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

// Only Days pricing data for the Alfa 7.58 card (id 31): days price 250,000.
const mockApi = {
  addOMTTransaction: mockAddOMTTransaction,
  getAllSettings: jest.fn().mockResolvedValue([]),
  getActiveMobileServiceItems: jest.fn().mockResolvedValue([
    {
      id: 31,
      sell_days_lbp: 250_000,
      sell_credit_lbp: null,
      max_returned_credits_usd: null,
    },
  ]),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 90000 }),
}));

jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: 411 }),
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => <input data-testid="stub-client-input" />,
}));
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));
jest.mock("../HistoryModal", () => ({
  HistoryModal: () => null,
}));
jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn().mockResolvedValue([]),
}));

jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

const ALFA_758: ServiceItem = {
  id: 31,
  key: "WHISH_APP/alfa/Prepaid/7.58",
  provider: "WHISH_APP",
  category: "alfa",
  subcategory: "Prepaid",
  label: "7.58",
  catalogCost: 765_007,
  catalogSellPrice: 800_000,
  sortOrder: 0,
  credits: 7.58,
  validityDays: 30,
  days_cost_lbp: 120_707,
};

const DSL: ServiceItem = {
  key: "WHISH_APP/internet/DSL/300k",
  provider: "WHISH_APP",
  category: "internet",
  subcategory: "DSL",
  label: "DSL 300k",
  catalogCost: 250_000,
  catalogSellPrice: 300_000,
  sortOrder: 1,
};

const CONFIG: ProviderConfig = {
  key: "WHISH_APP",
  label: "Whish App",
  module: "ipec_katch",
  drawer: "Whish_App",
  formMode: "financial",
  color: "text-red-400",
  bgTint: "bg-red-400/10",
  activeBg: "bg-red-500",
  activeText: "text-white",
  badgeCls: "bg-red-400/10 text-red-400",
  iconKey: "Zap",
  hasSupplier: true,
};

function renderForm(items: ServiceItem[]) {
  return render(
    <FinancialForm
      activeConfig={CONFIG}
      finTransactions={[]}
      activeProvider="WHISH_APP"
      getCategoriesForProvider={() => ["bills"]}
      getServiceItems={(_p, category) => (category === "bills" ? items : [])}
      methods={[{ code: "CASH", label: "Cash" }]}
      drawerAffectingMethods={[{ code: "CASH", label: "Cash" }]}
      clientName="amir halabi"
      setClientName={jest.fn()}
      loadFinancialData={jest.fn()}
      formatAmount={(v) => v.toLocaleString()}
      showHistory={false}
      setShowHistory={jest.fn()}
      alfaCreditSellRate={100_000}
    />,
  );
}

const strictSchema = createFinancialServiceSchema.strict();

async function payAndCollect(expectedCalls: number) {
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("stub-payment-sheet");
  fireEvent.click(screen.getByTestId("stub-confirm"));
  await waitFor(() =>
    expect(mockAddOMTTransaction).toHaveBeenCalledTimes(expectedCalls),
  );
  return mockAddOMTTransaction.mock.calls.map((c) => strictSchema.parse(c[0]));
}

describe("FinancialForm — LIRA-406 Whish App Only Days", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("an eligible Alfa card offers Only Days; a card without days does not", async () => {
    renderForm([ALFA_758, DSL]);
    fireEvent.click(screen.getByText("7.58"));
    expect(
      await screen.findByRole("checkbox", { name: /only days/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("DSL 300k"));
    expect(
      screen.getAllByRole("checkbox", { name: /only days/i }),
    ).toHaveLength(1);
  });

  it("Only Days with the default credit: Only Days price, gross cost, the item id, no typed credit", async () => {
    renderForm([ALFA_758]);
    fireEvent.click(screen.getByText("7.58"));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /only days/i }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("katsh-onlydays-credits")).toHaveValue("7"),
    );

    const [unit] = await payAndCollect(1);
    expect(unit!.amount).toBe(250_000);
    expect(unit!.cost).toBe(765_007);
    expect(unit!.itemCategory).toBe("alfa");
    expect(unit!.mobileServiceItemId).toBe(31);
    expect(unit!.returnedCreditsUsd).toBeUndefined();
    expect(unit!.note).toMatch(/ \[Only Days\]$/);
  });

  it("Only Days with an edited credit: the typed credit is sent and the kept credit is charged", async () => {
    renderForm([ALFA_758]);
    fireEvent.click(screen.getByText("7.58"));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /only days/i }),
    );
    const credits = await screen.findByTestId("katsh-onlydays-credits");
    fireEvent.change(credits, { target: { value: "5" } });
    fireEvent.blur(credits);

    const [unit] = await payAndCollect(1);
    // 250,000 days + (7.00 − 5) kept × 100,000 default credit price.
    expect(unit!.amount).toBe(450_000);
    expect(unit!.returnedCreditsUsd).toBe(5);
    expect(unit!.mobileServiceItemId).toBe(31);
  });

  it("a card sold normally sends no credit-return fields and keeps its price", async () => {
    renderForm([ALFA_758]);
    fireEvent.click(screen.getByText("7.58"));

    const [unit] = await payAndCollect(1);
    expect(unit!.amount).toBe(800_000);
    expect(unit!.mobileServiceItemId).toBeUndefined();
    expect(unit!.returnedCreditsUsd).toBeUndefined();
    expect(unit!.note).not.toMatch(/Only Days/);
  });
});
