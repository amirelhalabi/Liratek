/** @jest-environment jsdom */

/**
 * Recharge page — Telecom (MTC/Alfa) submit must send `paid_by_method`
 * DERIVED FROM THE PAY SHEET'S CURRENT LEGS (CARRIER_LINES_VALIDITY_PLAN.md
 * Phase 7), not a `lines.length === 1`-gated `paidBy` state that only
 * self-heals for a SINGLE leg and never advances to `"MULTI"` on a split.
 *
 * Pre-fix, `handleTelecomSubmit` sent `paid_by_method: paidBy` directly —
 * `paidBy` is only ever written by `setPaidBy` inside a `lines.length === 1`
 * guard (TelecomForm's `onPaymentChange`/`handleCardPaymentChange`), so a
 * split (2+ legs) submission still sent whatever `paidBy` last held (its
 * "CASH" default, since the in-form dropdown that used to write it directly
 * is gone) — never `"MULTI"`. `RechargeRepository`'s legacy fallback treats
 * an unrecognized `paid_by_method` as a real method routed to General
 * (packages/core/src/repositories/__tests__/RechargeRepository.paidByMultiGate.test.ts
 * proves the backend side of this danger); this file proves the FRONTEND
 * now sends the truthful value in the first place.
 *
 * The page's own subcomponents are stubbed (mirrors
 * Recharge.cryptoLegsGate.test.tsx) so the test drives `handleTelecomSubmit`
 * — the real closure under test — directly, via the SAME `setPaymentLines`
 * prop TelecomForm receives from the real page (not a paraphrased callback).
 *
 * Rule 17 (proven failing-first): reverting `paid_by_method:
 * derivePaidByMethod(paymentLines, paidBy)` back to `paid_by_method: paidBy`
 * makes the "split" test below fail — `payload.paid_by_method` reads
 * `"CASH"` instead of `"MULTI"`. Confirmed by running this file against a
 * temporarily-reverted Recharge/index.tsx before restoring the fix.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetPrimaryCarrierLine = jest
  .fn()
  .mockResolvedValue({ success: true, data: null });
const mockProcessRecharge = jest.fn().mockResolvedValue({ success: true });
const mockGetClients = jest.fn().mockResolvedValue([]);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getAllSettings: mockGetAllSettings,
    getPrimaryCarrierLine: mockGetPrimaryCarrierLine,
    getClients: mockGetClients,
    processRecharge: mockProcessRecharge,
  }),
}));

// Stub the page's own subcomponents — drives handleTelecomSubmit directly
// through the exact `setPaymentLines`/`telecomAmount` props Recharge/index.tsx
// passes to the REAL TelecomForm, rather than re-deriving a paraphrased shape.
jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatchForm: () => null,
  OmtWhishAppTransferForm: () => null,
  CryptoForm: () => null,
  ProviderTabs: () => null,
  TelecomForm: ({
    telecomAmount,
    setTelecomAmount,
    setPaymentLines,
    handleTelecomSubmit,
  }: {
    telecomAmount: string;
    setTelecomAmount: (v: string) => void;
    setPaymentLines: (lines: PaymentLine[]) => void;
    handleTelecomSubmit: () => void;
  }) => (
    <div data-testid="stub-telecom-form">
      <input
        data-testid="telecom-amount-input"
        value={telecomAmount}
        onChange={(e) => setTelecomAmount(e.target.value)}
      />
      <button
        data-testid="telecom-inject-single-account"
        onClick={() =>
          setPaymentLines([
            {
              id: "L1",
              method: "CUSTOMER_ACCOUNT",
              currencyCode: "LBP",
              amount: 100000,
            } as PaymentLine,
          ])
        }
      />
      <button
        data-testid="telecom-inject-split"
        onClick={() =>
          setPaymentLines([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "LBP",
              amount: 50000,
            } as PaymentLine,
            {
              id: "L2",
              method: "CUSTOMER_ACCOUNT",
              currencyCode: "LBP",
              amount: 50000,
            } as PaymentLine,
          ])
        }
      />
      <button data-testid="telecom-confirm" onClick={handleTelecomSubmit} />
    </div>
  ),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
    ],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
  }),
}));

jest.mock("../../../hooks/useMobileServiceItems", () => ({
  useMobileServiceItems: () => ({
    getCategoriesForProvider: () => [],
    getItems: () => [],
    refresh: jest.fn(),
  }),
  formatCatalogItemName: (item: { label: string }) => item.label,
}));

jest.mock("../../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: null }),
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

async function renderPage() {
  render(<MobileRecharge />);
  await waitFor(() => expect(mockGetAllSettings).toHaveBeenCalled());
  await screen.findByTestId("stub-telecom-form");
}

describe("Recharge page — Telecom paid_by_method derives from the sheet's legs (Phase 7)", () => {
  beforeEach(() => {
    mockProcessRecharge.mockClear();
  });

  it("SINGLE leg (CUSTOMER_ACCOUNT): paid_by_method reads the leg's own method", async () => {
    await renderPage();

    fireEvent.change(screen.getByTestId("telecom-amount-input"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByTestId("telecom-inject-single-account"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));

    const payload = mockProcessRecharge.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.paid_by_method).toBe("CUSTOMER_ACCOUNT");
  });

  // THE BUG: pre-fix, this read "CASH" (whatever `paidBy`'s default held) —
  // the split never advanced `paidBy` past a single-leg self-heal.
  it("SPLIT (2 legs): paid_by_method reads MULTI, not a stale single-method value", async () => {
    await renderPage();

    fireEvent.change(screen.getByTestId("telecom-amount-input"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByTestId("telecom-inject-split"));
    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));

    const payload = mockProcessRecharge.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.paid_by_method).toBe("MULTI");
    // The legs themselves must still both be forwarded (rule 16 — this fix
    // touches ONLY paid_by_method, never the legs array itself).
    expect(payload.payments).toEqual([
      expect.objectContaining({ method: "CASH", amount: 50000 }),
      expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 50000 }),
    ]);
  });
});
