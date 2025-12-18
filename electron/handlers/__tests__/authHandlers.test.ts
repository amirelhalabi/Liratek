// electron/handlers/__tests__/authHandlers.test.ts

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));
jest.mock("../../db", () => ({
  getDatabase: jest.fn(() => ({
    prepare: jest.fn(() => ({
      run: jest.fn(),
      all: jest.fn(),
      get: jest.fn(() => ""),
    })),
  })),
}));

describe("authHandlers registration", () => {
  it("registers expected IPC channels", () => {
    const { ipcMain } = require("electron");
    const mod = require("../authHandlers");
    mod.registerAuthHandlers();
    const calls = ipcMain.handle.mock.calls.map((c: any) => c[0]);
    [
      "auth:login",
      "auth:get-current-user",
      "users:get-non-admins",
      "users:create",
      "users:set-active",
      "users:set-role",
      "auth:logout",
      "users:set-password",
    ].forEach((ch) => expect(calls).toContain(ch));
  });
});
