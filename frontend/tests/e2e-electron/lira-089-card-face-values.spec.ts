/**
 * E2E: LIRA-089 (A1) — MTC prepaid cards labeled by FACE VALUE, not sell price
 *
 * The recharge card grid showed each card's USD sell price (e.g. "8.65")
 * instead of the value printed on the card (e.g. "7.58"). Owner provided the
 * card photos; Katsh + WHISH_APP mtc Prepaid items renamed (catalog for fresh
 * installs, migration v117 for existing DBs). Alfa: same fix via v118.
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    mobileServiceItems: {
      // Returns the standard { success, data } envelope, not a bare array.
      getAll: () => Promise<{
        success: boolean;
        data?: Array<{
          provider: string;
          category: string;
          subcategory: string;
          label: string;
        }>;
        error?: string;
      }>;
    };
  };
};

const MTC_FACE_VALUES = ["1.67", "3.79", "4.5", "7.58", "10", "15.15", "22.73", "77.28"];
const ALFA_FACE_VALUES = ["3.03", "4.5", "7.58", "10", "15.15", "22.73", "77.28"];
const OLD_PRICE_NAMES = ["2.10", "3.6", "4.45", "5.24", "8.65", "11.32", "17.06", "25.47", "86"];

test.describe("LIRA-089 (A1) — card face values", () => {
  for (const [category, faces] of [
    ["mtc", MTC_FACE_VALUES],
    ["alfa", ALFA_FACE_VALUES],
  ] as const) {
    test(`Katsh & WHISH_APP ${category} prepaid items are named by card face value`, async ({
      appPage,
    }) => {
      const labels = await appPage.evaluate(async (category) => {
        const w = window as unknown as Api;
        const res = await w.api.mobileServiceItems.getAll();
        const items = res.success ? (res.data ?? []) : [];
        return items
          .filter(
            (i) =>
              ["Katsh", "WHISH_APP"].includes(i.provider) &&
              i.category === category &&
              i.subcategory === "Prepaid",
          )
          .map((i) => i.label);
      }, category);

      expect(labels.length).toBeGreaterThan(0);
      for (const face of faces) {
        expect(labels).toContain(face);
      }
      for (const old of OLD_PRICE_NAMES) {
        expect(labels).not.toContain(old);
      }
    });
  }
});
