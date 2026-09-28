/**
 * LIRA-220 — db:update-setting / settings:update must not write an
 * `audit_log` row for a write that never happened.
 *
 * `SettingsService.updateSetting` refuses a `SENSITIVE_SETTING_KEYS` write
 * by returning `{ success: false }` (never throwing) — before this fix, both
 * IPC channels below called `audit(...)` UNCONDITIONALLY, so a rejected
 * write still persisted an audit row. `backend/src/api/settings.ts`'s
 * `PUT /:key` already guards this correctly (`if (!result.success) return`
 * before `auditRest`); this brings the IPC twins to parity (rule 19c).
 *
 * Mocking follows `dbHandlers_registration.test.ts`'s established pattern
 * (mock electron, partially mock @liratek/core, mock session.js/auditHelper.js).
 *
 * Rule 17: written and run FIRST against the unconditional `audit(...)`
 * call — see the recorded failure (both "writes NO audit row when rejected"
 * cases failed because `audit` WAS called) before the `if (result.success)`
 * guard was added.
 */

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
  app: { getPath: jest.fn(() => "/tmp"), isPackaged: false },
  dialog: { showOpenDialog: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSettingsService: jest.fn(),
    getExpenseService: jest.fn(),
    getClosingService: jest.fn(),
    getActivityService: jest.fn(),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session.js", () => ({
  requireRole: jest.fn(() => ({ ok: true, userId: 7 })),
}));

jest.mock("../auditHelper.js", () => ({
  audit: jest.fn(),
}));

import { getSettingsService } from "@liratek/core";
import { audit } from "../auditHelper.js";

type IpcHandler = (
  event: { sender: { id: number } },
  ...args: unknown[]
) => unknown;

function getHandler(channel: string): IpcHandler {
  const { ipcMain } = require("electron");
  const mod = require("../dbHandlers");
  mod.registerDatabaseHandlers();
  const call = (ipcMain.handle as jest.Mock).mock.calls.find(
    (c: unknown[]) => c[0] === channel,
  );
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as IpcHandler;
}

const fakeEvent = { sender: { id: 1 } };

describe("dbHandlers — db:update-setting / settings:update audit only a write that actually happened (LIRA-220)", () => {
  let updateSetting: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    updateSetting = jest.fn();
    (getSettingsService as jest.Mock).mockReturnValue({
      getAllSettings: jest.fn(),
      getSettingValue: jest.fn(),
      updateSetting,
    });
  });

  for (const channel of ["db:update-setting", "settings:update"] as const) {
    describe(channel, () => {
      it("writes NO audit row when the update is rejected", async () => {
        updateSetting.mockReturnValue({
          success: false,
          error: "Setting 'profits_password_hash' cannot be written through the generic settings pipe",
        });
        const handler = getHandler(channel);

        const result = await handler(
          fakeEvent,
          "profits_password_hash",
          "attacker-supplied-value",
        );

        expect(result).toEqual({
          success: false,
          error:
            "Setting 'profits_password_hash' cannot be written through the generic settings pipe",
        });
        expect(audit).not.toHaveBeenCalled();
      });

      it("still writes an audit row when the update succeeds", async () => {
        updateSetting.mockReturnValue({ success: true });
        const handler = getHandler(channel);

        const result = await handler(fakeEvent, "shop_base_system", "WHISH");

        expect(result).toEqual({ success: true });
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit).toHaveBeenCalledWith(
          1,
          expect.objectContaining({
            action: "update",
            entity_type: "setting",
            entity_id: "shop_base_system",
          }),
        );
      });
    });
  }
});
