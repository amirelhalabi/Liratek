import { parseEnabledModuleKeys } from "@/utils/moduleGates";

import { request, type ApiResult } from "./client";

/**
 * GET /api/modules/enabled — the shop's switched-on, plan-entitled modules, the
 * same list the web's Settings → Modules drives (LIRA-307). Only the keys are
 * kept; a body of any other shape throws, so the gate stays closed.
 */
export async function getEnabledModules(): Promise<ApiResult<ReadonlySet<string>>> {
  const r = await request<unknown>("GET", "/api/modules/enabled");
  if (!r.success) return r;
  return { success: true, data: parseEnabledModuleKeys(r.data) };
}
