// Tests behavior of currencies:create handler

/**
 * Revived 2026-09-13 (rotted test suite).
 *
 * What had drifted: mocked `../../db`'s `getDatabase()` and drove the
 * "unique violation" case by having a shared `stmt.run()` mock throw a raw
 * `SQLITE_CONSTRAINT_UNIQUE` error — but `currencies:create` never touches
 * the database directly; it delegates to `CurrencyService.createCurrency`
 * (`@liratek/core`), which ALREADY catches `SQLITE_CONSTRAINT_UNIQUE` /
 * `DUPLICATE_CURRENCY_CODE` and normalizes it to
 * `{ success: false, error: "Currency code already exists" }` before the
 * handler ever sees it — `currencies:create` has no try/catch of its own
 * (see `currencyHandlers.ts`). Repointed at `@liratek/core`'s
 * `getCurrencyService` getter (jest.requireActual + override), matching
 * `exchangeLotHandlers.test.ts` in this same folder; the test now configures
 * the mocked SERVICE's `createCurrency` to return that already-normalized
 * result instead of simulating a raw driver error the handler was never
 * responsible for catching.
 */

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getCurrencyService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

import { ipcMain as originalIpcMain } from "electron";
import { getCurrencyService } from "@liratek/core";
import { requireRole } from "../../session";
import { registerCurrencyHandlers } from "../currencyHandlers";

const ipcMain = originalIpcMain as unknown as { handle: jest.Mock };

describe("currencies:create behavior", () => {
  const mockCurrencyService = {
    listCurrencies: jest.fn(),
    createCurrency: jest.fn(),
    updateCurrency: jest.fn(),
    deleteCurrency: jest.fn(),
    getModulesForCurrency: jest.fn(),
    getCurrenciesForModule: jest.fn(),
    setModulesForCurrency: jest.fn(),
    getAllDrawerCurrencies: jest.fn(),
    getCountableCurrenciesByDrawer: jest.fn(),
    getCurrenciesForDrawer: jest.fn(),
    getFullCurrenciesForDrawer: jest.fn(),
    getDrawersForCurrency: jest.fn(),
    setCurrenciesForDrawer: jest.fn(),
    getConfiguredDrawerNames: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (getCurrencyService as jest.Mock).mockReturnValue(mockCurrencyService);
    (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });

    registerCurrencyHandlers();
  });

  it("returns error on unique violation", async () => {
    mockCurrencyService.createCurrency.mockReturnValue({
      success: false,
      error: "Currency code already exists",
    });

    const call = ipcMain.handle.mock.calls.find(
      (c: any) => c[0] === "currencies:create",
    );
    const handler = call[1];
    const mockEvent = { sender: { id: 1 } };
    const res = await handler(mockEvent, { code: "usd", name: "US Dollar" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already exists/i);
    expect(mockCurrencyService.createCurrency).toHaveBeenCalledWith({
      code: "usd",
      name: "US Dollar",
    });
  });
});
