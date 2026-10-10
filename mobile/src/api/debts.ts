import type { z } from "zod";
import type { addRepaymentSchema } from "@liratek/core/validators/debt";

import { request, type ApiResult } from "./client";

export interface Debtor {
  id: number;
  full_name: string;
  phone_number: string;
  total_debt_usd: number;
  total_debt_lbp: number;
}

/** GET /api/debts/debtors — clients who owe the shop. */
export async function getDebtors(): Promise<ApiResult<Debtor[]>> {
  const r = await request<{ debtors?: Debtor[] }>("GET", "/api/debts/debtors");
  if (!r.success) return r;
  return { success: true, data: r.data.debtors ?? [] };
}

export interface ClientBalance {
  balance_usd: number;
  balance_lbp: number;
}

/** GET /api/debts/clients/:id/balance — what the client owes, per currency. */
export function getClientBalance(clientId: number): Promise<ApiResult<ClientBalance>> {
  return request<ClientBalance>("GET", `/api/debts/clients/${clientId}/balance`);
}

/** Same shape the web Debts page sends; typed from the shared schema (rule 21). */
export type RepaymentPayload = z.input<typeof addRepaymentSchema>;

/**
 * POST /api/debts/repayments. `idempotencyKey`: one per Save tap, reused on
 * retries (FR-017). The route answers HTTP 400 with a JSON body on a refusal;
 * the client reads the body either way.
 */
export function recordRepayment(payload: RepaymentPayload, idempotencyKey: string): Promise<ApiResult<{ id?: number }>> {
  return request<{ id?: number }>("POST", "/api/debts/repayments", { body: payload, idempotencyKey });
}
