/**
 * LIRA-335 — staff read open checkpoint differences (the hint on cashier
 * forms) but never see user names. The ONE redaction both transports apply
 * (IPC `closing:get-open-differences-after`, REST
 * `GET /api/closing/differences/open-after`), rule 14.
 *
 * Rule 17: written before `redactCheckpointDifferencesForRole` existed.
 */
import type { CheckpointDifferenceView } from "../../repositories/CheckpointDifferenceRepository";
import { redactCheckpointDifferencesForRole } from "../checkpointDifference";

function view(): CheckpointDifferenceView {
  return {
    id: 7,
    closing_id: 3,
    closing_created_at: "2026-10-12 15:00:00",
    drawer_name: "General",
    currency_code: "USD",
    amount: -20,
    direction: "SHORT",
    resolved: 12,
    open: 8,
    status: "CLOSED",
    closed_at: "2026-10-13 09:00:00",
    closed_by_name: "owner",
    shortage_expense_id: 44,
    resolutions: [
      {
        transaction_id: 4821,
        transaction_type: "SALE",
        summary: null,
        amount: -12,
        effective_time: "2026-10-12 14:00:00",
        entered_at: "2026-10-13 08:00:00",
        user_name: "cashier",
      },
    ],
  };
}

describe("redactCheckpointDifferencesForRole", () => {
  it("admin sees everything unchanged", () => {
    const input = [view()];
    expect(redactCheckpointDifferencesForRole(input, "admin")).toEqual(input);
  });

  it.each(["staff", undefined, "unknown"])(
    "%s gets resolutions and closed_by_name blanked, every other field kept",
    (role) => {
      const [out] = redactCheckpointDifferencesForRole([view()], role);
      expect(out.resolutions).toEqual([]);
      expect(out.closed_by_name).toBeNull();
      const { resolutions: _r, closed_by_name: _c, ...rest } = out;
      const { resolutions: _r2, closed_by_name: _c2, ...expected } = view();
      expect(rest).toEqual(expected);
    },
  );

  it("never mutates its input", () => {
    const input = [view()];
    redactCheckpointDifferencesForRole(input, "staff");
    expect(input[0].closed_by_name).toBe("owner");
    expect(input[0].resolutions).toHaveLength(1);
  });
});
