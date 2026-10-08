/**
 * Transport selection and email config (LIRA-267, T017).
 *
 * The values are passed as arguments (each function defaults to the parsed
 * env), so no module re-import or env juggling is needed.
 */

import { jest } from "@jest/globals";

// Hermetic: the functions under test DEFAULT their parameters from core's
// parsed env, and passing `undefined` explicitly selects that default. A
// developer's backend/.env (APP_BASE_DOMAIN, EMAIL_*, SMTP_*) would otherwise
// leak into the "unset" cases. Every env value these functions read is
// pinned to unset here.
jest.mock("@liratek/core", () => ({
  ...jest.requireActual<typeof import("@liratek/core")>("@liratek/core"),
  APP_BASE_DOMAIN: undefined,
  SIGNUP_INVITE_BASE_URL: undefined,
  EMAIL_FILE_DIR: undefined,
  EMAIL_REPLY_TO: undefined,
  SMTP_HOST: undefined,
  SMTP_PASS: undefined,
  SMTP_PORT: undefined,
  SMTP_USER: undefined,
}));
import { emailLogger } from "@liratek/core";
import {
  createTransport,
  isEmailConfigured,
  resetEmailTransportState,
  resolveEmailTransport,
} from "../createTransport.js";
import {
  resolveInviteBaseUrl,
  resolveSupportEmail,
} from "../emailConfig.js";
import { PermanentEmailError } from "../EmailTransport.js";

const TAG = { template: "t", outboxId: 1, idempotencyKey: "k" };
const MESSAGE = {
  to: "a@b.c",
  from: "x@y.z",
  subject: "s",
  html: "h",
  text: "t",
  tag: TAG,
};

describe("resolveEmailTransport + isEmailConfigured", () => {
  const SMTP_OK = { host: "h", port: undefined, user: "u", pass: "p" };
  let logged: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logged = jest.spyOn(emailLogger, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logged.mockRestore();
    resetEmailTransportState();
  });

  it("disabled -> off, not configured, nothing logged", () => {
    expect(resolveEmailTransport("disabled").status).toBe("off");
    expect(isEmailConfigured()).toBe(false);
    expect(logged).not.toHaveBeenCalled();
  });

  it("a buildable transport (file, smtp with credentials) -> ready and configured", () => {
    expect(resolveEmailTransport("file", "/tmp/liratek-mail").status).toBe("ready");
    expect(isEmailConfigured()).toBe(true);
    expect(resolveEmailTransport("smtp", undefined, SMTP_OK).status).toBe("ready");
    expect(isEmailConfigured()).toBe(true);
  });

  it.each([
    ["smtp without SMTP_PASS", () => resolveEmailTransport("smtp", undefined, { ...SMTP_OK, pass: undefined })],
    ["file without EMAIL_FILE_DIR", () => resolveEmailTransport("file", undefined)],
    ["resend (not built)", () => resolveEmailTransport("resend")],
  ])("%s -> invalid, NOT configured, logged; never throws", (_label, resolve) => {
    let state: ReturnType<typeof resolveEmailTransport> | undefined;
    expect(() => {
      state = resolve();
    }).not.toThrow();
    expect(state?.status).toBe("invalid");
    expect(isEmailConfigured()).toBe(false);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe("createTransport", () => {
  it("disabled -> a transport whose sends fail permanently", async () => {
    const transport = createTransport("disabled");
    expect(transport.name).toBe("disabled");
    await expect(transport.send(MESSAGE)).rejects.toBeInstanceOf(
      PermanentEmailError,
    );
  });

  it("file -> the file transport", () => {
    expect(createTransport("file", "/tmp/liratek-mail").name).toBe("file");
  });

  it("file without EMAIL_FILE_DIR -> a clear error", () => {
    expect(() => createTransport("file", undefined)).toThrow(/EMAIL_FILE_DIR/);
  });

  const SMTP = {
    host: "mail.spacemail.test",
    port: undefined,
    user: "mail@liratek.test",
    pass: "pw",
  };

  it("smtp with host/user/pass -> the smtp transport (no network until a send)", () => {
    expect(createTransport("smtp", undefined, SMTP).name).toBe("smtp");
  });

  it("smtp missing host, user or pass -> a clear boot error naming each missing variable", () => {
    expect(() =>
      createTransport("smtp", undefined, {
        host: undefined,
        port: 465,
        user: "mail@liratek.test",
        pass: undefined,
      }),
    ).toThrow(/EMAIL_TRANSPORT=smtp needs SMTP_HOST, SMTP_PASS/);
  });

  it("resend -> throws a clear 'not available' error (Spacemail SMTP was chosen; resend is not built)", () => {
    expect(() => createTransport("resend")).toThrow(/EMAIL_TRANSPORT=resend/);
  });
});

describe("resolveSupportEmail", () => {
  it("prefers EMAIL_REPLY_TO and strips a display name to the bare address", () => {
    expect(
      resolveSupportEmail("Help <help@liratek.shop>", "LiraTek <mail@liratek.shop>"),
    ).toBe("help@liratek.shop");
    expect(resolveSupportEmail(undefined, "LiraTek <mail@liratek.shop>")).toBe(
      "mail@liratek.shop",
    );
    expect(resolveSupportEmail(undefined, "mail@liratek.shop")).toBe(
      "mail@liratek.shop",
    );
  });
});

describe("resolveInviteBaseUrl", () => {
  it("uses SIGNUP_INVITE_BASE_URL, else https://www.<APP_BASE_DOMAIN>, else null", () => {
    expect(resolveInviteBaseUrl("http://localhost:5173/", "liratek.shop")).toBe(
      "http://localhost:5173",
    );
    expect(resolveInviteBaseUrl(undefined, "liratek.shop")).toBe(
      "https://www.liratek.shop",
    );
    // Never "https://www.undefined".
    expect(resolveInviteBaseUrl(undefined, undefined)).toBeNull();
  });
});
