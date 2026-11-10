/**
 * LIRA-377 `shop-restored` — the owner notice after a web shop restore.
 * The name comes from the core constant the restore service enqueues with,
 * so registry and service cannot drift apart. (Written together with the
 * template, not seen failing first.)
 */
import { renderTemplate } from "../renderTemplate.js";
import { getEmailTemplate } from "../templates/index.js";
import { SHOP_RESTORED_TEMPLATE } from "@liratek/core";

const DATA = {
  shopName: `Cell <b>City</b>`,
  restoredToText: "2026-11-10 15:00",
  restoredAtText: "2026-11-10 15:20",
  byName: "boss",
  kindText: "an earlier time",
  supportEmail: "help@liratek.test",
};

describe("shop-restored template", () => {
  it("is registered under the name the restore service uses", () => {
    expect(getEmailTemplate(SHOP_RESTORED_TEMPLATE).name).toBe("shop-restored");
  });

  it("says which moment, when, by whom — escaped, in html and text", () => {
    const out = renderTemplate(getEmailTemplate(SHOP_RESTORED_TEMPLATE), DATA);
    expect(out.subject).toBe("Your LiraTek shop was restored");
    for (const v of ["2026-11-10 15:00", "2026-11-10 15:20", "boss", "an earlier time", "help@liratek.test"]) {
      expect(out.html).toContain(v);
      expect(out.text).toContain(v);
    }
    expect(out.html).toContain("Cell &lt;b&gt;City&lt;/b&gt;");
    expect(out.html).not.toContain("<b>City</b>");
  });

  it("refuses to render with a variable missing", () => {
    const { byName: _omit, ...rest } = DATA;
    expect(() => renderTemplate(getEmailTemplate(SHOP_RESTORED_TEMPLATE), rest)).toThrow();
  });
});
