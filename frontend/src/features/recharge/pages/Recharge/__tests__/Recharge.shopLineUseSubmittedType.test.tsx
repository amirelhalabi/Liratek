/** @jest-environment jsdom */

/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch: implement first, verify at the end).
 *
 * Fix round 1 (major, issue no-page-test-submitted-type) — owner note #21
 * case 2 (LIRA-088, migration v182). Every existing #21 test stops at
 * TelecomForm's own UI shape (button label, note text,
 * `TelecomForm.shopLineUseCheckbox.test.tsx`) — nothing asserts the actual
 * PAYLOAD `handleTelecomSubmit` (Recharge/index.tsx) sends once the
 * checkbox is toggled, on EITHER submit path. This file drives the REAL
 * `handleTelecomSubmit` closure directly (same pattern as
 * Recharge.telecomPaidByDerivation.test.tsx) through the `phoneNumber`/
 * `shopLineBuyback`/`telecomAmount`/`telecomPrice` props the real
 * `TelecomForm` receives, so what's asserted is exactly what a real
 * checkbox click would produce.
 *
 * Rule 17 (proven failing-first — predicted, not run this pass): dropping
 * `&& shopLineBuyback` from `deriveSubmittedRechargeType`
 * (rechargeLabels.ts) collapses cases 1 and 2 back to one — the "unticked"
 * tests below would then see `type: "CREDIT_BUYBACK"` instead of
 * `"SHOP_LINE_USE"`. Separately, removing the `isBuyback && activeSession`
 * short-circuit in `handleTelecomSubmit` makes the "blocked in a session"
 * test fail (`mockAddToSessionCart` would be called instead of the warning
 * firing with nothing called).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetClients = jest.fn().mockResolvedValue([]);
const mockProcessRecharge = jest.fn().mockResolvedValue({ success: true });
const mockGetActiveCarrierLines = jest.fn().mockResolvedValue([
  {
    id: 1,
    carrier: "mtc",
    phone_number: "70123456",
    credits: 0,
    validity_expires_at: null,
    is_active: 1,
    is_primary: 1,
  },
]);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getAllSettings: mockGetAllSettings,
    getClients: mockGetClients,
    processRecharge: mockProcessRecharge,
    getActiveCarrierLines: mockGetActiveCarrierLines,
  }),
}));

// window.api.recharge.* — Recharge/index.tsx reads stock/history/balances
// straight off window.api rather than useApi() for these (same as the
// telecomPhoneNumberTabSwitch test).
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

// Mutable, jest-hoisting-safe ("mock" prefix) session state read by the
// useSession() mock factory at CALL time — lets individual tests below flip
// activeSession truthy without a second jest.mock module.
let mockActiveSession: unknown = null;
const mockAddToSessionCart = jest.fn();

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession,
    linkTransaction: jest.fn(),
    addToCart: mockAddToSessionCart,
  }),
}));

// Stub the page's own subcomponents — drives handleTelecomSubmit directly
// through the exact props Recharge/index.tsx passes to the REAL TelecomForm
// (same pattern as Recharge.telecomPaidByDerivation.test.tsx), rather than
// re-implementing the checkbox's own logic in the test.
jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatchForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  CryptoForm: () => null,
  ProviderTabs: () => null,
  TelecomForm: ({
    phoneNumber,
    setPhoneNumber,
    telecomAmount,
    setTelecomAmount,
    telecomPrice,
    setTelecomPrice,
    shopLineBuyback,
    setShopLineBuyback,
    isShopLineMatch,
    handleTelecomSubmit,
  }: {
    phoneNumber: string;
    setPhoneNumber: (v: string) => void;
    telecomAmount: string;
    setTelecomAmount: (v: string) => void;
    telecomPrice: string;
    setTelecomPrice: (v: string) => void;
    shopLineBuyback: boolean;
    setShopLineBuyback: (v: boolean) => void;
    isShopLineMatch: boolean;
    handleTelecomSubmit: () => void;
  }) => (
    <div data-testid="stub-telecom-form">
      <div data-testid="is-shop-line-match">{String(isShopLineMatch)}</div>
      <button
        data-testid="type-shop-phone"
        onClick={() => setPhoneNumber("70123456")}
      />
      <input
        data-testid="telecom-amount-input"
        value={telecomAmount}
        onChange={(e) => setTelecomAmount(e.target.value)}
      />
      <input
        data-testid="telecom-price-input"
        value={telecomPrice}
        onChange={(e) => setTelecomPrice(e.target.value)}
      />
      <input
        type="checkbox"
        data-testid="shop-line-buyback-checkbox"
        checked={shopLineBuyback}
        onChange={(e) => setShopLineBuyback(e.target.checked)}
      />
      <button data-testid="telecom-confirm" onClick={handleTelecomSubmit} />
      {/* Unused by the checkbox tests, kept only so `phoneNumber` isn't
          flagged unused by the destructure. */}
      <span data-testid="phone-number-value">{phoneNumber}</span>
    </div>
  ),
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
  await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());
}

