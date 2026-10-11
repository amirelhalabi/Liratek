/**
 * Offline bindings — exchange family (LIRA-306, T091). Each calls the SAME
 * core service the REST route calls (backend/src/api/exchange.ts), with the
 * actor from the event instead of the JWT (E2, O-new-7):
 *   - POST /api/exchange/transactions    → addDirectTransaction(body)
 *   - POST /api/exchange/update-metadata → updateExchangeMetadata(id, {client_name, note}, username)
 */
import { getExchangeService } from "../../services/ExchangeService.js";
import type { CreateExchangeData } from "../../repositories/ExchangeRepository.js";
import { getUserRepository } from "../../repositories/UserRepository.js";
import type { BindingResult, OfflineBinding } from "./types.js";

/** The REST route uses the JWT's username; the event carries the user id. */
export function actorUsername(userId: number): string {
  return getUserRepository().findById(userId)?.username ?? `user-${userId}`;
}

const addTransaction: OfflineBinding = {
  channel: "exchange:add-transaction",
  run: (payload) =>
    getExchangeService().addDirectTransaction(payload as unknown as CreateExchangeData) as unknown as BindingResult,
  mainRow: (r) => (typeof r.id === "number" ? { table: "exchange_transactions", id: r.id } : null),
};

const updateMetadata: OfflineBinding = {
  channel: "exchange:update-metadata",
  run: (payload, ctx) => {
    const p = payload as { id: number; client_name?: string; note?: string };
    const result = getExchangeService().updateExchangeMetadata(
      p.id,
      { client_name: p.client_name, note: p.note },
      actorUsername(ctx.actorUserId),
    );
    return result.success ? { success: true, data: result.entity } : { success: false, error: result.error };
  },
};

export const EXCHANGE_BINDINGS: readonly OfflineBinding[] = [addTransaction, updateMetadata];
