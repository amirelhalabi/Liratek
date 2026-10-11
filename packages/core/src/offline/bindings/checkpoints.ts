/**
 * Offline bindings — checkpoints family (LIRA-306, T103; FR-032, N8, O-new-27).
 * The ReplayEngine HOLDS every one of these (`held_checkpoint`); a binding
 * runs only when an admin presses Apply. Each calls the SAME core service the
 * REST route calls, with the actor from the event instead of the JWT:
 *   - POST /api/closing/checkpoint             → ClosingService.createCheckpoint({...body, user_id})
 *   - PUT  /api/closing/daily-closing/:id      → ClosingService.updateDailyClosing({...body, id, user_id})
 *   - POST /api/loto/checkpoints               → LotoService.createCheckpoint(body)
 *   - PUT  /api/loto/checkpoints/:id           → LotoService.updateCheckpoint(id, body)
 *   - DELETE /api/loto/checkpoints/:id         → LotoService.deleteCheckpoint(id)
 *   - GET  /api/loto/checkpoints/scheduled     → LotoService.createScheduledCheckpoint(date)
 *   - PUT  /api/carrier-lines/:id/balance      → CarrierLineService.updateBalance(id, body, userId)
 *
 * Drawer count (O-new-27): the PC's `expected_amount` was computed on its own
 * copy, blind to web and other PCs' sales. Apply replaces it by the server's
 * figure — the drawer as of the event's time (`getDrawerBalancesAsOf()`,
 * `requestNow()` = the event's instant here) — and the result carries both
 * figures per drawer/currency for the review screen:
 *   `{ success, id, expected: [{ drawer_name, currency_code, pc_expected, server_expected, physical }] }`.
 * The reconciliation itself (ClosingRepository.createCheckpoint) is measured
 * against the same as-of balance, so movements after the count survive.
 */
import { getClosingService } from "../../services/ClosingService.js";
import { getLotoService } from "../../services/LotoService.js";
import { getCarrierLineService } from "../../services/CarrierLineService.js";
import type { CreateCheckpointInput, UpdateDailyClosingIpcInput } from "../../validators/closing.js";
import type {
  LotoCheckpointCreateInput,
  LotoCheckpointUpdateInput,
  LotoCheckpointDeleteInput,
  LotoCheckpointCreateScheduledInput,
} from "../../validators/loto.js";
import type { CarrierLineUpdateBalanceInput } from "../../validators/carrierLine.js";
import type { BindingResult, OfflineBinding } from "./types.js";

import type { CheckpointExpectedFigure } from "../views.js";
export type { CheckpointExpectedFigure } from "../views.js";

/**
 * The PC's and the server's expected figures for a drawer count — ONE
 * definition used by Apply (below) and by the review list's preview before
 * Apply (`OfflineReviewService.preview`, FR-032). Read-only; call it inside
 * the event's time context (`requestNow()` = the count's instant).
 */
export function checkpointExpectedFigures(payload: Record<string, unknown>): CheckpointExpectedFigure[] {
  const p = payload as unknown as CreateCheckpointInput;
  const asOf = getClosingService().getDrawerBalancesAsOf();
  return p.amounts.map((a) => ({
    drawer_name: a.drawer_name,
    currency_code: a.currency_code,
    pc_expected: a.expected_amount,
    server_expected: asOf[a.drawer_name]?.[a.currency_code] ?? 0,
    physical: a.physical_amount,
  }));
}

const createCheckpoint: OfflineBinding = {
  channel: "closing:create-checkpoint",
  run: (payload, ctx) => {
    const p = payload as unknown as CreateCheckpointInput;
    const service = getClosingService();
    const expected = checkpointExpectedFigures(payload);
    const result = service.createCheckpoint({
      ...p,
      amounts: p.amounts.map((a, i) => ({ ...a, expected_amount: expected[i].server_expected })),
      user_id: ctx.actorUserId,
    });
    return {
      ...result,
      id: result.id === undefined ? undefined : Number(result.id),
      expected,
    } as BindingResult;
  },
  mainRow: (r) => (typeof r.id === "number" ? { table: "daily_closings", id: r.id } : null),
};

const updateDailyClosing: OfflineBinding = {
  channel: "closing:update-daily-closing",
  run: (payload, ctx) => {
    const p = payload as unknown as UpdateDailyClosingIpcInput;
    return getClosingService().updateDailyClosing({ ...p, user_id: ctx.actorUserId });
  },
};

const lotoCreate: OfflineBinding = {
  channel: "loto:checkpoint:create",
  run: (payload) => {
    const checkpoint = getLotoService().createCheckpoint(payload as unknown as LotoCheckpointCreateInput);
    return { success: true, checkpoint };
  },
  mainRow: (r) => {
    const id = (r.checkpoint as { id?: unknown } | undefined)?.id;
    return typeof id === "number" ? { table: "loto_checkpoints", id } : null;
  },
};

const lotoUpdate: OfflineBinding = {
  channel: "loto:checkpoint:update",
  run: (payload) => {
    const { id, ...body } = payload as unknown as LotoCheckpointUpdateInput & { id: number };
    const checkpoint = getLotoService().updateCheckpoint(id, body);
    return { success: true, checkpoint };
  },
};

const lotoDelete: OfflineBinding = {
  channel: "loto:checkpoint:delete",
  run: (payload) => {
    const { id } = payload as unknown as LotoCheckpointDeleteInput;
    const deleted = getLotoService().deleteCheckpoint(id);
    return deleted ? { success: true } : { success: false, error: "Checkpoint not found or already settled" };
  },
};

const lotoCreateScheduled: OfflineBinding = {
  channel: "loto:checkpoint:create-scheduled",
  run: (payload) => {
    const { checkpointDate } = payload as unknown as LotoCheckpointCreateScheduledInput;
    const checkpoint = getLotoService().createScheduledCheckpoint(checkpointDate);
    return { success: true, checkpoint };
  },
  mainRow: (r) => {
    const id = (r.checkpoint as { id?: unknown } | undefined)?.id;
    return typeof id === "number" ? { table: "loto_checkpoints", id } : null;
  },
};

const carrierUpdateBalance: OfflineBinding = {
  channel: "carrier-lines:update-balance",
  run: (payload, ctx) => {
    const { id, ...data } = payload as unknown as CarrierLineUpdateBalanceInput;
    return getCarrierLineService().updateBalance(id, data, ctx.actorUserId) as unknown as BindingResult;
  },
};

export const CHECKPOINT_BINDINGS: readonly OfflineBinding[] = [
  createCheckpoint,
  updateDailyClosing,
  lotoCreate,
  lotoUpdate,
  lotoDelete,
  lotoCreateScheduled,
  carrierUpdateBalance,
];
