import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminListTenants,
  adminCreateTenant,
  adminUpdateTenant,
  adminImpersonate,
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
