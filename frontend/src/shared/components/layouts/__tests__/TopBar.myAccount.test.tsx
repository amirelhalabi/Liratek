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

import { fireEvent, render, screen, within } from "@testing-library/react";
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
    mockPictureUrl = null;
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

// LIRA-294: the Google photo replaces the person icon, at the SAME size, in a
// circle; the icon comes back when there is no photo or it fails to load.
describe("TopBar — account photo (LIRA-294)", () => {
  const PHOTO = "https://lh3.googleusercontent.com/a/photo=s96-c";
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveSession = null;
    mockGetLowStockProducts.mockResolvedValue([]);
    mockGetAllSettings.mockResolvedValue([]);
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({});
    mockGetClients.mockResolvedValue([]);
  });

  it("shows the photo in a 35px circle (owner-sized), without a referrer", () => {
    mockPictureUrl = PHOTO;
    render(<TopBar />);
    const link = screen.getByTestId("my-account-link");
    const img = within(link).getByRole("img", { name: "My account" });
    expect(img).toHaveAttribute("src", PHOTO);
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(img).toHaveAttribute("width", "35");
    expect(img).toHaveAttribute("height", "35");
    expect(img.className).toContain("rounded-full");
    expect(img.className).toContain("object-cover");
    expect(link.querySelector("svg")).toBeNull();
  });

  it("falls back to the icon when the photo fails to load", () => {
    mockPictureUrl = PHOTO;
    render(<TopBar />);
    const link = screen.getByTestId("my-account-link");
    fireEvent.error(within(link).getByRole("img", { name: "My account" }));
    expect(within(link).queryByRole("img", { name: "My account" })).toBeNull();
    expect(link.querySelector("svg")).not.toBeNull();
  });

  it("no photo: the icon", () => {
    mockPictureUrl = null;
    render(<TopBar />);
    const link = screen.getByTestId("my-account-link");
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector("svg")).not.toBeNull();
  });
});
