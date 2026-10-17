/**
 * LIRA-333 T015 (contracts/open-external.md) — the allow-list that guards
 * `app:open-external` (desktop) and the web arm of `openExternalUrl`: only
 * `https:` links to WhatsApp's own hosts may leave LiraTek.
 */
import { openExternalUrlSchema, WHATSAPP_HOSTS } from "../app.js";

describe("openExternalUrlSchema", () => {
  it("names exactly WhatsApp's two click-to-chat hosts", () => {
    expect([...WHATSAPP_HOSTS]).toEqual(["wa.me", "api.whatsapp.com"]);
  });

  it.each([
    "https://wa.me/9613123456?text=x",
    "https://api.whatsapp.com/send?phone=1",
  ])("accepts %s", (url) => {
    expect(openExternalUrlSchema.safeParse({ url }).success).toBe(true);
  });

  it.each([
    "http://wa.me/9613123456",
    "https://evil.com/wa.me",
    "https://wa.me.evil.com/9613123456",
    "https://evilwa.me/1",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "",
  ])("refuses %j", (url) => {
    const r = openExternalUrlSchema.safeParse({ url });
    expect(r.success).toBe(false);
  });

  it("refuses a missing url", () => {
    expect(openExternalUrlSchema.safeParse({}).success).toBe(false);
  });
});
