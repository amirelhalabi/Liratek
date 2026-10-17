// electron-app/handlers/__tests__/userPreferencesHandlers.test.ts
//
// LIRA-331 T011 — `user-preferences:get` / `user-preferences:set-language`,
// the desktop mirror of GET /api/user-preferences/me and
// PUT /api/user-preferences/me/language (rule 19). The user comes from the
// desktop session guard (requireRole), never from the payload; the payload is
// validated against core's `setMyLanguageSchema` (rule 24: fixtures parsed
// through it).

import { ipcMain } from "electron";
import { registerUserPreferencesHandlers } from "../userPreferencesHandlers";
import {
  getUserPreferencesService,
  setMyLanguageSchema,
  type MyPreferences,
} from "@liratek/core";
import { requireRole } from "../../session";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return { ...actual, getUserPreferencesService: jest.fn() };
});

jest.mock("../../session", () => ({ requireRole: jest.fn() }));

const PREFS: MyPreferences = {
  language: "ar",
  effectiveLanguage: "ar",
  shopDefaultLanguage: "en",
  receiptLanguage: "en",
};

describe("user-preferences IPC (LIRA-331)", () => {
  let getMine: jest.Mock;
  let setMine: jest.Mock;
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  const event = { sender: { id: 1 } };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    getMine = jest.fn(() => PREFS);
    setMine = jest.fn(() => PREFS);
    (getUserPreferencesService as jest.Mock).mockReturnValue({ getMine, setMine });
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      role: "staff",
      userId: 42,
    });
    registerUserPreferencesHandlers();
  });

  it("get answers the envelope for the session user, admin and staff", async () => {
    const result = await handlers.get("user-preferences:get")!(event);
    expect(requireRole).toHaveBeenCalledWith(1, ["admin", "staff"]);
    expect(getMine).toHaveBeenCalledWith(42);
    expect(result).toEqual({ success: true, data: PREFS });
  });

  it("set-language persists through the service for the SESSION user", async () => {
    const input = setMyLanguageSchema.parse({ language: "ar" });
    const result = await handlers.get("user-preferences:set-language")!(event, input);
    expect(setMine).toHaveBeenCalledWith(42, { language: "ar" });
    expect(result).toEqual({ success: true, data: PREFS });
  });

  it("refuses an unknown language with VALIDATION_ERROR and never calls the service", async () => {
    const result = await handlers.get("user-preferences:set-language")!(event, {
      language: "fr",
    });
    expect(result).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(setMine).not.toHaveBeenCalled();
  });

  it("a payload userId is refused, never obeyed", async () => {
    const result = await handlers.get("user-preferences:set-language")!(event, {
      language: "en",
      userId: 7,
    });
    expect(result).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(setMine).not.toHaveBeenCalled();
  });

  it("refuses when not signed in", async () => {
    (requireRole as jest.Mock).mockReturnValue({ ok: false, error: "Not authenticated" });
    const result = await handlers.get("user-preferences:get")!(event);
    expect(result).toMatchObject({ success: false });
    expect(getMine).not.toHaveBeenCalled();
  });
});
