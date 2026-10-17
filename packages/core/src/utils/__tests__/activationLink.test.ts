/**
 * LIRA-332 (FR-007) — the one WhatsApp activation link the web and the phone
 * both open. Not proven failing-first (new contract).
 */

import {
  LIRATEK_WHATSAPP_NUMBER,
  buildActivationWhatsAppUrl,
} from "../activationLink.js";

const PREFIX = "https://wa.me/96181077357?text=";

function decodedText(url: string): string {
  expect(url.startsWith(PREFIX)).toBe(true);
  return decodeURIComponent(url.slice(PREFIX.length));
}

describe("buildActivationWhatsAppUrl", () => {
  it("uses the landing page's number", () => {
    expect(LIRATEK_WHATSAPP_NUMBER).toBe("96181077357");
  });

  it("pre-fills the shop name and address", () => {
    const url = buildActivationWhatsAppUrl({
      shopName: "Abou Ali Phones",
      shopAddress: "abouali.liratek.shop",
    });
    expect(decodedText(url)).toBe(
      "Hi LiraTek, I'd like to activate my shop Abou Ali Phones (abouali.liratek.shop).",
    );
  });

  it("drops a missing part instead of printing undefined", () => {
    const noAddress = decodedText(
      buildActivationWhatsAppUrl({ shopName: "Corner", shopAddress: null }),
    );
    expect(noAddress).toBe("Hi LiraTek, I'd like to activate my shop Corner.");

    const noName = decodedText(
      buildActivationWhatsAppUrl({ shopName: "", shopAddress: "corner.x" }),
    );
    expect(noName).toBe("Hi LiraTek, I'd like to activate my shop (corner.x).");

    const nothing = decodedText(buildActivationWhatsAppUrl({}));
    expect(nothing).toBe("Hi LiraTek, I'd like to activate my shop.");
    for (const t of [noAddress, noName, nothing]) {
      expect(t).not.toMatch(/undefined|null/);
    }
  });

  it("Arabic and ampersands survive encoding", () => {
    const url = buildActivationWhatsAppUrl({
      shopName: "هواتف أبو علي & Co",
      shopAddress: "abouali.liratek.shop",
    });
    expect(url).not.toContain("&Co");
    expect(url).not.toContain(" ");
    expect(decodedText(url)).toBe(
      "Hi LiraTek, I'd like to activate my shop هواتف أبو علي & Co (abouali.liratek.shop).",
    );
  });
});
