/** @jest-environment jsdom */

/**
 * Recharge page — switching AWAY from the Credit tab must clear the shared
 * `phoneNumber` state (review finding #2, CARRIER_LINES_VALIDITY_PLAN.md
 * Phase 6 follow-up).
 *
 * Bug: `phoneNumber` is shared across all three telecom tabs (Credit/Days/
 * Alfa Gift), but only Credit renders a phone input. Pre-fix, the tab-switch
 * wrapper passed to `TelecomForm` (Recharge/index.tsx, around the
 * `setRechargeType` prop) cleared `telecomPrice`/`telecomAmount`/
 * `telecomDaysCostUsd` on every tab switch but never `phoneNumber`. Scenario:
 * an operator types the shop's own MTC number on Credit (flagging a
 * buy-back via `isShopLineMatch`), then switches to Days to sell validity to
 * an unrelated walk-in — without submitting. `phoneNumber` persists,
 * `isShopLineMatch` stays true, and Days renders ONLY the block-and-redirect
 * notice with zero form controls: a dead end recoverable only by manually
 * going back to Credit to clear the field.
 *
 * Fix: the wrapper now also clears `phoneNumber` whenever the NEW tab is not
 * `CREDIT_TRANSFER`. Same-tab edits (staying on Credit) are untouched — this
 * test also proves that leg of the behavior stays intact, per the review's
 * explicit constraint not to disturb the anti-bypass-while-on-Credit case.
 *
 * The page's real `TelecomForm` is stubbed (same pattern as
 * Recharge.telecomTenderRate.test.tsx/Recharge.cryptoLegsGate.test.tsx) so
 * this test drives the ACTUAL `setRechargeType` wrapper closure defined in
 * Recharge/index.tsx, rather than re-implementing its logic in the test.
 *
 * Rule 17: proven failing-first — reverting the wrapper to omit the
 * `if (type !== "CREDIT_TRANSFER") setPhoneNumber("")` line makes the
 * "switching to Days clears the stale shop-line number" assertion below fail
 * (phoneNumber remains "70123456", isShopLineMatch remains "true" — the dead
 * end reproduces exactly as reported).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetClients = jest.fn().mockResolvedValue([]);
const mockGetPrimaryCarrierLine = jest.fn().mockResolvedValue({
  success: true,
  data: {
    id: 1,
    carrier: "mtc",
    phone_number: "70123456",
    credits: 0,
    validity_expires_at: null,
    is_active: 1,
    is_primary: 1,
  },
});
const mockProcessRecharge = jest.fn().mockResolvedValue({ success: true });

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getAllSettings: mockGetAllSettings,
    getOMTHistory: mockGetOMTHistory,
    getOMTAnalytics: mockGetOMTAnalytics,
    getClients: mockGetClients,
    processRecharge: mockProcessRecharge,
    addOMTTransaction: jest.fn().mockResolvedValue({ success: true }),
    getPrimaryCarrierLine: mockGetPrimaryCarrierLine,
  }),
}));

// window.api.recharge.* — Recharge/index.tsx reads stock/history/balances
// straight off window.api rather than useApi() for these.
(globalThis as unknown as { window: { api: unknown } }).window = {
  ...(globalThis as unknown as { window: Record<string, unknown> }).window,
  api: {
    recharge: {
      getStock: jest.fn().mockResolvedValue({ mtc: 0, alfa: 0 }),
      getHistory: jest.fn().mockResolvedValue([]),
      getDrawerBalances: jest.fn().mockResolvedValue({}),
    },
  },
};

// Stub the page's own subcomponents — this test drives the REAL
// `setRechargeType` wrapper closure (the fix under test) and the REAL
// `phoneNumber`/`isShopLineMatch` state Recharge/index.tsx computes, without
// needing TelecomForm's own deep tree (PaymentSheet, CarrierLinesPanel, …) —
// that plumbing is out of scope for this specific state-clearing bug.
jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatchForm: () => null,
  OmtWhishAppTransferForm: () => null,
  CryptoForm: () => null,
  ProviderTabs: () => null,
  TelecomForm: ({
    phoneNumber,
    setPhoneNumber,
    rechargeType,
    setRechargeType,
    isShopLineMatch,
  }: {
    phoneNumber: string;
    setPhoneNumber: (v: string) => void;
    rechargeType: string;
    setRechargeType: (t: string) => void;
    isShopLineMatch: boolean;
  }) => (
    <div data-testid="stub-telecom-form">
      <div data-testid="phone-number-value">{phoneNumber}</div>
      <div data-testid="is-shop-line-match">{String(isShopLineMatch)}</div>
      <div data-testid="recharge-type-value">{rechargeType}</div>
      <button
        data-testid="type-shop-phone"
        onClick={() => setPhoneNumber("70123456")}
      />
      <button
        data-testid="type-other-phone"
        onClick={() => setPhoneNumber("03999999")}
      />
      <button
        data-testid="switch-to-days"
        onClick={() => setRechargeType("DAYS")}
      />
      <button
        data-testid="switch-to-alfa-gift"
        onClick={() => setRechargeType("ALFA_GIFT")}
      />
      <button
        data-testid="switch-to-credit"
        onClick={() => setRechargeType("CREDIT_TRANSFER")}
      />
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
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 91000, buyRate: 90000 }),
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
  // Default activeProvider is MTC (PROVIDER_CONFIGS[0]) — wait for the
  // primary-line fetch this drives so `isShopLineMatch` is ready to flip.
  await waitFor(() => expect(mockGetPrimaryCarrierLine).toHaveBeenCalled());
}

describe("Recharge page — tab switch clears the stale Credit-tab phoneNumber (review finding #2)", () => {
  it("switching to Days clears a shop-line phoneNumber left over from Credit — no more dead end", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("type-shop-phone"));
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "true",
      ),
    );

    fireEvent.click(screen.getByTestId("switch-to-days"));

    expect(screen.getByTestId("recharge-type-value").textContent).toBe(
      "DAYS",
    );
    // The fix: phoneNumber is cleared, so Days no longer inherits the stale
    // shop-line flag and would render its normal form, not the redirect.
    expect(screen.getByTestId("phone-number-value").textContent).toBe("");
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "false",
      ),
    );
  });

  it("switching to Alfa Gift also clears it (same fix, same tab-switch wrapper)", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("type-shop-phone"));
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "true",
      ),
    );

    fireEvent.click(screen.getByTestId("switch-to-alfa-gift"));

    expect(screen.getByTestId("phone-number-value").textContent).toBe("");
  });

  it("does NOT clear on a same-tab re-affirmation of Credit — the anti-bypass-while-on-Credit case is untouched", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("type-shop-phone"));
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "true",
      ),
    );

    // Switching to the SAME tab it's already on (CREDIT_TRANSFER is the
    // page's initial rechargeType) must not wipe an in-progress edit.
    fireEvent.click(screen.getByTestId("switch-to-credit"));

    expect(screen.getByTestId("phone-number-value").textContent).toBe(
      "70123456",
    );
    expect(screen.getByTestId("is-shop-line-match").textContent).toBe("true");
  });

  it("round-trip: Credit (shop number) -> Days (cleared) -> Credit (still empty) -> type a new number -> Days (cleared again)", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("type-shop-phone"));
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "true",
      ),
    );

    fireEvent.click(screen.getByTestId("switch-to-days"));
    expect(screen.getByTestId("phone-number-value").textContent).toBe("");

    fireEvent.click(screen.getByTestId("switch-to-credit"));
    expect(screen.getByTestId("phone-number-value").textContent).toBe("");

    fireEvent.click(screen.getByTestId("type-shop-phone"));
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "true",
      ),
    );

    fireEvent.click(screen.getByTestId("switch-to-days"));
    expect(screen.getByTestId("phone-number-value").textContent).toBe("");
    await waitFor(() =>
      expect(screen.getByTestId("is-shop-line-match").textContent).toBe(
        "false",
      ),
    );
  });
});
