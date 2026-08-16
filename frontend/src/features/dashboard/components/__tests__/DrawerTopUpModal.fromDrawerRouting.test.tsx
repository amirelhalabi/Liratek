/** @jest-environment jsdom */

/**
 * DrawerTopUpModal — "From Drawer" mode routing (owner-approved fix,
 * LIRA-141 follow-up).
 *
 * Background (traced from `DrawerTopUpRepository.ts`): moving cash from a
 * PRIMARY CASH DRAWER (OMT_System/Whish_System) into General used to go
 * through `createTopUpFromDrawer` — a non-reversible path (its source-side
 * debit is a raw `UPDATE` with no payment leg, and `DRAWER_TOPUP` is in
 * `NON_REVERSIBLE_TRANSACTION_TYPES`). The opposite direction (General ->
 * primary drawer, the modal's separate "Transfer" mode) already used the
 * reversible `transferBetweenDrawers` path. This test proves the "From
 * Drawer" mode's submit handler now routes a PRIMARY cash drawer source
 * through `transferBetweenDrawers` too (making both directions symmetric and
 * reversible), while a source drawer that is NOT one of the two primary
 * names — `createTopUpFromDrawer`'s own deliberately-kept, different use
 * case (an arbitrary named source drawer, append-only/audit-trail-only) —
 * keeps using the old path unchanged.
 *
 * Proven against the buggy code per rule 17: before the fix, EVERY
 * "From Drawer" submission (regardless of the selected source drawer) called
 * `api.drawerTopUp.createFromDrawer`, so the first test below
 * ("...OMT_System...transferBetweenDrawers...") failed with:
 *   expect(jest.fn()).toHaveBeenCalledWith(...)
 *   Number of calls: 0
 * (`mockTransferBetweenDrawers` was never invoked; `mockCreateFromDrawer` was
 * called instead with `source_drawer: "OMT_System"`). The second test (the
 * non-primary drawer must NOT regress) already passed pre-fix — it guards
 * against a future over-broad fix (e.g. routing every source through
 * `transferBetweenDrawers`) rather than the bug itself.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DrawerTopUpModal } from "../DrawerTopUpModal";

// ─── @liratek/ui ──────────────────────────────────────────────────────────────

// Select/DecimalInput stubbed to plain native elements (same treatment as
// DrawerTopUpModal.currencyList.test.tsx) so values are directly assertable.
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select
      data-testid="source-drawer-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  DecimalInput: ({
    value,
    onChange,
    "data-testid": testId,
  }: {
    value: number;
    onChange: (n: number) => void;
    "data-testid"?: string;
  }) => (
    <input
      type="text"
      data-testid={testId}
      value={value === 0 ? "" : String(value)}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    />
  ),
}));

const mockGetSourceDrawers = jest.fn();
const mockCreateFromDrawer = jest.fn();
const mockCreate = jest.fn();
const mockTransferBetweenDrawers = jest.fn();

const mockApi = {
  drawerTopUp: {
    getSourceDrawers: mockGetSourceDrawers,
    create: mockCreate,
    createFromDrawer: mockCreateFromDrawer,
  },
  getSystemExpectedBalancesDynamic: jest.fn().mockResolvedValue({}),
  transferBetweenDrawers: mockTransferBetweenDrawers,
};

// ─── Contexts / hooks ─────────────────────────────────────────────────────────

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    getCurrenciesForDrawer: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({ baseSystem: "OMT" }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: jest.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderModal() {
  return render(
    <DrawerTopUpModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} />,
  );
}

/** Same label -> next-sibling-div -> input lookup the e2e spec uses
 *  (`drawerAmountInput` in lira-141-...spec.ts), translated to RTL. */
function amountInput(label: "USD Amount" | "LBP Amount"): HTMLInputElement {
  const labelEl = screen.getByText(label);
  const input = labelEl.nextElementSibling?.querySelector("input");
  if (!input) throw new Error(`No input found for label "${label}"`);
  return input as HTMLInputElement;
}

async function openFromDrawerMode(sourceDrawer: string) {
  mockGetSourceDrawers.mockResolvedValue({
    success: true,
    data: [{ drawer_name: sourceDrawer, balance_usd: 500, balance_lbp: 0 }],
  });
  renderModal();
  fireEvent.click(screen.getByRole("button", { name: /from drawer/i }));
  // Wait for the auto-select effect (loadSourceDrawers) to populate the
  // source-drawer select with the resolved drawer name.
  await waitFor(() => {
    const select = screen.getByTestId(
      "source-drawer-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe(sourceDrawer);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DrawerTopUpModal — From Drawer mode routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateFromDrawer.mockResolvedValue({ success: true });
    mockCreate.mockResolvedValue({ success: true });
    mockTransferBetweenDrawers.mockResolvedValue({ success: true });
  });

  it("routes a primary cash drawer source (OMT_System) through transferBetweenDrawers, not createFromDrawer", async () => {
    await openFromDrawerMode("OMT_System");

    fireEvent.change(amountInput("USD Amount"), { target: { value: "50" } });

    fireEvent.click(screen.getByTestId("drawer-topup-submit"));

    await waitFor(() => {
      expect(mockTransferBetweenDrawers).toHaveBeenCalledWith({
        fromDrawer: "OMT_System",
        toDrawer: "General",
        amount_usd: 50,
        amount_lbp: 0,
      });
    });
    expect(mockCreateFromDrawer).not.toHaveBeenCalled();
  });

  it("routes the OTHER primary cash drawer source (Whish_System) through transferBetweenDrawers too", async () => {
    await openFromDrawerMode("Whish_System");

    fireEvent.change(amountInput("LBP Amount"), { target: { value: "90000" } });

    fireEvent.click(screen.getByTestId("drawer-topup-submit"));

    await waitFor(() => {
      expect(mockTransferBetweenDrawers).toHaveBeenCalledWith({
        fromDrawer: "Whish_System",
        toDrawer: "General",
        amount_usd: 0,
        amount_lbp: 90000,
      });
    });
    expect(mockCreateFromDrawer).not.toHaveBeenCalled();
  });

  it("keeps a NON-primary named source drawer on the old createFromDrawer path (deliberate use case — must not regress)", async () => {
    await openFromDrawerMode("PettyCash");

    fireEvent.change(amountInput("USD Amount"), { target: { value: "20" } });

    fireEvent.click(screen.getByTestId("drawer-topup-submit"));

    await waitFor(() => {
      expect(mockCreateFromDrawer).toHaveBeenCalledWith({
        amount_usd: 20,
        amount_lbp: 0,
        source_drawer: "PettyCash",
      });
    });
    expect(mockTransferBetweenDrawers).not.toHaveBeenCalled();
  });
});
