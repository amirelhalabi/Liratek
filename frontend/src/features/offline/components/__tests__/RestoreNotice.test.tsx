/** @jest-environment jsdom */
/**
 * LIRA-377 T046 — after an admin restores the shop, a paired PC shows
 * "Shop restored to <time> by <name>" until someone dismisses it. It must be
 * visible on the standby screen (nobody is signed in there) and above the
 * app while the PC works offline. Dismiss goes through `useApi()` and then
 * re-reads the status. The useApi mock returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { OfflineStatusView } from "@liratek/core";

const getOfflineStatus = jest.fn();
const dismissOfflineRestoreNotice = jest.fn();
const api = {
  getOfflineStatus,
  dismissOfflineRestoreNotice,
  openWebApp: jest.fn(),
  goOffline: jest.fn(),
  installOfflineUpdate: jest.fn(),
  backToWeb: jest.fn(),
  sendOfflineNow: jest.fn(),
};
jest.mock("@liratek/ui", () => ({ useApi: () => api }));

import { StandbyScreen } from "../StandbyScreen";
import { OfflineGate } from "../OfflineGate";

const STANDBY: OfflineStatusView = {
  mode: "standby",
  paired: true,
  deviceNo: 2,
  shopName: "Corner Tech",
  serverReachable: true,
  unreachableSeconds: 0,
  pendingCount: 0,
  restoreNotice: {
    restoreId: 5,
    restoredTo: "2026-11-09T14:30:00.000Z",
    restoredAt: "2026-11-10T08:00:00.000Z",
    byName: "Rania",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  dismissOfflineRestoreNotice.mockResolvedValue({ success: true });
});

describe("restore notice banner", () => {
  it("standby screen: shows when the shop was restored to and by whom", () => {
    render(<StandbyScreen status={STANDBY} onChanged={jest.fn()} />);
    const text = screen.getByText(/Shop restored to .*2026.* by Rania/);
    expect(text).toBeTruthy();
  });

  it("a restore from a backup file has no point in time", () => {
    render(
      <StandbyScreen
        status={{
          ...STANDBY,
          restoreNotice: { ...STANDBY.restoreNotice!, restoredTo: null },
        }}
        onChanged={jest.fn()}
      />,
    );
    expect(
      screen.getByText(/Shop restored from a backup file by Rania/),
    ).toBeTruthy();
  });

  it("never says 'by null' when the name is unknown", () => {
    render(
      <StandbyScreen
        status={{
          ...STANDBY,
          restoreNotice: { ...STANDBY.restoreNotice!, byName: null },
        }}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText(/Shop restored to .*2026/)).toBeTruthy();
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it("Dismiss calls the adapter, then re-reads the status", async () => {
    const onChanged = jest.fn();
    render(<StandbyScreen status={STANDBY} onChanged={onChanged} />);
    fireEvent.click(
      screen.getByRole("button", { name: /dismiss the restore notice/i }),
    );
    await waitFor(() =>
      expect(dismissOfflineRestoreNotice).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows the error when dismissing fails", async () => {
    dismissOfflineRestoreNotice.mockResolvedValue({
      success: false,
      error: "Could not save (stub)",
    });
    render(<StandbyScreen status={STANDBY} onChanged={jest.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: /dismiss the restore notice/i }),
    );
    expect(await screen.findByText(/Could not save \(stub\)/)).toBeTruthy();
  });

  it("hidden when there is no notice", () => {
    render(
      <StandbyScreen
        status={{ ...STANDBY, restoreNotice: null }}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.queryByText(/Shop restored/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /dismiss the restore notice/i }),
    ).toBeNull();
  });

  it("offline PC: the notice shows above the app too", async () => {
    getOfflineStatus.mockResolvedValue({
      success: true,
      data: { ...STANDBY, mode: "offline", serverReachable: false },
    });
    render(
      <OfflineGate>
        <div>THE APP</div>
      </OfflineGate>,
    );
    expect(await screen.findByText("THE APP")).toBeTruthy();
    expect(screen.getByText(/Shop restored to .*2026.* by Rania/)).toBeTruthy();
  });
});
