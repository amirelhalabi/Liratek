import type { CreateFinancialServicePayload } from "@liratek/core/validators/financial";

import { request, type ApiResult } from "./client";

/**
 * POST /api/services/transactions with the body from core's shared
 * buildWalletTransferPayload (the web form uses the same builder, rule 22).
 * `idempotencyKey`: one per Save tap, reused on retries of that tap, so a
 * double tap or a weak-signal retry books once (FR-017).
 */
export function recordServiceSale(
  payload: CreateFinancialServicePayload,
  idempotencyKey: string,
): Promise<ApiResult<{ id?: number }>> {
  return request<{ id?: number }>("POST", "/api/services/transactions", { body: payload, idempotencyKey });
}

/** A fresh key for one Save tap: 8–128 letters, digits or dashes (server rule). */
export function newIdempotencyKey(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `ph-${Date.now().toString(36)}-${rand()}-${rand()}`;
}
