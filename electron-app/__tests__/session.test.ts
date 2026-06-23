/**
 * Session Security Tests
 *
 * Verifies the session.ts source enforces the hardened plaintext-rejection
 * and in-memory purge behaviors. Uses source-text assertions (same pattern
 * as security.test.ts) because the Electron APIs are not available at test
 * runtime.
 */

import * as fs from "fs";
import * as path from "path";

const sessionSource = fs.readFileSync(
  path.join(__dirname, "..", "session.ts"),
  "utf-8",
);

const mainSource = fs.readFileSync(
  path.join(__dirname, "..", "main.ts"),
  "utf-8",
);

describe("Session file encryption", () => {
  it("rejects plaintext on decrypt failure when safeStorage is available", () => {
    // Old code did: decrypted = fileData.toString("utf-8") as fallback.
    // New code must discard the file instead.
    expect(sessionSource).toMatch(/clearEncryptedSession\(\)/);
    expect(sessionSource).not.toMatch(
      /Failed to decrypt.*trying base64 fallback/,
    );
  });

  it("only allows plaintext session files in dev (unpackaged) builds", () => {
    // The plaintext read path must be guarded by !app.isPackaged
    expect(sessionSource).toMatch(/app\.isPackaged/);
    // And it must contain a log clearly marking it as dev-only
    expect(sessionSource).toMatch(/dev only/i);
  });

  it("refuses to write a plaintext session in packaged builds", () => {
    // writeSessionFile must throw or log an error in packaged builds
    expect(sessionSource).toMatch(/refusing to persist session as plaintext/i);
  });

  it("does not have the old base64 fallback wording", () => {
    expect(sessionSource).not.toMatch(/base64 fallback/);
  });
});

describe("In-memory session purge", () => {
  it("purgeExpiredSessions returns an array of purged ids", () => {
    // The return type must be number[]
    expect(sessionSource).toMatch(/purged\.push\(id\)/);
    expect(sessionSource).toMatch(/return purged/);
  });

  it("purgeExpiredSessions is called from main.ts session cleanup", () => {
    expect(mainSource).toMatch(/purgeExpiredSessions/);
  });

  it("main.ts sends session:expired to purged renderers", () => {
    expect(mainSource).toMatch(/session:expired/);
    expect(mainSource).toMatch(/webContents\.fromId\(id\)/);
  });
});
