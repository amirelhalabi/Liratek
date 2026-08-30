/** @jest-environment jsdom */
/**
 * KatchForm — Only-Days owner pricing model (TELECOM_CREDIT_RATE_PLAN.md §Q4,
 * owner-confirmed 2026-08-05):
 *
 *   total = sell_days_lbp + kept_credits * credit_price
 *
 * Both components are editable per sale and default from data:
 *   - sell_days_lbp  <- the catalog item's own column (seeded from the
 *     day-count table, migration v147)
 *   - credit_price   <- per-item sell_credit_lbp, else the tenant setting
 *     telecom_credit_sell_price_lbp, else the named default
 *
 * FALLBACK: an item with no sell_days_lbp (a day count outside the seeded
 * table, or a non-candidate) must keep TODAY'S pricing exactly
 * (`sellPrice - returnedCredits * sellRate`) — never 0.
 *
 * Rule 17 failure evidence (pre-fix, `calcPrice` without the 5th
 * `onlyDaysTotal` parameter — i.e. always the legacy formula):
 *
 *   FAIL  KatchForm.onlyDaysPricing.test.tsx
 *   ● Only-Days owner pricing model › (1) default: total = sell_days_lbp + 0 * credit_price (kept = 0)
 *     expect(received).toBe(expected)
 *     Expected: 250000
 *     Received: 300000
 *   ● Only-Days owner pricing model › (2) operator returns less than max: kept_credits > 0
 *     expect(received).toBe(expected)
 *     Expected: 730000
 *     Received: 700000
 *   ● Only-Days owner pricing model › (4) editable override: Days price
 *     expect(received).toBe(expected)
 *     Expected: 999000
 *     Received: 250000
 *   ● Only-Days owner pricing model › (5) editable override: Credit price
 *     expect(received).toBe(expected)
 *     Expected: 450000
 *     Received: 730000
 *
 * (3), the FALLBACK test, passes on both pre- and post-fix code — it exists
 * to prove the fallback formula is unaffected by the new pricing model, not
 * to guard the fix itself.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KatchForm } from "../KatchForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

// @liratek/core pulls in Node-only DB modules via its main index — mock the
// subset KatchForm actually uses. Faithful copies of the real logic (from
// packages/core/src/utils/telecomCredit.ts) so the pricing-model math under
// test is real behaviour, not a mocked stub — the authoritative definitions
// still live ONLY in core (rule 14).
// Use the REAL core module. The previous version of this mock hand-rewrote
// maxReturnableCredits and isTelecomSplitComplete in test code — a rule-14
// duplication that lets the test agree with itself while disagreeing with
// production, and which silently omitted resolveCreditSellPriceLbp once
// KatchForm started importing it. requireActual on the pure-function file
// keeps the assertions honest; the file has no Node-only imports, so it loads
// cleanly under jsdom.
jest.mock("@liratek/core", () =>
  jest.requireActual("../../../../../../packages/core/src/utils/telecomCredit"),
);

// ── Capture addOMTTransaction payloads ──────────────────────────────────────
const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 42 });

/**
 * Catalog rows returned by `api.getActiveMobileServiceItems()` — this is the
 * separate fetch KatchForm makes to source `sell_days_lbp`/`sell_credit_lbp`,
 * since the shared `ServiceItem`/context type never maps them through.
 * Mutable per-test via `mockCatalogRows.length = 0; mockCatalogRows.push(...)`.
 */
const mockCatalogRows: Array<{
  id: number;
  sell_days_lbp: number | null;
  sell_credit_lbp: number | null;
  /** v160 — omitted on most rows, which is the "no override" default. */
  max_returned_credits_usd?: number | null;
}> = [];
const mockGetActiveMobileServiceItems = jest
  .fn()
  .mockImplementation(() => Promise.resolve(mockCatalogRows));
