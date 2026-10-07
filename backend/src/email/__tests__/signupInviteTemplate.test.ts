/**
 * The `signup-invite` template (LIRA-267, T023) against its contract in
 * contracts/api.md: variables inviteUrl, shopNameHint, expiresAtText,
 * supportEmail; subject "You're invited to open your shop on LiraTek".
 *
 * The data object is the one SignupInvitationService enqueues, so the
 * template and the service cannot drift apart unnoticed.
 */

import { renderTemplate } from "../renderTemplate.js";
import { getEmailTemplate } from "../templates/index.js";
import {
  SIGNUP_INVITE_TEMPLATE,
  SIGNUP_INVITE_URL_KEY,
} from "@liratek/core";

const URL = "https://www.liratek.test/signup?invite=AbC_123-xyz";
const DATA = {
  [SIGNUP_INVITE_URL_KEY]: URL,
  shopNameHint: "Cell City",
  expiresAtText: "10 October 2026, 10:00 UTC",
  supportEmail: "help@liratek.test",
};

describe("signup-invite template", () => {
  const template = getEmailTemplate(SIGNUP_INVITE_TEMPLATE);

  it("has the contract subject", () => {
    expect(renderTemplate(template, DATA).subject).toBe(
      "You're invited to open your shop on LiraTek",
    );
  });

  it("puts the link in a button AND written out in full, in both bodies", () => {
    const { html, text } = renderTemplate(template, DATA);
    expect(html).toContain(`href="${URL}"`);
    // Button + fallback anchor + the link printed as text.
    expect(html.split(URL).length - 1).toBeGreaterThanOrEqual(3);
    expect(text).toContain(URL);
  });

  it("states the single use and the UTC expiry", () => {
    const { html, text } = renderTemplate(template, DATA);
    const sentence =
      "This link works once and expires on 10 October 2026, 10:00 UTC";
    expect(html).toContain(sentence);
    expect(text).toContain(sentence);
  });

  it("shows the shop name hint only when there is one", () => {
    expect(renderTemplate(template, DATA).html).toContain("Cell City");
    const without = renderTemplate(template, { ...DATA, shopNameHint: "" });
    expect(without.html).not.toContain("Cell City");
    expect(without.text).not.toContain("Cell City");
  });

  it("mentions the support address", () => {
    const { html, text } = renderTemplate(template, DATA);
    expect(html).toContain("mailto:help@liratek.test");
    expect(text).toContain("help@liratek.test");
  });

  it("needs every contract variable (a missing one throws)", () => {
    for (const key of Object.keys(DATA)) {
      if (key === "shopNameHint") continue; // optional by contract
      const partial: Record<string, string> = { ...DATA };
      delete partial[key];
      expect(() => renderTemplate(template, partial)).toThrow(key);
    }
  });

  it("is a 600px table layout with inline styles only", () => {
    const { html } = renderTemplate(template, DATA);
    expect(html).toMatch(/<table[^>]*width="600"/);
    expect(html).not.toMatch(/<style|<link|<script/i);
  });

  it("an unknown template name throws", () => {
    expect(() => getEmailTemplate("no-such-template")).toThrow(
      /no-such-template/,
    );
  });
});
