/**
 * lotoCheckpointUpdateSchema — guards the one checkpoint write channel that
 * had NO validation before this ticket (`PUT /api/loto/checkpoints/:id` /
 * `loto:checkpoint:update` both passed the raw payload straight into
 * `LotoService.updateCheckpoint` → `LotoCheckpointRepository.updateCheckpoint`).
 *
 * The schema MUST accept every field in `LotoCheckpointUpdate`
 * (packages/core/src/repositories/LotoCheckpointRepository.ts) — Zod strips
 * unknown keys silently, so an omitted field would vanish on every write,
 * including the Checkpoint History note edit (the only current UI caller)
 * and the money fields (`total_sales`/`total_commission`/`total_prizes`/
 * `is_settled`/`settlement_id`) a checkpoint settlement depends on.
 *
 * Rule 17 (failing-first proof owed, not run here): to prove the
 * "rejects a bad type" case actually guards something, temporarily change
 * `total_sales` back to `z.any()` (or drop the field entirely), re-run this
 * file, confirm the "rejects a bad type" test fails, then revert.
 */

import { describe, it, expect } from "@jest/globals";
import { lotoCheckpointUpdateSchema } from "../loto.js";

describe("lotoCheckpointUpdateSchema", () => {
  it("accepts a full LotoCheckpointUpdate payload and round-trips every field", () => {
    const payload = {
      checkpoint_date: "2026-08-01",
      period_start: "2026-07-25",
      period_end: "2026-08-01",
      total_sales: 1000000,
      total_commission: 50000,
      total_tickets: 10,
      total_prizes: 20000,
      is_settled: 1 as const,
      settled_at: "2026-08-02T10:00:00.000Z",
      settlement_id: 3,
      note: "settled manually",
    };

    const result = lotoCheckpointUpdateSchema.parse(payload);

    expect(result).toEqual(payload);
  });

  it("accepts a { note }-only partial (the Checkpoint History edit's actual payload)", () => {
    const result = lotoCheckpointUpdateSchema.parse({ note: "new note" });

    expect(result).toEqual({ note: "new note" });
  });

  it("accepts an empty object (all fields optional — a partial update)", () => {
    expect(() => lotoCheckpointUpdateSchema.parse({})).not.toThrow();
  });

  it("rejects a bad type on a money field (total_sales: string)", () => {
    expect(() =>
      lotoCheckpointUpdateSchema.parse({ total_sales: "abc" }),
    ).toThrow();
  });

  it("rejects is_settled outside the 0/1 integer-flag domain", () => {
    expect(() => lotoCheckpointUpdateSchema.parse({ is_settled: 2 })).toThrow();
  });

  it("rejects an over-long note (matches lotoUpdateMetadataSchema's 500-char bound)", () => {
    expect(() =>
      lotoCheckpointUpdateSchema.parse({ note: "a".repeat(501) }),
    ).toThrow();
  });
});
