/**
 * LIRA-360 — Dashboard "Insurance renewals" card (Credits & Stock row).
 *
 * Lists the customers whose insurance expires within 7 days or has expired
 * without renewal, so the shop can call them. The list comes from core's one
 * rule (`selectInsuranceRenewals`) for the shop's own day (rule 27); this
 * card only shows it. No money is shown (owner decision 2026-10-29).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, Phone } from "lucide-react";
import type { InsuranceRenewal } from "@liratek/core";
import { useApi } from "@liratek/ui";
import { useModules } from "@/contexts/ModuleContext";
import { useFormat } from "@/i18n/useFormat";
import { localDay } from "@/shared/utils/localDay";
import { insuranceTypeLabel } from "@/features/custom-services/utils/labels";
import logger from "@/utils/logger";

export function InsuranceRenewalsCard() {
  const { t } = useTranslation("dashboard");
  const { t: tcs } = useTranslation("customServices");
  const { formatDate } = useFormat();
  const { isModuleEnabled } = useModules();
  const enabled = isModuleEnabled("custom_services");
  const api = useApi();
  // rule 25: read `api` through a ref, never from a dependency list.
  const apiRef = useRef(api);
  apiRef.current = api;

  const [renewals, setRenewals] = useState<InsuranceRenewal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRenewals(
        await apiRef.current.getInsuranceRenewals({ client_day: localDay() }),
      );
    } catch (err) {
      logger.error("Failed to load insurance renewals:", err);
      setError(t("insurance.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  if (!enabled) return null;

  const customerName = (r: InsuranceRenewal) =>
    r.client_name?.trim() || r.description;

  const dueText = (r: InsuranceRenewal) =>
    r.days_left > 0
      ? t("insurance.inDays", { count: r.days_left })
      : r.days_left === 0
        ? t("insurance.today")
        : t("insurance.expiredAgo", { count: -r.days_left });

  const handleWontRenew = async (r: InsuranceRenewal) => {
    if (!window.confirm(t("insurance.confirmWontRenew", { name: customerName(r) })))
      return;
    setBusyId(r.id);
    setError(null);
    try {
      const result = await apiRef.current.dismissInsuranceRenewal({ id: r.id });
      if (result.success) {
        await load();
      } else {
        setError(result.error ?? t("insurance.dismissFailed"));
      }
    } catch (err) {
      logger.error("Failed to dismiss insurance renewal:", err);
      setError(t("insurance.dismissFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      data-testid="insurance-renewals-card"
      // i18n-exempt: accent edge stays physical (border-l), like the other Credits & Stock cards
      className="relative bg-slate-800 p-4 rounded-xl border border-slate-700/40 border-l-2 border-l-sky-500 shadow-lg hover:shadow-sky-500/20 hover:border-sky-500/50 hover:shadow-xl transition-all duration-200 overflow-hidden"
    >
      <div className="absolute -top-5 -end-5 w-20 h-20 rounded-full blur-2xl opacity-15 pointer-events-none bg-sky-500" />
      <div className="relative">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
            <ShieldAlert size={14} />
            {t("insurance.title")}
          </h3>
          {renewals && renewals.length > 0 && (
            <span className="text-xs text-slate-400">
              {t("insurance.total", { count: renewals.length })}
            </span>
          )}
        </div>

        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

        {renewals && renewals.length === 0 && (
          <p
            data-testid="insurance-renewals-empty"
            className="text-sm text-slate-400"
          >
            {t("insurance.empty")}
          </p>
        )}

        {renewals && renewals.length > 0 && (
          <ul className="max-h-40 overflow-y-auto -me-2 pe-2 space-y-1.5">
            {renewals.map((r) => {
              const overdue = r.days_left < 0;
              return (
                <li
                  key={r.id}
                  data-testid={`insurance-renewal-row-${r.id}`}
                  className={`flex items-start gap-2 rounded-lg px-2 py-1.5 border ${
                    overdue
                      ? "bg-red-500/10 border-red-500/30"
                      : "bg-amber-500/10 border-amber-500/30"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {customerName(r)}
                    </p>
                    <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2">
                      {r.phone_number && (
                        <span className="inline-flex items-center gap-1" dir="ltr">
                          <Phone size={10} />
                          {r.phone_number}
                        </span>
                      )}
                      {r.insurance_type && (
                        <span>{insuranceTypeLabel(r.insurance_type, tcs)}</span>
                      )}
                      <span>
                        {t("insurance.expires", { date: formatDate(r.expiry_day) })}
                      </span>
                    </p>
                    <p
                      className={`text-xs font-semibold ${
                        overdue ? "text-red-300" : "text-amber-300"
                      }`}
                    >
                      {dueText(r)}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid={`insurance-renewal-dismiss-${r.id}`}
                    onClick={() => void handleWontRenew(r)}
                    disabled={busyId === r.id}
                    className="shrink-0 text-[10px] px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    {t("insurance.wontRenew")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
