import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminListSubscriptions,
  adminUpdateSubscription,
  adminIssueLicenseKey,
  type AdminSubscriptionPatch,
} from "@/api/backendApi";
import { ADMIN_TENANT_KEYS } from "./useTenants";

// ── Query key constants ─────────────────────────────────────────────────────
export const ADMIN_SUBSCRIPTION_KEYS = {
  all: ["admin", "subscriptions"] as const,
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
