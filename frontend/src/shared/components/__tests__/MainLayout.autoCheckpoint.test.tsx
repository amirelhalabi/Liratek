/** @jest-environment jsdom */
/**
 * After a FRESH sign-in (password login or the Google hand-off), an admin of
 * a shop that uses checkpoints gets the Checkpoint window for the first
 * drawer not counted today — General first. Once per sign-in: a page
 * refresh never opens it, and closing it never brings it back.
 *
 * MainLayout is shared by the desktop and web apps (rule 19); the data comes
 * through useApi(), so both transports take this same path.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";

jest.mock("../layouts/LeftPanelLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock("../layouts/HomeViewLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Rule 25: ONE stable adapter object for the whole file.
const api = {
  getSystemExpectedBalancesDynamic: jest.fn(),
  getLastCheckpointPerDrawer: jest.fn(),
  getEnabledModules: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  __esModule: true,
  NotificationCenter: () => null,
  appEvents: { on: jest.fn(() => jest.fn()) },
  useApi: () => api,
}));

jest.mock("@/features/closing/pages/Checkpoint", () => ({
  __esModule: true,
  default: ({ drawerName, onClose }: { drawerName: string; onClose: () => void }) => (
    <div role="dialog" data-testid="checkpoint-modal">
      {drawerName}
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

const auth = {
  user: { id: 1, role: "admin" } as { id: number; role: string } | null,
  freshSignIn: true,
  clearFreshSignIn: jest.fn(() => {
    auth.freshSignIn = false;
  }),
};
jest.mock("@/features/auth/context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => auth,
}));

const flagState = { flags: { sessionManagement: true, customerSessions: true }, loaded: true };
jest.mock("@/contexts/FeatureFlagContext", () => ({
  __esModule: true,
  useFeatureFlags: () => flagState,
}));

jest.mock("@/features/admin/components/ImpersonationBanner", () => ({
  __esModule: true,
  ImpersonationBanner: () => null,
}));
jest.mock("@/shared/components/SubscriptionBanner", () => ({
  __esModule: true,
  SubscriptionBanner: () => null,
}));
jest.mock("@/features/whatsNew/WhatsNewModal", () => ({
  __esModule: true,
  WhatsNewModal: () => null,
}));
jest.mock("@/features/whatsNew/useWhatsNew", () => ({
  __esModule: true,
  useWhatsNew: () => ({ isOpen: false, open: jest.fn(), dismiss: jest.fn(), entries: [] }),
}));

/** A UTC SQLite stamp for a moment that is TODAY in local time. */
function todayStamp(): string {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  return local.toISOString().replace("T", " ").slice(0, 19);
}

function renderLayout() {
  return render(
    <MemoryRouter>
      <MainLayout>
        <div>content</div>
      </MainLayout>
    </MemoryRouter>,
  );
}

/** Let the async auto-open settle (or prove it did nothing). */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  auth.user = { id: 1, role: "admin" };
  auth.freshSignIn = true;
  flagState.flags = { sessionManagement: true, customerSessions: true };
  flagState.loaded = true;
  // Unordered, as the server returns them; General is not first here.
  api.getSystemExpectedBalancesDynamic.mockResolvedValue({
    MTC: { USD: 0 },
    General: { USD: 10, LBP: 0 },
  });
  api.getLastCheckpointPerDrawer.mockResolvedValue({});
  api.getEnabledModules.mockResolvedValue([{ key: "recharge", is_enabled: 1 }]);
});

describe("MainLayout — Checkpoint window after a fresh sign-in", () => {
  it("fresh sign-in + admin + checkpoints on + nothing counted today -> opens for General", async () => {
    renderLayout();
    const modal = await screen.findByTestId("checkpoint-modal");
    expect(modal).toHaveTextContent("General");
    expect(auth.clearFreshSignIn).toHaveBeenCalledTimes(1);
  });

  it("General counted today -> opens for the next drawer not counted today", async () => {
    api.getLastCheckpointPerDrawer.mockResolvedValue({
      General: { drawer_name: "General", checked_at: todayStamp(), amounts: {} },
    });
    renderLayout();
    expect(await screen.findByTestId("checkpoint-modal")).toHaveTextContent("MTC");
  });

  it("every drawer counted today -> nothing opens", async () => {
    api.getLastCheckpointPerDrawer.mockResolvedValue({
      General: { drawer_name: "General", checked_at: todayStamp(), amounts: {} },
      MTC: { drawer_name: "MTC", checked_at: todayStamp(), amounts: {} },
    });
    renderLayout();
    await settle();
    await waitFor(() => expect(api.getLastCheckpointPerDrawer).toHaveBeenCalled());
    await settle();
    expect(screen.queryByTestId("checkpoint-modal")).toBeNull();
  });

  it("a page refresh (not a fresh sign-in) -> nothing opens, nothing is fetched", async () => {
    auth.freshSignIn = false;
    renderLayout();
    await settle();
    expect(screen.queryByTestId("checkpoint-modal")).toBeNull();
    expect(api.getLastCheckpointPerDrawer).not.toHaveBeenCalled();
  });

  it("a non-admin -> nothing opens", async () => {
    auth.user = { id: 2, role: "staff" };
    renderLayout();
    await settle();
    expect(screen.queryByTestId("checkpoint-modal")).toBeNull();
    expect(api.getLastCheckpointPerDrawer).not.toHaveBeenCalled();
  });

  it("checkpoints turned off -> nothing opens", async () => {
    flagState.flags = { sessionManagement: false, customerSessions: true };
    renderLayout();
    await settle();
    expect(screen.queryByTestId("checkpoint-modal")).toBeNull();
    expect(api.getLastCheckpointPerDrawer).not.toHaveBeenCalled();
  });

  it("waits for the shop's settings before deciding (default flags are not trusted)", async () => {
    flagState.loaded = false;
    const view = renderLayout();
    await settle();
    expect(screen.queryByTestId("checkpoint-modal")).toBeNull();
    expect(auth.clearFreshSignIn).not.toHaveBeenCalled();

    flagState.loaded = true;
    view.rerender(
      <MemoryRouter>
        <MainLayout>
          <div>content</div>
        </MainLayout>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("checkpoint-modal")).toHaveTextContent("General");
  });

  it("closing it keeps it closed (once per sign-in)", async () => {
    renderLayout();
    fireEvent.click(await screen.findByText("close"));
    await settle();
    expect(screen.queryByTestId("checkpoint-modal")).toBeNull();
    expect(api.getLastCheckpointPerDrawer).toHaveBeenCalledTimes(1);
  });
});
