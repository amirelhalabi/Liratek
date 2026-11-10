/** @jest-environment jsdom */

/**
 * Settings › Backup (web app, admins): "Download backup" asks the adapter for
 * the shop's own copy, stamped with THIS browser's local time (rule 27), and
 * saves it through a blob object URL under the server's file name.
 *
 * Written failing-first (rule 17): `../ShopBackupPanel` did not exist on the
 * first run. Stable `useApi` mock (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShopBackupPanel from "../ShopBackupPanel";

const mockDownload = jest.fn();
const mockApi = { downloadShopBackup: mockDownload };
jest.mock("@liratek/ui", () => ({ useApi: () => mockApi }));

let mockElectron = false;
jest.mock("@/api/backendApi", () => ({ isElectron: () => mockElectron }));

let mockRole = "admin";
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "owner", role: mockRole } }),
}));

const createObjectURL = jest.fn(() => "blob:backup");
const revokeObjectURL = jest.fn();
let clickedDownload: string | null = null;

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clickedDownload = this.download;
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockElectron = false;
  mockRole = "admin";
  clickedDownload = null;
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  // 14:30 local time on 10 Nov 2026
  jest.setSystemTime(new Date(2026, 10, 10, 14, 30, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ShopBackupPanel", () => {
  it("downloads the shop's backup with the browser's local stamp and the server's file name", async () => {
    const blob = new Blob(["SQLite format 3"]);
    mockDownload.mockResolvedValue({ success: true, data: { blob, fileName: "liratek-cornertech-2026-11-10-1430.db" } });
    render(<ShopBackupPanel />);
    fireEvent.click(screen.getByRole("button", { name: /download backup/i }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith({ stamp: "2026-11-10-1430" }));
    await waitFor(() => expect(clickedDownload).toBe("liratek-cornertech-2026-11-10-1430.db"));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    // revoked later, so the browser has started the download first
    expect(revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup");
  });

  it("shows the server's error and no download", async () => {
    mockDownload.mockResolvedValue({ success: false, error: "Could not prepare the backup" });
    render(<ShopBackupPanel />);
    fireEvent.click(screen.getByRole("button", { name: /download backup/i }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not prepare the backup");
    expect(clickedDownload).toBeNull();
  });

  it("disables the button while the backup is being prepared", async () => {
    let resolve: (v: unknown) => void = () => {};
    mockDownload.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ShopBackupPanel />);
    const button = screen.getByRole("button", { name: /download backup/i });
    fireEvent.click(button);
    await waitFor(() => expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true));
    resolve({ success: false, error: "x" });
    await waitFor(() => expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false));
  });

  it("renders nothing on the desktop app or for a non-admin", () => {
    mockElectron = true;
    const { container, unmount } = render(<ShopBackupPanel />);
    expect(container.innerHTML).toBe("");
    unmount();
    mockElectron = false;
    mockRole = "staff";
    const second = render(<ShopBackupPanel />);
    expect(second.container.innerHTML).toBe("");
  });
});
