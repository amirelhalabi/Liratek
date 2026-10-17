import { useState } from "react";
import { Plus, ExternalLink, RefreshCw, Send } from "lucide-react";
import { ConfirmModal } from "@liratek/ui";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { useFormat } from "@/i18n/useFormat";
import {
  useTenantsQuery,
  useCreateTenantMutation,
  useUpdateTenantMutation,
  useImpersonateTenantMutation,
} from "../../hooks/useTenants";
import { AddTenantModal } from "../../components/AddTenantModal";
import { SendInviteModal } from "../../components/SendInviteModal";
import { SignupInvitationsSection } from "../../components/SignupInvitationsSection";
import { PlanModal } from "../../components/PlanModal";
import { DeleteTenantModal } from "../../components/DeleteTenantModal";
import { useSubscriptionsQuery } from "../../hooks/useSubscriptions";
import type {
  AdminTenant,
  AdminCreateTenantPayload,
  AdminSubscription,
} from "@/api/backendApi";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { messageFrom } from "@/api/apiError";

/** en-US output identical to the old `toLocaleString()`. */
const FULL_DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

/** en-US output identical to the old `toLocaleDateString()`. */
const NUMERIC_DATE: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
};

const STATUS_BADGE_CLASSES: Record<AdminTenant["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  suspended: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  archived: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

function StatusBadge({ status }: { status: AdminTenant["status"] }) {
  const { t } = useTranslation("admin");
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE_CLASSES[status]}`}
    >
      {t(`tenants.status.${status}`)}
    </span>
  );
}

/**
 * A tenant's plan at a glance: standing, plus how restricted it is.
 *
 * "—" means no subscription row, which the whole stack reads as
 * unrestricted. Said as a dash rather than as an alarming label, because
 * it is the normal state for anything that predates subscriptions.
 */
function PlanCell({ row }: { row: AdminSubscription | undefined }) {
  const { t } = useTranslation("admin");
  if (!row) return <span className="text-slate-500">—</span>;

  // LIRA-332: the server's trial view, verbatim (no date math here).
  if (row.standing === "trial" && row.trial) {
    const left =
      row.trial.daysLeft === 1
        ? t("tenants.trial.oneDayLeft")
        : t("tenants.trial.daysLeft", { n: row.trial.daysLeft });
    return (
      <span className={row.trial.endsSoon ? "text-amber-400" : "text-sky-300"}>
        {t("tenants.trial.active", { left, day: row.trial.lastDay })}
      </span>
    );
  }
  if (row.standing === "trial_ended" && row.trial) {
    return (
      <span className="text-red-400">
        {t("tenants.trial.ended", { day: row.trial.lastDay })}
      </span>
    );
  }

  const modules = row.entitled_modules;
  let scope = t("tenants.allModules");
  if (modules) {
    try {
      const parsed: unknown = JSON.parse(modules);
      if (Array.isArray(parsed))
        scope = t("tenants.nModules", { count: parsed.length });
    } catch {
      // Unparseable reads as unrestricted everywhere else; stay consistent
      // rather than showing an error in a table cell.
      scope = t("tenants.allModules");
    }
  }

  const tone =
    row.status === "active"
      ? "text-slate-300"
      : row.status === "grace"
        ? "text-amber-400"
        : "text-red-400";

  return (
    <span className={tone}>
      {scope}
      {row.status !== "active" &&
        t("tenants.planStatus", {
          status: t(`tenants.planState.${row.status}`),
        })}
    </span>
  );
}

export function TenantsPage() {
  const { t } = useTranslation("admin");
  const { formatDate, formatDateTime } = useFormat();
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
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AdminTenant | null>(null);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<number | null>(null);
  const [planTenantId, setPlanTenantId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminTenant | null>(null);

  // A SEPARATE query from the tenants list rather than one joined payload:
  // the plan column is additive, so if this request fails the table still
  // renders and Connect-as-admin still works. Losing the whole tenant list
  // because a plan lookup failed would be the worse trade.
  const { data: subs } = useSubscriptionsQuery();
  const subscriptions = subs?.subscriptions ?? [];
  const sellableModules = subs?.sellableModules ?? [];
  const planFor = (tenantId: number) =>
    subscriptions.find((row) => row.tenant_id === tenantId);
  const planTenant = planTenantId === null ? null : planFor(planTenantId);

  const handleCreate = async (payload: AdminCreateTenantPayload) => {
    setCreateError(null);
    try {
      await createTenant.mutateAsync(payload);
      setIsAddOpen(false);
    } catch (err) {
      // requestJson throws a PLAIN `{ status, message }` object on non-2xx
      // (e.g. the 409 duplicate-slug / EMAIL_ALREADY_HAS_SHOP cases), whose
      // `message` is itself `{ code, message }` — not an Error. messageFrom
      // unwraps every shape so the server's words reach the form.
      setCreateError(messageFrom(err, t("tenants.createFailed")));
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
      const { tenantName, token, username, targetOrigin } =
        await impersonate.mutateAsync(tenant.id);
      // tenantName (and username, if the backend provides it) travel via the
      // URL because the new tab only has access to what's in the URL —
      // bootstrapImpersonationSession() stashes both into sessionStorage on
      // load (see features/admin/utils/impersonation.ts).
      const params = new URLSearchParams({ impersonation_token: token });
      if (tenantName) params.set("tenant_name", tenantName);
      if (username) params.set("username", username);

      // Open the session on the TENANT'S OWN origin when there is one.
      //
      // This was a relative `/?…`, which opens on the current origin — the
      // control plane's, i.e. the platform host. Since `www` became platform-
      // only, no tenant user ever signs in there, so impersonating on it means
      // testing the app on the one host the customer never sees.
      //
      // The token already crosses origins safely: sessionStorage is per-origin
      // exactly like localStorage, which is why impersonation has always
      // passed its token through the URL. Changing the base is all this needs
      // — the handoff itself is unchanged.
      //
      // Falls back to relative when targetOrigin is null (no APP_BASE_DOMAIN,
      // e.g. local dev), preserving the old behaviour rather than opening a
      // hostname that does not resolve.
      const href = targetOrigin
        ? `${targetOrigin}/?${params.toString()}`
        : `/?${params.toString()}`;
      window.open(href, "_blank", "noopener,noreferrer");
    } catch (err) {
      setImpersonateError(
        err instanceof Error ? err.message : t("tenants.impersonateFailed"),
      );
    } finally {
      setImpersonatingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        {t("tenants.loading")}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full flex items-center justify-center text-red-400">
        {error instanceof Error ? error.message : t("tenants.loadFailed")}
      </div>
    );
  }

  return (
    <div className="h-full p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">{t("tenants.title")}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
            title={t("tenants.refresh")}
          >
            <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setIsInviteOpen(true)}
            className="flex items-center gap-2 px-4 py-2 border border-orange-500/60 text-orange-300 hover:bg-orange-500/10 text-sm font-semibold rounded-lg transition-colors"
          >
            <Send size={16} />
            {t("tenants.sendInvite")}
          </button>
          <button
            onClick={() => {
              setCreateError(null);
              setIsAddOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <Plus size={16} />
            {t("tenants.addTenant")}
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
          {t("tenants.empty")}
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-900">
              <tr>
                <th className="text-start text-xs text-slate-400 px-4 py-3">
                  {t("tenants.colName")}
                </th>
                <th className="text-start text-xs text-slate-400 px-4 py-3">
                  {t("tenants.colSlug")}
                </th>
                <th className="text-start text-xs text-slate-400 px-4 py-3">
                  {t("tenants.colStatus")}
                </th>
                <th className="text-start text-xs text-slate-400 px-4 py-3">
                  {t("tenants.colUsers")}
                </th>
                <th className="text-start text-xs text-slate-400 px-4 py-3">
                  {t("tenants.colPlan")}
                </th>
                <th className="text-start text-xs text-slate-400 px-4 py-3">
                  {t("tenants.colLastActivity")}
                </th>
                <th className="text-start text-xs text-slate-400 px-4 py-3">
                  {t("tenants.colCreated")}
                </th>
                <th className="text-end text-xs text-slate-400 px-4 py-3">
                  {t("tenants.colActions")}
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
                    {formatNumber(tenant.user_count)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <PlanCell row={planFor(tenant.id)} />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {tenant.last_activity
                      ? formatDateTime(
                          parseDbDate(tenant.last_activity),
                          FULL_DATE_TIME,
                        )
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {formatDate(parseDbDate(tenant.created_at), NUMERIC_DATE)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {/* Tenant 1 is undeletable server-side; disabling it
                          here explains why instead of letting the click
                          come back as an error. */}
                      <button
                        onClick={() => setDeleteTarget(tenant)}
                        disabled={tenant.id === 1}
                        title={
                          tenant.id === 1
                            ? t("tenants.deleteDefault")
                            : t("tenants.deleteHint")
                        }
                        className="text-xs px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      >
                        {t("tenants.delete")}
                      </button>
                      <button
                        onClick={() => setPlanTenantId(tenant.id)}
                        disabled={!planFor(tenant.id)}
                        title={
                          planFor(tenant.id)
                            ? t("tenants.managePlan")
                            : t("tenants.noSubscription")
                        }
                        className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40 transition-colors"
                      >
                        {t("tenants.plan")}
                      </button>
                      {tenant.status !== "archived" && (
                        <button
                          onClick={() => setConfirmTarget(tenant)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                          {tenant.status === "active"
                            ? t("tenants.suspend")
                            : t("tenants.activate")}
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
                            ? t("tenants.connecting")
                            : t("tenants.connect")}
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

      <SignupInvitationsSection />

      {deleteTarget && (
        <DeleteTenantModal
          tenant={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => setDeleteTarget(null)}
        />
      )}

      {planTenant && (
        <PlanModal
          // Remount per tenant: PlanModal initialises its fields from
          // props and has no resync effect, on purpose (see there).
          key={planTenant.tenant_id}
          subscription={planTenant}
          sellableModules={sellableModules}
          onClose={() => setPlanTenantId(null)}
        />
      )}

      <SendInviteModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
      />

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
            ? t("tenants.suspendTitle")
            : t("tenants.activateTitle")
        }
        message={
          confirmTarget?.status === "active"
            ? t("tenants.suspendMessage", { name: confirmTarget?.name ?? "" })
            : t("tenants.activateMessage", { name: confirmTarget?.name ?? "" })
        }
        confirmLabel={
          confirmTarget?.status === "active"
            ? t("tenants.suspend")
            : t("tenants.activate")
        }
        variant={confirmTarget?.status === "active" ? "danger" : "info"}
        onConfirm={confirmToggleStatus}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}

export default TenantsPage;
