/** @jest-environment jsdom */
/**
 * LIRA-306 T139 — the banner a PC shows while it works offline (plan diagram
 * B, O-new-17): how many actions wait to be sent, "Internet is back — Back to
 * the web app" once the server answers, the online-only rule in plain words,
 * and (finishing) that new actions wait. Plus the offline receipt number:
 * an offline sale's receipt is `RCP-<offline id>` and still parses back
 * (FR-040 — the web resolves it through the id map).
 *
 * The useApi mock returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { OfflineStatusView } from "@liratek/core";
import {
  encodeOfflineId,
  offlineTableIndex,
  parseReceiptNumber,
  receiptNumberFor,
} from "@liratek/core";

const api = {
  backToWeb: jest.fn(async () => ({ success: true })),
  sendOfflineNow: jest.fn(async () => ({
    success: true,
    data: { sent: 3, waiting: 0 },
  })),
};
jest.mock("@liratek/ui", () => ({ useApi: () => api }));

import { OfflineBanner } from "../OfflineBanner";

const OFFLINE: OfflineStatusView = {
  mode: "offline",
  paired: true,
  deviceNo: 3,
  shopName: "Corner Tech",
  serverReachable: false,
  unreachableSeconds: 600,
  pendingCount: 4,
};

beforeEach(() => jest.clearAllMocks());

describe("OfflineBanner", () => {
  it("offline, no internet: says offline and how many actions wait", () => {
    render(<OfflineBanner status={OFFLINE} onChanged={jest.fn()} />);
    expect(screen.getByText(/working offline/i)).toBeTruthy();
    expect(screen.getByText(/4 actions waiting/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /back to the web app/i }),
    ).toBeNull();
  });

  it("states the online-only rule in plain words", () => {
    render(<OfflineBanner status={OFFLINE} onChanged={jest.fn()} />);
    expect(
      screen.getByText(/settings, users.*not available offline/i),
    ).toBeTruthy();
  });

  it("internet back: 'Back to the web app' calls backToWeb; 'Send now' uploads", async () => {
    render(
      <OfflineBanner
        status={{ ...OFFLINE, serverReachable: true, unreachableSeconds: 0 }}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText(/internet is back/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /send now/i }));
    await waitFor(() => expect(api.sendOfflineNow).toHaveBeenCalledTimes(1));
    fireEvent.click(
      screen.getByRole("button", { name: /back to the web app/i }),
    );
    await waitFor(() => expect(api.backToWeb).toHaveBeenCalledTimes(1));
  });

  it("a refused back-to-web shows why", async () => {
    api.backToWeb.mockResolvedValueOnce({
      success: false,
      error: "The internet is not back yet",
    } as never);
    render(
      <OfflineBanner
        status={{ ...OFFLINE, serverReachable: true }}
        onChanged={jest.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /back to the web app/i }),
    );
    expect(await screen.findByText(/not back yet/)).toBeTruthy();
  });

  it("finishing: new actions wait while the rest is sent", () => {
    render(
      <OfflineBanner
        status={{ ...OFFLINE, mode: "finishing", serverReachable: true }}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText(/sending the offline work/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /back to the web app/i }),
    ).toBeNull();
  });
});

describe("offline receipt number (FR-040, O-new-10)", () => {
  it("an offline sale prints RCP-<offline id>, which parses back to that id", () => {
    const saleId = encodeOfflineId(3, offlineTableIndex("sales"), 5);
    const receipt = receiptNumberFor(saleId);
    expect(receipt).toBe(`RCP-${saleId}`);
    expect(parseReceiptNumber(receipt)).toBe(saleId);
    // the largest possible offline id still parses
    const max = encodeOfflineId(9006, 999, 999_999_999);
    expect(parseReceiptNumber(receiptNumberFor(max))).toBe(max);
  });
});
