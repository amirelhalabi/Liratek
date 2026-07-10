import { useState } from "react";
import { Plus, ExternalLink, RefreshCw } from "lucide-react";
import { ConfirmModal } from "@liratek/ui";
import {
  useTenantsQuery,
  useCreateTenantMutation,
  useUpdateTenantMutation,
  useImpersonateTenantMutation,
} from "../../hooks/useTenants";
import { AddTenantModal } from "../../components/AddTenantModal";
import type {
  AdminTenant,
  AdminCreateTenantPayload,
} from "@/api/backendApi";

const STATUS_BADGE_CLASSES: Record<AdminTenant["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  suspended: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  archived: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

function StatusBadge({ status }: { status: AdminTenant["status"] }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE_CLASSES[status]}`}
    >
      {status}
    </span>
  );
}

export function TenantsPage() {
  const {
    data: tenants = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useTenantsQuery();
  const createTenant = useCreateTenantMutation();
  const updateTenant = useUpdateTenantMutation();
  const impersonate = useImpersonateTenantMutation();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AdminTenant | null>(null);
  const [impersonateError, setImpersonateError] = useState<string | null>(
    null,
  );
  const [impersonatingId, setImpersonatingId] = useState<number | null>(null);

  const handleCreate = async (payload: AdminCreateTenantPayload) => {
    setCreateError(null);
    try {
      await createTenant.mutateAsync(payload);
      setIsAddOpen(false);
    } catch (err) {
      // requestJson throws ApiError (with .message) on non-2xx, e.g. the
      // 409 duplicate-slug case — surface it verbatim in the form.
      setCreateError(
        err instanceof Error ? err.message : "Failed to create tenant",
      );
    }
  };

  const confirmToggleStatus = async () => {
    if (!confirmTarget) return;
    const nextStatus =
      confirmTarget.status === "active" ? "suspended" : "active";
    try {
      await updateTenant.mutateAsync({
        id: confirmTarget.id,
        patch: { status: nextStatus },
      });
    } finally {
      setConfirmTarget(null);
    }
  };

  const handleConnect = async (tenant: AdminTenant) => {
    setImpersonateError(null);
    setImpersonatingId(tenant.id);
    try {
      const { tenantName, token, username } = await impersonate.mutateAsync(
        tenant.id,
      );
      // tenantName (and username, if the backend provides it) travel via the
      // URL because the new tab only has access to what's in the URL —
      // bootstrapImpersonationSession() stashes both into sessionStorage on
      // load (see features/admin/utils/impersonation.ts).
      const params = new URLSearchParams({ impersonation_token: token });
      if (tenantName) params.set("tenant_name", tenantName);
      if (username) params.set("username", username);
      window.open(`/?${params.toString()}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      setImpersonateError(
        err instanceof Error
          ? err.message
          : "Failed to start impersonation",
      );
    } finally {
      setImpersonatingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        Loading tenants...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full flex items-center justify-center text-red-400">
        {error instanceof Error ? error.message : "Failed to load tenants"}
      </div>
    );
  }

  return (
    <div className="h-full p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Tenants</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => {
              setCreateError(null);
              setIsAddOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add tenant
          </button>
        </div>
      </div>

      {impersonateError && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-300 text-sm">
          {impersonateError}
        </div>
      )}

      {tenants.length === 0 ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-10 text-center text-slate-400">
          No tenants yet. Click &quot;Add tenant&quot; to provision the first
          one.
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-900">
              <tr>
                <th className="text-left text-xs text-slate-400 px-4 py-3">
                  Name
                </th>
                <th className="text-left text-xs text-slate-400 px-4 py-3">
                  Slug
                </th>
                <th className="text-left text-xs text-slate-400 px-4 py-3">
                  Status
                </th>
                <th className="text-left text-xs text-slate-400 px-4 py-3">
                  Users
                </th>
                <th className="text-left text-xs text-slate-400 px-4 py-3">
                  Last activity
                </th>
                <th className="text-left text-xs text-slate-400 px-4 py-3">
                  Created
                </th>
                <th className="text-right text-xs text-slate-400 px-4 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-slate-700/50">
                  <td className="px-4 py-3 text-sm text-white">
                    {tenant.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {tenant.slug}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={tenant.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-white">
                    {tenant.user_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {tenant.last_activity
                      ? new Date(tenant.last_activity).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {new Date(tenant.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {tenant.status !== "archived" && (
                        <button
                          onClick={() => setConfirmTarget(tenant)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                          {tenant.status === "active"
                            ? "Suspend"
                            : "Activate"}
                        </button>
                      )}
                      {tenant.status === "active" && (
                        <button
                          onClick={() => handleConnect(tenant)}
                          disabled={impersonatingId === tenant.id}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium transition-colors"
                        >
                          <ExternalLink size={12} />
                          {impersonatingId === tenant.id
                            ? "Connecting..."
                            : "Connect as admin"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddTenantModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onSubmit={handleCreate}
        isSubmitting={createTenant.isPending}
        error={createError}
      />

      <ConfirmModal
        isOpen={confirmTarget != null}
        title={
          confirmTarget?.status === "active"
            ? "Suspend tenant?"
            : "Activate tenant?"
        }
        message={
          confirmTarget?.status === "active"
            ? `This blocks all logins for "${confirmTarget?.name}" until reactivated.`
            : `This restores login access for "${confirmTarget?.name}".`
        }
        confirmLabel={confirmTarget?.status === "active" ? "Suspend" : "Activate"}
        variant={confirmTarget?.status === "active" ? "danger" : "info"}
        onConfirm={confirmToggleStatus}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}

export default TenantsPage;
