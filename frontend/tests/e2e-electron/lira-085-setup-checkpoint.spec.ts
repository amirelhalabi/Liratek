/**
 * E2E: LIRA-085 (A4 + B1) — setup writes an initial checkpoint with
 * per-currency starting amounts
 *
 * A4: completing the setup wizard must write a checkpoint-timeline row (the
 * baseline for the closing timeline) — previously skipped entirely when the
 * operator didn't enter amounts.
 * B1: the wizard seeds DISTINCT per-currency amounts; the e2e fixtures fill
 * General USD=500 and LBP=9,000,000 in step 6, and this spec asserts those
 * exact values against the immutable setup-checkpoint row (live drawer
 * balances shift as other specs run; the checkpoint record does not).
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type CheckpointRecord = {
  id: number;
  drawer_name: string;
  checkpoint_type: string;
  notes?: string;
  currencies: Array<{
    currency_code: string;
    opening_amount: number;
    physical_amount?: number;
  }>;
};

type Api = {
  api: {
    closing: {
      getCheckpointTimeline: (filters: {
        type?: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
      }) => Promise<{
        success: boolean;
        error?: string;
        checkpoints?: CheckpointRecord[];
      }>;
    };
  };
};

test.describe("LIRA-085 (A4/B1) — setup checkpoint", () => {
  test("setup wrote an initial checkpoint carrying the per-currency amounts", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const res = await w.api.closing.getCheckpointTimeline({ type: "ALL" });
      const setupCheckpoint =
        res.checkpoints?.find((c) =>
          c.notes?.includes("Initial drawer amounts from setup"),
        ) ?? null;
      // The timeline's STARTING point: the checkpoint with the smallest id
      // (immutable history — later specs may add checkpoints, never earlier).
      const earliestId =
        res.checkpoints && res.checkpoints.length > 0
          ? Math.min(...res.checkpoints.map((c) => c.id))
          : null;
      return {
        ok: res.success === true,
        error: res.error ?? null,
        setupCheckpoint,
        earliestId,
      };
    });

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);

    // A4: the setup checkpoint row exists…
    expect(result.setupCheckpoint).not.toBeNull();
    // …and it is the timeline's FIRST entry — setup is the starting checkpoint.
    expect(result.setupCheckpoint!.id).toBe(result.earliestId);

    // B1: it recorded the DISTINCT per-currency amounts the wizard seeded
    // (General USD 500 / LBP 9,000,000 — set by the e2e fixtures).
    const currencies = result.setupCheckpoint!.currencies;
    const usd = currencies.find((c) => c.currency_code === "USD");
    const lbp = currencies.find((c) => c.currency_code === "LBP");
    expect(usd?.physical_amount ?? usd?.opening_amount).toBeCloseTo(500, 2);
    expect(lbp?.physical_amount ?? lbp?.opening_amount).toBeCloseTo(
      9_000_000,
      2,
    );
  });
});
