/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UpdatesPanel from "../UpdatesPanel";

// Mock appEvents so we can assert notification calls
const emitMock = jest.fn();
jest.mock("@liratek/ui", () => ({
  appEvents: { emit: (...args: unknown[]) => emitMock(...args) },
}));

describe("UpdatesPanel", () => {
  beforeEach(() => {
    emitMock.mockClear();
    (window as any).api = {
      updater: {
        getStatus: jest.fn().mockResolvedValue({
          packaged: false,
          platform: "darwin",
          version: "1.0.0",
          devMode: true,
        }),
        check: jest.fn().mockResolvedValue({ success: true, updateInfo: null }),
        download: jest.fn().mockResolvedValue({ success: true }),
        quitAndInstall: jest.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).api;
  });

  it("renders and shows updater status", async () => {
    render(<UpdatesPanel />);

    expect(await screen.findByText(/Updater:/)).toBeInTheDocument();
    expect(screen.getByText(/Dev mode/)).toBeInTheDocument();
  });

  it("check calls updater.check and shows dev release info", async () => {
    (window as any).api.updater.check.mockResolvedValue({
      success: true,
      devMode: true,
      updateInfo: {
        version: "1.0.1",
        releaseDate: "2026-03-04T00:00:00Z",
      },
    });

    render(<UpdatesPanel />);

    // No auto-check on mount — user must click "Check for Updates"
    fireEvent.click(await screen.findByText("Check for Updates"));

    expect(await screen.findByText("v1.0.1")).toBeInTheDocument();
  });

  it("check shows packaged update info as JSON and shows Download button", async () => {
    (window as any).api.updater.getStatus.mockResolvedValue({
      packaged: true,
      platform: "win32",
      version: "1.0.0",
    });
    (window as any).api.updater.check.mockResolvedValue({
      success: true,
      updateInfo: { version: "1.0.1" },
    });

    render(<UpdatesPanel />);

    // Download button should NOT be visible before check
    expect(screen.queryByText("Download")).not.toBeInTheDocument();

    // Must click to trigger check
    fireEvent.click(await screen.findByText("Check for Updates"));

    expect(await screen.findByText(/"version": "1\.0\.1"/)).toBeInTheDocument();
    // Download button should now be visible
    expect(screen.getByText("Download")).toBeInTheDocument();
    // Install button should NOT be visible yet
    expect(screen.queryByText("Install & Restart")).not.toBeInTheDocument();
  });

  it("check shows error notification on failure", async () => {
    (window as any).api.updater.check.mockResolvedValue({
      success: false,
      error: "boom",
    });

    render(<UpdatesPanel />);

    // No auto-check — user must click button
    fireEvent.click(await screen.findByText("Check for Updates"));

    await waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(
        "notification:show",
        "boom",
        "error",
      );
    });
  });

  it("download shows error notification on failure", async () => {
    // Packaged mode so Download button can appear
    (window as any).api.updater.getStatus.mockResolvedValue({
      packaged: true,
      platform: "win32",
      version: "1.0.0",
    });
    // Check returns an update available
    (window as any).api.updater.check.mockResolvedValue({
      success: true,
      updateInfo: { version: "1.0.1" },
    });
    (window as any).api.updater.download.mockResolvedValueOnce({
      success: false,
      error: "download failed",
    });

    render(<UpdatesPanel />);

    // First check for updates to make Download button appear
    fireEvent.click(await screen.findByText("Check for Updates"));
    // Wait for Download button to appear
    fireEvent.click(await screen.findByText("Download"));

    await waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(
        "notification:show",
        "download failed",
        "error",
      );
    });
  });
});
