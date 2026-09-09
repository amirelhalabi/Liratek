import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminListTenants,
  adminCreateTenant,
  adminUpdateTenant,
  adminImpersonate,
  adminDeleteTenant,
  adminChangeTenantSlug,
  type AdminCreateTenantPayload,
  type AdminUpdateTenantPayload,
} from "@/api/backendApi";

// ── Query key constants ─────────────────────────────────────────────────────
export const ADMIN_TENANT_KEYS = {
  all: ["admin", "tenants"] as const,
};

// ── Read ──────────────────────────────────────────────────────────────────────
export function useTenantsQuery() {
  return useQuery({
    queryKey: ADMIN_TENANT_KEYS.all,
    queryFn: adminListTenants,
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────
export function useCreateTenantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminCreateTenantPayload) =>
      adminCreateTenant(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_TENANT_KEYS.all });
    },
  });
}

export function useUpdateTenantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number;
      patch: AdminUpdateTenantPayload;
    }) => adminUpdateTenant(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_TENANT_KEYS.all });
    },
  });
}

export function useImpersonateTenantMutation() {
  return useMutation({
    mutationFn: (id: number) => adminImpersonate(id),
  });
}

/**
 * Delete a tenant. Invalidates BOTH lists: the subscriptions query joins
 * `tenants`, so a stale row there would render a plan for a shop that no
 * longer exists.
 */
export function useDeleteTenantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmSlug }: { id: number; confirmSlug: string }) =>
      adminDeleteTenant(id, confirmSlug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_TENANT_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    },
  });
}

export function useChangeTenantSlugMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, slug }: { id: number; slug: string }) =>
      adminChangeTenantSlug(id, slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_TENANT_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    },
  });
}
