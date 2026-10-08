/**
 * The `password-reset` template (LIRA-275/276) against contract C:
 * variables resetUrl, username, shopName, expiresAtText, supportEmail.
 *
 * Keys come from core (`PASSWORD_RESET_TEMPLATE`, `PASSWORD_RESET_URL_KEY`),
 * the same ones PasswordResetService enqueues, so the template and the
 * service cannot drift apart unnoticed.
 */

import { renderTemplate } from "../renderTemplate.js";
import { getEmailTemplate } from "../templates/index.js";
import { EMAIL_PREVIEW_SAMPLES } from "../preview.js";
import {
  PASSWORD_RESET_TEMPLATE,
  PASSWORD_RESET_URL_KEY,
} from "@liratek/core";

const URL = "https://cellcity.liratek.test/#/reset-password?token=AbC_123-xyz";
const DATA = {
  [PASSWORD_RESET_URL_KEY]: URL,
  username: "boss",
  shopName: "Cell City",
  expiresAtText: "7 October 2026, 11:00 UTC",
  supportEmail: "help@liratek.test",
};

describe("password-reset template", () => {
  const template = () => getEmailTemplate(PASSWORD_RESET_TEMPLATE);

  it("is registered, with a preview sample", () => {
    expect(template().name).toBe("password-reset");
    expect(EMAIL_PREVIEW_SAMPLES[PASSWORD_RESET_TEMPLATE]).toBeDefined();
  });

  it("has a plain subject", () => {
    expect(renderTemplate(template(), DATA).subject).toBe(
      "Reset your LiraTek password",
    );
  });

  it("puts the link in a button AND written out in full, in both bodies", () => {
    const { html, text } = renderTemplate(template(), DATA);
    expect(html).toContain(`href="${URL}"`);
    expect(html.split(URL).length - 1).toBeGreaterThanOrEqual(3);
    expect(text).toContain(URL);
  });

  it("names the account and the shop, and states single use + UTC expiry", () => {
    const { html, text } = renderTemplate(template(), DATA);
    for (const body of [html, text]) {
      expect(body).toContain("boss");
      expect(body).toContain("Cell City");
      expect(body).toContain(
        "This link works once and expires on 7 October 2026, 11:00 UTC",
      );
      expect(body).toContain("help@liratek.test");
    }
  });

  it("LIRA-291: the heading names the username ('Reset the password for boss')", () => {
    const { html, text } = renderTemplate(template(), DATA);
    expect(html).toContain("Reset the password for boss</h1>");
    expect(text.startsWith("Reset the password for boss")).toBe(true);
  });

  it("escapes the shop name and username in HTML", () => {
    const { html } = renderTemplate(template(), {
      ...DATA,
      shopName: `<script>x</script>`,
      username: `a"b`,
    });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("needs every contract variable (a missing one throws)", () => {
    for (const key of Object.keys(DATA)) {
      const partial: Record<string, string> = { ...DATA };
      delete partial[key];
      expect(() => renderTemplate(template(), partial)).toThrow(key);
    }
  });
});
