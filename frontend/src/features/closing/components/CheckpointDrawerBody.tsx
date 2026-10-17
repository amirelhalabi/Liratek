/**
 * The count sheet for ONE drawer — moved verbatim from the per-drawer
 * Checkpoint modal so both windows render the same fields (rule 14): the
 * single-drawer window and each card of the "all drawers" window. All state
 * and the save live in `useDrawerCheckpoint`; this only draws it.
 */

import { Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DecimalInput } from "@liratek/ui";
import { DrawerCard } from "./DrawerCard";
import { SinceLastCountList } from "./SinceLastCountList";
import { useDrawerText } from "../hooks/useDrawerText";
import type { DrawerCheckpointState } from "../hooks/useDrawerCheckpoint";

interface CheckpointDrawerBodyProps {
  cp: DrawerCheckpointState;
  /** Unique per drawer when several bodies share a page. */
  notesId?: string;
}

export function CheckpointDrawerBody({
  cp,
  notesId = "checkpoint-notes",
}: CheckpointDrawerBodyProps) {
  const { t } = useTranslation("closing");
  const drawerText = useDrawerText();
  const {
    drawer,
    partnerSystem,
    isPartnerDrawerInactive,
    currencies,
    currenciesLoading,
    loadError,
    retryLoad,
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
    usdTotal,
    handleAmountChange,
    handleResetToExpected,
  } = cp;
  const drawerName = drawer;

  return (
    <>
      {currenciesLoading && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <p className="text-blue-200 text-sm">
            {t("body.loadingCurrencies")}
          </p>
        </div>
      )}
      {loadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center justify-between gap-3">
          <p className="text-red-200 text-sm">
            {t("body.loadFailed", { error: loadError })}
          </p>
          <button
            type="button"
            onClick={retryLoad}
            className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            {t("common:actions.retry")}
          </button>
        </div>
      )}
      {saveError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-200 text-sm">{saveError}</p>
        </div>
      )}

      {!currenciesLoading && !loadError && (
        <>
          {currencies.length === 0 ? (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <p className="text-yellow-200 text-sm">
                {t("body.noActiveCurrencies")}
              </p>
            </div>
          ) : carrier && !carrierLinesLoaded ? (
            <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4">
              <p className="text-slate-400 text-sm">{t("body.loadingLines")}</p>
            </div>
          ) : carrier && carrierLines.length === 0 ? (
            // Owner decision A: a carrier with no active line never takes
            // a bare drawer amount — the screen asks for a line first.
            <div
              data-testid={`checkpoint-add-line-${drawer}`}
              className="bg-slate-900 rounded-xl border border-slate-600/40 border-s-4 border-s-orange-500 px-4 py-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-orange-400" />
                <p className="text-sm font-semibold text-white">
                  {t("body.noActiveLine", {
                    drawer: drawerText.label(drawerName),
                  })}
                </p>
              </div>
              <p className="text-xs text-slate-400">
                {t("body.noActiveLineHint", { drawer })}
              </p>
              {addLineError && (
                <p className="text-sm text-red-400">{addLineError}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    {t("body.phoneNumber")}
                  </label>
                  <input
                    type="text"
                    value={newLinePhone}
                    onChange={(e) => setNewLinePhone(e.target.value)}
                    placeholder={t("body.phonePlaceholder")}
                    data-testid={`checkpoint-add-line-phone-${drawer}`}
                    disabled={addingLine}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 placeholder:text-slate-600 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    {t("body.startingCredits")}
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
                {addingLine ? t("body.adding") : t("body.addLine")}
              </button>
              <p className="text-[11px] text-slate-500">
                {t("body.manageLinesHint")}
              </p>
            </div>
          ) : drawerCurrencies.length === 0 && !carrier ? (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <p className="text-yellow-200 text-sm">
                {t("body.noDrawerCurrencies")}
              </p>
            </div>
          ) : (
            <div className="relative">
              {isPartnerDrawerInactive && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-slate-900/80 backdrop-blur-sm border-2 border-slate-600">
                  <div className="text-center px-4">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-slate-700 text-slate-400 uppercase tracking-wide mb-2">
                      {t("body.inactive")}
                    </span>
                    <p className="text-slate-400 text-sm">
                      {t("body.partnerDebt", { system: partnerSystem })}
                    </p>
                    <p className="text-slate-500 text-xs mt-1">
                      {t("body.noActivePartner")}
                    </p>
                  </div>
                </div>
              )}
              <DrawerCard
                drawer={drawer}
                currencies={drawerCurrencies}
                getDisplayValue={(d, c) => drawerAmounts.getDisplayValue(d, c)}
                onAmountChange={handleAmountChange}
                getExpectedValue={getExpectedValue}
                {...(usdTotal ? { usdTotal } : {})}
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

          {/* LIRA-289: what moved this drawer since its last count. */}
          <SinceLastCountList drawer={drawerName} />

          {/* Notes */}
          <div className="space-y-2">
            <label
              htmlFor={notesId}
              className="block text-sm font-medium text-slate-300"
            >
              {t("body.notesLabel")}
            </label>
            <textarea
              id={notesId}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              rows={3}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-violet-600 focus:border-transparent transition-all disabled:opacity-50 resize-none"
              placeholder={t("body.notesPlaceholder")}
            />
          </div>
        </>
      )}
    </>
  );
}
