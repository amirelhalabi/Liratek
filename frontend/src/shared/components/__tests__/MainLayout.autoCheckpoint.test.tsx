/** @jest-environment jsdom */
/**
 * After a FRESH sign-in (password login or the Google hand-off), an admin of
 * a shop that uses checkpoints gets ONE Checkpoint window listing EVERY
 * visible drawer — General first — each marked counted-today or not (owner
 * decision 2026-10-07; it used to open the single-drawer window for the
 * first uncounted drawer only). It opens only while at least one drawer is
 * not counted today. Once per sign-in: a page refresh never opens it, and
 * closing it never brings it back.
 *
 * MainLayout is shared by the desktop and web apps (rule 19); the data comes
 * through useApi(), so both transports take this same path.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";

jest.mock("../layouts/LeftPanelLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
jest.mock("../layouts/HomeViewLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
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

// The single-drawer window (dashboard clipboard icon) must NOT be what opens
// after sign-in any more.
jest.mock("@/features/closing/pages/Checkpoint", () => ({
  __esModule: true,
  default: ({ drawerName }: { drawerName: string }) => (
    <div role="dialog" data-testid="single-drawer-checkpoint">
      {drawerName}
    </div>
  ),
}));

jest.mock(
  "@/features/closing/pages/Checkpoint/AllDrawersCheckpointModal",
  () => ({
    __esModule: true,
    default: ({
      drawers,
      onClose,
    }: {
      drawers: { name: string; countedToday: boolean }[];
      onClose: () => void;
    }) => (
      <div role="dialog" data-testid="checkpoint-modal">
        <ol>
          {drawers.map((d) => (
            <li key={d.name}>
              {d.name}:{d.countedToday ? "counted" : "open"}
            </li>
          ))}
        </ol>
        <button onClick={onClose}>close</button>
      </div>
    ),
  }),
);

/** The drawers the all-drawers window was given, in order. */
function listed(): string[] {
  const items = screen.getByTestId("checkpoint-modal").querySelectorAll("li");
  return Array.from(items).map((li) => li.textContent ?? "");
}

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

const flagState = {
  flags: { sessionManagement: true, customerSessions: true },
  loaded: true,
};
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
  useWhatsNew: () => ({
    isOpen: false,
    open: jest.fn(),
    dismiss: jest.fn(),
    entries: [],
  }),
}));

/** A UTC SQLite stamp for a moment that is TODAY in local time. */
function todayStamp(): string {
  const now = new Date();
  const local = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0,
  );
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
  it("fresh sign-in + admin + checkpoints on -> ONE window listing every visible drawer, General first", async () => {
    renderLayout();
    await screen.findByTestId("checkpoint-modal");
    expect(listed()).toEqual(["General:open", "MTC:open"]);
    expect(screen.queryByTestId("single-drawer-checkpoint")).toBeNull();
    expect(auth.clearFreshSignIn).toHaveBeenCalledTimes(1);
  });

  it("General counted today -> still listed, marked counted; the others stay open", async () => {
    api.getLastCheckpointPerDrawer.mockResolvedValue({
      General: {
        drawer_name: "General",
        checked_at: todayStamp(),
        amounts: {},
      },
    });
    renderLayout();
    await screen.findByTestId("checkpoint-modal");
    expect(listed()).toEqual(["General:counted", "MTC:open"]);
  });

  it("a drawer whose module is off is not listed", async () => {
    api.getSystemExpectedBalancesDynamic.mockResolvedValue({
      General: { USD: 10 },
      MTC: { USD: 0 },
      Binance: { USD: 0 },
    });
    renderLayout();
    await screen.findByTestId("checkpoint-modal");
    expect(listed()).toEqual(["General:open", "MTC:open"]);
  });

  it("every drawer counted today -> nothing opens", async () => {
    api.getLastCheckpointPerDrawer.mockResolvedValue({
      General: {
        drawer_name: "General",
        checked_at: todayStamp(),
        amounts: {},
      },
      MTC: { drawer_name: "MTC", checked_at: todayStamp(), amounts: {} },
    });
    renderLayout();
    await settle();
    await waitFor(() =>
      expect(api.getLastCheckpointPerDrawer).toHaveBeenCalled(),
    );
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
    await screen.findByTestId("checkpoint-modal");
    expect(listed()).toEqual(["General:open", "MTC:open"]);
  });

  it("closing it keeps it closed (once per sign-in)", async () => {
    renderLayout();
    fireEvent.click(await screen.findByText("close"));
    await settle();
    expect(screen.queryByTestId("checkpoint-modal")).toBeNull();
    expect(api.getLastCheckpointPerDrawer).toHaveBeenCalledTimes(1);
  });
});
