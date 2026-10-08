/**
 * LIRA-291 email templates. Keys come from core (the same constants
 * PasswordResetService enqueues), so template and service cannot drift.
 *
 *   password-added   notice after a signed-in user added a password from
 *                    Settings. No link, no secret keys.
 *   password-set     the reset link, worded for a user with NO password:
 *                    "Set a password for <username>". Same data as
 *                    password-reset; the link is a secret.
 */

import { renderTemplate } from "../renderTemplate.js";
import { getEmailTemplate } from "../templates/index.js";
import { EMAIL_PREVIEW_SAMPLES } from "../preview.js";
import {
  PASSWORD_ADDED_TEMPLATE,
  PASSWORD_RESET_URL_KEY,
  PASSWORD_SET_TEMPLATE,
} from "@liratek/core";

const ADDED = {
  username: "rami",
  shopName: "Corner Tech",
  supportEmail: "help@liratek.test",
};

describe("password-added template (LIRA-291)", () => {
  const template = () => getEmailTemplate(PASSWORD_ADDED_TEMPLATE);

  it("is registered with a preview sample and NO secret keys", () => {
    expect(template().name).toBe("password-added");
    expect(template().secretKeys).toEqual([]);
    expect(EMAIL_PREVIEW_SAMPLES[PASSWORD_ADDED_TEMPLATE]).toBeDefined();
  });

  it("says a password was added to the username at the shop, and to contact the admin if it wasn't them", () => {
    const { subject, html, text } = renderTemplate(template(), ADDED);
    expect(subject).toBe("A password was added to your LiraTek account");
    for (const body of [html, text]) {
      expect(body).toContain("rami");
      expect(body).toContain("Corner Tech");
      expect(body).toContain("If this wasn't you, contact your shop admin.");
      expect(body).toContain("help@liratek.test");
    }
    expect(html).not.toContain("href=\"http");
  });

  it("needs every variable (a missing one throws)", () => {
    for (const key of Object.keys(ADDED)) {
      const partial: Record<string, string> = { ...ADDED };
      delete partial[key];
      expect(() => renderTemplate(template(), partial)).toThrow(key);
    }
  });
});

const SET_URL = "https://cornertech.liratek.test/#/reset-password?token=AbC_123-xyz";
const SET = {
  [PASSWORD_RESET_URL_KEY]: SET_URL,
  username: "rami",
  shopName: "Corner Tech",
  expiresAtText: "8 October 2026, 11:00 UTC",
  supportEmail: "help@liratek.test",
};

describe("password-set template (LIRA-291)", () => {
  const template = () => getEmailTemplate(PASSWORD_SET_TEMPLATE);

  it("is registered with a preview sample; the link is a secret key", () => {
    expect(template().name).toBe("password-set");
    expect(template().secretKeys).toEqual([PASSWORD_RESET_URL_KEY]);
    expect(EMAIL_PREVIEW_SAMPLES[PASSWORD_SET_TEMPLATE]).toBeDefined();
  });

  it("says 'Set a password', never 'reset', and names the username and shop", () => {
    const { subject, html, text } = renderTemplate(template(), SET);
    expect(subject).toBe("Set a password for your LiraTek account");
    for (const body of [html, text]) {
      expect(body).toContain("Set a password for rami");
      expect(body).toContain("Corner Tech");
      expect(body).toContain(SET_URL);
      expect(body).toContain("This link works once and expires on 8 October 2026, 11:00 UTC");
      // The link's own path is /#/reset-password; the WORDS never say reset.
      expect(body.split(SET_URL).join("").toLowerCase()).not.toContain("reset");
    }
    expect(html).toContain(`href="${SET_URL}"`);
  });

  it("needs every variable (a missing one throws)", () => {
    for (const key of Object.keys(SET)) {
      const partial: Record<string, string> = { ...SET };
      delete partial[key];
      expect(() => renderTemplate(template(), partial)).toThrow(key);
    }
  });
});

