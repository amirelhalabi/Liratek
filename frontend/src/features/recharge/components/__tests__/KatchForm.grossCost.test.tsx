/** @jest-environment jsdom */
/**
 * KatchForm — LIRA-090 B1/B2: gross-cost, mobileServiceItemId, computed default,
 * operator override, walk-in aggregated `telecomCreditReturns` array.
 *
 * Rule 17: every test here MUST have been seen to FAIL on the pre-fix code.
 * The failure output is pasted below in the describe-block comments.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KatchForm } from "../KatchForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

// @liratek/core pulls in Node-only DB modules via its main index — mock the
// subset KatchForm actually uses. The implementations here are faithful copies
// of the real logic (from packages/core/src/utils/telecomCredit.ts) so the
// gross-cost and split-gate tests prove real behaviour, not mocked stubs.
// This is a jest infrastructure necessity — the authoritative definition still
// lives ONLY in core (rule 14); this copy exists solely to let jsdom run.
// Load the REAL core module. frontend/jest.config.ts maps @liratek/core to
// packages/core/src/browser.ts, which excludes the Node-only DB modules that
// once forced a hand-written mock here. Those hand-copied "faithful copies" of
// isTelecomSplitComplete / maxReturnableCredits were a rule-14 duplication:
// they let this suite agree with itself while drifting from production, and
// they broke as soon as the component imported one more core function.
jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

// ── Capture addOMTTransaction payloads ──────────────────────────────────────
const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 42 });

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    addOMTTransaction: mockAddOMTTransaction,
    getAllSettings: jest.fn().mockResolvedValue([]),
    // createMobileServiceItem is also on useApi() — not called in these tests
    createMobileServiceItem: jest.fn().mockResolvedValue({ success: true }),
    // Only-Days pricing model (2026-08-05): KatchForm fetches the catalog's
    // sell_days_lbp/sell_credit_lbp on mount. Empty here on purpose — these
    // gross-cost tests are about the COST side, untouched by the pricing
    // model; the pricing panel stays hidden and the legacy price formula
    // governs (proved separately in KatchForm.onlyDaysPricing.test.tsx).
    getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: null }),
}));

jest.mock("@/assets/logos/alfa.svg?react", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/assets/logos/mtc.svg?react", () => ({
  __esModule: true,
  default: () => null,
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
    onReturnChange?: (legs: unknown[]) => void;
    onExchangeRateChange?: (rate: number) => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-inject-cash"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "L1",
                method: "CASH",
                currencyCode: "LBP",
                amount: 9_600_000,
              },
            ])
          }
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * A split-COMPLETE 77$ MTC cart — the headline case from the plan.
 *   cost_lbp       = 7,600,000
 *   days_cost_lbp  = 1,162,000
 *   credits        = 77
 *   sell_days_lbp  = (irrelevant for cost tests; KatchForm uses catalogSellPrice)
 *
 * The catalog sell price for the "Only Days" sale is not sell_days_lbp from the
 * DB — the current KatchForm calculates it as:
 *   catalogSellPrice - returnedCredits * alfaCreditSellRate
 * We use catalogSellPrice = 9_600_000 and alfaCreditSellRate = 100_000 (per LBP)
 * so the customer price = 9,600,000 - 73 * 100,000 = 2,300,000 LBP.
 */
const SPLIT_COMPLETE_77: ServiceItem = {
  key: "iPick/mtc/Prepaid/77",
  id: 101,
  provider: "iPick",
  category: "mtc",
  subcategory: "Prepaid",
  label: "77",
  catalogCost: 7_600_000, // gross cost_lbp
  catalogSellPrice: 9_600_000,
  sortOrder: 0,
  credits: 77,
  validityDays: 30,
  days_cost_lbp: 1_162_000,
};

/** A split-INCOMPLETE item — no days_cost_lbp, no credits. Manual path only. */
const SPLIT_INCOMPLETE: ServiceItem = {
  key: "iPick/alfa/Prepaid/50",
  id: 102,
  provider: "iPick",
  category: "alfa",
  subcategory: "Prepaid",
  label: "50",
  catalogCost: 4_900_000,
  catalogSellPrice: 5_500_000,
  sortOrder: 1,
  // credits and days_cost_lbp deliberately omitted — incomplete split
};

const CONFIG_IPICK: ProviderConfig = {
  key: "iPick",
  label: "iPick",
  module: "ipec_katch",
  drawer: "iPick",
  formMode: "financial",
  color: "text-sky-400",
  bgTint: "bg-sky-400/10",
  activeBg: "bg-sky-500",
  activeText: "text-white",
  badgeCls: "bg-sky-400/10 text-sky-400",
  iconKey: "Zap",
  hasSupplier: true,
};

