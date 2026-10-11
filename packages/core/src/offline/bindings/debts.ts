/**
 * Offline bindings — debts (LIRA-306). US1: `debt:add-repayment` →
 * `DebtService.addRepayment({ ...payload, userId })`, exactly what
 * `POST /api/debts/repayments` and the IPC handler call, with the actor from
 * the event (never the payload's `userId`). Phase 6 adds the rest of the
 * family here.
 */
import { getDebtService } from "../../services/DebtService.js";
import type { BindingResult, OfflineBinding } from "./types.js";

const debtAddRepayment: OfflineBinding = {
  channel: "debt:add-repayment",
  run: (payload, ctx) =>
    getDebtService().addRepayment({ ...(payload as never as object), userId: ctx.actorUserId } as never) as unknown as BindingResult,
};

export const DEBT_BINDINGS: readonly OfflineBinding[] = [debtAddRepayment];
