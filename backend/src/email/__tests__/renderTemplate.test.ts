/**
 * The email renderer (LIRA-267, T018; research R7).
 *
 * Contract:
 *   - every {{var}} in the HTML is HTML-escaped, quotes included, so a
 *     value is safe inside an attribute;
 *   - the text body and the subject are NOT escaped;
 *   - a referenced variable that is missing (or null) throws;
 *   - {{#if var}}…{{/if}} is the only control structure, shown only when
 *     the variable is non-empty.
 */

import { renderTemplate, type EmailTemplate } from "../renderTemplate.js";
import { signupInviteTemplate } from "../templates/signupInvite.js";

function template(parts: Partial<EmailTemplate>): EmailTemplate {
  return {
    name: "test",
    subject: "Hello",
    html: "",
    text: "",
    secretKeys: [],
    ...parts,
  };
}

describe("renderTemplate", () => {
  it("substitutes variables in subject, html and text", () => {
    const out = renderTemplate(
      template({
        subject: "Hi {{name}}",
        html: "<p>Hi {{name}}</p>",
        text: "Hi {{ name }}",
      }),
      { name: "Amir" },
    );
    expect(out).toEqual({
      subject: "Hi Amir",
      html: "<p>Hi Amir</p>",
      text: "Hi Amir",
    });
  });

  it("escapes & < > \" ' in the HTML, so values are attribute-safe", () => {
    const hostile = `<script>alert(1)</script> & "x" 'y'`;
    const out = renderTemplate(
      template({
        html: '<a href="{{url}}">{{name}}</a>',
        text: "{{name}} {{url}}",
      }),
      { name: hostile, url: 'https://x.test/?a=1&b="2"' },
    );
    expect(out.html).toBe(
      '<a href="https://x.test/?a=1&amp;b=&quot;2&quot;">' +
        "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot; &#39;y&#39;</a>",
    );
    // Text is not HTML, so it carries the value verbatim.
    expect(out.text).toBe(`${hostile} https://x.test/?a=1&b="2"`);
  });

  it("throws on a referenced variable that is missing or null", () => {
    expect(() =>
      renderTemplate(template({ html: "{{missing}}" }), {}),
    ).toThrow(/missing/);
    expect(() =>
      renderTemplate(template({ text: "{{gone}}" }), { gone: null }),
    ).toThrow(/gone/);
    expect(() =>
      renderTemplate(template({ subject: "{{nope}}" }), {}),
    ).toThrow(/nope/);
  });

  it("shows an {{#if}} block only when the variable is non-empty", () => {
    const t = template({
      html: "A{{#if hint}}<b>{{hint}}</b>{{/if}}B",
      text: "A{{#if hint}} ({{hint}}){{/if}}B",
    });
    expect(renderTemplate(t, { hint: "Cell City" })).toMatchObject({
      html: "A<b>Cell City</b>B",
      text: "A (Cell City)B",
    });
    for (const empty of ["", null, undefined]) {
      expect(renderTemplate(t, { hint: empty })).toMatchObject({
        html: "AB",
        text: "AB",
      });
    }
  });

  it("rejects any other control structure or triple braces", () => {
    expect(() =>
      renderTemplate(template({ html: "{{#each items}}x{{/each}}" }), {
        items: "a",
      }),
    ).toThrow();
    expect(() =>
      renderTemplate(template({ html: "{{{raw}}}" }), { raw: "<b>" }),
    ).toThrow();
  });

  it("renders numbers and booleans as text", () => {
    const out = renderTemplate(template({ text: "{{n}} {{b}}" }), {
      n: 3,
      b: true,
    });
    expect(out.text).toBe("3 true");
  });
});

// US3 (T038): the escaping contract proven on the REAL invite template with
// hostile values, not just a toy template.
describe("signup-invite template — hostile values (T038)", () => {
  const HOSTILE_HINT = "<script>alert(1)</script>";
  const HOSTILE_URL =
    'https://www.liratek.test/signup?invite=abc"onmouseover="alert(1)';

  const out = renderTemplate(signupInviteTemplate, {
    inviteUrl: HOSTILE_URL,
    shopNameHint: HOSTILE_HINT,
    expiresAtText: "10 October 2026, 09:00 UTC",
    supportEmail: "help@liratek.test",
  });

  it("renders a <script> shop name as text, never as markup", () => {
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("keeps a quote in the link inside the href attribute", () => {
    expect(out.html).not.toContain('"onmouseover="');
    expect(out.html).toContain(
      'href="https://www.liratek.test/signup?invite=abc&quot;onmouseover=&quot;alert(1)"',
    );
  });

  it("leaves the plain-text body verbatim (it is never parsed as HTML)", () => {
    expect(out.text).toContain(HOSTILE_HINT);
    expect(out.text).toContain(HOSTILE_URL);
  });
});
