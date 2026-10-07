/**
 * The `signin-code` template (LIRA-287): the 6-digit code a www sign-in
 * mails. Variables: code, expiresAtText, supportEmail. The code is the
 * secret, so it is the template's secret key (scrubbed from the outbox once
 * the email is final). Keys come from core, the same ones
 * SigninCodeService enqueues.
 */

import { renderTemplate } from "../renderTemplate.js";
import { getEmailTemplate } from "../templates/index.js";
import { EMAIL_PREVIEW_SAMPLES } from "../preview.js";
import { SIGNIN_CODE_SECRET_KEY, SIGNIN_CODE_TEMPLATE } from "@liratek/core";

const DATA = {
  [SIGNIN_CODE_SECRET_KEY]: "482913",
  expiresAtText: "7 October 2026, 10:10 UTC",
  supportEmail: "help@liratek.test",
};

describe("signin-code template", () => {
  const template = () => getEmailTemplate(SIGNIN_CODE_TEMPLATE);

  it("is registered, with a preview sample, and declares the code as its secret", () => {
    expect(template().name).toBe("signin-code");
    expect(template().secretKeys).toEqual([SIGNIN_CODE_SECRET_KEY]);
    expect(EMAIL_PREVIEW_SAMPLES[SIGNIN_CODE_TEMPLATE]).toBeDefined();
  });

  it("keeps the code out of the subject (lock-screen previews)", () => {
    const { subject } = renderTemplate(template(), DATA);
    expect(subject).toBe("Your LiraTek sign-in code");
    expect(subject).not.toContain("482913");
  });

  it("shows the code, its UTC expiry, and that it does not sign anyone in", () => {
    const { html, text } = renderTemplate(template(), DATA);
    for (const body of [html, text]) {
      expect(body).toContain("482913");
      expect(body).toContain("7 October 2026, 10:10 UTC");
      expect(body).toContain("help@liratek.test");
    }
  });

  it("needs every contract variable (a missing one throws)", () => {
    for (const key of Object.keys(DATA)) {
      const partial: Record<string, string> = { ...DATA };
      delete partial[key];
      expect(() => renderTemplate(template(), partial)).toThrow(key);
    }
  });
});
