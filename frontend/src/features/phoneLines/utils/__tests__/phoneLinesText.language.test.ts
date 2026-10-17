/**
 * LIRA-331 T069: a line's status and its for-sale alert are worded in the
 * current UI language; the English stays exactly as before.
 */
import { i18n, loadLanguage } from "@/i18n/setup";
import { lineStatusText } from "../lineStatusText";
import { resaleLineAlertText, type ResaleLineAlert } from "../resaleLineAlerts";

const ALERT: ResaleLineAlert = {
  kind: "expiring",
  productId: 10,
  number: "03555101",
  carrier: "mtc",
  daysLeft: 2,
  daysToSave: 0,
  key: "resale:10:expiring:2026-10-17",
};

beforeAll(async () => {
  await loadLanguage("ar");
});
afterEach(() => i18n.changeLanguage("en"));

describe("phone line wording follows the language", () => {
  it("English is unchanged", () => {
    expect(lineStatusText({ status: "EXPIRING", daysLeft: 1, daysToSave: 0 })).toBe(
      "Expires in 1 day",
    );
    expect(lineStatusText({ status: "IN_GRACE", daysLeft: 0, daysToSave: 3 })).toBe(
      "Expired — 3 days left to save it",
    );
    expect(resaleLineAlertText(ALERT)).toBe(
      "Line for sale 03555101 (MTC) expires in 2 days",
    );
  });

  it("Arabic when the language is ar", async () => {
    await i18n.changeLanguage("ar");
    expect(lineStatusText({ status: "LOST", daysLeft: 0, daysToSave: 0 })).toBe("ضاع");
    expect(resaleLineAlertText({ ...ALERT, kind: "lost" })).toBe(
      "خط للبيع 03555101 (MTC) ضاع — هل تشطبه؟",
    );
  });
});
