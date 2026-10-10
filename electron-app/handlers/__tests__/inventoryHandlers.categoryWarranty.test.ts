/**
 * LIRA-296 (T017) — `inventory:update-category` forwards the category's
 * default warranty (`warranty_months`, 0–60 or null) to the repository, and
 * the shared schema refuses an out-of-range value before it gets there.
 * Rule 23: the schema key, the preload type and the forwarded field all
 * carry `warranty_months`.
 */
import { ipcMain } from "electron";
import { registerInventoryHandlers } from "../inventoryHandlers";
import {
  getInventoryService,
  getCategoryRepository,
  getProductSupplierRepository,
} from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({ ipcMain: { handle: jest.fn() } }));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getInventoryService: jest.fn(),
    getCategoryRepository: jest.fn(),
    getProductSupplierRepository: jest.fn(),
  };
});

jest.mock("../../session", () => ({ requireRole: jest.fn() }));
jest.mock("../auditHelper", () => ({ audit: jest.fn() }));

describe("inventory:update-category — warranty_months (LIRA-296)", () => {
  const catRepo = {
    getNames: jest.fn(),
    getAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn().mockReturnValue(true),
    delete: jest.fn(),
  };
  let handlers: Map<string, (...args: any[]) => any>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((ch, fn) =>
      handlers.set(ch, fn),
    );
    (getInventoryService as jest.Mock).mockReturnValue({});
    (getCategoryRepository as jest.Mock).mockReturnValue(catRepo);
    (getProductSupplierRepository as jest.Mock).mockReturnValue({});
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 1 });
    registerInventoryHandlers();
  });

  it("forwards warranty_months to the repository", async () => {
    const result = await handlers.get("inventory:update-category")!(
      { sender: { id: 1 } },
      3,
      { warranty_months: 1 },
    );
    expect(result).toEqual({ success: true, updated: true });
    expect(catRepo.update).toHaveBeenCalledWith(3, {
      name: undefined,
      tracksImeiUnits: undefined,
      warrantyMonths: 1,
    });
  });

  it("forwards null (no default warranty)", async () => {
    await handlers.get("inventory:update-category")!({ sender: { id: 1 } }, 3, {
      warranty_months: null,
    });
    expect(catRepo.update.mock.calls[0][1]).toHaveProperty(
      "warrantyMonths",
      null,
    );
  });

  it("refuses more than 60 months without touching the repository", async () => {
    const result = await handlers.get("inventory:update-category")!(
      { sender: { id: 1 } },
      3,
      { warranty_months: 61 },
    );
    expect(result.success).toBe(false);
    expect(catRepo.update).not.toHaveBeenCalled();
  });

  it("LIRA-296 P3: forwards serial_label and serial_required (rule 23)", async () => {
    const result = await handlers.get("inventory:update-category")!(
      { sender: { id: 1 } },
      3,
      { serial_label: "IMEI", serial_required: "WARN" },
    );
    expect(result).toEqual({ success: true, updated: true });
    expect(catRepo.update.mock.calls[0][1]).toMatchObject({
      serialLabel: "IMEI",
      serialRequired: "WARN",
    });
  });

  it("LIRA-296 P3: refuses an unknown serial rule before the repository", async () => {
    const result = await handlers.get("inventory:update-category")!(
      { sender: { id: 1 } },
      3,
      { serial_required: "MAYBE" },
    );
    expect(result.success).toBe(false);
    expect(catRepo.update).not.toHaveBeenCalled();
  });
});
