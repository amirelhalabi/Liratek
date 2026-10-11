/** @jest-environment jsdom */
/**
 * LIRA-306 — the gate above the app (plan diagram B): standby/blocked PCs
 * show ONLY the standby screen (the app — and its sign-in — never mounts, so
 * nothing reaches the PC's copy); offline/finishing PCs show the banner over
 * the app; a standalone desktop and the web app render the app unchanged.
 * The useApi mock returns ONE stable object (rule 25).
 */
import { render, screen, waitFor } from "@testing-library/react";

const getOfflineStatus = jest.fn();
const api = {
  getOfflineStatus,
  openWebApp: jest.fn(),
  goOffline: jest.fn(),
  installOfflineUpdate: jest.fn(),
  backToWeb: jest.fn(),
  sendOfflineNow: jest.fn(),
};
jest.mock("@liratek/ui", () => ({ useApi: () => api }));

import { OfflineGate } from "../OfflineGate";

const App = () => <div>THE APP</div>;

beforeEach(() => getOfflineStatus.mockReset());

it("web app (desktop-only refusal): renders the app unchanged", async () => {
  getOfflineStatus.mockResolvedValue({
    success: false,
    error: "Available on the desktop app",
  });
  render(
    <OfflineGate>
      <App />
    </OfflineGate>,
  );
  expect(await screen.findByText("THE APP")).toBeTruthy();
  expect(screen.queryByText(/working offline/i)).toBeNull();
});

it("standalone desktop: renders the app unchanged", async () => {
  getOfflineStatus.mockResolvedValue({
    success: true,
    data: { mode: "standalone", paired: false },
  });
  render(
    <OfflineGate>
      <App />
    </OfflineGate>,
  );
  expect(await screen.findByText("THE APP")).toBeTruthy();
});

it("standby: only the standby screen — the app never mounts", async () => {
  getOfflineStatus.mockResolvedValue({
    success: true,
    data: {
      mode: "standby",
      paired: true,
      deviceNo: 2,
      shopName: "Corner Tech",
      ready: true,
    },
  });
  render(
    <OfflineGate>
      <App />
    </OfflineGate>,
  );
  expect(
    await screen.findByRole("button", { name: /open the web app/i }),
  ).toBeTruthy();
  expect(screen.queryByText("THE APP")).toBeNull();
});

it("offline: banner above the app", async () => {
  getOfflineStatus.mockResolvedValue({
    success: true,
    data: {
      mode: "offline",
      paired: true,
      pendingCount: 2,
      serverReachable: false,
    },
  });
  render(
    <OfflineGate>
      <App />
    </OfflineGate>,
  );
  await waitFor(() => expect(screen.getByText("THE APP")).toBeTruthy());
  expect(screen.getByText(/working offline/i)).toBeTruthy();
});

it("a failing status call never hides the app", async () => {
  getOfflineStatus.mockRejectedValue(new Error("boom"));
  render(
    <OfflineGate>
      <App />
    </OfflineGate>,
  );
  expect(await screen.findByText("THE APP")).toBeTruthy();
});
