/**
 * `openAndConfigure()` (Phase A review finding: `connection.ts`'s
 * `openTenantDatabase(filePath)` did `new Database(filePath)` then
 * `configureConnection(db)` with nothing closing the handle when
 * `configureConnection` threw — e.g. a bad SQLCipher key or a failed pragma —
 * leaking an open file handle per failed open).
 */
import { openAndConfigure } from "../openAndConfigure.js";

function fakeDb() {
  return { close: jest.fn() };
}

describe("openAndConfigure", () => {
  it("returns the opened db when configure succeeds, without closing it", () => {
    const db = fakeDb();
    const openRaw = jest.fn(() => db);
    const configure = jest.fn();

    const result = openAndConfigure("/tmp/1.db", openRaw, configure);

    expect(result).toBe(db);
    expect(configure).toHaveBeenCalledWith(db);
    expect(db.close).not.toHaveBeenCalled();
  });

  it("closes the handle before rethrowing when configure throws", () => {
    const db = fakeDb();
    const openRaw = jest.fn(() => db);
    const configureError = new Error("bad SQLCipher key");
    const configure = jest.fn(() => {
      throw configureError;
    });

    expect(() => openAndConfigure("/tmp/1.db", openRaw, configure)).toThrow(
      "bad SQLCipher key",
    );
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it("still rethrows the original error even if close() itself throws", () => {
    const db = { close: jest.fn(() => { throw new Error("close failed"); }) };
    const openRaw = jest.fn(() => db);
    const configureError = new Error("bad pragma");
    const configure = jest.fn(() => {
      throw configureError;
    });

    expect(() => openAndConfigure("/tmp/1.db", openRaw, configure)).toThrow(
      "bad pragma",
    );
    expect(db.close).toHaveBeenCalledTimes(1);
  });
});
