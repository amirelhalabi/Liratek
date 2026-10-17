/**
 * LIRA-332 — the subscription row a new shop starts with, derived ONCE for
 * both storage modes (rule 14, same shape as `adminEmailFields`):
 * `SharedTenantStorageProvisioner` (core) and the per-tenant provisioner
 * (backend) both take `input.subscriptionSeed ?? payingSubscriptionSeed()`.
 *
 * Paying (no trial) is the default: owner-created shops, scripts and tests
 * that do not ask for a trial keep exactly the row they always got (FR-004).
 */

import { toUtcSqlTimestamp, trialEndFor } from "../utils/trialCalendar.js";
import type { SubscriptionStatus } from "../repositories/SubscriptionRepository.js";

export interface SubscriptionSeed {
  plan: string;
  status: SubscriptionStatus;
  current_period_end: string | null;
  entitled_modules: string | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
}

/** Active, no expiry, every module, no trial (SUBSCRIPTION_MANAGEMENT_PLAN D6). */
export function payingSubscriptionSeed(): SubscriptionSeed {
  return {
    plan: "standard",
    status: "active",
    current_period_end: null,
    entitled_modules: null,
  };
}

/** The paying seed plus a 14-day trial starting at `now`. */
export function trialSubscriptionSeed(now: Date): SubscriptionSeed {
  return {
    ...payingSubscriptionSeed(),
    trial_started_at: toUtcSqlTimestamp(now),
    trial_ends_at: toUtcSqlTimestamp(trialEndFor(now)),
  };
}
