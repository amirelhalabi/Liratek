/**
 * LIRA-331: status codes stay codes; only the label follows the language.
 */
import { i18n } from "@/i18n/setup";
import { statusLabel } from "../statusLabel";

type MaintenanceT = Parameters<typeof statusLabel>[1];
const t = () => i18n.getFixedT(null, "maintenance") as unknown as MaintenanceT;

afterEach(() => i18n.changeLanguage("en"));

describe("statusLabel", () => {
  it("labels known codes in English", () => {
    expect(statusLabel("In_Progress", t())).toBe("In Progress");
    expect(statusLabel("Delivered_Paid", t())).toBe("Delivered & Paid");
  });

  it("labels known codes in Arabic", async () => {
    const { loadLanguage } = await import("@/i18n/setup");
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    expect(statusLabel("In_Progress", t())).toBe("قيد التصليح");
    expect(statusLabel("Ready", t())).toBe("جاهز");
  });

  it("shows an unknown code as-is (underscore as a space)", () => {
    expect(statusLabel("On_Hold", t())).toBe("On Hold");
  });
});
