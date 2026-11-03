import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { formatNumber } from "@liratek/ui/i18n/format";
import { addDaysToDateString, type OmtCoveredType } from "@liratek/core";
import { useFormat } from "@/i18n/useFormat";
import { localDay } from "@/shared/utils/localDay";
import {
  useSupplierAccountExpectedStatementQuery,
  type AccountBalance,
} from "../hooks/useSuppliers";
import OmtCoveredTypesPicker from "./OmtCoveredTypesPicker";
import {
  loadCoveredTypes,
  saveCoveredTypes,
} from "../utils/omtCoveredTypesStorage";

/**
 * LIRA-255 — "check against OMT's statement" panel on the OMT account card.
 *
 * OMT texts the shop its balance with the shop's commission ALREADY
 * deducted ("INCLUDES INTRA SHARES"); the app books OMT GROSS
 * (FEATURE_GUIDE.md §7/§8.1), so the two numbers differ by exactly the
 * commission on transfers OMT hasn't settled yet. This panel shows, per
 * currency: the app's gross owed figure (same source the account card
 * already shows), minus the unsettled commission the core read sums, equal
 * to what OMT's own statement should say — in OMT's OWN sign convention
 * (owner, 2026-10-03: "minus = OMT owes the shop, plus = the shop owes
 * OMT"). See `SupplierRepository.AccountExpectedStatement`'s doc comment
 * for the full design (why no sign flip, why ALL commission types/models
 * count, and the D17 nuance).
 *
 * Display only — nothing here is booked or saved server-side.
 *
 * LIRA-370 (owner 2026-11-03) — read-only: the OMT SMS figure is typed on
 * Settle Account, which works the commission out from it. This panel no
 * longer has SMS boxes or an "Off by" line. Its expected figure includes the
 * shares OMT still owes us from earlier settlements (of the ticked types),
 * computed by the same core formula the settle sheet uses (rule 14).
 *
 * LIRA-256 — OMT's SMS may cover only some commission types ("INCLUDES
 * INTRA SHARES"). The operator ticks the covered types; the read then
 * subtracts only those types' commission (see the core doc comment for the
 * old-style-row rule, S9). The choice is remembered per account on this
 * device (`omtCoveredTypesStorage`), shared with both settle screens.
 *
 * 2026-10-27 (owner option B) — OMT's SMS covers the account up to the END
 * OF YESTERDAY, so the read is cut at a shop day: by default yesterday,
 * from the BROWSER's own day (rule 27); the "Up to" chip picks an earlier
 * one (never today or later). Not saved anywhere: a remount starts at
 * yesterday again. What later days still have open is shown under the
 * expected line, not counted.
 */

const DIFF_EPS_USD = 0.01;
const DIFF_EPS_LBP = 1;

function formatUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function formatLbp(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(Math.round(n)))} LBP`;
}

/** The left-out amounts with an explicit sign, non-zero currencies only:
 *  "-$150.00 · +500,000 LBP"; "" when both round to nothing. */
function formatLeftOut(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (Math.abs(usd) >= DIFF_EPS_USD / 2) {
    parts.push(`${usd > 0 ? "+" : ""}${formatUsd(usd)}`);
  }
  if (Math.abs(lbp) >= DIFF_EPS_LBP / 2) {
    parts.push(`${lbp > 0 ? "+" : ""}${formatLbp(lbp)}`);
  }
  return parts.join(" · ");
}

/** A `YYYY-MM-DD` shop day as a local-midnight Date, for DISPLAY only
 *  (never for bucketing). */
function dayAsLocalDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function OmtStatementCheckPanel({
  account,
}: {
  account: AccountBalance;
}) {
  const { t } = useTranslation("suppliers");
  const fmt = useFormat();
  const accountSupplierId = account.account_supplier_id;
  const upToInputId = useId();
  // Yesterday on the browser's own clock (rule 27), fixed for this mount:
  // the latest day OMT's SMS can cover.
  const [maxDay] = useState(() => addDaysToDateString(localDay(), -1));
  const [upToDay, setUpToDay] = useState(maxDay);
  const [pickingDay, setPickingDay] = useState(false);
  const dayLabel = (day: string) =>
    fmt.formatDate(dayAsLocalDate(day), {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  // LIRA-256 — lazily initialised from this device's last choice (no
  // setState in an effect); undefined = All types.
  const [coveredTypes, setCoveredTypes] = useState<
    OmtCoveredType[] | undefined
  >(() => loadCoveredTypes(accountSupplierId));
  const statementQuery = useSupplierAccountExpectedStatementQuery(
    accountSupplierId,
    coveredTypes,
    upToDay,
  );

  const statement = statementQuery.data;
  // Falls back to the account card's own gross figures while the dedicated
  // read is loading/unavailable, so the top line never flashes 0 first.
  const grossUsd = statement?.gross_owed_usd ?? account.total_usd;
  const grossLbp = statement?.gross_owed_lbp ?? account.total_lbp;
  const commissionUsd = statement?.unsettled_commission_usd ?? 0;
  const commissionLbp = statement?.unsettled_commission_lbp ?? 0;
  const expectedUsd = statement?.expected_usd ?? grossUsd - commissionUsd;
  const expectedLbp = statement?.expected_lbp ?? grossLbp - commissionLbp;

  // LIRA-370 — of the commission: shares OMT still owes us from earlier
  // settlements (ticked types).
  const sharesUsd = statement?.owed_shares_usd ?? 0;
  const sharesLbp = statement?.owed_shares_lbp ?? 0;
  const sharesParts = [
    ...(Math.abs(sharesUsd) >= DIFF_EPS_USD / 2 ? [formatUsd(sharesUsd)] : []),
    ...(Math.abs(sharesLbp) >= DIFF_EPS_LBP / 2 ? [formatLbp(sharesLbp)] : []),
  ];
  const leftOut = formatLeftOut(
    statement?.after_day_usd ?? 0,
    statement?.after_day_lbp ?? 0,
  );

  return (
    <div
      data-testid="omt-statement-check-panel"
      className="mt-3 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          {t("statement.title")}
        </div>
        <button
          type="button"
          data-testid="omt-statement-up-to-chip"
          aria-expanded={pickingDay}
          aria-controls={upToInputId}
          onClick={() => setPickingDay((open) => !open)}
          className="shrink-0 rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:border-slate-500"
        >
          {t("statement.upTo", { day: dayLabel(upToDay) })}
          <span aria-hidden="true" className="ms-1 text-slate-500">
            ▾
          </span>
        </button>
      </div>

      {pickingDay && (
        <div className="flex items-center justify-end gap-2">
          <label htmlFor={upToInputId} className="text-[11px] text-slate-400">
            {t("statement.upToPick")}
          </label>
          <input
            id={upToInputId}
            data-testid="omt-statement-up-to-input"
            type="date"
            value={upToDay}
            max={maxDay}
            onChange={(e) => {
              const next = e.target.value;
              // Today or later is not in OMT's message: refused, as is a
              // cleared field.
              if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next > maxDay) return;
              setUpToDay(next);
              setPickingDay(false);
            }}
            className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-emerald-500 [color-scheme:dark]"
          />
        </div>
      )}

      <OmtCoveredTypesPicker
        value={coveredTypes}
        onChange={(next) => {
          setCoveredTypes(next);
          saveCoveredTypes(accountSupplierId, next);
        }}
        byType={statement?.commission_by_type}
        testIdPrefix="omt-statement-covered"
      />

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
        <div className="text-slate-400">{t("statement.grossOwed")}</div>
        <div />
        <div data-testid="omt-statement-gross-usd" className="text-slate-200">
          <Ltr>{formatUsd(grossUsd)}</Ltr>
        </div>
        <div data-testid="omt-statement-gross-lbp" className="text-slate-200">
          <Ltr>{formatLbp(grossLbp)}</Ltr>
        </div>

        <div className="text-slate-400">
          {t("statement.unsettledCommission")}
        </div>
        <div />
        <div
          data-testid="omt-statement-commission-usd"
          className="text-slate-200"
        >
          <Ltr>{formatUsd(commissionUsd)}</Ltr>
        </div>
        <div
          data-testid="omt-statement-commission-lbp"
          className="text-slate-200"
        >
          <Ltr>{formatLbp(commissionLbp)}</Ltr>
        </div>

        <div className="text-slate-300 font-semibold border-t border-slate-700/60 pt-1">
          {t("statement.expected")}
        </div>
        <div className="border-t border-slate-700/60 pt-1" />
        <div
          data-testid="omt-statement-expected-usd"
          className="text-white font-semibold"
        >
          <Ltr>{formatUsd(expectedUsd)}</Ltr>
        </div>
        <div
          data-testid="omt-statement-expected-lbp"
          className="text-white font-semibold"
        >
          <Ltr>{formatLbp(expectedLbp)}</Ltr>
        </div>
      </div>

      {leftOut !== "" && (
        <div
          data-testid="omt-statement-after-day"
          className="text-[11px] text-slate-500"
        >
          <Trans
            t={t}
            i18nKey="statement.afterDay"
            values={{ day: dayLabel(upToDay), amounts: leftOut }}
            components={{ ltr: <bdi dir="ltr" /> }}
          />
        </div>
      )}

      {sharesParts.length > 0 && (
        <div
          data-testid="omt-statement-owed-shares"
          className="text-[11px] text-indigo-300"
        >
          <Trans
            t={t}
            i18nKey="statement.owedShares"
            values={{ amounts: sharesParts.join(" · ") }}
            components={{ ltr: <bdi dir="ltr" /> }}
          />
        </div>
      )}

      <p className="text-[11px] text-slate-500">{t("statement.typeOnSettle")}</p>
    </div>
  );
}
