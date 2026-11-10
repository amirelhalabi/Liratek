/** @jest-environment jsdom */

/**
 * LIRA-377 Settings › Backup › Restore (web app, admins).
 *
 * Written failing-first (rule 17): `../ShopRestorePanel` did not exist on the
 * first run. Payloads are checked against the core schemas' own parse
 * (rule 24). Stable, module-level `useApi` mock (rule 25).
 */
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { prepareRestoreSchema, confirmRestoreSchema } from "@liratek/core";
import ShopRestorePanel from "../ShopRestorePanel";
import { isoToLocalInput, localInputToUtcIso, browserTzOffsetMin } from "../restoreTime";

const mockGetPoints = jest.fn();
const mockPrepare = jest.fn();
const mockUpload = jest.fn();
const mockConfirm = jest.fn();
const mockCancel = jest.fn();
const mockApi = {
  getRestorePoints: mockGetPoints,
  prepareRestore: mockPrepare,
  uploadRestoreFile: mockUpload,
  confirmRestore: mockConfirm,
  cancelRestore: mockCancel,
};
jest.mock("@liratek/ui", () => ({ useApi: () => mockApi }));

let mockElectron = false;
jest.mock("@/api/backendApi", () => ({ isElectron: () => mockElectron }));

let mockRole = "admin";
const mockLogout = jest.fn(async () => undefined);
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "owner", role: mockRole }, logout: mockLogout }),
}));

const POINTS = {
  earliest: "2026-11-03T12:40:10Z",
  latest: "2026-11-10T12:39:30Z",
  beforeCopies: [{ restoreId: 12, takenAt: "2026-11-10T12:20:04Z", byName: "owner" }],
  lastRestore: null,
  shopName: "CornerTech",
};

const PREPARED = {
  restoreId: 13,
  expiresAt: "2026-11-10T12:55:00Z",
  preview: {
    restoredTo: "2026-11-10T12:00:00Z",
    lastSaleInCopy: { at: "2026-11-10T11:58:41Z", amount: 12.5, currency: "USD", client: "Rami" },
    lost: {
      sales: { count: 3, totalUsd: 50 },
      payments: 5,
      expenses: 1,
      dayClosings: 1,
      checkpoints: 2,
      settlements: { suppliers: 1, partners: 0, loto: 0 },
      moneyIn: [
        { currency: "LBP", amount: 900000 },
        { currency: "USD", amount: 50 },
      ],
      moneyOut: [{ currency: "USD", amount: 9 }],
    },
    youAreMissing: false,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockElectron = false;
  mockRole = "admin";
  mockGetPoints.mockResolvedValue({ success: true, data: POINTS });
  mockPrepare.mockResolvedValue({ success: true, data: PREPARED });
  mockUpload.mockResolvedValue({ success: true, data: PREPARED });
  mockCancel.mockResolvedValue({ success: true, data: {} });
});

async function openTimePreview() {
  render(<ShopRestorePanel />);
  const picker = (await screen.findByLabelText(/restore to this date and time/i)) as HTMLInputElement;
  fireEvent.change(picker, { target: { value: isoToLocalInput("2026-11-10T12:00:00Z") } });
  fireEvent.click(screen.getByRole("button", { name: /show what will change/i }));
  return screen.findByTestId("restore-preview");
}

