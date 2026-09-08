/**
 * The owner's plan editor for one tenant.
 *
 * Three jobs that used to require curl: choose which modules a customer pays
 * for, record a payment, and issue a desktop licence key.
 *
 * The design decision worth knowing: each section SAVES SEPARATELY. It is
 * tempting to have one Save button send everything, but the API applies only
 * the fields present precisely so that recording a payment cannot touch an
 * allowlist — and a single button would undo that protection by always sending
 * both. Separate buttons make the API's guarantee visible in the UI.
 */

import { useState } from "react";
import { X, Check, KeyRound, Copy, AlertTriangle } from "lucide-react";
import {
  useUpdateSubscriptionMutation,
  useIssueLicenseKeyMutation,
} from "../hooks/useSubscriptions";
import { UNGATEABLE_MODULES } from "@liratek/core";
import type { AdminSubscription } from "@/api/backendApi";
import logger from "@/utils/logger";

interface Props {
  subscription: AdminSubscription;
  /** Sellable module keys, from the server's own catalogue. */
  sellableModules: string[];
  onClose: () => void;
}

/**
 * The stored allowlist is RAW JSON text. Parsed here rather than server-side
 * so the raw value stays visible in the API for debugging, and parsed
 * defensively for the same reason the service does: a corrupt column must read
 * as "everything", never as "nothing".
 */
function parseModules(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((m): m is string => typeof m === "string");
  } catch {
    logger.warn("entitled_modules is not valid JSON; treating as ALL");
    return null;
  }
}

export function PlanModal({ subscription, sellableModules, onClose }: Props) {
  const stored = parseModules(subscription.entitled_modules);

  /** null = unrestricted. Kept distinct from [] , which means nothing. */
  const [selected, setSelected] = useState<string[] | null>(stored);
  const [periodEnd, setPeriodEnd] = useState(
    subscription.current_period_end?.slice(0, 10) ?? "",
  );
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const update = useUpdateSubscriptionMutation();
  const issueKey = useIssueLicenseKeyMutation();

  // NO resync effect here, deliberately. An effect keyed on
  // `subscription` looked like good hygiene and was a BUG: saving
  // invalidates the query, a fresh object arrives, the effect fires and
  // wipes `issuedKey` -- so the licence key the owner has to copy would
  // vanish a moment after being shown, and it cannot be retrieved again.
  //
  // The parent passes `key={tenant_id}` instead, so switching tenants
  // remounts this component and every field initialises from props once.
  // React's own remount is the resync.

  const unrestricted = selected === null;

  const toggle = (key: string) => {
    setSelected((prev) => {
      // First tick from "everything" starts from everything, so the owner
      // narrows a plan rather than rebuilding it from nothing.
      const base = prev ?? sellableModules;
      return base.includes(key)
        ? base.filter((k) => k !== key)
        : [...base, key];
    });
  };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setSaved(null);
    try {
      await fn();
      setSaved(label);
    } catch (err) {
      logger.error(`${label} failed:`, err);
      setError(err instanceof Error ? err.message : `${label} failed`);
    }
  };

  const saveModules = () =>
    run("Modules saved", () =>
      update.mutateAsync({
        tenantId: subscription.tenant_id,
        patch: { entitledModules: selected },
      }),
    );

  const recordPayment = () =>
    run("Payment recorded", () =>
      update.mutateAsync({
        tenantId: subscription.tenant_id,
        // Empty means "no expiry", which is a real choice, not a missing value.
        patch: { periodEnd: periodEnd ? periodEnd : null },
      }),
    );

  const doIssueKey = () =>
    run("Licence key issued", async () => {
      const key = await issueKey.mutateAsync(subscription.tenant_id);
      setIssuedKey(key);
    });

  const busy = update.isPending || issueKey.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800 rounded-xl border border-slate-700 shadow-xl">
        <div className="flex items-start justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Plan — {subscription.tenant_name}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {subscription.tenant_slug} · status{" "}
              <span className="text-slate-300">{subscription.status}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-8">
          {/* ── Modules ─────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-white">
                Modules this customer pays for
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                The customer still chooses what to switch on — this is the
                ceiling, not the setting. Dashboard, Settings, Audit and Closing
                are always included and cannot be sold separately.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                data-testid="plan-unrestricted"
                checked={unrestricted}
                onChange={(e) =>
                  setSelected(e.target.checked ? null : sellableModules)
                }
                className="accent-violet-500"
              />
              Every module (no restriction)
            </label>

            {!unrestricted && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-6">
                {sellableModules.map((key) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-sm text-slate-300"
                  >
                    <input
                      type="checkbox"
                      data-testid={`plan-module-${key}`}
                      checked={selected?.includes(key) ?? false}
                      onChange={() => toggle(key)}
                      className="accent-violet-500"
                    />
                    {key}
                  </label>
                ))}
              </div>
            )}

            <button
              onClick={saveModules}
              disabled={busy}
              data-testid="plan-save-modules"
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg"
            >
              Save modules
            </button>
          </section>

          {/* ── Payment ─────────────────────────────────────────────── */}
          <section className="space-y-3 pt-6 border-t border-slate-700">
            <div>
              <h3 className="text-sm font-medium text-white">
                Record a payment
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Sets the plan back to active and runs it until this date. Leave
                it empty for no expiry. Grace resets, so a later lapse gets a
                full window.
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={periodEnd}
                data-testid="plan-period-end"
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
              />
              <button
                onClick={recordPayment}
                disabled={busy}
                data-testid="plan-record-payment"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg"
              >
                Record payment
              </button>
            </div>
            {subscription.grace_ends_at && (
              <p className="text-xs text-amber-400">
                Currently in grace until{" "}
                {subscription.grace_ends_at.slice(0, 10)}.
              </p>
            )}
          </section>

          {/* ── Desktop licence key ─────────────────────────────────── */}
          <section className="space-y-3 pt-6 border-t border-slate-700">
            <div>
              <h3 className="text-sm font-medium text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-violet-400" />
                Desktop licence key
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Only needed for a customer running the desktop app. Without a
                key their install is unrestricted — issuing one is what lets
                this plan reach it.
              </p>
            </div>

            <p className="text-xs text-slate-400">
              {subscription.license_key
                ? "A key is currently issued."
                : "No key issued."}
            </p>

            <button
              onClick={doIssueKey}
              disabled={busy}
              data-testid="plan-issue-key"
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:text-slate-500 text-white text-sm rounded-lg"
            >
              {subscription.license_key
                ? "Issue a new key (revokes the old one)"
                : "Issue a key"}
            </button>

            {issuedKey && (
              <div className="bg-slate-900 border border-violet-500/40 rounded-lg p-3 space-y-2">
                <p className="text-xs text-amber-300 flex items-start gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Copy this now — it is shown once and cannot be retrieved
                  later.
                </p>
                <div className="flex items-center gap-2">
                  <code
                    data-testid="plan-issued-key"
                    className="flex-1 text-sm text-white font-mono break-all"
                  >
                    {issuedKey}
                  </code>
                  <button
                    onClick={() => {
                      void navigator.clipboard?.writeText(issuedKey);
                    }}
                    title="Copy"
                    className="text-slate-400 hover:text-white"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Ungateable, stated once so the checkbox list needs no footnotes */}
          <p className="text-xs text-slate-500">
            Always included: {UNGATEABLE_MODULES.join(", ")}.
          </p>

          {saved && (
            <div
              role="status"
              className="flex items-center gap-2 text-sm text-emerald-400"
            >
              <Check className="w-4 h-4" />
              {saved}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 text-sm text-red-400"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PlanModal;
