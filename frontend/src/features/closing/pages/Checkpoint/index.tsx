/**
 * Per-Drawer Checkpoint Modal (single page)
 *
 * Performs a checkpoint for a single drawer. Fields pre-fill with the
 * system-expected balance; the cashier edits only what differs. Each field
 * shows a live three-tier variance status (green match / amber within tolerance
 * / red beyond tolerance), and notes live on the same page — no wizard steps.
 */

import { useEffect, useRef, useState } from "react";
import logger from "@/utils/logger";
import type { DrawerType } from "../../types";
import { DRAWER_CONFIGS } from "../../config/drawers";
import { useCurrencies } from "../../hooks/useCurrencies";
import { useDrawerAmounts } from "../../hooks/useDrawerAmounts";
import { useSystemExpected } from "../../hooks/useSystemExpected";
import { DrawerCard } from "../../components/DrawerCard";
import {
  getVarianceStatus,
  formatCurrencyAmount,
  type VarianceStatus,
} from "../../utils/variance";
import { appEvents, useApi } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { generateClosingReport } from "../../utils/closingReportGenerator";
import { X } from "lucide-react";
import { useShopBase } from "@/hooks/useShopBase";

interface CheckpointModalProps {
  isOpen: boolean;
  drawerName: string;
  onClose: () => void;
}

/** Save-button styling per overall status. */
const SAVE_STYLES: Record<VarianceStatus, string> = {
  match: "bg-green-600 hover:bg-green-500",
  within: "bg-amber-600 hover:bg-amber-500",
  beyond: "bg-red-600 hover:bg-red-500",
};

