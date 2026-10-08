/** @jest-environment jsdom */
/**
 * LIRA-291 — the top bar's "My account" link, next to the signed-in user's
 * name and Sign out. Every role sees it (Settings is admin-only, and a staff
 * member who joined with Google must reach "Set a password").
 *
 * LIRA-292: shown on the desktop app too — My account now holds the
 * device's display preferences and the user's profile, which both apply
 * there.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import TopBar from "../TopBar";

const mockGetClients = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetLowStockProducts = jest.fn();
const mockGetAllSettings = jest.fn();
const mockGetSystemExpectedBalancesDynamic = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Fresh object every call — see the file-level comment above. Do NOT
  // memoize this; it is what catches a re-introduced `[api]` dependency.
  useApi: () => ({
    getClients: mockGetClients,
    getClientBalance: mockGetClientBalance,
    getLowStockProducts: mockGetLowStockProducts,
    getAllSettings: mockGetAllSettings,
    getSystemExpectedBalancesDynamic: mockGetSystemExpectedBalancesDynamic,
  }),
}));

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({
    user: { username: "cashier", role: "staff" },
    logout: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopName: () => "",
}));

jest.mock("@/contexts/FeatureFlagContext", () => ({
  // customerSessions: false keeps CustomerSessionButton (and its own,
  // unrelated dependency tree) out of this render entirely.
  useFeatureFlags: () => ({
    flags: { customerSessions: false, sessionManagement: true },
  }),
}));

jest.mock("@/hooks/useVoiceBotSettings", () => ({
  useVoiceBotSettings: () => ({ config: { enabled: false } }),
}));

// TopBar imports these unconditionally (they render behind flags, but the
// import itself is eager). VoiceBotButton's chain reaches
// HuggingFaceASRClient, which reads `import.meta.env` at module scope —
// ts-jest compiles to CommonJS and TS1343s on that syntax outside the one
// mapped exception (frontend/jest.config.ts, `@/config/viteEnv`). Without
// this mock the whole suite fails in setup/transform, before any test body
// runs (rule 28a) — the exact risk reviewer finding #1 named.
jest.mock("@/components/VoiceBotButton", () => ({
  VoiceBotButton: () => null,
}));
// Not rendered here (customerSessions: false above), but mocked defensively
// so its own import chain (SessionFloatingWindow, StartSessionModal) can
// never resurface the same failure mode if that flag or this test changes.
jest.mock("@/features/sessions/components/CustomerSessionButton", () => ({
  CustomerSessionButton: () => null,
}));

jest.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

jest.mock("@/shared/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
}));

let mockActiveSession: { id: number; customer_phone?: string } | null = null;
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: mockActiveSession }),
}));


describe("TopBar — My account link (LIRA-291)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveSession = null;
    mockGetLowStockProducts.mockResolvedValue([]);
    mockGetAllSettings.mockResolvedValue([]);
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({});
    mockGetClients.mockResolvedValue([]);
    delete (window as unknown as { api?: unknown }).api;
  });
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it("a staff user sees 'My account', and it opens /account", () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "My account" }));
    expect(mockNavigate).toHaveBeenCalledWith("/account");
  });

  it("is shown on the desktop app too (LIRA-292)", () => {
    (window as unknown as { api?: unknown }).api = {};
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "My account" }));
    expect(mockNavigate).toHaveBeenCalledWith("/account");
  });
});
