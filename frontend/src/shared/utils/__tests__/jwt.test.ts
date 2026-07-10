import { decodeJwtPayload } from "../jwt";

function makeToken(payload: Record<string, unknown>): string {
  const base64Url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const header = base64Url({ alg: "HS256", typ: "JWT" });
  const body = base64Url(payload);
  return `${header}.${body}.signature`;
}

describe("decodeJwtPayload", () => {
  it("decodes a well-formed token's payload", () => {
    const payload = {
      userId: 42,
      role: "super_admin",
      tenantId: null,
      sessionToken: "abc",
    };
    const token = makeToken(payload);

    expect(decodeJwtPayload(token)).toEqual(payload);
  });

  it("round-trips a numeric tenantId and impersonatorId", () => {
    const payload = {
      userId: 7,
      role: "admin",
      tenantId: 3,
      impersonatorId: 1,
      sessionToken: "xyz",
    };
    const token = makeToken(payload);

    const decoded = decodeJwtPayload(token);
    expect(decoded?.tenantId).toBe(3);
    expect(decoded?.impersonatorId).toBe(1);
  });

  it("decodes non-ASCII (UTF-8) claim values correctly", () => {
    const payload = { username: "شركة ليرا تك" };
    const token = makeToken(payload);

    expect(decodeJwtPayload(token)?.username).toBe("شركة ليرا تك");
  });

  it("returns null for null/undefined/empty input", () => {
    expect(decodeJwtPayload(null)).toBeNull();
    expect(decodeJwtPayload(undefined)).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });

  it("returns null for a malformed token (wrong segment count)", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("only.two")).toBeNull();
  });

  it("returns null when the payload segment isn't valid base64/JSON", () => {
    expect(decodeJwtPayload("header.%%%not-base64%%%.signature")).toBeNull();
  });
});
