/** @jest-environment jsdom */

/**
 * LIRA-306 T074 — Settings › Paired PCs (web app, FR-002): each PC's name,
 * number, last seen, state, waiting work and app version; Unpair asks to
 * confirm, then revokes by id and reloads. Stable `useApi` mock (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PairedDeviceView } from "@liratek/core";
import PairedPcsPanel from "../PairedPcsPanel";

const mockGetPairedPcs = jest.fn();
const mockRevokePairedPc = jest.fn();
const mockApi = { getPairedPcs: mockGetPairedPcs, revokePairedPc: mockRevokePairedPc };
jest.mock("@liratek/ui", () => ({ useApi: () => mockApi }));

const pc = (over: Partial<PairedDeviceView>): PairedDeviceView => ({
  id: 1,
  deviceNo: 1,
  name: "Front PC",
  pairedAt: "2026-10-01T08:00:00.000Z",
  lastSeenAt: "2026-10-11T09:00:00.000Z",
  state: "standby",
  pendingCount: 0,
  appVersion: "2.4.0",
  revokedAt: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPairedPcs.mockResolvedValue({
    success: true,
    data: { devices: [pc({}), pc({ id: 2, deviceNo: 2, name: "Back PC", state: "offline", pendingCount: 7, appVersion: "2.3.9" }), pc({ id: 3, deviceNo: 3, name: "Old PC", revokedAt: "2026-10-05T08:00:00.000Z" })] },
  });
  mockRevokePairedPc.mockResolvedValue({ success: true, data: { revoked: true } });
});

describe("PairedPcsPanel", () => {
  it("lists name, number, state, waiting work and version", async () => {
    render(<PairedPcsPanel />);
    expect(await screen.findByText("Back PC")).toBeTruthy();
    const row = screen.getByText("Back PC").closest("tr")!;
    expect(row.textContent).toMatch(/PC 2/);
    expect(row.textContent).toMatch(/Working offline/);
    expect(row.textContent).toMatch(/7 waiting/);
    expect(row.textContent).toMatch(/2\.3\.9/);
    expect(screen.getByText("Old PC").closest("tr")!.textContent).toMatch(/Unpaired/);
  });

  it("Unpair asks to confirm, then revokes by id and reloads; an unpaired PC has no button", async () => {
    render(<PairedPcsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Unpair Front PC" }));
    expect(mockRevokePairedPc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mockRevokePairedPc).toHaveBeenCalledWith(1));
    await waitFor(() => expect(mockGetPairedPcs).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Unpair Old PC" })).toBeNull();
  });
});
