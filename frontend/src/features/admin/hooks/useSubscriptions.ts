import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActivateSubscriptionInput,
  ExtendTrialInput,
  SetEnabledFeaturesInput,
} from "@liratek/core";
import {
  adminListSubscriptions,
  adminUpdateSubscription,
  adminIssueLicenseKey,
  adminActivateSubscription,
  adminExtendTrial,
  adminSetEnabledFeatures,
  adminSubscriptionHistory,
  type AdminSubscriptionPatch,
} from "@/api/backendApi";
import { ADMIN_TENANT_KEYS } from "./useTenants";

// ── Query key constants ─────────────────────────────────────────────────────
export const ADMIN_SUBSCRIPTION_KEYS = {
  all: ["admin", "subscriptions"] as const,
  history: (tenantId: number) =>
    ["admin", "subscriptions", "history", tenantId] as const,
};

// ── Read ────────────────────────────────────────────────────────────────────
export function useSubscriptionsQuery() {
  return useQuery({
    queryKey: ADMIN_SUBSCRIPTION_KEYS.all,
    queryFn: adminListSubscriptions,
  });
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Change a tenant's plan.
 *
 * Invalidates the TENANTS list as well as this one. They are separate queries
 * over the same registry, and the tenants table shows a plan column — leaving
 * it stale would show the owner the plan they just replaced, which is the
 * worst moment to be shown an old value.
 */
export function useUpdateSubscriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tenantId,
      patch,
    }: {
      tenantId: number;
      patch: AdminSubscriptionPatch;
    }) => adminUpdateSubscription(tenantId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_SUBSCRIPTION_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ADMIN_TENANT_KEYS.all });
    },
  });
}

/**
 * Issue a desktop licence key.
 *
 * The key comes back ONCE and is not stored anywhere the UI can re-read, so
 * the caller must show it to the owner immediately. Issuing again revokes the
 * previous one.
 */
export function useIssueLicenseKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: number) => adminIssueLicenseKey(tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_SUBSCRIPTION_KEYS.all });
    },
  });
}

// ── LIRA-332: the owner's trial actions ─────────────────────────────────────

/** One shop's subscription history (activate, extend, record payment). */
export function useSubscriptionHistoryQuery(tenantId: number) {
  return useQuery({
    queryKey: ADMIN_SUBSCRIPTION_KEYS.history(tenantId),
    queryFn: () => adminSubscriptionHistory(tenantId),
  });
}

/**
 * Both actions invalidate the subscriptions list (which also covers each
 * shop's history key) and the tenants list, for the same reason as the plan
 * update above.
 */
function useTrialActionMutation<TBody>(
  run: (tenantId: number, body: TBody) => Promise<void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, body }: { tenantId: number; body: TBody }) =>
      run(tenantId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_SUBSCRIPTION_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ADMIN_TENANT_KEYS.all });
    },
  });
}

export function useActivateSubscriptionMutation() {
  return useTrialActionMutation<ActivateSubscriptionInput>(
    adminActivateSubscription,
  );
}

export function useExtendTrialMutation() {
  return useTrialActionMutation<ExtendTrialInput>(adminExtendTrial);
}

/** LIRA-364 — Plan window → Features (e.g. Monthly progress). */
export function useSetEnabledFeaturesMutation() {
  return useTrialActionMutation<SetEnabledFeaturesInput>(
    adminSetEnabledFeatures,
  );
}
