/**
 * env.ts — the settings for self-serve sign-up, password reset, user
 * invites and Google sign-in (SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md).
 *
 * env.ts parses `process.env` once at import, so each case re-imports it in
 * an isolated module registry with the variables it needs.
 */

const KEYS = [
  "SIGNUP_SELF_SERVE_ENABLED",
  "SIGNUP_SELF_SERVE_DAILY_CAP",
  "CLIENT_IP_HEADER",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "PASSWORD_RESET_TTL_MINUTES",
  "USER_INVITE_TTL_HOURS",
] as const;

type EnvModule = typeof import("../env");

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const key of KEYS) saved[key] = process.env[key];
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function loadEnv(
  vars: Partial<Record<(typeof KEYS)[number], string>>,
): EnvModule {
  // "" reads as unset (emptyToUndefined) and also blocks dotenv from filling
  // the variable in from a developer's .env file.
  for (const key of KEYS) process.env[key] = vars[key] ?? "";
  let mod: EnvModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../env") as EnvModule;
  });
  return mod!;
}

describe("env — auth and email settings", () => {
  it("defaults: self-serve off, cap 20, reset 60 min, invite 72 h, no Google, no IP header", () => {
    const env = loadEnv({});
    expect(env.SIGNUP_SELF_SERVE_ENABLED).toBe(false);
    expect(env.SIGNUP_SELF_SERVE_DAILY_CAP).toBe(20);
    expect(env.PASSWORD_RESET_TTL_MINUTES).toBe(60);
    expect(env.USER_INVITE_TTL_HOURS).toBe(72);
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(env.CLIENT_IP_HEADER).toBeUndefined();
  });

  it.each([
    ["true", true],
    ["1", true],
    ["TRUE", true],
    ["false", false],
    ["0", false],
    ["yes", false],
  ])("SIGNUP_SELF_SERVE_ENABLED=%s -> %s", (raw, expected) => {
    expect(
      loadEnv({ SIGNUP_SELF_SERVE_ENABLED: raw }).SIGNUP_SELF_SERVE_ENABLED,
    ).toBe(expected);
  });

  it("reads the explicit values", () => {
    const env = loadEnv({
      SIGNUP_SELF_SERVE_DAILY_CAP: "5",
      CLIENT_IP_HEADER: " Fly-Client-IP ",
      GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "secret",
      PASSWORD_RESET_TTL_MINUTES: "30",
      USER_INVITE_TTL_HOURS: "48",
    });
    expect(env.SIGNUP_SELF_SERVE_DAILY_CAP).toBe(5);
    // Header names are case-insensitive; Express lowercases them.
    expect(env.CLIENT_IP_HEADER).toBe("fly-client-ip");
    expect(env.GOOGLE_CLIENT_ID).toBe("client-id.apps.googleusercontent.com");
    expect(env.GOOGLE_CLIENT_SECRET).toBe("secret");
    expect(env.PASSWORD_RESET_TTL_MINUTES).toBe(30);
    expect(env.USER_INVITE_TTL_HOURS).toBe(48);
  });
});