const mockGetAllSettings = jest.fn().mockResolvedValue([]);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    addOMTTransaction: mockAddOMTTransaction,
    getAllSettings: mockGetAllSettings,
    getActiveMobileServiceItems: mockGetActiveMobileServiceItems,
    createMobileServiceItem: jest.fn().mockResolvedValue({ success: true }),
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
 * A split-complete "10" MTC-style card, credits=10 -> maxReturnableCredits
 * = 9.00 (pinned by the plan's own table: "10 | 9.00 | 10.0%"). Catalog id
 * 201 so it can be matched by `mockCatalogRows`.
 */
const ITEM_WITH_DAYS_PRICE: ServiceItem = {
  key: "iPick/mtc/Prepaid/10",
  id: 201,
  provider: "iPick",
  category: "mtc",
  subcategory: "Prepaid",
  label: "10",
  catalogCost: 1_000_000,
  catalogSellPrice: 1_200_000,
  sortOrder: 0,
  credits: 10,
  validityDays: 30,
  days_cost_lbp: 700_000,
};

/** Same face value, but this catalog id has NO sell_days_lbp — the FALLBACK
 *  case (a day count outside the seeded table, or a non-candidate). */
const ITEM_WITHOUT_DAYS_PRICE: ServiceItem = {
  ...ITEM_WITH_DAYS_PRICE,
  key: "iPick/mtc/Prepaid/10b",
  id: 202,
  label: "10",
};

/** Same shape again, but under a fresh catalog id (203) so the credit-price
 *  3-level-fallback tests (6)/(7) can control the catalog row independently
 *  of tests (1)/(2)/(4)/(5) above. */
/** A catalog row that HAS a days price but whose `credits` was left blank.
 *  Reachable in production: Settings can save sell_days_lbp on an item whose
 *  credits is null, and nothing enforces the pair. */
const ITEM_WITH_DAYS_PRICE_BUT_NULL_CREDITS: ServiceItem = (() => {
  // The key must be ABSENT, not set to undefined: the frontend tsconfig runs
  // exactOptionalPropertyTypes, so `credits: undefined` is a type error while a
  // missing key is the real "not configured" state this test is about.
  const base = {
    ...ITEM_WITH_DAYS_PRICE,
    key: "iPick/mtc/Prepaid/10d",
    id: 204,
    label: "10",
  };
  delete (base as { credits?: number }).credits;
  return base;
})();

const ITEM_FOR_CREDIT_PRICE_FALLBACK: ServiceItem = {
  ...ITEM_WITH_DAYS_PRICE,
  key: "iPick/mtc/Prepaid/10c",
  id: 203,
  label: "10",
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
        // Legacy fallback rate — must still govern items with no sell_days_lbp.
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

describe("Only-Days owner pricing model (TELECOM_CREDIT_RATE_PLAN.md §Q4)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockCatalogRows.length = 0;
    mockGetAllSettings.mockClear();
    mockGetAllSettings.mockResolvedValue([]);
  });

  it("(1) default: total = sell_days_lbp + 0 * credit_price when kept_credits = 0", async () => {
    // credits=10 -> maxReturnableCredits = 9.00, and the checkbox default
    // returns exactly that -- so kept_credits = 9 - 9 = 0.
    mockCatalogRows.push({
      id: 201,
      sell_days_lbp: 250_000,
      sell_credit_lbp: 120_000,
    });
    renderWithItem(ITEM_WITH_DAYS_PRICE);
    await addItemToCart("10");
    await enableOnlyDays();

    // The pricing panel prefilled from the catalog default.
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Only-Days price" }),
      ).toHaveValue("250,000"),
    );
    expect(
      screen.getByRole("textbox", { name: "Only-Days credit price" }),
    ).toHaveValue("120,000");

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.amount).toBe(250_000);
  });

  it("(2) operator returns less than max: kept_credits > 0 is charged at the item's own credit price", async () => {
    mockCatalogRows.push({
      id: 201,
      sell_days_lbp: 250_000,
      sell_credit_lbp: 120_000,
    });
    renderWithItem(ITEM_WITH_DAYS_PRICE);
    await addItemToCart("10");
    await enableOnlyDays();

    // Operator returns only 5 (default was 9) -> kept = 9 - 5 = 4.
    const creditsInput = screen.getByRole("spinbutton");
    fireEvent.change(creditsInput, { target: { value: "5" } });

    await waitFor(() =>
      expect(screen.getByText(/\$4\.00/)).toBeInTheDocument(),
    );

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // 250,000 + 4 * 120,000 = 730,000
    expect(payload.amount).toBe(730_000);
  });

  it("(3) FALLBACK: an item with no sell_days_lbp keeps today's pricing exactly — never 0 or a free sale", async () => {
    // No mockCatalogRows entry for id 202 at all (the item is missing from
    // the catalog fetch entirely — the same shape a non-candidate item or a
    // network hiccup would produce).
    renderWithItem(ITEM_WITHOUT_DAYS_PRICE);
    await addItemToCart("10");
    await enableOnlyDays();

    // No pricing panel — the item has no computed days price.
    expect(
      screen.queryByRole("textbox", { name: "Only-Days price" }),
    ).not.toBeInTheDocument();

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Legacy formula: catalogSellPrice(1,200,000) - returnedCredits(9) * alfaCreditSellRate(100,000)
    expect(payload.amount).toBe(300_000);
    expect(payload.amount).not.toBe(0);
  });

  it("(3b) an item with a days price but NULL credits falls back — never bills kept credit as 0", async () => {
    // Found by adversarial review 2026-08-05 and reproduced: keptCredits is
    // derived from maxReturnableCredits(credits), and maxReturnableCredits(0)
    // is 0 — so a null `credits` clamped kept to 0 and charged the bare days
    // price no matter how much credit the customer walked away with. The model
    // now requires a known face credit before it applies at all.
    mockCatalogRows.length = 0;
    mockCatalogRows.push({
      id: 204,
      sell_days_lbp: 250_000,
      sell_credit_lbp: 100_000,
    });
    renderWithItem(ITEM_WITH_DAYS_PRICE_BUT_NULL_CREDITS);
    await addItemToCart("10");
    await enableOnlyDays();

    // The panel must not appear: without a face credit there is no kept-credit
    // figure to price, so the model does not apply.
    expect(
      screen.queryByRole("textbox", { name: "Only-Days price" }),
    ).not.toBeInTheDocument();

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Legacy pricing, NOT the bare 250,000 days price.
    expect(payload.amount).not.toBe(250_000);
    expect(payload.amount).not.toBe(0);
  });

  it("(4) editable override: Days price", async () => {
    mockCatalogRows.push({
      id: 201,
      sell_days_lbp: 250_000,
      sell_credit_lbp: 120_000,
    });
    renderWithItem(ITEM_WITH_DAYS_PRICE);
    await addItemToCart("10");
    await enableOnlyDays();

    const daysPriceInput = await screen.findByRole("textbox", {
      name: "Only-Days price",
    });
    fireEvent.change(daysPriceInput, { target: { value: "999000" } });

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // kept_credits = 0 (default 9 returned), so total = override only.
    expect(payload.amount).toBe(999_000);
  });

  it("(5) editable override: Credit price", async () => {
    mockCatalogRows.push({
      id: 201,
      sell_days_lbp: 250_000,
      sell_credit_lbp: 120_000,
    });
    renderWithItem(ITEM_WITH_DAYS_PRICE);
    await addItemToCart("10");
    await enableOnlyDays();

    // Return only 5 so kept_credits = 4, making the credit-price override visible.
    const creditsInput = screen.getByRole("spinbutton");
    fireEvent.change(creditsInput, { target: { value: "5" } });

    const creditPriceInput = await screen.findByRole("textbox", {
      name: "Only-Days credit price",
    });
    fireEvent.change(creditPriceInput, { target: { value: "50000" } });

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // 250,000 + 4 * 50,000 = 450,000
    expect(payload.amount).toBe(450_000);
  });

  it("(6) credit-price fallback: no per-item sell_credit_lbp -> falls to the tenant setting", async () => {
    // sell_credit_lbp is explicitly null -> the per-item level of the
    // 3-level fallback is absent, so the tenant setting must govern.
    mockCatalogRows.push({
      id: 203,
      sell_days_lbp: 250_000,
      sell_credit_lbp: null,
    });
    mockGetAllSettings.mockResolvedValue([
      { key_name: "telecom_credit_sell_price_lbp", value: "90000" },
    ]);
    renderWithItem(ITEM_FOR_CREDIT_PRICE_FALLBACK);
    await addItemToCart("10");
    await enableOnlyDays();

    // Return only 5 (default 9) -> kept = 4, so the credit price actually
    // multiplies into the total and the fallback level is observable.
    const creditsInput = screen.getByRole("spinbutton");
    fireEvent.change(creditsInput, { target: { value: "5" } });

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Only-Days credit price" }),
      ).toHaveValue("90,000"),
    );

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // 250,000 + 4 * 90,000 (tenant setting) = 610,000
    expect(payload.amount).toBe(610_000);
  });

  it("(7) credit-price fallback: no per-item value AND no tenant setting -> falls to the named default", async () => {
    // Neither the per-item nor the tenant-setting level is available -> the
    // 3rd level, DEFAULT_TELECOM_CREDIT_SELL_PRICE_LBP (mocked as 100,000
    // above, matching the real constant in packages/core/src/utils/telecomCredit.ts),
    // must govern.
    mockCatalogRows.push({
      id: 203,
      sell_days_lbp: 250_000,
      sell_credit_lbp: null,
    });
    mockGetAllSettings.mockResolvedValue([]);
    renderWithItem(ITEM_FOR_CREDIT_PRICE_FALLBACK);
    await addItemToCart("10");
    await enableOnlyDays();

    const creditsInput = screen.getByRole("spinbutton");
    fireEvent.change(creditsInput, { target: { value: "5" } });

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Only-Days credit price" }),
      ).toHaveValue("100,000"),
    );

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // 250,000 + 4 * 100,000 (named default) = 650,000
    expect(payload.amount).toBe(650_000);
  });

  it("(8) cost side is unchanged: calcCost still sends the gross cost even when the Only-Days pricing panel is active", async () => {
    mockCatalogRows.push({
      id: 201,
      sell_days_lbp: 250_000,
      sell_credit_lbp: 120_000,
    });
    renderWithItem(ITEM_WITH_DAYS_PRICE);
    await addItemToCart("10");
    await enableOnlyDays();

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Only-Days price" }),
      ).toHaveValue("250,000"),
    );

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Gross catalogCost, untouched by the owner pricing model — the model
    // changes only what the customer pays (`amount`), never the card cost.
    expect(payload.cost).toBe(1_000_000);
  });
});

