/**
 * Offline bindings — debts (LIRA-306). US1: `debt:add-repayment` →
 * `DebtService.addRepayment({ ...payload, userId })`, exactly what
 * `POST /api/debts/repayments` and the IPC handler call, with the actor from
 * the event (never the payload's `userId`). The rest of the family is in
 * `debtsRest.ts`.
 *
 * Replay-only rule (FR-029, O-new-3): when a ticked item is no longer open
 * (someone paid it online meanwhile) the repayment is booked again WITHOUT
 * its ticks — oldest-first, any extra becomes credit as today
 * (DebtRepository.overpayPin.test.ts) — noted `ticks_dropped`, and only its
 * main row is mapped (FR-020). Detected by DebtRepository's refusal text
 * (`TICKED_ITEM_NOT_OPEN`, it carries no code); `outcomes.test.ts` pins it.
 */
import { getDebtService } from "../../services/DebtService.js";
import type { BindingResult, OfflineBinding } from "./types.js";

/** DebtRepository._assertTargetsOpen's message (no error code exists). */
export const TICKED_ITEM_NOT_OPEN = /ticked items is no longer open/i;

const debtAddRepayment: OfflineBinding = {
  channel: "debt:add-repayment",
  run: (payload, ctx) => {
    const data: Record<string, unknown> = { ...payload, userId: ctx.actorUserId };
    const first = getDebtService().addRepayment(data as never) as unknown as BindingResult;
    const targets = Array.isArray(data.targets) ? (data.targets as unknown[]) : [];
    if (first.success || targets.length === 0 || !TICKED_ITEM_NOT_OPEN.test(String(first.error ?? ""))) return first;
    const retry = getDebtService().addRepayment({ ...data, targets: undefined } as never) as unknown as BindingResult;
    if (!retry.success) return retry;
    return {
      ...retry,
      offline: {
        mainRowOnly: true,
        notes: [{ kind: "ticks_dropped", details: { droppedTargets: targets, reason: first.error } }],
      },
    };
  },
  mainRow: (result) => (typeof result.id === "number" ? { table: "debt_ledger", id: result.id } : null),
};

export const DEBT_BINDINGS: readonly OfflineBinding[] = [debtAddRepayment];
