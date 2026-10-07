/**
 * LIRA-267 — sign-up invite token helpers.
 *
 * The invite row stores only `hashToken(token)`; the raw token travels in the
 * emailed link. These pin the properties the invite flow relies on.
 */

import { createHash } from "node:crypto";
import { generateToken, hashToken, safeEqual } from "../crypto.js";

describe("generateToken", () => {
  it("returns 32 random bytes as base64url (43 chars, URL-safe, no padding)", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateToken());
    expect(seen.size).toBe(200);
  });
});

describe("hashToken", () => {
  it("is sha256 as lowercase hex", () => {
    const token = "abc";
    expect(hashToken(token)).toBe(
      createHash("sha256").update(token, "utf8").digest("hex"),
    );
    expect(hashToken(token)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic and never returns the token itself", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("safeEqual", () => {
  it("is true only for identical strings", () => {
    expect(safeEqual("let-me-in", "let-me-in")).toBe(true);
    expect(safeEqual("let-me-in", "let-me-iN")).toBe(false);
  });

  it("is false (and does not throw) for strings of different lengths", () => {
    expect(safeEqual("short", "much-longer-value")).toBe(false);
    expect(safeEqual("much-longer-value", "short")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("does not treat a prefix as equal", () => {
    expect(safeEqual("secret", "secret-and-more")).toBe(false);
  });

  it("handles multi-byte characters by byte length", () => {
    expect(safeEqual("café", "café")).toBe(true);
    expect(safeEqual("café", "cafe")).toBe(false);
  });
});
