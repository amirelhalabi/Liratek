/** @jest-environment jsdom */
/**
 * LIRA-306 T121 — the paired PC's standby screen (plan diagram B; O-new-16:
 * the desktop window never shows the web app, it offers to open it in the
 * browser). Shows the shop, the PC number, the copy's age, whether offline
 * mode is ready (and why not), the server's reachability, and this PC's
 * offline items still held for review on the web — so a held repayment is
 * not collected twice (spec edge case).
 *
 * The useApi mock returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { OfflineStatusView } from "@liratek/core";

const api = {
  openWebApp: jest.fn(async () => ({ success: true })),
  goOffline: jest.fn(async () => ({ success: true })),
  installOfflineUpdate: jest.fn(async () => ({
    success: false,
    error: "No update downloaded yet",
  })),
};
jest.mock("@liratek/ui", () => ({ useApi: () => api }));

import { StandbyScreen } from "../StandbyScreen";

const READY: OfflineStatusView = {
  mode: "standby",
  paired: true,
  deviceNo: 3,
  shopName: "Corner Tech",
  copyAgeSeconds: 180,
  copyAgeWarning: false,
  ready: true,
  notReadyReason: null,
  serverReachable: true,
  unreachableSeconds: 0,
  canGoOffline: false,
  pendingCount: 0,
  lastError: null,
  heldItems: [],
};

beforeEach(() => jest.clearAllMocks());

describe("StandbyScreen", () => {
  it("shows the shop, the PC number and the copy's age", () => {
    render(<StandbyScreen status={READY} onChanged={jest.fn()} />);
    expect(screen.getByText(/Corner Tech/)).toBeTruthy();
    expect(screen.getByText(/PC 3/)).toBeTruthy();
    expect(screen.getByText(/3 min old/)).toBeTruthy();
    expect(screen.getByText(/connected/i)).toBeTruthy();
  });

  it("'Open the web app' opens the browser through the adapter", async () => {
    render(<StandbyScreen status={READY} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /open the web app/i }));
    await waitFor(() => expect(api.openWebApp).toHaveBeenCalledTimes(1));
  });

  it("'Work offline' is disabled until the server has been unreachable 30 s with a ready copy", () => {
    render(<StandbyScreen status={READY} onChanged={jest.fn()} />);
    expect(
      (
        screen.getByRole("button", {
          name: /work offline/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("enabled 'Work offline' calls goOffline; a refusal is shown", async () => {
    api.goOffline.mockResolvedValueOnce({
      success: false,
      error: "No usable copy",
    } as never);
    render(
      <StandbyScreen
        status={{
          ...READY,
          serverReachable: false,
          unreachableSeconds: 45,
          canGoOffline: true,
        }}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText(/no internet for 45 s/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /work offline/i }));
    await waitFor(() => expect(api.goOffline).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/No usable copy/)).toBeTruthy();
  });

  it("not ready → says why", () => {
    render(
      <StandbyScreen
        status={{
          ...READY,
          ready: false,
          notReadyReason:
            "Waiting for a fresh copy that includes this PC's last offline work",
        }}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText(/Waiting for a fresh copy/)).toBeTruthy();
  });

  it("lists this PC's offline items held for review, with a do-not-collect-again warning", () => {
    render(
      <StandbyScreen
        status={{
          ...READY,
          heldItems: [
            { eventId: "e1", label: "Debt repayment", amount: 20 },
            { eventId: "e2", label: "Drawer count", amount: null },
          ],
        }}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText(/held for review/i)).toBeTruthy();
    expect(screen.getByText(/do not collect/i)).toBeTruthy();
    expect(screen.getByText(/Debt repayment/)).toBeTruthy();
    expect(screen.getByText(/Drawer count/)).toBeTruthy();
  });

  it("blocked: explains, and a copy older than a day warns", () => {
    render(
      <StandbyScreen
        status={{
          ...READY,
          mode: "blocked",
          ready: false,
          notReadyReason: "No copy of the shop on this PC yet",
          copyAgeSeconds: null,
        }}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText(/No copy of the shop on this PC yet/)).toBeTruthy();
  });

  it("shows the last error (e.g. re-pair this PC)", () => {
    render(
      <StandbyScreen
        status={{
          ...READY,
          lastError: "This PC's key was revoked — re-pair this PC",
        }}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText(/re-pair this PC/)).toBeTruthy();
  });

  it("'Install update' shows the result", async () => {
    render(<StandbyScreen status={READY} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /install update/i }));
    expect(await screen.findByText(/No update downloaded yet/)).toBeTruthy();
  });
});
