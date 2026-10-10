/**
 * LIRA-297 (scope item 3) — the currency, payment-method and from-drawer
 * top-up IPC channels now validate with the SAME core schema their REST twin
 * runs (rule 14). Pins:
 *  - currencies:update validates the FIELDS only, so the `id` the preload
 *    puts in the payload still reaches the service (a schema without `id`
 *    would otherwise strip it — rule 23);
 *  - each channel forwards every schema key and refuses a malformed payload
 *    before touching the service.
 *
 * Fixtures are written against the schemas' own input types (rule 24). These
 * annotations are documentation only — electron-app's tsconfig excludes
 * `__tests__`; the compile-checked key guard lives in
 * packages/core/src/validators/__tests__/settingsWriteSchemas.test.ts.
 */

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getCurrencyService: jest.fn(),
    getPaymentMethodService: jest.fn(),
    getDrawerTopUpService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

import { ipcMain as originalIpcMain } from "electron";
import {
  getCurrencyService,
  getPaymentMethodService,
  getDrawerTopUpService,
  type UpdateCurrencyPayload,
  type CreatePaymentMethodPayload,
  type DrawerTopUpFromDrawerPayload,
} from "@liratek/core";
import { requireRole } from "../../session";
import { registerCurrencyHandlers } from "../currencyHandlers";
import { registerPaymentMethodHandlers } from "../paymentMethodHandlers";
import { registerDrawerTopUpHandlers } from "../drawerTopUpHandlers";

const ipcMain = originalIpcMain as unknown as { handle: jest.Mock };
const event = { sender: { id: 1 } };

function handlerFor(channel: string) {
  const call = ipcMain.handle.mock.calls.find(
    (c: unknown[]) => c[0] === channel,
  );
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as (...args: unknown[]) => Promise<any> | any;
}

const currencyService = {
  createCurrency: jest.fn(),
  updateCurrency: jest.fn(),
};
const paymentMethodService = {
  create: jest.fn(),
  update: jest.fn(),
};
const drawerTopUpService = {
  topUpFromDrawer: jest.fn(),
  addTopUp: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 7 });
  (getCurrencyService as jest.Mock).mockReturnValue(currencyService);
  (getPaymentMethodService as jest.Mock).mockReturnValue(paymentMethodService);
  (getDrawerTopUpService as jest.Mock).mockReturnValue(drawerTopUpService);
  registerCurrencyHandlers();
  registerPaymentMethodHandlers();
  registerDrawerTopUpHandlers();
});

describe("currencies:update", () => {
  it("keeps the id (passed separately) and forwards every schema field", async () => {
    currencyService.updateCurrency.mockReturnValue({ success: true });
    const fields = {
      code: "EUR",
      name: "Euro",
      symbol: "€",
      decimal_places: 2,
      is_active: 0,
    } satisfies UpdateCurrencyPayload;

    const res = await handlerFor("currencies:update")(event, {
      id: 5,
      ...fields,
    });

    expect(res).toEqual({ success: true });
    expect(currencyService.updateCurrency).toHaveBeenCalledWith(5, fields);
  });

  it("refuses a non-numeric is_active without reaching the service", async () => {
    const res = await handlerFor("currencies:update")(event, {
      id: 5,
      is_active: "yes",
    });

    expect(res.success).toBe(false);
    expect(currencyService.updateCurrency).not.toHaveBeenCalled();
  });
});

describe("payment-methods:create", () => {
  it("forwards every schema key (incl. sort_order)", async () => {
    paymentMethodService.create.mockReturnValue({ success: true, id: 3 });
    const payload = {
      code: "CARD",
      label: "Card",
      drawer_name: "General",
      affects_drawer: 0,
      sort_order: 2,
    } satisfies CreatePaymentMethodPayload;

    const res = await handlerFor("payment-methods:create")(event, payload);

    expect(res).toEqual({ success: true, id: 3 });
    expect(paymentMethodService.create).toHaveBeenCalledWith(payload);
  });

  it("refuses a missing drawer_name without reaching the service", async () => {
    const res = await handlerFor("payment-methods:create")(event, {
      code: "CARD",
      label: "Card",
    });

    expect(res.success).toBe(false);
    expect(paymentMethodService.create).not.toHaveBeenCalled();
  });
});

describe("drawer-topup:create-from-drawer", () => {
  it("forwards every schema key (incl. transaction_time) with the session user", async () => {
    drawerTopUpService.topUpFromDrawer.mockReturnValue({
      success: true,
      id: 9,
    });
    const payload = {
      amount_usd: 5,
      amount_lbp: 450000,
      source_drawer: "MTC",
      notes: "n",
      transaction_time: "2026-10-01T08:00:00.000Z",
    } satisfies DrawerTopUpFromDrawerPayload;

    const res = await handlerFor("drawer-topup:create-from-drawer")(
      event,
      payload,
    );

    expect(res).toEqual({ success: true, id: 9 });
    expect(drawerTopUpService.topUpFromDrawer).toHaveBeenCalledWith(payload, 7);
  });

  it("refuses a negative amount (used to reach the service unvalidated)", async () => {
    const res = await handlerFor("drawer-topup:create-from-drawer")(event, {
      amount_usd: -5,
      amount_lbp: 450000,
      source_drawer: "MTC",
    });

    expect(res.success).toBe(false);
    expect(drawerTopUpService.topUpFromDrawer).not.toHaveBeenCalled();
  });
});
