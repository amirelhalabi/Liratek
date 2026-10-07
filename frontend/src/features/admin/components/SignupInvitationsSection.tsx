import { useState } from "react";
import { MailWarning } from "lucide-react";
import { ConfirmModal } from "@liratek/ui";
import type { SignupInvitationView } from "@/api/backendApi";
import type { ListSignupInvitationsQuery } from "@liratek/core";
import { messageFrom } from "@/api/apiError";
import {
  useSignupInvitationsQuery,
  useRevokeSignupInvitationMutation,
} from "../hooks/useSignupInvitations";

const STATUS_CLASSES: Record<SignupInvitationView["status"], string> = {
  pending: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  used: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  expired: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  revoked: "bg-red-500/15 text-red-300 border-red-500/30",
};

type Delivery = NonNullable<SignupInvitationView["emailDelivery"]>;

const DELIVERY_LABEL: Record<Delivery["status"], string> = {
  queued: "Queued",
  accepted: "Accepted",
  failed: "Failed",
};

const DELIVERY_CLASSES: Record<Delivery["status"], string> = {
  queued: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  accepted: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-300 border-red-500/30",
};

type SourceFilter = NonNullable<ListSignupInvitationsQuery["source"]> | "all";

const SOURCE_FILTERS: ReadonlyArray<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "admin", label: "Admin" },
  { value: "self", label: "Self" },
];

const badge =
  "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border";

/** ISO instant -> the viewer's local date and time. */
function formatInstant(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function DeliveryBadge({ delivery }: { delivery: Delivery | null }) {
  if (!delivery) return <span className="text-slate-500">—</span>;
  // The failure reason (already redacted server-side) is the one thing the
  // owner needs to act on a failed send — a tooltip keeps the table narrow.
  const title =
    delivery.status === "failed"
      ? (delivery.lastError ?? "Sending failed")
      : delivery.status === "accepted"
        ? `Accepted ${formatInstant(delivery.sentAt)}`
        : delivery.attempts > 0
          ? `Retrying (${delivery.attempts} attempts so far)`
          : "Waiting to be sent";
  return (
    <span className={`${badge} ${DELIVERY_CLASSES[delivery.status]}`} title={title}>
      {DELIVERY_LABEL[delivery.status]}
    </span>
  );
}

/**
 * Sign-up invitations on the Tenants page (LIRA-267 US2): every recent link,
 * where its email got to, and Revoke for links that still work.
 *
 * A separate query from the tenants list, like the plan column: if it fails
 * the tenants table still renders.
 */
export function SignupInvitationsSection() {
  // LIRA-278: self-serve requests can be reviewed (and revoked) on their own.
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const { data, isLoading, isError, error } = useSignupInvitationsQuery(
    sourceFilter === "all" ? undefined : sourceFilter,
  );
  const revoke = useRevokeSignupInvitationMutation();
  const [revokeTarget, setRevokeTarget] = useState<SignupInvitationView | null>(
    null,
  );
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    setRevokeError(null);
    try {
      await revoke.mutateAsync(revokeTarget.id);
    } catch (err) {
      setRevokeError(messageFrom(err, "Failed to revoke the invitation"));
    } finally {
      setRevokeTarget(null);
    }
  };

  const invitations = data?.invitations ?? [];

  return (
    <section className="mt-8" aria-labelledby="invitations-heading">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2
          id="invitations-heading"
          className="text-lg font-semibold text-white"
        >
          Invitations
        </h2>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          Source
          <select
            data-testid="invitations-source-filter"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-orange-500"
          >
            {SOURCE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data && !data.emailConfigured && (
        <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-200 text-sm">
          <MailWarning size={16} className="mt-0.5 shrink-0" />
          <span>
            Email not configured — invites cannot be sent from this server.
            Use &quot;Add tenant&quot; to create shops until it is set up.
          </span>
        </div>
      )}

      {revokeError && (
        <div className="mb-3 p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-300 text-sm">
          {revokeError}
        </div>
      )}

      {isLoading ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-6 text-center text-slate-400 text-sm">
          Loading invitations...
        </div>
      ) : isError ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-6 text-center text-red-400 text-sm">
          {messageFrom(error, "Failed to load invitations")}
        </div>
      ) : invitations.length === 0 ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-6 text-center text-slate-400 text-sm">
          No invitations yet.
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-x-auto">
          <table className="w-full" data-testid="invitations-table">
            <thead className="bg-slate-900">
              <tr>
                <th className="text-left text-xs text-slate-400 px-4 py-3">Email</th>
                <th className="text-left text-xs text-slate-400 px-4 py-3">Source</th>
                <th className="text-left text-xs text-slate-400 px-4 py-3">Sent</th>
                <th className="text-left text-xs text-slate-400 px-4 py-3">Expires</th>
                <th className="text-left text-xs text-slate-400 px-4 py-3">Status</th>
                <th className="text-left text-xs text-slate-400 px-4 py-3">Email</th>
                <th className="text-right text-xs text-slate-400 px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {invitations.map((inv) => (
                <tr
                  key={inv.id}
                  data-email={inv.email}
                  className="hover:bg-slate-700/50"
                >
                  <td className="px-4 py-3 text-sm text-white">
                    {inv.email}
                    {inv.shopNameHint && (
                      <span className="block text-xs text-slate-500">
                        {inv.shopNameHint}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-300">
                    {inv.source === "admin" ? "Admin" : "Self"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {formatInstant(inv.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {formatInstant(inv.expiresAt)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`${badge} ${STATUS_CLASSES[inv.status]}`}>
                      {inv.status}
                    </span>
                    {inv.usedByTenant && (
                      <span className="ml-2 text-xs text-slate-400">
                        → {inv.usedByTenant.slug}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <DeliveryBadge delivery={inv.emailDelivery} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {inv.status === "pending" && (
                      <button
                        onClick={() => setRevokeTarget(inv)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        isOpen={revokeTarget != null}
        title="Revoke invite?"
        message={`The link sent to ${revokeTarget?.email ?? ""} will stop working. You can send a new invite later.`}
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </section>
  );
}

export default SignupInvitationsSection;
