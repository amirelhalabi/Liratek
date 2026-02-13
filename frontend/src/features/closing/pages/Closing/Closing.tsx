/**
 * Closing Modal - Simplified Design
 * Matches platform design language
 */

import { useEffect, useState } from "react";
import type { DrawerType } from "../../types";
import { DRAWER_ORDER } from "../../config/drawers";
import { useCurrencies } from "../../hooks/useCurrencies";
import { useDrawerAmounts } from "../../hooks/useDrawerAmounts";
import { useSystemExpected } from "../../hooks/useSystemExpected";
import { DrawerCard } from "../../components/DrawerCard";
import { VarianceCard } from "../../components/VarianceCard";
import { AlertBanner } from "../../components/AlertBanner";
import { appEvents } from "../../../../shared/utils/appEvents";
import * as api from "../../../../api/backendApi";
import { useAuth } from "../../../auth/context/AuthContext";
import { generateClosingReport } from "../../utils/closingReportGenerator";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface ClosingProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Closing({ isOpen, onClose }: ClosingProps) {
  const { user } = useAuth();
  const {
    currencies,
    loading: currenciesLoading,
    error: currenciesError,
  } = useCurrencies();
  const drawerAmounts = useDrawerAmounts({ currencies });
  const {
    systemExpected,
    loading: systemLoading,
    error: systemError,
    fetchSystemExpected,
  } = useSystemExpected();

  const [step, setStep] = useState(1);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const [varianceThresholdPct, setVarianceThresholdPct] = useState(5);

  // Initialize amounts when currencies are loaded
  useEffect(() => {
    if (currencies.length > 0 && isOpen) {
      drawerAmounts.initializeAmounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencies, isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setNotes("");
      setStepError(null);
      drawerAmounts.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleAmountChange = (
    drawer: DrawerType,
    code: string,
    value: string,
  ) => {
    const numValue = value === "" ? 0 : parseFloat(value);
    drawerAmounts.updateAmount(drawer, code, isNaN(numValue) ? 0 : numValue);
  };

  const handleNextStep = async () => {
    setStepError(null);

    if (step === 1) {
      // Validate amounts
      const validation = drawerAmounts.validate();
      if (!validation.isValid) {
        setStepError(validation.errors.join(", "));
        return;
      }

      if (!drawerAmounts.hasAnyAmounts) {
        setStepError("Please enter at least one amount before proceeding.");
        return;
      }

      // Move to step 2 and fetch expected balances
      setStep(2);
      await fetchSystemExpected();

      // Load variance threshold (defaults to 5%)
      try {
        const settings = await api.getAllSettings();
        const map = new Map(settings.map((s: any) => [s.key_name, s.value]));
        const pct = Number(map.get("closing_variance_threshold_pct") ?? 5);
        if (isFinite(pct) && pct >= 0) setVarianceThresholdPct(pct);
      } catch (e) {
        console.error("[Closing] Failed to load variance threshold:", e);
      }

    } else if (step === 2) {
      setStep(3);
    }
  };

  const handlePreviousStep = () => {
    if (step > 1) {
      setStep(step - 1);
      setStepError(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStepError(null);

    const closingDate = new Date().toISOString().split("T")[0];

    const amounts = DRAWER_ORDER.flatMap((drawer) =>
      currencies.map((currency) => ({
        drawer_name: drawer,
        currency_code: currency.code,
        physical_amount: drawerAmounts.amounts[drawer]?.[currency.code] ?? 0,
      })),
    );

    const sumByCurrency = (code: string): number =>
      amounts
        .filter((a) => a.currency_code === code)
        .reduce((acc, a) => acc + (a.physical_amount ?? 0), 0);

    const expectedUsd =
      (systemExpected?.generalDrawer.usd ?? 0) +
      (systemExpected?.omtDrawer.usd ?? 0) +
      (systemExpected?.mtcDrawer.usd ?? 0) +
      (systemExpected?.alfaDrawer.usd ?? 0);

    const expectedLbp =
      (systemExpected?.generalDrawer.lbp ?? 0) +
      (systemExpected?.omtDrawer.lbp ?? 0) +
      (systemExpected?.mtcDrawer.lbp ?? 0) +
      (systemExpected?.alfaDrawer.lbp ?? 0);

    const expectedEur =
      (systemExpected?.generalDrawer.eur ?? 0) +
      (systemExpected?.omtDrawer.eur ?? 0) +
      (systemExpected?.mtcDrawer.eur ?? 0) +
      (systemExpected?.alfaDrawer.eur ?? 0);

    const escapeHtml = (s: string): string =>
      s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    try {
      // 1) Create closing record
      const result = await api.createDailyClosing({
        closing_date: closingDate,
        amounts,
        variance_notes: notes,
        system_expected_usd: expectedUsd,
        system_expected_lbp: expectedLbp,
        ...(user?.id != null ? { user_id: user.id } : {}),
      });

      if (!result.success) {
        setStepError(result.error || "Failed to save closing");
        return;
      }

      // If id is missing, still allow the closing to be saved; skip report attachment.
      if (result.id == null) {
        alert("Daily closing saved successfully!");
        appEvents.emit("closing:completed", result);
        onClose();
        return;
      }

      // 2) Generate and attach report PDF
      try {
        const dailyStats = await api.getDailyStatsSnapshot();

        const reportText = generateClosingReport(
          {
            closing_date: closingDate,
            drawer_name: "AGGREGATED",
            physical_usd: sumByCurrency("USD"),
            system_expected_usd: expectedUsd,
            physical_lbp: sumByCurrency("LBP"),
            system_expected_lbp: expectedLbp,
            physical_eur: sumByCurrency("EUR"),
            system_expected_eur: expectedEur,
          },
          dailyStats,
        );

        const html = `<!doctype html><html><head><meta charset="utf-8" /><title>Daily Closing Report</title></head><body><pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; white-space: pre-wrap;">${escapeHtml(reportText)}</pre></body></html>`;

        const pdfRes = await api.generatePDF(html, `closing_${closingDate}.pdf`);

        if (pdfRes?.success && pdfRes.path) {
          await api.updateDailyClosing(Number(result.id), {
            report_path: pdfRes.path,
            ...(user?.id != null ? { user_id: user.id } : {}),
          });
        }
      } catch (reportError) {
        // Don't block closing if report generation fails.
        console.error("[Closing] Report generation error:", reportError);
      }

      alert("Daily closing saved successfully!");
      appEvents.emit("closing:completed", result);
      onClose();
    } catch (error) {
      console.error("[Closing] Save error:", error);
      setStepError(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (step > 1 || drawerAmounts.hasAnyAmounts) {
      if (
        confirm("You have unsaved changes. Are you sure you want to close?")
      ) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  const totalSteps = 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          handleCancel();
        }
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-700 bg-slate-800">
          <div>
            <h2 className="text-2xl font-bold text-white">Closing</h2>
            <p className="text-slate-400 text-sm mt-1">
              Step {step} of {totalSteps}:{" "}
              {step === 1
                ? "Physical Count"
                : step === 2
                  ? "Variance Review"
                  : "Notes & Confirmation"}
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

          {stepError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-200 text-sm">{stepError}</p>
            </div>
          )}

          {/* Step 1: Physical Count */}
          {step === 1 &&
            !currenciesLoading &&
            !currenciesError &&
            currencies.length === 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <p className="text-yellow-200 text-sm">
                  No active currencies found. Please enable at least one
                  currency in Settings → Currency Manager.
                </p>
              </div>
            )}

          {step === 1 &&
            !currenciesLoading &&
            !currenciesError &&
            currencies.length > 0 && (
              <>
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                  <p className="text-slate-300 text-sm">
                    Count the physical cash in each drawer. Enter amounts
                    without checking the system totals.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {DRAWER_ORDER.map((drawer) => {
                    const drawerCurrencies =
                      drawer === "MTC" || drawer === "Alfa"
                        ? currencies.filter((c) => c.code === "USD")
                        : currencies;

                    return (
                      <DrawerCard
                        key={drawer}
                        drawer={drawer}
                        currencies={drawerCurrencies}
                        getDisplayValue={(d, c) =>
                          drawerAmounts.getDisplayValue(d, c)
                        }
                        onAmountChange={handleAmountChange}
                        disabled={saving}
                        focusRingColor="orange-500"
                      />
                    );
                  })}
                </div>
              </>
            )}

          {/* Step 2: Variance Review */}
          {step === 2 && (
            <>
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-300 text-sm">
                  Review variances between your physical count and expected
                  system balances.
                </p>
              </div>

              {systemLoading && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                  <p className="text-blue-200 text-sm">
                    Calculating expected balances...
                  </p>
                </div>
              )}

              {systemError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <p className="text-red-200 text-sm">Error: {systemError}</p>
                </div>
              )}

              {!systemLoading && !systemError && systemExpected && (() => {
                const flagged: Array<{ drawer: DrawerType; currency: string; variance: number; expected: number; pct: number }> = [];

                for (const drawer of DRAWER_ORDER) {
                  const drawerCurrencies =
                    drawer === "MTC" || drawer === "Alfa"
                      ? currencies.filter((c) => c.code === "USD")
                      : currencies;

                  const drawerKey =
                    drawer === "General"
                      ? "generalDrawer"
                      : drawer === "OMT_System"
                        ? "omtDrawer"
                        : drawer === "OMT_App"
                          ? "omtAppDrawer"
                        : drawer === "MTC"
                          ? "mtcDrawer"
                          : "alfaDrawer";

                  const expectedObj = systemExpected[drawerKey];

                  for (const currency of drawerCurrencies) {
                    const expected = expectedObj?.[currency.code.toLowerCase()] || 0;
                    const physical = drawerAmounts.amounts[drawer]?.[currency.code] ?? 0;
                    const variance = physical - expected;
                    const pct = expected !== 0 ? (Math.abs(variance) / expected) * 100 : 0;

                    if (varianceThresholdPct > 0 && pct >= varianceThresholdPct && Math.abs(variance) > 0.01) {
                      flagged.push({ drawer, currency: currency.code, variance, expected, pct });
                    }
                  }
                }

                return (
                  <>
                    {flagged.length > 0 && (
                      <AlertBanner type="warning">
                        Variance threshold exceeded ({varianceThresholdPct}%+):{" "}
                        {flagged
                          .slice(0, 4)
                          .map((f) =>
                            `${f.drawer} ${f.currency} ${f.variance > 0 ? "+" : ""}${f.variance.toFixed(2)} (${f.pct.toFixed(1)}%)`,
                          )
                          .join(" • ")}
                        {flagged.length > 4 ? " • ..." : ""}
                      </AlertBanner>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {DRAWER_ORDER.map((drawer) => {
                    const drawerCurrencies =
                      drawer === "MTC" || drawer === "Alfa"
                        ? currencies.filter((c) => c.code === "USD")
                        : currencies;

                    return (
                      <VarianceCard
                        key={drawer}
                        drawer={drawer}
                        currencies={drawerCurrencies}
                        physicalAmounts={drawerAmounts.amounts[drawer] || {}}
                        getExpectedAmount={(currencyCode: string) => {
                          // Map drawer to systemExpected field
                          const drawerKey =
                            drawer === "General"
                              ? "generalDrawer"
                              : drawer === "OMT_System"
                                ? "omtDrawer"
                                : drawer === "OMT_App"
                                  ? "omtAppDrawer"
                                : drawer === "MTC"
                                  ? "mtcDrawer"
                                  : "alfaDrawer";
                          const expected = systemExpected[drawerKey];
                          if (!expected) return 0;

                          // Map currency code to field (usd, lbp, eur)
                          const currencyKey = currencyCode.toLowerCase();
                          return expected[currencyKey] || 0;
                        }}
                      />
                    );
                  })}
                    </div>
                  </>
                );
              })()}
            </>
          )}

          {/* Step 3: Notes & Confirmation */}
          {step === 3 && (
            <>
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                <p className="text-slate-300 text-sm">
                  Add any notes to explain variances or issues before finalizing
                  the closing.
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="closing-notes"
                  className="block text-sm font-medium text-slate-300"
                >
                  Closing Notes (Optional)
                </label>
                <textarea
                  id="closing-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={saving}
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-violet-600 focus:border-transparent transition-all disabled:opacity-50 resize-none"
                  placeholder="Explain any variances or issues..."
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 p-6 bg-slate-800">
          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            <div className="flex items-center gap-3">
              {step > 1 && (
                <button
                  type="button"
                  onClick={handlePreviousStep}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <ChevronLeft size={16} />
                  Previous
                </button>
              )}

              {step < totalSteps ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={saving || currenciesLoading}
                  className="px-6 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  Next Step
                  <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Saving..." : "Save & Close Day"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
