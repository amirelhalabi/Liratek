/** @jest-environment jsdom */

/**
 * CheckoutModal — LIRA-247: a failed `onComplete`/`onSaveDraft` used to show
 * nothing. `handleComplete`/`handleSaveDraft`'s catch blocks only called
 * `logger.error(...)` and reset `isLoading` — no `appEvents.emit(
 * "notification:show", ...)` at all, so an operator whose `onComplete`
 * rejected (a thrown ApiError — web's `requestJson` throws a plain
 * `{status,message,details}` object on a non-2xx response, e.g. a role
 * refusal, or a resolved `{success:false}` a caller re-threw) saw the modal
 * just sit there with no feedback.
 *
 * `totalAmount={0}` sidesteps the payment-completeness/debt guards in
 * `handleComplete` entirely (remaining = 0 <= tolerance), so clicking
 * "Complete Sale" reaches `onComplete(getPaymentData())` unconditionally —
 * the only thing under test is what CheckoutModal's OWN catch block does
 * with a rejection from that call.
 *
 * NOT proven failing-first (LIRA-247): the fix landed in the same pass as
 * this test (CheckoutModal.tsx's catch blocks were edited before this file
 * was written), and rule 17 forbids reverting/re-breaking finished code
 * afterward just to manufacture a red run. Reasoning for why it WOULD have
 * failed pre-fix: the old catch blocks called only `logger.error(...)` +
 * `setIsLoading(false)` — no `appEvents.emit` call existed at all, so
 * `mockEmit` would never have been invoked and the `waitFor` below would
 * have timed out.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CheckoutModal from "../CheckoutModal";

const mockEmit = jest.fn();

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getClients: jest.fn().mockResolvedValue([]),
      getAllSettings: jest.fn().mockResolvedValue([]),
    }),
    // Wrapped in a closure (not `emit: mockEmit` directly) — the factory
    // object is constructed eagerly, at `require("@liratek/ui")` time,
    // which happens while this file's own `import` statements are still
    // resolving (before its trailing `const mockEmit = jest.fn();` line has
    // run). A bare reference hits "Cannot access 'mockEmit' before
    // initialization"; a wrapper function only reads `mockEmit` later, at
    // actual call time, once test setup has completed.
    appEvents: {
      emit: (...args: unknown[]) => mockEmit(...args),
      on: jest.fn(() => () => {}),
    },
    MultiPaymentInput: () => <div data-testid="mock-multi-payment-input" />,
  };
});

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({
    sellRate: 90500,
    buyRate: 90000,
    isLoading: false,
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [{ id: 1, code: "CASH", label: "Cash", is_active: 1 }],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Shop", phone: "", location: "", logo: "" }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

describe("CheckoutModal — a rejected onComplete/onSaveDraft is surfaced (LIRA-247)", () => {
  beforeEach(() => {
    mockEmit.mockReset();
  });

  it("handleComplete shows the thrown error's real message via a notification instead of nothing", async () => {
    const onComplete = jest.fn().mockRejectedValue({
      status: 403,
      message: "Retail price below cost",
      details: {},
    });

    render(
      <CheckoutModal
        totalAmount={0}
        onComplete={onComplete}
        onSaveDraft={jest.fn()}
      />,
    );

    await screen.findByTestId("mock-multi-payment-input");
    fireEvent.click(screen.getByTestId("checkout-complete-btn"));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());

    const call = mockEmit.mock.calls.find((c) => c[0] === "notification:show");
    expect(call).toBeDefined();
    expect(call?.[1]).toContain("Retail price below cost");
    expect(call?.[2]).toBe("error");
  });

  it("handleSaveDraft shows the thrown error's real message via a notification instead of nothing", async () => {
    const onSaveDraft = jest.fn().mockRejectedValue({
      status: 400,
      message: "Draft limit reached",
      details: {},
    });

    render(
      <CheckoutModal
        totalAmount={0}
        onComplete={jest.fn()}
        onSaveDraft={onSaveDraft}
      />,
    );

    await screen.findByTestId("mock-multi-payment-input");
    fireEvent.click(screen.getByTestId("checkout-save-draft-btn"));

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());

    const call = mockEmit.mock.calls.find((c) => c[0] === "notification:show");
    expect(call).toBeDefined();
    expect(call?.[1]).toContain("Draft limit reached");
    expect(call?.[2]).toBe("error");
  });
});