async function typeShopPhoneAndFillAmounts() {
  fireEvent.click(screen.getByTestId("type-shop-phone"));
  await waitFor(() =>
    expect(screen.getByTestId("is-shop-line-match").textContent).toBe("true"),
  );
  fireEvent.change(screen.getByTestId("telecom-amount-input"), {
    target: { value: "3" },
  });
  fireEvent.change(screen.getByTestId("telecom-price-input"), {
    target: { value: "300000" },
  });
}

describe("Recharge page — the checkbox's ACTUAL submitted type (owner note #21, LIRA-088)", () => {
  beforeEach(() => {
    mockActiveSession = null;
    mockProcessRecharge.mockClear();
    mockAddToSessionCart.mockClear();
  });

  it("direct submit, checkbox ON (default): processRecharge receives type CREDIT_BUYBACK", async () => {
    await renderPage();
    await typeShopPhoneAndFillAmounts();
    // Checkbox defaults ON — no toggle needed.

    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const payload = mockProcessRecharge.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.type).toBe("CREDIT_BUYBACK");
    expect(mockAddToSessionCart).not.toHaveBeenCalled();
  });

  it("direct submit, checkbox UNTICKED: processRecharge receives type SHOP_LINE_USE", async () => {
    await renderPage();
    await typeShopPhoneAndFillAmounts();
    fireEvent.click(screen.getByTestId("shop-line-buyback-checkbox"));

    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const payload = mockProcessRecharge.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.type).toBe("SHOP_LINE_USE");
    expect(payload.phoneNumber).toBe("70123456");
  });

  it("a non-shop number stays a plain CREDIT_TRANSFER regardless of the checkbox", async () => {
    await renderPage();
    fireEvent.change(screen.getByTestId("telecom-amount-input"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByTestId("telecom-price-input"), {
      target: { value: "300000" },
    });
    // phoneNumber left empty — isShopLineMatch stays false, the checkbox is
    // never even shown by the real TelecomForm in that state.

    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const payload = mockProcessRecharge.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.type).toBe("CREDIT_TRANSFER");
  });

  it("inside an active session, checkbox ON: blocked with a warning, NEITHER processRecharge NOR addToSessionCart fires", async () => {
    mockActiveSession = { id: 42 };
    const emitSpy = jest.spyOn(appEvents, "emit");
    await renderPage();
    await typeShopPhoneAndFillAmounts();

    fireEvent.click(screen.getByTestId("telecom-confirm"));

    expect(mockProcessRecharge).not.toHaveBeenCalled();
    expect(mockAddToSessionCart).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      "notification:show",
      expect.stringMatching(/cannot be added to an active customer session/i),
      "warning",
    );
    emitSpy.mockRestore();
  });

  it("inside an active session, checkbox UNTICKED (case 2): allowed — addToSessionCart receives type SHOP_LINE_USE", async () => {
    mockActiveSession = { id: 42 };
    await renderPage();
    await typeShopPhoneAndFillAmounts();
    fireEvent.click(screen.getByTestId("shop-line-buyback-checkbox"));

    fireEvent.click(screen.getByTestId("telecom-confirm"));

    await waitFor(() =>
      expect(mockAddToSessionCart).toHaveBeenCalledTimes(1),
    );
    expect(mockProcessRecharge).not.toHaveBeenCalled();
    const cartItem = mockAddToSessionCart.mock.calls[0][0] as {
      formData: Record<string, unknown>;
    };
    expect(cartItem.formData.type).toBe("SHOP_LINE_USE");
    expect(cartItem.formData.phoneNumber).toBe("70123456");
  });
});
