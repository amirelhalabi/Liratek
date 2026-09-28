/** @jest-environment jsdom */

/**
 * HoldMoneySection — LIRA-247: `handleHold`'s catch block hardcoded
 * `appEvents.emit("notification:show", "Failed to hold money.", "error")`
 * on ANY thrown error, discarding the real reason. `requestJson` (web)
 * throws a plain `{status,message,details}` object on a non-2xx response
 * (a role refusal, a business-rule rejection turned into a thrown error,
 * etc.) — NOT an `Error` instance — so the hardcoded string was all an
 * operator ever saw, no matter what the server actually said.
 *
 * The `res.success === false` branch right above the catch already showed
 * `res.error` correctly (a RESOLVED refusal) — this test exercises the
 * THROWN path, which is what the catch block itself is responsible for.
 *
 * NOT proven failing-first (LIRA-247): the fix landed in the same pass as
 * this test (HoldMoneySection.tsx's catch block was edited before this file
 * was written), and rule 17 forbids reverting/re-breaking finished code
 * afterward just to manufacture a red run. Reasoning for why it WOULD have
 * failed pre-fix: the old catch block emitted the hardcoded string
 * "Failed to hold money." unconditionally, so the assertion that the
 * message contains "Retail price below cost" (and is not the generic
 * string) would have failed.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HoldMoneySection } from "../HoldMoneySection";

const mockEmit = jest.fn();
const mockHoldMoneyList = jest.fn().mockResolvedValue({ success: true, data: [] });
const mockHoldMoneyCreate = jest.fn();

const mockApi = {
  holdMoney: {
    list: mockHoldMoneyList,
    create: mockHoldMoneyCreate,
    pickups: jest.fn().mockResolvedValue({ success: true, data: [] }),
    voidPickup: jest.fn(),
    collect: jest.fn(),
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    // Wrapped in a closure (not `emit: mockEmit` directly) — see the
    // matching comment in CheckoutModal.submitErrorSurfaced.test.tsx for why
    // a bare reference hits "Cannot access 'mockEmit' before initialization".
    appEvents: {
      emit: (...args: unknown[]) => mockEmit(...args),
      on: jest.fn(() => () => {}),
    },
    DecimalInput: ({
      value,
      onChange,
      id,
      "data-testid": testId,
    }: {
      value: number;
      onChange: (n: number) => void;
      id?: string;
      "data-testid"?: string;
    }) => (
      <input
        data-testid={testId ?? id}
        value={value === 0 ? "" : String(value)}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    ),
    MultiPaymentInput: () => <div data-testid="mock-multi-payment-input" />,
  };
});

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000 }),
}));

jest.mock("@/api/backendApi", () => ({
  getClients: jest.fn().mockResolvedValue([]),
  getDebtors: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

describe("HoldMoneySection — a thrown holdMoney.create failure is surfaced (LIRA-247)", () => {
  beforeEach(() => {
    mockEmit.mockReset();
    mockHoldMoneyCreate.mockReset();
    mockHoldMoneyList.mockClear();
  });

  it("shows the thrown error's real message instead of the generic 'Failed to hold money.'", async () => {
    mockHoldMoneyCreate.mockRejectedValue({
      status: 400,
      message: "Retail price below cost",
      details: {},
    });

    render(<HoldMoneySection />);
    await waitFor(() => expect(mockHoldMoneyList).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/Customer Name/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByTestId("hold-usd"), {
      target: { value: "50" },
    });

    fireEvent.click(screen.getByTestId("hold-money-submit"));

    await waitFor(() => expect(mockHoldMoneyCreate).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const call = mockEmit.mock.calls.find(
        (c) => c[0] === "notification:show" && c[2] === "error",
      );
      expect(call).toBeDefined();
      expect(call?.[1]).toContain("Retail price below cost");
      expect(call?.[1]).not.toBe("Failed to hold money.");
    });
  });
});
