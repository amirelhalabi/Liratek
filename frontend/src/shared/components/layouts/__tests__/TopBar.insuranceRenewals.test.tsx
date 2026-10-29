/** @jest-environment jsdom */
/**
 * LIRA-360 — the bell shows ONE insurance renewal summary per day ("Insurance:
 * 3 expire this week, 2 expired"), linking to the Dashboard. The day it was
 * shown is kept in localStorage so a page reload does not repeat it.
 *
 * Written before the change (rule 17).
 */

import { render, waitFor } from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import TopBar from "../TopBar";
import { localDay } from "@/shared/utils/localDay";
import type { InsuranceRenewal } from "@liratek/core";

const mockGetClients = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetLowStockProducts = jest.fn();
const mockGetAllSettings = jest.fn();
const mockGetSystemExpectedBalancesDynamic = jest.fn();
const mockGetResaleLines = jest.fn();
const mockGetInsuranceRenewals = jest.fn();

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
    getInsuranceRenewals: mockGetInsuranceRenewals,
  }),
}));

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

const mockPictureUrl: string | null = null;
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

const mockActiveSession: { id: number; customer_phone?: string } | null = null;
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: mockActiveSession }),
}));

let mockCustomServicesEnabled = true;
jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({
    isModuleEnabled: (key: string) =>
      key === "custom_services" && mockCustomServicesEnabled,
  }),
}));

const BELL_DAY_KEY = "liratek.insuranceRenewals.lastBellDay";

function renewal(id: number, days_left: number): InsuranceRenewal {
  return {
    id,
    client_id: null,
    client_name: `Customer ${id}`,
    phone_number: null,
    description: "Insurance",
    insurance_type: "COMPULSORY",
    sale_day: "2025-11-03",
    expiry_day: "2026-11-03",
    days_left,
  };
}

function insuranceCalls(emit: jest.SpyInstance): unknown[][] {
  return emit.mock.calls.filter(
    (c) => c[0] === "notification:show" && String(c[1]).startsWith("Insurance:"),
  );
}

describe("TopBar — daily insurance renewal summary (LIRA-360)", () => {
  let emit: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomServicesEnabled = true;
    window.localStorage.clear();
    mockGetLowStockProducts.mockResolvedValue([]);
    mockGetAllSettings.mockResolvedValue([]);
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({});
    mockGetClients.mockResolvedValue([]);
    mockGetResaleLines.mockResolvedValue([]);
    emit = jest.spyOn(appEvents, "emit");
  });

  afterEach(() => emit.mockRestore());

  it("shows one summary line linking to the Dashboard, once per day", async () => {
    mockGetInsuranceRenewals.mockResolvedValue([
      renewal(1, 5),
      renewal(2, 0),
      renewal(3, 7),
      renewal(4, -1),
      renewal(5, -300),
    ]);
    render(<TopBar />);
    await waitFor(() => expect(insuranceCalls(emit)).toHaveLength(1));
    expect(insuranceCalls(emit)[0]).toEqual([
      "notification:show",
      "Insurance: 3 expire this week, 2 expired",
      "warning",
      undefined,
      "/dashboard",
    ]);
    expect(mockGetInsuranceRenewals).toHaveBeenCalledWith({
      client_day: localDay(),
    });
    expect(window.localStorage.getItem(BELL_DAY_KEY)).toBe(localDay());

    // A sale / stock change re-runs every TopBar check; the day is already
    // done, so the list is not even fetched again.
    appEvents.emit("inventory:updated");
    await waitFor(() =>
      expect(mockGetLowStockProducts).toHaveBeenCalledTimes(2),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(insuranceCalls(emit)).toHaveLength(1);
  });

  it("leaves out a part whose count is 0", async () => {
    mockGetInsuranceRenewals.mockResolvedValue([renewal(1, -4)]);
    render(<TopBar />);
    await waitFor(() => expect(insuranceCalls(emit)).toHaveLength(1));
    expect(insuranceCalls(emit)[0][1]).toBe("Insurance: 1 expired");
  });

  it("stays quiet after a reload on the same day", async () => {
    window.localStorage.setItem(BELL_DAY_KEY, localDay());
    mockGetInsuranceRenewals.mockResolvedValue([renewal(1, 3)]);
    render(<TopBar />);
    await waitFor(() => expect(mockGetLowStockProducts).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(insuranceCalls(emit)).toHaveLength(0);
  });

  it("stays quiet when nobody is due", async () => {
    mockGetInsuranceRenewals.mockResolvedValue([]);
    render(<TopBar />);
    await waitFor(() => expect(mockGetInsuranceRenewals).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(insuranceCalls(emit)).toHaveLength(0);
    expect(window.localStorage.getItem(BELL_DAY_KEY)).toBeNull();
  });

  it("stays quiet when Custom Services is off", async () => {
    mockCustomServicesEnabled = false;
    mockGetInsuranceRenewals.mockResolvedValue([renewal(1, 3)]);
    render(<TopBar />);
    await waitFor(() => expect(mockGetLowStockProducts).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetInsuranceRenewals).not.toHaveBeenCalled();
    expect(insuranceCalls(emit)).toHaveLength(0);
  });
});
