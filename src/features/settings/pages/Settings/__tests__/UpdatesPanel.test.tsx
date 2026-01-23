/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";
import UpdatesPanel from "../UpdatesPanel";

describe("UpdatesPanel", () => {
  beforeEach(() => {
    (window as any).api = {
      updater: {
        getStatus: jest
          .fn()
          .mockResolvedValue({ packaged: false, platform: "darwin", version: "1.0.0" }),
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
    expect(screen.getByText(/Disabled \(dev mode\)/)).toBeInTheDocument();
  });

  it("check calls updater.check and shows update info", async () => {
    (window as any).api.updater.check.mockResolvedValueOnce({
      success: true,
      updateInfo: { version: "1.0.1" },
    });

    const { fireEvent } = await import("@testing-library/react");

    render(<UpdatesPanel />);

    fireEvent.click(await screen.findByText("Check for Updates"));

    expect(await screen.findByText(/"version": "1\.0\.1"/)).toBeInTheDocument();
  });

  it("check shows error on failure", async () => {
    (window as any).api.updater.check.mockResolvedValueOnce({
      success: false,
      error: "boom",
    });

    const { fireEvent } = await import("@testing-library/react");

    render(<UpdatesPanel />);

    fireEvent.click(await screen.findByText("Check for Updates"));

    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("download shows error on failure", async () => {
    (window as any).api.updater.download.mockResolvedValueOnce({
      success: false,
      error: "download failed",
    });

    const { fireEvent } = await import("@testing-library/react");

    render(<UpdatesPanel />);

    fireEvent.click(await screen.findByText("Download"));

    expect(await screen.findByText(/download failed/i)).toBeInTheDocument();
  });
});
