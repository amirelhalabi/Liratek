/** @jest-environment jsdom */
/**
 * LIRA-309 (US2, T030) — the bell warns about lines held for sale: amber 3
 * days before expiry, red in grace, "write off?" once lost. Each line's
 * alert is shown at most ONCE per line, status and day per session: TopBar
 * re-runs its checks on every poll and the bell keeps only 20 entries, so
 * re-emitting would push everything else out.
 *
 * Written before the change; first run failed (no line alert was emitted).
 */

import { render, waitFor } from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import TopBar from "../TopBar";
import { localDay } from "@/shared/utils/localDay";

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDay(d);
}

const mockGetClients = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetLowStockProducts = jest.fn();
const mockGetAllSettings = jest.fn();
const mockGetSystemExpectedBalancesDynamic = jest.fn();
const mockGetResaleLines = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Fresh object every call on purpose (TopBar must not depend on `api`
  // identity — see TopBar.voiceDesktopOnly.test.tsx).
  useApi: () => ({
    getClients: mockGetClients,
    getClientBalance: mockGetClientBalance,
    getLowStockProducts: mockGetLowStockProducts,
    getAllSettings: mockGetAllSettings,
    getSystemExpectedBalancesDynamic: mockGetSystemExpectedBalancesDynamic,
    getResaleLines: mockGetResaleLines,
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

let mockRechargeEnabled = true;
jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({
    isModuleEnabled: (key: string) => key === "recharge" && mockRechargeEnabled,
  }),
}));

const LINE = {
  product_id: 31,
  phone_number: "70444202",
  name: "Alfa line 70 444 202",
  category: "Phone Lines",
  cost_price_usd: 12,
  selling_price_usd: 20,
  stock_quantity: 1,
  is_unsold: 1,
  resale_line_id: 1,
  carrier: "alfa",
  credits: 0,
  validity_expires_at: inDays(2),
};

function lineAlertCalls(emit: jest.SpyInstance): unknown[][] {
  return emit.mock.calls.filter(
    (c) => c[0] === "notification:show" && String(c[1]).startsWith("Line for sale"),
  );
}

describe("TopBar — bell alerts for lines held for sale (LIRA-309)", () => {
  let emit: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRechargeEnabled = true;
    mockGetLowStockProducts.mockResolvedValue([]);
    mockGetAllSettings.mockResolvedValue([]);
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({});
    mockGetClients.mockResolvedValue([]);
    mockGetResaleLines.mockResolvedValue([LINE]);
    emit = jest.spyOn(appEvents, "emit");
  });

  afterEach(() => emit.mockRestore());

  it("warns once about a line expiring in 2 days, even when the checks re-run", async () => {
    render(<TopBar />);
    await waitFor(() => expect(lineAlertCalls(emit)).toHaveLength(1));
    expect(lineAlertCalls(emit)[0]).toEqual([
      "notification:show",
      "Line for sale 70444202 (Alfa) expires in 2 days",
      "warning",
    ]);

    // A sale / stock change re-runs every TopBar check.
    appEvents.emit("inventory:updated");
    await waitFor(() => expect(mockGetResaleLines).toHaveBeenCalledTimes(2));
    expect(lineAlertCalls(emit)).toHaveLength(1);
  });

  it("stays quiet when Mobile Recharge is switched off", async () => {
    mockRechargeEnabled = false;
    render(<TopBar />);
    await waitFor(() => expect(mockGetLowStockProducts).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(lineAlertCalls(emit)).toHaveLength(0);
  });
});
