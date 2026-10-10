/** @jest-environment jsdom */
/**
 * LIRA-297 — the voice-command button only shows on the desktop app. Voice
 * commands run through the Electron bridge (`window.api.voicebot`) and have no
 * server route, so on the web every command failed with a TypeError. Owner
 * decision 2026-10-10: hide it on the web for now.
 */

import { render, screen } from "@testing-library/react";
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

let mockPictureUrl: string | null = null;
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({
    user: { username: "cashier", role: "staff", pictureUrl: mockPictureUrl },
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
  useVoiceBotSettings: () => ({ config: { enabled: true } }),
}));

// TopBar imports these unconditionally (they render behind flags, but the
// import itself is eager). VoiceBotButton's chain reaches
// HuggingFaceASRClient, which reads `import.meta.env` at module scope —
// ts-jest compiles to CommonJS and TS1343s on that syntax outside the one
// mapped exception (frontend/jest.config.ts, `@/config/viteEnv`). Without
// this mock the whole suite fails in setup/transform, before any test body
// runs (rule 28a) — the exact risk reviewer finding #1 named.
jest.mock("@/components/VoiceBotButton", () => ({
  VoiceBotButton: () => <span data-testid="voice-bot-button" />,
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

describe("TopBar — voice button is desktop-only (LIRA-297)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveSession = null;
    mockPictureUrl = null;
    mockGetLowStockProducts.mockResolvedValue([]);
    mockGetAllSettings.mockResolvedValue([]);
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({});
    mockGetClients.mockResolvedValue([]);
  });
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it("web app (no Electron bridge): the voice button is not shown", () => {
    delete (window as unknown as { api?: unknown }).api;
    render(<TopBar />);
    expect(screen.queryByTestId("voice-bot-button")).not.toBeInTheDocument();
  });

  it("desktop app: the voice button is shown when voice is enabled", () => {
    (window as unknown as { api: Record<string, unknown> }).api = {};
    render(<TopBar />);
    expect(screen.getByTestId("voice-bot-button")).toBeInTheDocument();
  });
});