function renderWithItem(item: ServiceItem) {
  // KatchForm now invalidates the Suppliers-page unsettled-bill query
  // (`useQueryClient()`) on a successful bill submission — needs a real
  // QueryClientProvider in the tree, same as every Suppliers-page test.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KatchForm
        activeConfig={CONFIG_IPICK}
        activeProvider="iPick"
        getCategoriesForProvider={() => ["mtc"]}
        getServiceItems={() => [item]}
        methods={[{ code: "CASH", label: "Cash" }]}
        loadFinancialData={jest.fn()}
        formatAmount={(v) => v.toLocaleString()}
        // alfaCreditSellRate is used for the customer price in Only-Days mode.
        // 100,000 LBP per $1 recovered credit.
        alfaCreditSellRate={100_000}
        exchangeRate={89_500}
        showHistory={false}
        setShowHistory={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

async function addItemToCart(itemLabel: string) {
  await screen.findByText(itemLabel);
  fireEvent.click(screen.getByText(itemLabel));
}

async function enableOnlyDays() {
  const checkbox = await screen.findByRole("checkbox", {
    name: /Only Days/i,
  });
  fireEvent.click(checkbox);
  return checkbox;
}

async function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("stub-payment-sheet");
}

async function submitWithCash() {
  fireEvent.click(screen.getByTestId("stub-inject-cash"));
  fireEvent.click(screen.getByTestId("stub-confirm"));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
}

// ── Tests ────────────────────────────────────────────────────────────────────

/**
 * Rule 17 failure evidence (pre-fix, current code):
 *
 *   FAIL  KatchForm.grossCost.test.tsx
 *   ● gross-cost B1/B2 › (1) split-complete: cost is GROSS cost_lbp — never pre-netted
 *     expect(received).toBe(expected)
 *     Expected: 7600000
 *     Received: 1395000
 *
 *   ● gross-cost B1/B2 › (2) split-complete: mobileServiceItemId is in the payload
 *     expect(received).toBeDefined()
 *     Received: undefined
 *
 *   ● gross-cost B1/B2 › (3) split-complete: computed default — no returnedCreditsUsd sent
 *     expect(received).toBeUndefined()
 *     Received: 73
 *
 *   ● gross-cost B1/B2 › (5) walk-in two Only-Days items: telecomCreditReturns array sent
 *     expect(received).toBeDefined()
 *     Received: undefined
 */
describe("KatchForm gross-cost B1/B2 (LIRA-090)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("(1) split-complete: cost is GROSS cost_lbp — never pre-netted", async () => {
    renderWithItem(SPLIT_COMPLETE_77);
    await addItemToCart("77");
    await enableOnlyDays();
    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // GROSS cost_lbp = 7,600,000.  Pre-fix (with alfaCreditCostRate=85,000): 7,600,000 - 77 * 85,000 = 1,055,000.
    expect(payload.cost).toBe(7_600_000);
  });

  it("(2) split-complete: mobileServiceItemId is in the telecomCreditReturns array", async () => {
    /**
     * Walk-in path (spec §6.2): the aggregated SEND carries per-line credit-return
     * info via `telecomCreditReturns[]`, not the scalar `mobileServiceItemId`.
     * The scalar is reserved for the session-cart per-item path.
     */
    renderWithItem(SPLIT_COMPLETE_77);
    await addItemToCart("77");
    await enableOnlyDays();
    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const returns = payload.telecomCreditReturns as
      | Array<Record<string, unknown>>
      | undefined;
    expect(returns).toBeDefined();
    expect(returns).toHaveLength(1);
    expect(returns![0].mobileServiceItemId).toBe(101);
    expect(returns![0].itemCategory).toBe("mtc");
  });

  it("(3) split-complete: computed default — no returnedCreditsUsd in telecomCreditReturns entry", async () => {
    /**
     * When the operator leaves the computed default untouched, the frontend omits
     * `returnedCreditsUsd` from the telecomCreditReturns entry so the repo uses
     * its own computed default from `mobileServiceItemId.credits`.
     */
    renderWithItem(SPLIT_COMPLETE_77);
    await addItemToCart("77");
    await enableOnlyDays();
    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const returns = payload.telecomCreditReturns as
      | Array<Record<string, unknown>>
      | undefined;
    expect(returns).toBeDefined();
    // returnedCreditsUsd must be absent (not 73) so the repo computes it.
    expect(returns![0].returnedCreditsUsd).toBeUndefined();
  });

  it("(4) split-complete: operator override forwarded in telecomCreditReturns entry", async () => {
    renderWithItem(SPLIT_COMPLETE_77);
    await addItemToCart("77");
    await enableOnlyDays();

    // Simulate operator changing the credits field to 70
    const creditsInput = screen.getByRole("spinbutton");
    fireEvent.change(creditsInput, { target: { value: "70" } });

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const returns = payload.telecomCreditReturns as
      | Array<Record<string, unknown>>
      | undefined;
    expect(returns).toBeDefined();
    // Override must be forwarded so the repo respects it.
    expect(returns![0].returnedCreditsUsd).toBe(70);
    // Cost is still GROSS even with an override.
    expect(payload.cost).toBe(7_600_000);
  });

  it("(5) split-incomplete: manual path — returnedCreditsUsd in telecomCreditReturns entry", async () => {
    renderWithItem(SPLIT_INCOMPLETE);
    await addItemToCart("50");
    await enableOnlyDays();

    const creditsInput = screen.getByRole("spinbutton");
    fireEvent.change(creditsInput, { target: { value: "45" } });

    await openSheet();
    fireEvent.click(screen.getByTestId("stub-inject-cash"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const returns = payload.telecomCreditReturns as
      | Array<Record<string, unknown>>
      | undefined;
    // Split-incomplete item: the operator's override must be forwarded.
    expect(returns).toBeDefined();
    expect(returns![0].returnedCreditsUsd).toBe(45);
  });
});
