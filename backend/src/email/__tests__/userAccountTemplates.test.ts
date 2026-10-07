/**
 * The `user-invite` and `verify-email` templates (LIRA-281 / LIRA-279,
 * feature B) against contract B in SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md:
 *
 *   user-invite   subject "<Shop name> invited you to LiraTek";
 *                 inviteUrl, shopName, roleText, expiresAtText, supportEmail
 *   verify-email  verifyUrl, username, shopName, expiresAtText, supportEmail
 *
 * Template names come from the core constants the services enqueue with,
 * so the registry and the services cannot drift apart unnoticed.
 */

import { renderTemplate } from "../renderTemplate.js";
import { getEmailTemplate } from "../templates/index.js";
import { USER_INVITE_TEMPLATE, VERIFY_EMAIL_TEMPLATE } from "@liratek/core";

const INVITE_URL = "https://cellcity.liratek.test/#/join?invite=AbC_123-xyz";
const INVITE = {
  inviteUrl: INVITE_URL,
  shopName: `Cell <b>City</b>`,
  roleText: "a staff member",
  expiresAtText: "10 October 2026, 10:00 UTC",
  supportEmail: "help@liratek.test",
};

const VERIFY_URL = "https://cellcity.liratek.test/#/verify-email?token=Zz9";
const VERIFY = {
  verifyUrl: VERIFY_URL,
  username: "cashier1",
  shopName: "Cell City",
  expiresAtText: "8 October 2026, 10:00 UTC",
  supportEmail: "help@liratek.test",
};

function expectEveryVariableRequired(
  name: string,
  data: Record<string, string>,
): void {
  const template = getEmailTemplate(name);
  for (const key of Object.keys(data)) {
    const partial: Record<string, string> = { ...data };
    delete partial[key];
    expect(() => renderTemplate(template, partial)).toThrow(key);
  }
}

describe("user-invite template", () => {
  it("is registered under the name the service enqueues", () => {
    expect(USER_INVITE_TEMPLATE).toBe("user-invite");
    expect(() => getEmailTemplate(USER_INVITE_TEMPLATE)).not.toThrow();
  });

  it("subject is '<Shop name> invited you to LiraTek' (verbatim, subjects are not HTML)", () => {
    const { subject } = renderTemplate(getEmailTemplate("user-invite"), INVITE);
    expect(subject).toBe("Cell <b>City</b> invited you to LiraTek");
  });

  it("escapes the shop name in the HTML body", () => {
    const { html } = renderTemplate(getEmailTemplate("user-invite"), INVITE);
    expect(html).toContain("Cell &lt;b&gt;City&lt;/b&gt;");
    expect(html).not.toContain("<b>City</b>");
  });

  it("puts the link in a button AND written out, states role, single use and UTC expiry", () => {
    const { html, text } = renderTemplate(getEmailTemplate("user-invite"), INVITE);
    expect(html).toContain(`href="${INVITE_URL}"`);
    expect(html.split(INVITE_URL).length - 1).toBeGreaterThanOrEqual(3);
    expect(text).toContain(INVITE_URL);
    for (const body of [html, text]) {
      expect(body).toContain("a staff member");
      expect(body).toContain(
        "This link works once and expires on 10 October 2026, 10:00 UTC",
      );
      expect(body).toContain("help@liratek.test");
    }
  });

  it("needs every contract variable (a missing one throws)", () => {
    expectEveryVariableRequired("user-invite", INVITE);
  });
});

describe("verify-email template", () => {
  it("is registered under the name the service enqueues", () => {
    expect(VERIFY_EMAIL_TEMPLATE).toBe("verify-email");
    expect(() => getEmailTemplate(VERIFY_EMAIL_TEMPLATE)).not.toThrow();
  });

  it("names the user and the shop, carries the link twice, states the UTC expiry", () => {
    const { subject, html, text } = renderTemplate(
      getEmailTemplate("verify-email"),
      VERIFY,
    );
    expect(subject).toBe("Confirm your email for LiraTek");
    expect(html).toContain(`href="${VERIFY_URL}"`);
    expect(text).toContain(VERIFY_URL);
    for (const body of [html, text]) {
      expect(body).toContain("cashier1");
      expect(body).toContain("Cell City");
      expect(body).toContain("8 October 2026, 10:00 UTC");
      expect(body).toContain("help@liratek.test");
    }
  });

  it("needs every contract variable (a missing one throws)", () => {
    expectEveryVariableRequired("verify-email", VERIFY);
  });

  it("is a 600px table layout with inline styles only", () => {
    const { html } = renderTemplate(getEmailTemplate("verify-email"), VERIFY);
    expect(html).toMatch(/<table[^>]*width="600"/);
    expect(html).not.toMatch(/<style|<link|<script/i);
  });
});
