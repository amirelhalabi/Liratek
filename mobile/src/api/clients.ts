import type { z } from "zod";
import type { createClientSchema } from "@liratek/core/validators/client";

import { request, type ApiResult } from "./client";

export interface ClientSummary {
  id: number;
  full_name: string;
  phone_number: string;
}

/** GET /api/clients?search= — the shop's clients matching a name or phone. */
export async function searchClients(search: string): Promise<ApiResult<ClientSummary[]>> {
  const r = await request<{ clients?: ClientSummary[] }>("GET", `/api/clients?search=${encodeURIComponent(search)}`);
  if (!r.success) return r;
  return { success: true, data: r.data.clients ?? [] };
}

type CreateClientPayload = z.input<typeof createClientSchema>;

/** POST /api/clients — registers a new client (admin). Returns the new id. */
export async function createClient(payload: CreateClientPayload): Promise<ApiResult<number>> {
  const r = await request<{ id?: number }>("POST", "/api/clients", { body: payload });
  if (!r.success) return r;
  return typeof r.data.id === "number" ? { success: true, data: r.data.id } : { success: false, error: "NO_CLIENT_ID" };
}
