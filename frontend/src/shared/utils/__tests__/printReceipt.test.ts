/** @jest-environment jsdom */
/**
 * Unit tests for the shared receipt HTML builder (RCP-0,
 * docs/plans/done_plans/RECEIPTS_PLAN.md). The logo is presentation — injected as an
 * <img> above the monospace <pre>, never mangled into the text body.
 */

import { buildReceiptHtml } from "../printReceipt";

describe("buildReceiptHtml", () => {
  it("wraps the receipt text in a <pre> and never drops it", () => {
    const html = buildReceiptHtml("LINE ONE\nLINE TWO");
    expect(html).toContain("<pre>LINE ONE\nLINE TWO</pre>");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("injects an <img> with the data URL above the <pre> when a logo is set", () => {
    const logo = "data:image/png;base64,ABC123";
    const html = buildReceiptHtml("BODY", logo);
    expect(html).toContain(`<img class="receipt-logo" src="${logo}"`);
    // Logo comes before the text body.
    expect(html.indexOf("receipt-logo")).toBeLessThan(html.indexOf("<pre>"));
  });

  it("renders no <img> when the logo is empty or whitespace", () => {
    expect(buildReceiptHtml("BODY", "")).not.toContain("<img");
    expect(buildReceiptHtml("BODY", "   ")).not.toContain("<img");
    expect(buildReceiptHtml("BODY")).not.toContain("<img");
  });
});