// ── v160: the per-card max-returned override ────────────────────────────────

/**
 * The owner's alfa 77.28 card. A bare card returns $73.00
 * (24 messages x $3.16 = $75.84 spent, $1.44 left, a final $1.50 needs $1.66),
 * but with $0.22 of the customer's own credit the shop gets $73.50 back —
 * which is what `max_returned_credits_usd` records.
 */
const ITEM_77_28: ServiceItem = {
  key: "iPick/alfa/Prepaid/77.28",
  id: 210,
  provider: "iPick",
  category: "alfa",
  subcategory: "Prepaid",
  label: "77.28",
  catalogCost: 7_728_000,
  catalogSellPrice: 8_000_000,
  sortOrder: 0,
  credits: 77.28,
  validityDays: 365,
  days_cost_lbp: 1_159_200,
};

/**
 * Rule 17 — failure evidence for this block. With `keptCredits` left on
 * `maxReturnableCredits(faceCredits)` (i.e. the pre-v160 line, ignoring the
 * override) and the toggle autofill left on the same:
 *
 *   ● autofills the override, not the bare-card maximum
 *       Expected: "73.5"   Received: "73"
 *   ● a short transfer is billed to the customer (owner decision 2026-08-30)
 *       Expected: 1830000  Received: 1780000
 *
 * The third test passes either way — it exists to prove a card WITHOUT an
 * override is unaffected, not to guard the change.
 */
