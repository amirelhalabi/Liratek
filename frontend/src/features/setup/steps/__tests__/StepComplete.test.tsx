/** @jest-environment jsdom */
/**
 * StepComplete — LIRA-252 item A.
 *
 * Two invariants under test:
 *  1. Rule 19 — the finish step routes through `useApi()` (`completeSetup`,
 *     `createCheckpoint`), never a raw `window.api.setup.complete` /
 *     `window.api.closing.createCheckpoint` call.
 *  2. The initial setup checkpoint never carries a bare MTC/Alfa amount: that
 *     money already moved when `completeSetup` created the carrier line
 *     (`CarrierLineRepository.createLine` posts the drawer adjustment itself,
 *     item B) — a second, bare row here would double the money AND the
 *     server now refuses a bare non-zero MTC/Alfa amount with no
 *     `carrier_lines` behind it (item C).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StepComplete from "../StepComplete";

const mockResetWizard = jest.fn();
const mockSetStep = jest.fn();
const mockLogin = jest.fn();
const mockClearSetupRequired = jest.fn();
const mockClearFreshSignIn = jest.fn();
const mockCompleteSetup = jest.fn();
const mockCreateCheckpoint = jest.fn();
const mockSetDrawerCurrencies = jest.fn();

let mockPayload: Record<string, unknown> = {};

jest.mock("../../context/SetupContext", () => ({
  useSetup: () => ({
    payload: mockPayload,
    resetWizard: mockResetWizard,
    setStep: mockSetStep,
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({
    login: mockLogin,
    clearSetupRequired: mockClearSetupRequired,
    clearFreshSignIn: mockClearFreshSignIn,
  }),
}));

// STABLE object reference (rule 25).
const mockApi = {
  completeSetup: mockCompleteSetup,
  createCheckpoint: mockCreateCheckpoint,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

describe("StepComplete", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPayload = {
      shop_name: "E2E Shop",
      admin_username: "admin",
      admin_password: "pw",
      enabled_modules: ["pos", "recharge"],
      drawer_amounts: [
        { drawer_name: "General", currency_code: "USD", amount: 500 },
        { drawer_name: "General", currency_code: "LBP", amount: 9_000_000 },
      ],
      carrier_lines: [
        { carrier: "mtc", phone_number: "03123456", credits: 25 },
      ],
      extra_users: [],
    };
    mockCompleteSetup.mockResolvedValue({ success: true, adminUserId: 2 });
    mockLogin.mockResolvedValue({ success: true });
    mockCreateCheckpoint.mockResolvedValue({ success: true, id: 1 });
    // No Electron bridge in this jsdom test — exercises the isElectron()
    // guard around the desktop-only setDrawerCurrencies call.
    delete (window as unknown as { api?: unknown }).api;
  });

  it("routes setup completion and the initial checkpoint through useApi(), never window.api directly", async () => {
    render(<StepComplete />);
    fireEvent.click(screen.getByRole("button", { name: /Launch App/ }));

    await waitFor(() => expect(mockCreateCheckpoint).toHaveBeenCalled());

    expect(mockCompleteSetup).toHaveBeenCalledWith(mockPayload);
    expect(mockLogin).toHaveBeenCalledWith("admin", "pw");
    expect(mockSetDrawerCurrencies).not.toHaveBeenCalled();
  });

  // The setup's own auto-login is not a person signing in, and the setup has
  // just counted every drawer (the baseline checkpoint) — so it must not
  // trigger the after-sign-in Checkpoint window.
  it("consumes the fresh-sign-in signal its own auto-login raised", async () => {
    render(<StepComplete />);
    fireEvent.click(screen.getByRole("button", { name: /Launch App/ }));

    await waitFor(() => expect(mockCreateCheckpoint).toHaveBeenCalled());
    expect(mockClearFreshSignIn).toHaveBeenCalledTimes(1);
    expect(mockClearFreshSignIn.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockLogin.mock.invocationCallOrder[0]!,
    );
  });

  it("never sends a bare MTC/Alfa row in the initial checkpoint's amounts, even when drawer_amounts somehow carries one", async () => {
    // Defense-in-depth case: even if a stale/legacy payload carried a
    // carrier drawer row (buildDrawerAmounts() no longer produces one),
    // StepComplete must still filter it out before the checkpoint call.
    mockPayload.drawer_amounts = [
      { drawer_name: "General", currency_code: "USD", amount: 500 },
      { drawer_name: "MTC", currency_code: "USD", amount: 25 },
    ];

    render(<StepComplete />);
    fireEvent.click(screen.getByRole("button", { name: /Launch App/ }));

    await waitFor(() => expect(mockCreateCheckpoint).toHaveBeenCalled());
    const payload = mockCreateCheckpoint.mock.calls[0][0];

    expect(payload.amounts).toEqual([
      {
        drawer_name: "General",
        currency_code: "USD",
        expected_amount: 500,
        physical_amount: 500,
      },
    ]);
  });

  it("surfaces a server refusal message readably instead of a stringified error object", async () => {
    mockCompleteSetup.mockResolvedValue({
      success: false,
      error: "MTC drawer amount was submitted with no carrier line counted",
    });

    render(<StepComplete />);
    fireEvent.click(screen.getByRole("button", { name: /Launch App/ }));

    expect(
      await screen.findByText(
        /MTC drawer amount was submitted with no carrier line counted/,
      ),
    ).toBeInTheDocument();
    expect(mockCreateCheckpoint).not.toHaveBeenCalled();
  });
});
