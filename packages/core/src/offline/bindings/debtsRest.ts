/**
 * Offline bindings — debts family, the rest (LIRA-306 T087). Each calls the
 * SAME `DebtService` method its REST route calls (`backend/src/api/debts.ts`:
 * `{ ...body, userId }`), with the actor from the event (O-new-7) — a payload
 * `userId` is overwritten. `debt:add-repayment` lives in `debts.ts` (US1).
 */
import { getDebtService } from "../../services/DebtService.js";
import { actorUsername } from "./actor.js";
import type { BindingResult, OfflineBinding } from "./types.js";

type DebtService = ReturnType<typeof getDebtService>;
type Arg<K extends keyof DebtService> = DebtService[K] extends (a: infer A, ...r: never[]) => unknown ? A : never;

/** POST /api/debts/cash-out */
const cashOut: OfflineBinding = {
  channel: "debt:cash-out",
  run: (payload, ctx) =>
    getDebtService().cashOut({ ...(payload as unknown as Arg<"cashOut">), userId: ctx.actorUserId }) as unknown as BindingResult,
};

/** POST /api/debts/account-entry */
const accountEntry: OfflineBinding = {
  channel: "debt:add-account-entry",
  run: (payload, ctx) =>
    getDebtService().addAccountCashEntry({
      ...(payload as unknown as Arg<"addAccountCashEntry">),
      userId: ctx.actorUserId,
    }) as unknown as BindingResult,
};

/** POST /api/debts/credit */
const addCredit: OfflineBinding = {
  channel: "debt:add-credit",
  run: (payload, ctx) =>
    getDebtService().addCredit({ ...(payload as unknown as Arg<"addCredit">), userId: ctx.actorUserId }) as unknown as BindingResult,
};

/** POST /api/debts/use-credit */
const useCredit: OfflineBinding = {
  channel: "debt:use-credit",
  run: (payload, ctx) =>
    getDebtService().useCredit({ ...(payload as unknown as Arg<"useCredit">), userId: ctx.actorUserId }) as unknown as BindingResult,
};

/** POST /api/debts/write-off (admin) */
const writeOff: OfflineBinding = {
  channel: "debt:write-off",
  run: (payload, ctx) =>
    getDebtService().writeOffDebt({ ...(payload as unknown as Arg<"writeOffDebt">), userId: ctx.actorUserId }) as unknown as BindingResult,
};

/** POST /api/debts/update-metadata — `editedBy` = the actor's username. */
const updateMetadata: OfflineBinding = {
  channel: "debts:update-metadata",
  run: (payload, ctx) => {
    const p = payload as { id: number; note?: string };
    const result = getDebtService().updateDebtMetadata(p.id, { note: p.note }, actorUsername(ctx.actorUserId));
    return result.success ? { success: true, data: result.entity } : { success: false, error: result.error };
  },
};

export const DEBTS_REST_BINDINGS: readonly OfflineBinding[] = [cashOut, accountEntry, addCredit, useCredit, writeOff, updateMetadata];