describe("v160 — max_returned_credits_usd override", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockCatalogRows.length = 0;
    mockGetAllSettings.mockClear();
    mockGetAllSettings.mockResolvedValue([]);
  });

  /** The Credits box is the only number input on the Only-Days row. */
  const creditsInput = () => screen.getByRole("spinbutton");

  it("autofills the override, not the bare-card maximum", async () => {
    mockCatalogRows.push({
      id: 210,
      sell_days_lbp: 1_780_000,
      sell_credit_lbp: 100_000,
      max_returned_credits_usd: 73.5,
    });
    renderWithItem(ITEM_77_28);
    await addItemToCart("77.28");
    await enableOnlyDays();

    await waitFor(() => expect(creditsInput()).toHaveValue(73.5));
  });

  it("charges only the days price when the full override comes back", async () => {
    mockCatalogRows.push({
      id: 210,
      sell_days_lbp: 1_780_000,
      sell_credit_lbp: 100_000,
      max_returned_credits_usd: 73.5,
    });
    renderWithItem(ITEM_77_28);
    await addItemToCart("77.28");
    await enableOnlyDays();
    await waitFor(() => expect(creditsInput()).toHaveValue(73.5));

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // kept = 73.5 - 73.5 = 0
    expect(payload.amount).toBe(1_780_000);
  });

  it("bills a short transfer to the customer (owner decision 2026-08-30)", async () => {
    mockCatalogRows.push({
      id: 210,
      sell_days_lbp: 1_780_000,
      sell_credit_lbp: 100_000,
      max_returned_credits_usd: 73.5,
    });
    renderWithItem(ITEM_77_28);
    await addItemToCart("77.28");
    await enableOnlyDays();
    await waitFor(() => expect(creditsInput()).toHaveValue(73.5));

    // The customer's line was empty, so the last $1.50 SMS could not be sent
    // and only $73 came back. The operator corrects the box.
    fireEvent.change(creditsInput(), { target: { value: "73" } });

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // kept = 73.5 - 73 = 0.5, charged at 100,000/$ on top of the days price.
    expect(payload.amount).toBe(1_830_000);
  });

  it("leaves a card WITHOUT an override on the bare-card maximum", async () => {
    mockCatalogRows.push({
      id: 210,
      sell_days_lbp: 1_780_000,
      sell_credit_lbp: 100_000,
    });
    renderWithItem(ITEM_77_28);
    await addItemToCart("77.28");
    await enableOnlyDays();

    await waitFor(() => expect(creditsInput()).toHaveValue(73));

    await openSheet();
    await submitWithCash();

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // kept = 73 - 73 = 0 — the override must not leak into an unset card.
    expect(payload.amount).toBe(1_780_000);
  });

  it("ignores an out-of-range override, matching the core resolver", async () => {
    // A stored override goes stale when someone edits `credits`. The write path
    // refuses that save, but the sale screen must keep pricing correctly in the
    // meantime rather than autofilling 83.
    mockCatalogRows.push({
      id: 210,
      sell_days_lbp: 1_780_000,
      sell_credit_lbp: 100_000,
      max_returned_credits_usd: 83,
    });
    renderWithItem(ITEM_77_28);
    await addItemToCart("77.28");
    await enableOnlyDays();

    await waitFor(() => expect(creditsInput()).toHaveValue(73));
  });
});
