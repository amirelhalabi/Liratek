import { i18n, loadLanguage } from "@/i18n/setup";
import { moduleLabel } from "../moduleLabel";

describe("moduleLabel (LIRA-331 OD-3: seeded names translate only while unchanged)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("English: a seeded label shows as stored", () => {
    expect(moduleLabel("pos", "Point of Sale", i18n.t)).toBe("Point of Sale");
  });

  it("Arabic: a seeded label is translated", async () => {
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    expect(moduleLabel("pos", "Point of Sale", i18n.t)).toBe("نقطة البيع");
    expect(moduleLabel("debts", "Accounts", i18n.t)).toBe("الحسابات");
    expect(moduleLabel("customer_sessions", "Sessions", i18n.t)).toBe(
      "جلسات الزبائن",
    );
  });

  it("Arabic: a label the shop renamed stays as the shop wrote it", async () => {
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    expect(moduleLabel("pos", "Caisse", i18n.t)).toBe("Caisse");
  });

  it("an unknown module key shows its stored label", async () => {
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    expect(moduleLabel("future_module", "Future", i18n.t)).toBe("Future");
  });
});
