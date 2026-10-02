/**
 * MaintenanceJobSchema (desktop IPC) — desktop/web schema parity (LIRA-185 D9).
 *
 * The desktop IPC handler (`maintenance:save`) validates against a LOCAL
 * duplicate of core's `saveMaintenanceJobSchema` that never declared
 * `paid_by`, `note` or `transaction_time` — so those three keys were
 * silently stripped by Zod on every desktop save, even though
 * `MaintenanceRepository.createJob`/`updateJob` read `job.paid_by`/`job.note`
 * directly and `MaintenanceService.saveJob` validates/uses
 * `params.transaction_time`. REST validates the real core schema and kept
 * all three. A backdated repair checkout was therefore silently ignored on
 * desktop while working on web.
 *
 * Rule 17: proven to fail against the pre-fix local schema — `parse()`
 * stripped `paid_by`/`note`/`transaction_time` from the result entirely
 * (they were simply absent keys, not rejected/errored).
 */
import { MaintenanceJobSchema } from "../index";

const basePayload = {
  device_name: "iPhone 13",
  issue_description: "Screen cracked",
  cost_usd: 10,
  price_usd: 50,
  status: "Delivered_Paid" as const,
  paid_by: "CASH",
  note: "hello",
  transaction_time: "2026-09-10T09:00:00.000Z",
  kept_change_usd: 10,
};

describe("MaintenanceJobSchema — desktop keeps paid_by/note/transaction_time (LIRA-185 D9)", () => {
  it("does not strip paid_by", () => {
    const parsed = MaintenanceJobSchema.parse(basePayload);
    expect(parsed.paid_by).toBe("CASH");
  });

  it("does not strip note", () => {
    const parsed = MaintenanceJobSchema.parse(basePayload);
    expect(parsed.note).toBe("hello");
  });

  it("does not strip transaction_time", () => {
    const parsed = MaintenanceJobSchema.parse(basePayload);
    expect(parsed.transaction_time).toBe("2026-09-10T09:00:00.000Z");
  });

  it("still keeps kept_change_usd (already present before this fix)", () => {
    const parsed = MaintenanceJobSchema.parse(basePayload);
    expect(parsed.kept_change_usd).toBe(10);
  });
});
