import type { TrialStatus } from "@/utils/trialStrip";

import { request, type ApiResult } from "./client";

/**
 * LIRA-332: GET /api/subscription/status — the shop's standing and free-trial
 * view, computed by the server (the same answer the web banner renders).
 */
export async function getSubscriptionStatus(): Promise<ApiResult<TrialStatus>> {
  return request<TrialStatus>("GET", "/api/subscription/status");
}
