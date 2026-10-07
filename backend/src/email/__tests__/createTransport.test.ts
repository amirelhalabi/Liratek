/**
 * Transport selection and email config (LIRA-267, T017).
 *
 * The values are passed as arguments (each function defaults to the parsed
 * env), so no module re-import or env juggling is needed.
 */

import { createTransport, isEmailConfigured } from "../createTransport.js";
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

describe("isEmailConfigured", () => {
  it("is false only for disabled", () => {
    expect(isEmailConfigured("disabled")).toBe(false);
    expect(isEmailConfigured("file")).toBe(true);
    expect(isEmailConfigured("smtp")).toBe(true);
    expect(isEmailConfigured("resend")).toBe(true);
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

  it.each(["smtp", "resend"] as const)(
    "%s -> throws a clear 'not available yet' error (lands with T040)",
    (kind) => {
      expect(() => createTransport(kind)).toThrow(
        new RegExp(`EMAIL_TRANSPORT=${kind}`),
      );
    },
  );
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
