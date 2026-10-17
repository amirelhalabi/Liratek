/**
 * Precondition seed (rule 15): make sure the General drawer holds at least
 * `minUsd` / `minLbp` before a step that pays cash OUT of it. The shared DB's
 * General balance depends on which specs ran first (a fresh web DB running a
 * subset, or a full run after payout-heavy specs, can sit at or below 0, and
 * the repositories refuse a payout that would overdraw it). Tops up ONLY the
 * shortfall, with a cash-in, so callers keep asserting deltas.
 *
 * Same logic as lira-091's local `ensureGeneralFloat`.
 */
import { expect, type Page } from "@playwright/test";

export async function ensureGeneralFloat(
  page: Page,
  minUsd: number,
  minLbp: number,
): Promise<void> {
  const res = await page.evaluate(
    async ({ minUsd, minLbp }) => {
      const w = window as unknown as {
        api: {
          closing: {
            getSystemExpectedBalancesDynamic: () => Promise<
              Record<string, Record<string, number>>
            >;
          };
          drawerTopUp: {
            create: (data: {
              amount_usd: number;
              amount_lbp: number;
              notes?: string;
            }) => Promise<{ success: boolean; error?: string }>;
          };
        };
      };
      const bal = await w.api.closing.getSystemExpectedBalancesDynamic();
      const usd = bal?.General?.USD ?? 0;
      const lbp = bal?.General?.LBP ?? 0;
      const amount_usd = usd < minUsd ? Math.ceil(minUsd - usd) : 0;
      const amount_lbp = lbp < minLbp ? Math.ceil(minLbp - lbp) : 0;
      if (amount_usd === 0 && amount_lbp === 0) return { success: true };
      return w.api.drawerTopUp.create({
        amount_usd,
        amount_lbp,
        notes: "E2E precondition: General float",
      });
    },
    { minUsd, minLbp },
  );
  expect(res.error ?? null).toBeNull();
  expect(res.success).toBe(true);
}
