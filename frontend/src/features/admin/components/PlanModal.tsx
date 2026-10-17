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
import { useTranslation } from "react-i18next";
import { X, Check, KeyRound, Copy, AlertTriangle } from "lucide-react";
import {
  useUpdateSubscriptionMutation,
  useIssueLicenseKeyMutation,
  useActivateSubscriptionMutation,
  useExtendTrialMutation,
  useSubscriptionHistoryQuery,
} from "../hooks/useSubscriptions";
import {
  UNGATEABLE_MODULES,
  type ActivateSubscriptionInput,
  type ExtendTrialInput,
} from "@liratek/core";
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
  const { t } = useTranslation("admin");
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
  // LIRA-332: the trial actions and the per-shop history.
  const activate = useActivateSubscriptionMutation();
  const extend = useExtendTrialMutation();
  const history = useSubscriptionHistoryQuery(subscription.tenant_id);
  const [activateOpenEnded, setActivateOpenEnded] = useState(true);
  const [activateUntil, setActivateUntil] = useState("");
  const [extendLastDay, setExtendLastDay] = useState(
    subscription.trial?.lastDay ?? "",
  );
  const onTrial =
    subscription.standing === "trial" ||
    subscription.standing === "trial_ended";
  // Extend is also offered to an owner-created shop that pays nothing yet
  // (active, no period, no grace) — the server re-checks (data-model).
  const canExtend =
    onTrial ||
    (subscription.standing === "active" &&
      !subscription.current_period_end &&
      !subscription.grace_ends_at);

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
      setError(
        err instanceof Error ? err.message : t("plan.failed", { label }),
      );
    }
  };

  const saveModules = () =>
    run(t("plan.modulesSaved"), () =>
      update.mutateAsync({
        tenantId: subscription.tenant_id,
        patch: { entitledModules: selected },
      }),
    );

  const recordPayment = () =>
    run(t("plan.paymentRecorded"), () =>
      update.mutateAsync({
        tenantId: subscription.tenant_id,
        // Empty means "no expiry", which is a real choice, not a missing value.
        patch: { periodEnd: periodEnd ? periodEnd : null },
      }),
    );

  const doIssueKey = () =>
    run(t("plan.keyIssuedDone"), async () => {
      const key = await issueKey.mutateAsync(subscription.tenant_id);
      setIssuedKey(key);
    });

  const doActivate = () =>
    run(t("plan.activated"), () => {
      // ONE payload, typed from the schema (rule 21/22).
      const body: ActivateSubscriptionInput = {
        until: activateOpenEnded ? null : activateUntil,
      };
      return activate.mutateAsync({ tenantId: subscription.tenant_id, body });
    });

  const doExtend = () =>
    run(t("plan.extended"), () => {
      const body: ExtendTrialInput = { lastDay: extendLastDay };
      return extend.mutateAsync({ tenantId: subscription.tenant_id, body });
    });

  const busy =
    update.isPending ||
    issueKey.isPending ||
    activate.isPending ||
    extend.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800 rounded-xl border border-slate-700 shadow-xl">
        <div className="flex items-start justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {t("plan.title", { name: subscription.tenant_name })}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {t("plan.status", { slug: subscription.tenant_slug })}
              <span className="text-slate-300">{subscription.status}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("plan.close")}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-8">
          {/* ── LIRA-332: free trial ─────────────────────────────────── */}
          {subscription.trial && (
            <p
              data-testid="plan-trial-state"
              className={`text-sm ${
                subscription.standing === "trial_ended"
                  ? "text-red-400"
                  : "text-sky-300"
              }`}
            >
              {subscription.standing === "trial_ended"
                ? t("plan.trialEnded", { day: subscription.trial.lastDay })
                : t("plan.trialLeft", {
                    n: subscription.trial.daysLeft,
                    day: subscription.trial.lastDay,
                  })}
            </p>
          )}

          {onTrial && (
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-medium text-white">
                  {t("plan.activateTitle")}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {t("plan.activateHint")}
                </p>
              </div>
              <div className="flex flex-wrap gap-4 items-center text-sm text-slate-200">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="activate-end"
                    checked={activateOpenEnded}
                    onChange={() => setActivateOpenEnded(true)}
                    className="accent-emerald-500"
                  />
                  {t("plan.noEndDate")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="activate-end"
                    checked={!activateOpenEnded}
                    onChange={() => setActivateOpenEnded(false)}
                    className="accent-emerald-500"
                  />
                  {t("plan.paidUntil")}
                </label>
                <input
                  type="date"
                  value={activateUntil}
                  data-testid="plan-activate-until"
                  disabled={activateOpenEnded}
                  onChange={(e) => setActivateUntil(e.target.value)}
                  className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-40"
                />
              </div>
              <button
                onClick={doActivate}
                disabled={busy || (!activateOpenEnded && !activateUntil)}
                data-testid="plan-activate-subscription"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg"
              >
                {t("plan.activateTitle")}
              </button>
            </section>
          )}

          {canExtend && (
            <section
              className={`space-y-3 ${onTrial ? "pt-6 border-t border-slate-700" : ""}`}
            >
              <div>
                <h3 className="text-sm font-medium text-white">
                  {t("plan.extendTitle")}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {t("plan.extendHint")}
                </p>
              </div>
              <div className="flex gap-2 items-center">
                <label
                  className="text-xs text-slate-400"
                  htmlFor="plan-extend-last-day"
                >
                  {t("plan.newLastDay")}
                </label>
                <input
                  id="plan-extend-last-day"
                  type="date"
                  value={extendLastDay}
                  data-testid="plan-extend-last-day"
                  onChange={(e) => setExtendLastDay(e.target.value)}
                  className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                />
                <button
                  onClick={doExtend}
                  disabled={busy || !extendLastDay}
                  data-testid="plan-extend-trial"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg"
                >
                  {t("plan.extendTitle")}
                </button>
              </div>
            </section>
          )}

          {/* ── Modules ─────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-white">
                {t("plan.modulesTitle")}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {t("plan.modulesHint")}
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
              {t("plan.everyModule")}
            </label>

            {!unrestricted && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 ps-6">
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
              {t("plan.saveModules")}
            </button>
          </section>

          {/* ── Payment ─────────────────────────────────────────────── */}
          <section className="space-y-3 pt-6 border-t border-slate-700">
            <div>
              <h3 className="text-sm font-medium text-white">
                {t("plan.paymentTitle")}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {t("plan.paymentHint")}
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
                {t("plan.recordPayment")}
              </button>
            </div>
            {subscription.grace_ends_at && (
              <p className="text-xs text-amber-400">
                {t("plan.graceUntil", {
                  date: subscription.grace_ends_at.slice(0, 10),
                })}
              </p>
            )}
          </section>

          {/* ── Desktop licence key ─────────────────────────────────── */}
          <section className="space-y-3 pt-6 border-t border-slate-700">
            <div>
              <h3 className="text-sm font-medium text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-violet-400" />
                {t("plan.keyTitle")}
              </h3>
              <p className="text-xs text-slate-400 mt-1">{t("plan.keyHint")}</p>
            </div>

            <p className="text-xs text-slate-400">
              {subscription.license_key ? t("plan.keyIssued") : t("plan.noKey")}
            </p>

            <button
              onClick={doIssueKey}
              disabled={busy}
              data-testid="plan-issue-key"
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:text-slate-500 text-white text-sm rounded-lg"
            >
              {subscription.license_key ? t("plan.issueNew") : t("plan.issue")}
            </button>

            {issuedKey && (
              <div className="bg-slate-900 border border-violet-500/40 rounded-lg p-3 space-y-2">
                <p className="text-xs text-amber-300 flex items-start gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {t("plan.copyNow")}
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
                    title={t("plan.copy")}
                    className="text-slate-400 hover:text-white"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── LIRA-332: history ───────────────────────────────────── */}
          <section className="space-y-2 pt-6 border-t border-slate-700">
            <h3 className="text-sm font-medium text-white">
              {t("plan.history")}
            </h3>
            {(history.data ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">
                {history.isLoading
                  ? t("plan.historyLoading")
                  : t("plan.historyEmpty")}
              </p>
            ) : (
              <ul data-testid="plan-history" className="space-y-1.5 text-xs">
                {(history.data ?? []).map((entry, i) => (
                  <li key={`${entry.at}-${i}`} className="text-slate-300">
                    <span className="text-slate-500">
                      {entry.at.slice(0, 16)}
                    </span>{" "}
                    · {entry.actor} · {entry.summary}
                    {entry.oldValues?.standing !== undefined &&
                      entry.newValues?.standing !== undefined && (
                        <span className="text-slate-400">
                          {" "}
                          ({String(entry.oldValues.standing)} →{" "}
                          {String(entry.newValues.standing)})
                        </span>
                      )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Ungateable, stated once so the checkbox list needs no footnotes */}
          <p className="text-xs text-slate-500">
            {t("plan.alwaysIncluded", {
              modules: UNGATEABLE_MODULES.join(", "),
            })}
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
