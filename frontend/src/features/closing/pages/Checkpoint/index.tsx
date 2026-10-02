/**
 * Per-Drawer Checkpoint Modal (single page)
 *
 * Performs a checkpoint for a single drawer. Fields pre-fill with the
 * system-expected balance; the cashier edits only what differs. Each field
 * shows a live two-tier variance status (green match / amber attention) — there
 * is no tolerance, any difference is flagged. Notes live on the same page.
 */

import { useEffect, useRef, useState } from "react";
import logger from "@/utils/logger";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import type { DrawerType } from "../../types";
import { DRAWER_CONFIGS, DRAWER_CARRIER } from "../../config/drawers";
import type { CarrierLineEntity } from "@liratek/ui";
import { useCurrencies } from "../../hooks/useCurrencies";
import { useDrawerAmounts } from "../../hooks/useDrawerAmounts";
import { useSystemExpected } from "../../hooks/useSystemExpected";
import { DrawerCard } from "../../components/DrawerCard";
import {
  getVarianceStatus,
  getDateVarianceStatus,
  formatCurrencyAmount,
  formatDayVariance,
  type VarianceStatus,
} from "../../utils/variance";
import { appEvents, useApi, DecimalInput } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { generateClosingReport } from "../../utils/closingReportGenerator";
import { X, Smartphone } from "lucide-react";
import { useShopBase } from "@/hooks/useShopBase";
import { localDay } from "@/shared/utils/localDay";
import { useSellRate } from "@/hooks/useSellRate";

interface CheckpointModalProps {
  isOpen: boolean;
  drawerName: string;
  onClose: () => void;
}

