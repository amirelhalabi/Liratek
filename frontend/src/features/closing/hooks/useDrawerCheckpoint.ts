/**
 * useDrawerCheckpoint — everything ONE drawer's checkpoint needs: its count
 * fields pre-filled from the expected balance, SIM lines (MTC/Alfa), the
 * live variance summary, and the save itself.
 *
 * Extracted verbatim from the per-drawer Checkpoint modal so the same save
 * path serves both windows (rule 14): the single-drawer window (dashboard
 * clipboard icon) and the after-sign-in "all drawers" window, where every
 * drawer card runs its own instance and saves only itself. There is exactly
 * one `createCheckpoint` call site for a drawer count — this one.
 */

import { useEffect, useRef, useState } from "react";
import logger from "@/utils/logger";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import type { DrawerType } from "../types";
import { DRAWER_CONFIGS, DRAWER_CARRIER } from "../config/drawers";
import type { CarrierLineEntity } from "@liratek/ui";
import { useCurrencies } from "./useCurrencies";
import { useDrawerAmounts } from "./useDrawerAmounts";
import { useSystemExpected } from "./useSystemExpected";
import {
  getVarianceStatus,
  getDateVarianceStatus,
  formatCurrencyAmount,
  formatDayVariance,
  type VarianceStatus,
} from "../utils/variance";
import { appEvents, useApi } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import { generateClosingReport } from "../utils/closingReportGenerator";
import { useShopBase } from "@/hooks/useShopBase";
import { localDay } from "@/shared/utils/localDay";
import { useSellRate } from "@/hooks/useSellRate";

/** Save-button styling per overall status. */
export const SAVE_STYLES: Record<VarianceStatus, string> = {
  match: "bg-green-600 hover:bg-green-500",
  diff: "bg-amber-600 hover:bg-amber-500",
};

interface UseDrawerCheckpointArgs {
  /** False resets every field (the modal is closed). */
  isOpen: boolean;
  drawerName: string;
  /** Called once the checkpoint is saved (after `closing:completed`). */
  onSaved: () => void;
}

export function useDrawerCheckpoint({
  isOpen,
  drawerName,
  onSaved,
}: UseDrawerCheckpointArgs) {
  // Read through a ref so a parent's inline callback never matters.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });
  const [amountsReady, setAmountsReady] = useState(false);

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
      setAmountsReady(true);
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
      setAmountsReady(false);
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
      onSavedRef.current();
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

  // Moved verbatim from the modal's Cancel handler: any field off its
  // expected value, any note, or any SIM-line difference is unsaved work.
  const hasInput = statusFields.some((c) => {
    const { status } = getVarianceStatus(
      drawerAmounts.amounts[drawer]?.[c.code] ?? 0,
      getExpectedValue(drawer, c.code),
    );
    return status !== "match";
  });
  const hasNotes = notes.trim().length > 0;
  const hasLineDiff = lineCreditsDiffs.length > 0 || hasValidityDiff;
  const hasUnsavedChanges = hasInput || hasNotes || hasLineDiff;

  const saveDisabled =
    saving ||
    currenciesLoading ||
    isPartnerDrawerInactive ||
    (carrier ? carrierLines.length === 0 : drawerCurrencies.length === 0);

  return {
    drawer,
    drawerConfig,
    partnerSystem,
    isPartnerDrawerInactive,
    currencies,
    currenciesLoading,
    currenciesError,
    drawerAmounts,
    drawerCurrencies,
    carrier,
    carrierLines,
    carrierLinesLoaded,
    lineCredits,
    setLineCredits,
    lineExpiry,
    setLineExpiry,
    newLinePhone,
    setNewLinePhone,
    newLineCredits,
    setNewLineCredits,
    addingLine,
    addLineError,
    handleAddLine,
    notes,
    setNotes,
    saving,
    saveError,
    getExpectedValue,
    handleAmountChange,
    handleResetToExpected,
    overallStatus,
    saveLabel,
    saveDisabled,
    handleSave,
    hasUnsavedChanges,
    /** True once the fields hold the expected balances (not the blank 0s). */
    amountsReady,
  };
}

export type DrawerCheckpointState = ReturnType<typeof useDrawerCheckpoint>;
