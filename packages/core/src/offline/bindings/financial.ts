/**
 * Offline bindings — financial services family (LIRA-306 T083). Each calls
 * the SAME core service method its REST route calls
 * (`backend/src/api/services.ts`, `backend/src/api/walletExchange.ts`), with
 * the actor from the event (O-new-7) — a payload `userId` is overwritten.
 */
import { getFinancialService } from "../../services/FinancialService.js";
import { getWalletExchangeService } from "../../services/WalletExchangeService.js";
import type { CreateFinancialServiceData, SelfChargeTelecomItemData } from "../../repositories/FinancialServiceRepository.js";
import type { CreateWalletExchangeInput } from "../../validators/walletExchange.js";
import { actorUsername } from "./actor.js";
import type { BindingResult, OfflineBinding } from "./types.js";

/** POST /api/services/transactions → addTransaction({ ...body, userId }) */
const addTransaction: OfflineBinding = {
  channel: "omt:add-transaction",
  run: (payload, ctx) =>
    getFinancialService().addTransaction({
      ...(payload as unknown as CreateFinancialServiceData),
      userId: ctx.actorUserId,
    }) as unknown as BindingResult,
};

/** POST /api/services/update-metadata — `editedBy` = the actor's username. */
const updateMetadata: OfflineBinding = {
  channel: "financial:update-metadata",
  run: (payload, ctx) => {
    const p = payload as {
      id: number;
      client_name?: string;
      phone_number?: string;
      sender_name?: string;
      sender_phone?: string;
      receiver_name?: string;
      receiver_phone?: string;
      note?: string;
    };
    const result = getFinancialService().updateFinancialServiceMetadata(
      p.id,
      {
        client_name: p.client_name,
        phone_number: p.phone_number,
        sender_name: p.sender_name,
        sender_phone: p.sender_phone,
        receiver_name: p.receiver_name,
        receiver_phone: p.receiver_phone,
        note: p.note,
      },
      actorUsername(ctx.actorUserId),
    );
    return result.success ? { success: true, data: result.entity } : { success: false, error: result.error };
  },
};

/** POST /api/services/self-charge → selfChargeTelecomItem({ ...body, userId }) */
const selfCharge: OfflineBinding = {
  channel: "financial:self-charge-telecom-item",
  run: (payload, ctx) =>
    getFinancialService().selfChargeTelecomItem({
      ...(payload as unknown as SelfChargeTelecomItemData),
      userId: ctx.actorUserId,
    }) as unknown as BindingResult,
};

/** POST /api/wallet-exchange → exchange(body, userId); the rate is the one the PC recorded in the payload. */
const walletExchange: OfflineBinding = {
  channel: "wallet-exchange:create",
  run: (payload, ctx) =>
    getWalletExchangeService().exchange(payload as unknown as CreateWalletExchangeInput, ctx.actorUserId) as unknown as BindingResult,
};

export const FINANCIAL_BINDINGS: readonly OfflineBinding[] = [addTransaction, updateMetadata, selfCharge, walletExchange];
