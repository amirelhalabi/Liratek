/** @jest-environment jsdom */
/**
 * StepDrawerAmounts — Carrier Lines section (LIRA carrier-lines-validity
 * Phase 2, §0.1). The invariant under test: a carrier's Credits field is the
 * ONLY place its starting balance is typed — the value must reach BOTH the
 * carrier_lines payload entry AND that carrier's drawer_amounts entry,
 * and the two can never disagree because they read the same state.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StepDrawerAmounts from "../StepDrawerAmounts";

const mockUpdatePayload = jest.fn();
const mockSetStep = jest.fn();
// Mutable so the module-gating test can switch it without re-mocking the
// module (jest.mock factories are hoisted and evaluated once).
let mockEnabledModules: string[] = ["pos", "inventory", "recharge"];

jest.mock("../../context/SetupContext", () => ({
  useSetup: () => ({
    payload: { enabled_modules: mockEnabledModules },
    updatePayload: mockUpdatePayload,
    setStep: mockSetStep,
  }),
}));

describe("StepDrawerAmounts — Carrier Lines section", () => {
  beforeEach(() => {
    mockUpdatePayload.mockReset();
    mockSetStep.mockReset();
    mockEnabledModules = ["pos", "inventory", "recharge"];
    // Mirrors currency_drawers (create_db.sql): MTC/Alfa are USD-only. This
    // is what buildDrawerAmounts() iterates to decide which currencies a
    // drawer even has — matching production so the credits→drawer-amount
    // assertions below reflect real behaviour, not a test-only shortcut.
    window.api = {
      ...window.api,
      currencies: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(null),
        allDrawerCurrencies: () =>
          Promise.resolve({
            General: ["USD", "LBP"],
            MTC: ["USD"],
            Alfa: ["USD"],
          }),
        setDrawerCurrencies: () => Promise.resolve({ success: true }),
      },
    } as typeof window.api;
  });

  it("renders exactly one Credits field per carrier and feeds it into both the line and that carrier's drawer amount", async () => {
    render(<StepDrawerAmounts />);

    // Wait for the async currency_drawers config (mocked above) to land —
    // buildDrawerAmounts() only emits a currency it knows the drawer has.
    await waitFor(() =>
      expect(screen.getByTestId("setup-amount-General-USD")).toBeTruthy(),
    );

    // Only one credits input exists for MTC — in the Carrier Lines section.
    expect(
      screen.queryByTestId("setup-amount-MTC-USD"),
    ).not.toBeInTheDocument();
    const mtcCredits = screen.getByTestId("setup-carrier-credits-MTC");

    fireEvent.change(mtcCredits, { target: { value: "25" } });
    fireEvent.change(screen.getByTestId("setup-carrier-phone-MTC"), {
      target: { value: "03123456" },
    });

    fireEvent.click(screen.getByText("Next →"));

    expect(mockUpdatePayload).toHaveBeenCalledTimes(1);
    const payload = mockUpdatePayload.mock.calls[0][0];

    expect(payload.carrier_lines).toEqual([
      {
        carrier: "mtc",
        phone_number: "03123456",
        label: null,
        credits: 25,
        validity_expires_at: null,
      },
    ]);
    expect(payload.drawer_amounts).toEqual(
      expect.arrayContaining([
        { drawer_name: "MTC", currency_code: "USD", amount: 25 },
      ]),
    );
  });

  it("does not create a line for a carrier with no phone number, even if credits were typed (D4 — soft nudge, never blocks)", async () => {
    render(<StepDrawerAmounts />);
    await waitFor(() =>
      expect(screen.getByTestId("setup-amount-General-USD")).toBeTruthy(),
    );

    fireEvent.change(screen.getByTestId("setup-carrier-credits-MTC"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByText("Next →"));

    const payload = mockUpdatePayload.mock.calls[0][0];
    expect(payload.carrier_lines).toEqual([]);
    // The typed amount still reaches the drawer even without a line, exactly
    // like every other drawer on this step.
    expect(payload.drawer_amounts).toEqual(
      expect.arrayContaining([
        { drawer_name: "MTC", currency_code: "USD", amount: 10 },
      ]),
    );
  });

  it("Skip clears carrier_lines alongside drawer_amounts", () => {
    render(<StepDrawerAmounts />);

    fireEvent.change(screen.getByTestId("setup-carrier-credits-MTC"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByText("Skip"));

    expect(mockUpdatePayload).toHaveBeenCalledWith({
      drawer_amounts: [],
      drawer_currency_config: [],
      carrier_lines: [],
    });
  });

  it("omits the Carrier Lines section entirely when the recharge module is disabled", () => {
    mockEnabledModules = ["pos", "inventory"];
    render(<StepDrawerAmounts />);

    expect(screen.queryByText(/Carrier Lines/)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("setup-carrier-credits-MTC"),
    ).not.toBeInTheDocument();
  });
});
