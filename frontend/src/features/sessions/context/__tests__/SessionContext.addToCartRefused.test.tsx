/**
 * addToCart must not put a line in the on-screen basket when the server
 * refused to store it.
 *
 * Before: `addToCart` awaited `session.cartAdd`, ignored a
 * `{ success: false, error }` answer (and swallowed a thrown error into a
 * log line), then appended the line anyway. The basket showed an item the
 * server never stored — it vanished on reload / on another till, or (a
 * no-price custom service) failed the whole checkout later — and the
 * cashier was never told why.
 *
 * Rule 25: `useApi()` returns ONE module-level object, so the provider's
 * effects see a stable reference exactly as in production.
 */
import { render, screen, waitFor, act } from "@testing-library/react";

const mockApi = {
  session: {
    getActiveSessions: jest.fn(),
    getTodayAllSessions: jest.fn(),
    cartGet: jest.fn(),
    cartAdd: jest.fn(),
    cartRemove: jest.fn(),
    cartClear: jest.fn(),
    getTransactions: jest.fn(),
    delete: jest.fn(),
  },
  getSessionDetails: jest.fn(),
  startSession: jest.fn(),
  closeSession: jest.fn(),
  updateSession: jest.fn(),
  linkTransactionToSession: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const stableFlags = { flags: { customerSessions: true } };
jest.mock("@/contexts/FeatureFlagContext", () => ({
  useFeatureFlags: () => stableFlags,
}));

const stableAuth = { isAuthenticated: true };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => stableAuth,
}));

jest.mock("@/api/realtime", () => ({
  subscribeToInvalidation: () => () => {},
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { SessionProvider, useSession } from "../SessionContext";

function Probe() {
  const { activeSession, cartItems, addToCart } = useSession();
  return (
    <div>
      <div data-testid="session">{activeSession ? activeSession.id : "none"}</div>
      <div data-testid="count">{cartItems.length}</div>
      <button
        onClick={() =>
          addToCart({
            module: "custom_service",
            label: "Service: cover",
            amount: 0,
            currency: "USD",
            ipcChannel: "custom-services:add",
            formData: { description: "cover", cost_usd: 4 },
          })
        }
      >
        add
      </button>
    </div>
  );
}

async function renderWithSession() {
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("12"));
  expect(screen.getByTestId("count").textContent).toBe("0");
}

describe("SessionContext.addToCart — server refusal", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.session.getActiveSessions.mockResolvedValue({
      success: true,
      sessions: [{ id: 12, started_at: "2026-10-07 10:00:00", started_by: "admin", is_active: 1 }],
    });
    mockApi.session.getTodayAllSessions.mockResolvedValue({ success: true, sessions: [] });
    mockApi.session.cartGet.mockResolvedValue({ success: true, items: [] });
    mockApi.session.getTransactions.mockResolvedValue({ success: true, transactions: [] });
    mockApi.getSessionDetails.mockResolvedValue({ success: true });
    alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it("does not add the line and shows the server's reason when cartAdd answers success:false", async () => {
    mockApi.session.cartAdd.mockResolvedValue({
      success: false,
      error: "Enter a selling price first.",
    });
    await renderWithSession();

    await act(async () => {
      screen.getByText("add").click();
    });

    await waitFor(() => expect(mockApi.session.cartAdd).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("Enter a selling price first."),
    );
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("does not add the line when cartAdd throws (nothing was stored)", async () => {
    mockApi.session.cartAdd.mockRejectedValue({ status: 500, message: "Network down" });
    await renderWithSession();

    await act(async () => {
      screen.getByText("add").click();
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Network down"));
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("still adds the line when the server stores it", async () => {
    mockApi.session.cartAdd.mockResolvedValue({ success: true, id: 1 });
    await renderWithSession();

    await act(async () => {
      screen.getByText("add").click();
    });

    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