export default function CheckpointModal({
  isOpen,
  drawerName,
  onClose,
}: CheckpointModalProps) {
  useModalFocusFix(isOpen);
  const api = useApi();
  const { user } = useAuth();
  const drawer = drawerName as DrawerType;
  const drawerConfig = DRAWER_CONFIGS[drawer];

  const { partnerSystem } = useShopBase();
  const [hasActivePartner, setHasActivePartner] = useState(true);
  const partnerDrawerName = `${partnerSystem === "WHISH" ? "Whish" : "OMT"}_System`;

  useEffect(() => {
    if (isOpen) {
      window.api.partners
        .getAll(false)
        .then((partners: Array<{ system_association: string | null }>) => {
          const exists = partners.some(
            (p) => p.system_association === partnerSystem,
          );
          setHasActivePartner(exists);
        })
        .catch(() => setHasActivePartner(false));
    }
  }, [isOpen, partnerSystem]);

  const isPartnerDrawerInactive =
    drawerName === partnerDrawerName && !hasActivePartner;

  const {
    currencies,
    loading: currenciesLoading,
    error: currenciesError,
  } = useCurrencies();

  const drawerAmounts = useDrawerAmounts({ currencies });
  const {
    systemExpected,
    fetchSystemExpected,
  } = useSystemExpected();

  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [varianceThresholdPct, setVarianceThresholdPct] = useState(5);
  const [drawerCurrencyConfig, setDrawerCurrencyConfig] = useState<
    Record<string, string[]>
  >({});

  useEffect(() => {
    if (!isOpen) return;
    api
      .getAllDrawerCurrencies()
      .then(setDrawerCurrencyConfig)
      .catch(() => {});
    fetchSystemExpected();
    api
      .getAllSettings()
      .then((settings: { key_name: string; value: string }[]) => {
        const map = new Map(settings.map((s) => [s.key_name, s.value]));
        const pct = Number(map.get("closing_variance_threshold_pct") ?? 5);
        if (isFinite(pct) && pct >= 0) setVarianceThresholdPct(pct);
      })
      .catch((e) => logger.error("[Checkpoint] Failed to load threshold:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const hasInitializedAmounts = useRef(false);
  useEffect(() => {
    if (
      currencies.length > 0 &&
      isOpen &&
      systemExpected &&
      !hasInitializedAmounts.current
    ) {
      drawerAmounts.initializeFromExpected(systemExpected);
      hasInitializedAmounts.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencies, isOpen, systemExpected]);

  useEffect(() => {
    if (!isOpen) {
      hasInitializedAmounts.current = false;
      setNotes("");
      setSaveError(null);
      drawerAmounts.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const allowed = drawerCurrencyConfig[drawerName];
  const drawerCurrencies = allowed
    ? currencies.filter((c) => allowed.includes(c.code))
    : currencies;
  const coreCurrencies = drawerCurrencies.filter((c) =>
    ["USD", "LBP", "EUR", "USDT"].includes(c.code),
  );
  const otherCurrencies =
    drawerName === "General"
      ? drawerCurrencies.filter((c) => !["USD", "LBP", "EUR"].includes(c.code))
      : undefined;

  const getExpectedValue = (_d: DrawerType, code: string): number =>
    systemExpected?.[drawerName]?.[code] ?? 0;

  const handleAmountChange = (d: DrawerType, code: string, value: string) => {
    const numValue = value === "" || value === "-" ? 0 : parseFloat(value);
    drawerAmounts.updateAmount(d, code, isNaN(numValue) ? 0 : numValue);
  };

  const handleResetToExpected = (d: DrawerType, code: string) => {
    drawerAmounts.updateAmount(d, code, getExpectedValue(d, code));
  };

  // Overall status across the editable fields, for the Save button summary.
  const statusFields = [...coreCurrencies, ...(otherCurrencies ?? [])];
  let overallStatus: VarianceStatus = "match";
  const diffs: { code: string; variance: number }[] = [];
  for (const c of statusFields) {
    const { status, variance } = getVarianceStatus(
      drawerAmounts.amounts[drawer]?.[c.code] ?? 0,
      getExpectedValue(drawer, c.code),
      varianceThresholdPct,
    );
    if (status !== "match") diffs.push({ code: c.code, variance });
    if (status === "beyond") overallStatus = "beyond";
    else if (status === "within" && overallStatus === "match")
      overallStatus = "within";
  }

  const saveLabel = (() => {
    if (saving) return "Saving...";
    if (overallStatus === "match" || diffs.length === 0)
      return "Save Checkpoint — Balanced";
    if (diffs.length > 2) return `Save — Variance in ${diffs.length} currencies`;
    const summary = diffs
      .map(
        (d) =>
          `${d.code} ${d.variance > 0 ? "+" : ""}${formatCurrencyAmount(d.variance, d.code)}`,
      )
      .join(", ");
    return `Save — ${summary}`;
  })();

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    const amounts = drawerCurrencies.map((currency) => ({
      drawer_name: drawerName,
      currency_code: currency.code,
      expected_amount: systemExpected?.[drawerName]?.[currency.code] ?? 0,
      physical_amount: drawerAmounts.amounts[drawer]?.[currency.code] ?? 0,
    }));

    const escapeHtml = (s: string): string =>
      s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    try {
      const checkpointData: Parameters<
        typeof window.api.closing.createCheckpoint
      >[0] = {
        user_id: user?.id ?? 0,
        drawer_name: drawerName,
        amounts,
      };
      if (notes) checkpointData.notes = notes;
      const result = await window.api.closing.createCheckpoint(checkpointData);

      if (!result.success) {
        setSaveError(result.error || "Failed to save checkpoint");
        return;
      }

      if (result.id != null) {
        try {
          const dailyStats = await api.getDailyStatsSnapshot();
          const sumByCurrency = (code: string): number =>
            amounts
              .filter((a) => a.currency_code === code)
              .reduce((acc, a) => acc + a.physical_amount, 0);
          const sumExpectedByCurrency = (code: string): number =>
            amounts
              .filter((a) => a.currency_code === code)
              .reduce((acc, a) => acc + a.expected_amount, 0);

          const reportText = generateClosingReport(
            {
              closing_date: new Date().toISOString().split("T")[0],
              drawer_name: drawerName,
              physical: Object.fromEntries(
                currencies.map((c) => [c.code, sumByCurrency(c.code)]),
              ),
              systemExpected: Object.fromEntries(
                currencies.map((c) => [c.code, sumExpectedByCurrency(c.code)]),
              ),
              physical_usd: sumByCurrency("USD"),
              system_expected_usd: sumExpectedByCurrency("USD"),
              physical_lbp: sumByCurrency("LBP"),
              system_expected_lbp: sumExpectedByCurrency("LBP"),
              physical_eur: sumByCurrency("EUR"),
              system_expected_eur: sumExpectedByCurrency("EUR"),
            },
            dailyStats,
          );

          const html = `<!doctype html><html><head><meta charset="utf-8" /><title>Checkpoint Report</title></head><body><pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; white-space: pre-wrap;">${escapeHtml(reportText)}</pre></body></html>`;

          const pdfRes = await api.generatePDF(
            html,
            `checkpoint_${drawerName}_${new Date().toISOString().split("T")[0]}_${Date.now()}.pdf`,
          );

          if (pdfRes?.success && pdfRes.path) {
            await api.updateDailyClosing(Number(result.id), {
              report_path: pdfRes.path,
              ...(user?.id != null ? { user_id: user.id } : {}),
            });
          }
        } catch (reportError) {
          logger.error("[Checkpoint] Report generation error:", reportError);
        }
      }

      appEvents.emit("closing:completed", result);
      onClose();
    } catch (error) {
      logger.error("[Checkpoint] Save error:", error);
      setSaveError(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    const hasInput = statusFields.some((c) => {
      const { status } = getVarianceStatus(
        drawerAmounts.amounts[drawer]?.[c.code] ?? 0,
        getExpectedValue(drawer, c.code),
        varianceThresholdPct,
      );
      return status !== "match";
    });
    const hasNotes = notes.trim().length > 0;
    if (hasInput || hasNotes) {
      if (confirm("You have unsaved changes. Are you sure you want to close?")) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-700 bg-slate-800">
          <div>
            <h2 className="text-xl font-bold text-white">
              Checkpoint — {drawerConfig?.label ?? drawerName}
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Adjust any amount that differs from the expected balance, then
              save.
            </p>
          </div>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {currenciesLoading && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-blue-200 text-sm">Loading currencies...</p>
            </div>
          )}
          {currenciesError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-200 text-sm">Error: {currenciesError}</p>
            </div>
          )}
          {saveError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-200 text-sm">{saveError}</p>
            </div>
          )}

          {!currenciesLoading && !currenciesError && (
            <>
              {currencies.length === 0 ? (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                  <p className="text-yellow-200 text-sm">
                    No active currencies found. Please enable at least one
                    currency in Settings → Currency Manager.
                  </p>
                </div>
              ) : coreCurrencies.length === 0 ? (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                  <p className="text-yellow-200 text-sm">
                    No currencies configured for this drawer.
                  </p>
                </div>
              ) : (
                <div className="relative">
                  {isPartnerDrawerInactive && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-slate-900/80 backdrop-blur-sm border-2 border-slate-600">
                      <div className="text-center px-4">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-slate-700 text-slate-400 uppercase tracking-wide mb-2">
                          Inactive
                        </span>
                        <p className="text-slate-400 text-sm">
                          {partnerSystem} System debt is tracked via Partners.
                        </p>
                        <p className="text-slate-500 text-xs mt-1">
                          No active partner — drawer is read-only.
                        </p>
                      </div>
                    </div>
                  )}
                  <DrawerCard
                    drawer={drawer}
                    currencies={coreCurrencies}
                    {...(otherCurrencies ? { otherCurrencies } : {})}
                    getDisplayValue={(d, c) =>
                      drawerAmounts.getDisplayValue(d, c)
                    }
                    onAmountChange={handleAmountChange}
                    getExpectedValue={getExpectedValue}
                    varianceThresholdPct={varianceThresholdPct}
                    onResetToExpected={handleResetToExpected}
                    disabled={saving || isPartnerDrawerInactive}
                    focusRingColor="violet-500"
                  />
                </div>
              )}

              {/* Notes */}
              <div className="space-y-2">
                <label
                  htmlFor="checkpoint-notes"
                  className="block text-sm font-medium text-slate-300"
                >
                  Notes (Optional)
                </label>
                <textarea
                  id="checkpoint-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={saving}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-violet-600 focus:border-transparent transition-all disabled:opacity-50 resize-none"
                  placeholder="Explain any variances or issues..."
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 p-6 bg-slate-800">
          <div className="flex justify-between items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={
                saving ||
                currenciesLoading ||
                isPartnerDrawerInactive ||
                coreCurrencies.length === 0
              }
              className={`px-6 py-2 ${SAVE_STYLES[overallStatus]} text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed max-w-[70%] truncate`}
            >
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
