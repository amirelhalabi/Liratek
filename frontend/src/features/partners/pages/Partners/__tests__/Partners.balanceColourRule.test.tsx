/** @jest-environment jsdom */

/**
 * Balance Pages colour audit (`docs/plans/todo_plans/BALANCE_PAGES_UX_AUDIT.md`),
 * owner's rule verbatim (2026-08-10): "Positive account should be green,
 * means shop owes the second party."
 *
 * Partners' own field comment (`usd`/`lbp` = `SUM(DEBIT) - SUM(CREDIT)`,
 * `PartnerRepository.getBalance`): DEBIT = partner owes shop (positive),
 * CREDIT = shop owes partner (negative). Pre-audit, `balanceColor`/
 * `balanceBorderColor`/`BalanceIcon` (`Partners/index.tsx`) did
 * `usd > 0 || lbp > 0 -> green` — the OPPOSITE polarity AND an OR-across-
 * currency bug: a partner owed +$5 USD but owing 100,000 LBP rendered an
 * all-green card off the USD alone (latent bugs 0b/#3).
 *
 * INTERACTION-layer tests (rule 15/17) — render the REAL Partners page
 * against the REAL, unmodified `PartnerCard`/`LedgerRow` JSX, not a
 * props-level shape.
 *
 * Rule 17 (failing-first): confirmed by temporarily reverting `balanceColor`/
 * `balanceBorderColor`/`BalanceIcon` to the pre-audit
 * `usd > 0 || lbp > 0 ? emerald : ...` shape — the "shop owes" case then
 * fails with:
 *   expect(received).toMatch(expected)
 *   Expected pattern: /text-emerald-400/
 *   Received string:  "text-xs font-mono font-medium text-red-400"
 * and the mixed-currency case fails because the LBP text (which SHOULD be
 * green, shop owes) instead shares the USD text's colour (a single OR'd
 * green for both) — the two assertions on the LBP span diverge. Reverted
 * back to the fix after capturing this.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import Partners from "../index";

const mockGetAllBalances = jest.fn();
const mockGetLedger = jest.fn();

jest.mock("@liratek/ui", () => {
  // Keep the REAL balance colour helpers (`balanceBucket`/`balanceTextColor`/
  // `combinedBalanceBucket`/etc.) and REAL shared components — only `useApi`
  // needs a stub (no ApiProvider is mounted in this test).
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      partners: {
        getAllBalances: mockGetAllBalances,
        getLedger: mockGetLedger,
        recordTransaction: jest.fn(),
        settle: jest.fn(),
        writeOff: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deactivate: jest.fn(),
        activate: jest.fn(),
        getBalance: jest.fn(),
      },
    }),
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

function partner(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: "Acme Partner",
    phone: null,
    notes: null,
    is_active: 1,
    system_association: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    usd: 0,
    lbp: 0,
    usdt: 0,
    ...overrides,
  };
}

// `screen.findByText("$X")`-style global queries collide with the page-level
// "Partners owe us"/"We owe partners" summary cards, which can render the
// IDENTICAL amount string as the card under test (e.g. a partner owing
// exactly $20 makes the "Partners owe us" tile also read "$20.00"). Wait for
// the partner's NAME (unambiguous, renders once `getAllBalances` resolves —
// `partners` state starts empty, so the card doesn't exist before that),
// then scope every further query to `within` that one card.
async function findPartnerCard(name: string): Promise<HTMLElement> {
  const nameEl = await screen.findByText(name);
  return nameEl.closest("button") as HTMLElement;
}

describe("Partners page — PartnerCard balance colour (Balance Pages colour audit)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shop owes the partner (negative usd, CREDIT-heavy) renders GREEN", async () => {
    mockGetAllBalances.mockResolvedValue([partner({ usd: -20, lbp: 0 })]);

    render(<Partners />);
    const card = await findPartnerCard("Acme Partner");

    const amountText = within(card).getByText("-$20.00");
    expect(amountText.className).toMatch(/text-emerald-400/);
    expect(amountText.className).not.toMatch(/text-red-400/);

    expect(card.className).toMatch(/border-emerald-500\/30/);
    expect(card.className).not.toMatch(/border-red-500\/30/);
  });

  it("the partner owes the shop (positive usd, DEBIT-heavy) renders RED", async () => {
    mockGetAllBalances.mockResolvedValue([partner({ usd: 20, lbp: 0 })]);

    render(<Partners />);
    const card = await findPartnerCard("Acme Partner");

    const amountText = within(card).getByText("$20.00");
    expect(amountText.className).toMatch(/text-red-400/);
    expect(amountText.className).not.toMatch(/text-emerald-400/);

    expect(card.className).toMatch(/border-red-500\/30/);
    expect(card.className).not.toMatch(/border-emerald-500\/30/);
  });

  it("an exactly-settled partner (usd === 0 && lbp === 0) renders NEUTRAL, not red or green", async () => {
    mockGetAllBalances.mockResolvedValue([partner({ usd: 0, lbp: 0 })]);

    render(<Partners />);
    const card = await findPartnerCard("Acme Partner");

    // Latent-bug-adjacent: Partners had no epsilon at all pre-audit
    // (strict `>0`/`<0`/else), so exact 0 already fell into the `else`
    // neutral branch by luck — this pins that it stays neutral post-fix too.
    expect(card.className).not.toMatch(/border-red-500\/30/);
    expect(card.className).not.toMatch(/border-emerald-500\/30/);
    expect(card.className).toMatch(/border-slate-700\/50/);
  });

  it("a mixed-currency row (+$5 USD / -100,000 LBP) no longer reads green off the USD alone", async () => {
    mockGetAllBalances.mockResolvedValue([partner({ usd: 5, lbp: -100000 })]);

    render(<Partners />);
    const card = await findPartnerCard("Acme Partner");

    // USD side: DEBIT-heavy (+5) -> partner owes shop -> RED.
    const usdText = within(card).getByText("$5.00");
    expect(usdText.className).toMatch(/text-red-400/);
    expect(usdText.className).not.toMatch(/text-emerald-400/);

    // LBP side: CREDIT-heavy (-100,000) -> shop owes partner -> GREEN.
    // Pre-fix this was ALSO green off `usd > 0 || lbp > 0` agreeing by
    // coincidence, but for the WRONG polarity reason; post-fix it's green
    // because ITS OWN sign says shop-owes, independent of the USD side.
    const lbpText = within(card).getByText("-LBP 100,000");
    expect(lbpText.className).toMatch(/text-emerald-400/);
    expect(lbpText.className).not.toMatch(/text-red-400/);

    // The single shared card border/icon can't correctly be green OR red
    // for a genuinely mixed row — it must be neutral, never a same-
    // currency-only guess (the OR-bug this test exists to prove fixed:
    // pre-fix, `usd > 0 || lbp > 0` made the WHOLE card, including this
    // border, green off the USD alone).
    expect(card.className).not.toMatch(/border-emerald-500\/30/);
    expect(card.className).not.toMatch(/border-red-500\/30/);
    expect(card.className).toMatch(/border-slate-700\/50/);
  });
});

describe("Partners page — LedgerRow colour handles USDT (Balance Pages colour audit)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllBalances.mockResolvedValue([
      partner({ usd: 0, lbp: 0, usdt: 0 }),
    ]);
  });

  it("a USDT DEBIT row (partner owes shop) renders RED, a USDT CREDIT row (shop owes partner) renders GREEN", async () => {
    mockGetLedger.mockResolvedValue({
      entries: [
        {
          id: 901,
          partner_id: 1,
          transaction_type: "ADJUSTMENT",
          reference_table: null,
          reference_id: null,
          amount: 50,
          currency: "USDT",
          direction: "DEBIT",
          notes: "USDT debit leg",
          user_id: 1,
          settlement_method: null,
          created_at: "2026-08-11 10:00:00",
          fs_provider: null,
          fs_service_type: null,
        },
        {
          id: 902,
          partner_id: 1,
          transaction_type: "ADJUSTMENT",
          reference_table: null,
          reference_id: null,
          amount: 30,
          currency: "USDT",
          direction: "CREDIT",
          notes: "USDT credit leg",
          user_id: 1,
          settlement_method: null,
          created_at: "2026-08-11 11:00:00",
          fs_provider: null,
          fs_service_type: null,
        },
      ],
      balance: { usd: 0, lbp: 0, usdt: 20 },
      breakdown: null,
    });

    render(<Partners />);

    fireEvent.click(await screen.findByText("Acme Partner"));

    const debitBadge = await screen.findByText("DEBIT");
    const debitRow = debitBadge.closest("tr") as HTMLElement;
    // `entry.amount` is UNSIGNED — the row's `direction` (not currency)
    // decides the sign, so this must colour correctly for USDT exactly like
    // it would for USD/LBP: DEBIT = partner owes shop = RED.
    expect(debitBadge.className).toMatch(/text-red-400/);
    expect(debitBadge.className).not.toMatch(/text-emerald-400/);
    expect(debitRow.className).toMatch(/hover:bg-red-900\/10/);

    const creditBadge = await screen.findByText("CREDIT");
    const creditRow = creditBadge.closest("tr") as HTMLElement;
    expect(creditBadge.className).toMatch(/text-emerald-400/);
    expect(creditBadge.className).not.toMatch(/text-red-400/);
    expect(creditRow.className).toMatch(/hover:bg-emerald-900\/10/);

    await waitFor(() => expect(mockGetLedger).toHaveBeenCalled());
  });
});