describe("ShopRestorePanel", () => {
  it("renders nothing for staff or on the desktop app, and asks nothing", () => {
    mockRole = "staff";
    const first = render(<ShopRestorePanel />);
    expect(first.container.innerHTML).toBe("");
    first.unmount();
    mockRole = "admin";
    mockElectron = true;
    const second = render(<ShopRestorePanel />);
    expect(second.container.innerHTML).toBe("");
    expect(mockGetPoints).not.toHaveBeenCalled();
  });

  it("limits the picker to the window, in local time, and sends UTC + the browser offset", async () => {
    await openTimePreview();
    const picker = screen.getByLabelText(/restore to this date and time/i) as HTMLInputElement;
    expect(picker.min).toBe(isoToLocalInput(POINTS.earliest, true));
    expect(picker.max).toBe(isoToLocalInput(POINTS.latest));
    const payload = {
      kind: "time" as const,
      restoredTo: localInputToUtcIso(isoToLocalInput("2026-11-10T12:00:00Z")),
      clientTzOffsetMin: browserTzOffsetMin(),
    };
    expect(mockPrepare).toHaveBeenCalledWith(prepareRestoreSchema.parse(payload));
    expect(mockPrepare.mock.calls[0][0].restoredTo).toMatch(/Z$/);
  });

  it("lists the before-restore copy first, and its Restore prepares an undo", async () => {
    render(<ShopRestorePanel />);
    const row = await screen.findByTestId("restore-before-copy-12");
    expect(row.textContent).toMatch(/before restore/i);
    expect(row.textContent).toMatch(/owner/);
    // listed before the time picker
    const picker = screen.getByLabelText(/restore to this date and time/i);
    expect(row.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /restore/i }));
    await screen.findByTestId("restore-preview");
    expect(mockPrepare).toHaveBeenCalledWith(
      prepareRestoreSchema.parse({ kind: "undo", restoreId: 12, clientTzOffsetMin: browserTzOffsetMin() }),
    );
  });

  it("shows what will be lost with Money in and Money out as separate lines, never netted", async () => {
    const preview = await openTimePreview();
    const sales = within(preview).getByTestId("restore-lost-sales");
    expect(sales.textContent).toMatch(/3/);
    expect(sales.textContent).toMatch(/\$50/);
    const moneyIn = within(preview).getByTestId("restore-lost-money-in");
    expect(moneyIn.textContent).toMatch(/900,000 LBP/);
    expect(moneyIn.textContent).toMatch(/\$50/);
    const moneyOut = within(preview).getByTestId("restore-lost-money-out");
    expect(moneyOut.textContent).toMatch(/\$9/);
    expect(moneyOut.textContent).not.toMatch(/\$41/); // 50 − 9 never shown
    expect(preview.textContent).not.toMatch(/\$41/);
    expect(within(preview).getByTestId("restore-lost-expenses").textContent).toMatch(/1/);
    expect(within(preview).getByTestId("restore-lost-day-closings").textContent).toMatch(/1/);
    expect(within(preview).getByTestId("restore-lost-checkpoints").textContent).toMatch(/2/);
    const settlements = within(preview).getByTestId("restore-lost-settlements");
    expect(settlements.textContent).toMatch(/supplier/i);
    expect(settlements.textContent).not.toMatch(/partner/i); // 0 → no sub-line
    expect(preview.textContent).toMatch(/Rami/);
    expect(preview.textContent).toMatch(/\$12\.5/);
  });

  it("warns when the admin's own account is not in the copy", async () => {
    mockPrepare.mockResolvedValue({
      success: true,
      data: { ...PREPARED, preview: { ...PREPARED.preview, youAreMissing: true } },
    });
    const preview = await openTimePreview();
    expect(preview.textContent).toMatch(/your account does not exist in this copy/i);
  });

  it("keeps Restore disabled until the shop name is typed exactly, then signs out", async () => {
    mockConfirm.mockResolvedValue({
      success: true,
      data: { restoreId: 13, restoredTo: "2026-11-10T12:00:00Z", beforeCopy: { takenAt: "2026-11-10T12:50:00Z" } },
    });
    const preview = await openTimePreview();
    const confirm = within(preview).getByRole("button", { name: /^restore the shop$/i }) as HTMLButtonElement;
    const name = within(preview).getByLabelText(/type the shop's name/i);
    expect(confirm.disabled).toBe(true);
    fireEvent.change(name, { target: { value: "cornertech" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(name, { target: { value: "CornerTech " } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(name, { target: { value: "CornerTech" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(await screen.findByText(/restored — please sign in again/i)).toBeTruthy();
    expect(mockConfirm).toHaveBeenCalledWith(confirmRestoreSchema.parse({ restoreId: 13, typedShopName: "CornerTech" }));
    fireEvent.click(screen.getByRole("button", { name: /sign in again/i }));
    await waitFor(() => expect(mockLogout).toHaveBeenCalled());
  });

  it("Cancel drops the prepared restore and returns to the picker", async () => {
    const preview = await openTimePreview();
    fireEvent.click(within(preview).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByTestId("restore-preview")).toBeNull());
    expect(mockCancel).toHaveBeenCalledWith({ restoreId: 13 });
  });

  it("uploads a file with the browser offset; OTHER_SHOP names the other shop", async () => {
    mockUpload.mockResolvedValue({ success: false, code: "OTHER_SHOP", error: "OTHER_SHOP", shopName: "Canary Phones" });
    render(<ShopRestorePanel />);
    const input = (await screen.findByLabelText(/restore from a file/i)) as HTMLInputElement;
    const file = new File(["SQLite format 3"], "liratek-cornertech.db");
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(mockUpload).toHaveBeenCalledWith(file, browserTzOffsetMin());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Canary Phones/);
    expect(alert.textContent).not.toMatch(/OTHER_SHOP/);
  });

  it("turns an error code into a plain message, even when it arrives as `error`", async () => {
    mockPrepare.mockResolvedValue({ success: false, error: "OUT_OF_WINDOW" });
    render(<ShopRestorePanel />);
    const picker = await screen.findByLabelText(/restore to this date and time/i);
    fireEvent.change(picker, { target: { value: isoToLocalInput("2026-11-10T12:00:00Z") } });
    fireEvent.click(screen.getByRole("button", { name: /show what will change/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/OUT_OF_WINDOW/);
    expect(alert.textContent).toMatch(/last 7 days/i);
  });
});