/** Save-button styling per overall status. */
const SAVE_STYLES: Record<VarianceStatus, string> = {
  match: "bg-green-600 hover:bg-green-500",
  diff: "bg-amber-600 hover:bg-amber-500",
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
      api.partners
        .getAll(false)
        .then((partners: Array<{ system_association: string | null }>) => {
          const exists = partners.some(
            (p) => p.system_association === partnerSystem,
          );
          setHasActivePartner(exists);
        })
        .catch(() => setHasActivePartner(false));
    }
  }, [isOpen, partnerSystem, api]);

  const isPartnerDrawerInactive =
    drawerName === partnerDrawerName && !hasActivePartner;

  const {
    currencies,
    loading: currenciesLoading,
    error: currenciesError,
  } = useCurrencies();

  const drawerAmounts = useDrawerAmounts({ currencies });
  const { systemExpected, fetchSystemExpected } = useSystemExpected();
  // LIRA-174: the closing PDF's rate-stamped profit view converts at
  // sell_rate (owner decision) — see rateStampedProfit.ts for why. Read via
  // the canonical hook, never hardcoded, and injected into
  // generateClosingReport rather than reached for inside it.
  const { sellRate } = useSellRate();

  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Carrier lines (MTC/Alfa only, LIRA-252 item A) ─────────────────────────
  // These two drawers hold the shop's OWN SIM credit stock. Owner decision A:
  // credits are entered PER ACTIVE LINE, never as one free-typed drawer
  // amount — the drawer is always the SUM of every active line's counted
  // credits (see ClosingRepository.createCheckpoint). Each line also keeps
  // its own validity row, exactly as Phase 3 introduced for the single-line
  // case; `lineCredits`/`lineExpiry` pre-fill from each line's stored values
  // so an untouched checkpoint posts no change at all.
  const carrier = DRAWER_CARRIER[drawer];
  const [carrierLines, setCarrierLines] = useState<CarrierLineEntity[]>([]);
  const [carrierLinesLoaded, setCarrierLinesLoaded] = useState(false);
  const [lineCredits, setLineCredits] = useState<Record<number, string>>({});
  const [lineExpiry, setLineExpiry] = useState<Record<number, string>>({});

  // Inline "add a line" prompt — shown instead of the (empty) carrier card
  // when the carrier has no active line at all (owner decision A: "the
  // screen asks you to add one first").
  const [newLinePhone, setNewLinePhone] = useState("");
  const [newLineCredits, setNewLineCredits] = useState("");
  const [addingLine, setAddingLine] = useState(false);
  const [addLineError, setAddLineError] = useState<string | null>(null);

  const [drawerCurrencyConfig, setDrawerCurrencyConfig] = useState<
    Record<string, string[]>
  >({});

  useEffect(() => {
    if (!isOpen) return;
    api
      .getCountableDrawerCurrencies()
      .then(setDrawerCurrencyConfig)
      .catch(() => {});
    fetchSystemExpected();
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

  // Loads (or reloads, after "Add Line") every active line for this carrier
  // and seeds the per-line input state from their stored values.
  const loadCarrierLines = () => {
    if (!carrier) return;
    return api
      .getActiveCarrierLines(carrier)
      .then((lines) => {
        setCarrierLines(lines);
        setLineCredits(
          Object.fromEntries(lines.map((l) => [l.id, String(l.credits)])),
        );
        setLineExpiry(
          Object.fromEntries(
            lines.map((l) => [l.id, l.validity_expires_at ?? ""]),
          ),
        );
        setCarrierLinesLoaded(true);
      })
      .catch(() => {
        setCarrierLines([]);
        setCarrierLinesLoaded(true);
      });
  };

  useEffect(() => {
    if (!isOpen || !carrier) return;
    setCarrierLinesLoaded(false);
    loadCarrierLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, carrier, api]);

  useEffect(() => {
    if (!isOpen) {
      hasInitializedAmounts.current = false;
      setNotes("");
      setSaveError(null);
      setCarrierLines([]);
      setCarrierLinesLoaded(false);
      setLineCredits({});
      setLineExpiry({});
      setNewLinePhone("");
      setNewLineCredits("");
      setAddLineError(null);
      drawerAmounts.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleAddLine = async () => {
    if (!carrier) return;
    const phone = newLinePhone.trim();
    if (!phone) {
      setAddLineError("Enter a phone number to add a line.");
      return;
    }
    setAddingLine(true);
    setAddLineError(null);
    try {
      const credits = parseFloat(newLineCredits) || 0;
      const result = await api.createCarrierLine({
        carrier,
        phone_number: phone,
        credits,
      });
      if (!result.success) {
        setAddLineError(result.error || "Failed to add the line");
        return;
      }
      setNewLinePhone("");
      setNewLineCredits("");
      await loadCarrierLines();
      await fetchSystemExpected();
    } catch (error) {
      setAddLineError(getApiErrorMessage(error, "Failed to add the line"));
    } finally {
      setAddingLine(false);
    }
  };

  // `drawerCurrencyConfig[drawerName]` is the server's already-deduplicated,
  // already-ordered count-sheet set (base allowlist ∪ non-zero balances — see
  // GENERAL_DRAWER_UNRESTRICTED.md item 8). It is rendered as ONE list: no
  // re-filtering against a hardcoded currency whitelist, no special-casing
  // "General" — that split is what produced the duplicate-field bug.
  //
  // Built by MAPPING the server's codes (never by intersecting against
  // `currencies`, which is `useCurrencies()`'s ACTIVE-ONLY list): a currency
  // deactivated in Settings while still holding cash keeps being reported as
  // countable by getCountableDrawerCurrencies() (CurrencyRepository ignores
  // is_active for held balances by design), and an intersection against the
  // active-only list would silently drop its field — the exact "money
  // exists, no count field" failure item 8 exists to close. `DrawerCard`
  // only reads `.code` off each entry, so a synthetic fallback entry for a
  // code not present in `currencies` is safe.
  const allowed = drawerCurrencyConfig[drawerName];
  const allDrawerCurrencies = allowed
    ? allowed.map(
        (code) =>
          currencies.find((c) => c.code === code) ?? {
            code,
            name: code,
            is_active: 0,
          },
      )
    : currencies;
  // MTC/Alfa's USD figure is no longer a generic currency field (owner
  // decision A) — it's the SUM of the per-line Credits rows rendered below,
  // so the USD entry is dropped here to avoid a second, free-typed amount
  // that could disagree with the lines.
  const drawerCurrencies = carrier
    ? allDrawerCurrencies.filter((c) => c.code !== "USD")
    : allDrawerCurrencies;

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
  const statusFields = drawerCurrencies;
  let overallStatus: VarianceStatus = "match";
  const diffs: { code: string; variance: number }[] = [];
  for (const c of statusFields) {
    const { status, variance } = getVarianceStatus(
      drawerAmounts.amounts[drawer]?.[c.code] ?? 0,
      getExpectedValue(drawer, c.code),
    );
    if (status !== "match") {
      diffs.push({ code: c.code, variance });
      overallStatus = "diff";
    }
  }

  // Per-line credits/expiry variance (LIRA-252 item A) — every active line
  // contributes its own credits diff and validity diff, same grammar as the
  // single-line version this replaces. A counted expiry or credits figure
  // that differs from the stored one is a real change the checkpoint will
  // post, so the Save button must not read "Balanced" while any is pending.
  const lineCreditsDiffs = carrierLines
    .map((line) => {
      const { status, variance } = getVarianceStatus(
        parseFloat(lineCredits[line.id] ?? "") || 0,
        line.credits,
      );
      return { line, status, variance };
    })
    .filter((d) => d.status === "diff");

  const lineExpiryDiffs = carrierLines
    .map((line) => ({
      line,
      info: getDateVarianceStatus(
        lineExpiry[line.id] || null,
        line.validity_expires_at,
      ),
    }))
    .filter((d) => d.info.status === "diff");

  const hasValidityDiff = lineExpiryDiffs.length > 0;
  if (lineCreditsDiffs.length > 0 || hasValidityDiff) overallStatus = "diff";

  const saveLabel = (() => {
    if (saving) return "Saving...";
    if (overallStatus === "match") return "Save Checkpoint — Balanced";
    const parts: string[] = [];
    if (diffs.length > 2) {
      parts.push(`Variance in ${diffs.length} currencies`);
    } else {
      parts.push(
        ...diffs.map(
          (d) =>
            `${d.code} ${d.variance > 0 ? "+" : ""}${formatCurrencyAmount(d.variance, d.code)}`,
        ),
      );
    }
    if (lineCreditsDiffs.length > 0) {
      parts.push(
        lineCreditsDiffs.length > 1
          ? `Credits variance on ${lineCreditsDiffs.length} lines`
          : `${lineCreditsDiffs[0].line.phone_number} ${lineCreditsDiffs[0].variance > 0 ? "+" : ""}${formatCurrencyAmount(lineCreditsDiffs[0].variance, "USD")}`,
      );
    }
    if (hasValidityDiff) {
      parts.push(
        lineExpiryDiffs.length > 1
          ? `Validity variance on ${lineExpiryDiffs.length} lines`
          : `Validity ${formatDayVariance(lineExpiryDiffs[0].info.days)}`,
      );
    }
    return `Save — ${parts.join(", ")}`;
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

    // LIRA-219 (C.3): computed ONCE and reused for the checkpoint's
    // `closing_date`, the daily-stats-snapshot query's `day`, and the PDF's
    // `closing_date` line — so the checkpoint record, the profit figure and
    // the printed date can never disagree with each other (rule 22).
    const closingDay = localDay();

    try {
      const checkpointData: Parameters<typeof api.createCheckpoint>[0] = {
        user_id: user?.id ?? 0,
        drawer_name: drawerName,
        amounts,
        closing_date: closingDay,
      };
      // The SIM count travels as counted values only — the backend reads the
      // expected side off carrier_lines and derives the drawer from the SUM
      // of every active line (owner decision A). `amounts` never carries a
      // bare MTC/Alfa USD figure (filtered out of `drawerCurrencies` above)
      // — the drawer is reconstructed server-side from this array alone.
      if (carrier && carrierLines.length > 0) {
        checkpointData.carrier_lines = carrierLines.map((line) => ({
          carrier_line_id: line.id,
          counted_credits: parseFloat(lineCredits[line.id] ?? "") || 0,
          counted_expires_at: lineExpiry[line.id] || null,
        }));
      }
      if (notes) checkpointData.notes = notes;
      const result = await api.createCheckpoint(checkpointData);

      if (!result.success) {
        setSaveError(result.error || "Failed to save checkpoint");
        return;
      }

      if (result.id != null) {
        try {
          const dailyStats = await api.getDailyStatsSnapshot({
            day: closingDay,
          });
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
              closing_date: closingDay,
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
            sellRate,
            new Date(),
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
      // LIRA-247: `error instanceof Error` is false for a thrown ApiError
      // (e.g. a web 403 role refusal), so it used to fall back to this
      // generic string and hide the real reason.
      setSaveError(getApiErrorMessage(error, "An unexpected error occurred"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    const hasInput = statusFields.some((c) => {
      const { status } = getVarianceStatus(
        drawerAmounts.amounts[drawer]?.[c.code] ?? 0,
        getExpectedValue(drawer, c.code),
      );
      return status !== "match";
    });
    const hasNotes = notes.trim().length > 0;
    const hasLineDiff = lineCreditsDiffs.length > 0 || hasValidityDiff;
    if (hasInput || hasNotes || hasLineDiff) {
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
              ) : carrier && !carrierLinesLoaded ? (
                <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4">
                  <p className="text-slate-400 text-sm">Loading lines…</p>
                </div>
              ) : carrier && carrierLines.length === 0 ? (
                // Owner decision A: a carrier with no active line never takes
                // a bare drawer amount — the screen asks for a line first.
                <div
                  data-testid={`checkpoint-add-line-${drawer}`}
                  className="bg-slate-900 rounded-xl border border-slate-600/40 border-l-4 border-l-orange-500 px-4 py-4 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-orange-400" />
                    <p className="text-sm font-semibold text-white">
                      No active {drawerConfig?.label ?? drawerName} line
                    </p>
                  </div>
                  <p className="text-xs text-slate-400">
                    This drawer's balance always equals the sum of its active
                    SIM lines' credits. Add the shop's {drawer} line before
                    counting this drawer.
                  </p>
                  {addLineError && (
                    <p className="text-sm text-red-400">{addLineError}</p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">
                        Phone Number
                      </label>
                      <input
                        type="text"
                        value={newLinePhone}
                        onChange={(e) => setNewLinePhone(e.target.value)}
                        placeholder="e.g. 03123456"
                        data-testid={`checkpoint-add-line-phone-${drawer}`}
                        disabled={addingLine}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 placeholder:text-slate-600 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">
                        Starting Credits ($)
                      </label>
                      <DecimalInput
                        value={parseFloat(newLineCredits) || 0}
                        onChange={(v) => setNewLineCredits(v ? String(v) : "")}
                        decimals={2}
                        placeholder="0"
                        disabled={addingLine}
                        data-testid={`checkpoint-add-line-credits-${drawer}`}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 placeholder:text-slate-600 disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddLine}
                    disabled={addingLine}
                    data-testid={`checkpoint-add-line-submit-${drawer}`}
                    className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    {addingLine ? "Adding…" : "Add Line"}
                  </button>
                  <p className="text-[11px] text-slate-500">
                    Or manage lines from Settings → Carrier Lines.
                  </p>
                </div>
              ) : drawerCurrencies.length === 0 && !carrier ? (
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
                    currencies={drawerCurrencies}
                    getDisplayValue={(d, c) =>
                      drawerAmounts.getDisplayValue(d, c)
                    }
                    onAmountChange={handleAmountChange}
                    getExpectedValue={getExpectedValue}
                    onResetToExpected={handleResetToExpected}
                    disabled={saving || isPartnerDrawerInactive}
                    focusRingColor="violet-500"
                    {...(carrier && carrierLines.length > 0
                      ? {
                          carrierLines: carrierLines.map((line) => ({
                            lineId: line.id,
                            phoneNumber: line.phone_number,
                            label: line.label,
                            creditsValue: lineCredits[line.id] ?? "0",
                            onCreditsChange: (value: string) =>
                              setLineCredits((prev) => ({
                                ...prev,
                                [line.id]: value,
                              })),
                            expectedCredits: line.credits,
                            countedExpiresAt: lineExpiry[line.id] ?? "",
                            expectedExpiresAt: line.validity_expires_at,
                            onExpiryChange: (value: string) =>
                              setLineExpiry((prev) => ({
                                ...prev,
                                [line.id]: value,
                              })),
                            onResetExpiry: () =>
                              setLineExpiry((prev) => ({
                                ...prev,
                                [line.id]: line.validity_expires_at ?? "",
                              })),
                          })),
                        }
                      : {})}
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
                (carrier
                  ? carrierLines.length === 0
                  : drawerCurrencies.length === 0)
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
