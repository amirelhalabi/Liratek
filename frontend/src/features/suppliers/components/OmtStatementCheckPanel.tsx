import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { formatNumber } from "@liratek/ui/i18n/format";
import { normalizeDigits } from "@liratek/ui/i18n/digits";
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
 * Display only — nothing here is booked or saved server-side. The two SMS
 * inputs persist to localStorage (behind try/catch, per-account key) purely
 * as a convenience so a reload doesn't lose what the operator just typed;
 * that storage is per-browser/per-device and is never read back by the app
 * for any other purpose (CLAUDE.md's browser-storage rule).
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

function storageKey(accountSupplierId: number): string {
  return `liratek:omt-statement-check:${accountSupplierId}`;
}

function loadSavedInputs(accountSupplierId: number): {
  usd: string;
  lbp: string;
} {
  try {
    const raw = window.localStorage.getItem(storageKey(accountSupplierId));
    if (!raw) return { usd: "", lbp: "" };
    const parsed = JSON.parse(raw) as { usd?: string; lbp?: string };
    return { usd: parsed.usd ?? "", lbp: parsed.lbp ?? "" };
  } catch {
    return { usd: "", lbp: "" };
  }
}

function saveInputs(accountSupplierId: number, usd: string, lbp: string) {
  try {
    window.localStorage.setItem(
      storageKey(accountSupplierId),
      JSON.stringify({ usd, lbp }),
    );
  } catch {
    // Best-effort only — a private window / blocked storage must not break
    // the panel (CLAUDE.md's browser-storage rule).
  }
}

/** Parses an operator-typed SMS figure — digits, one optional leading `-`,
 *  thousands separators and a decimal point. Returns `null` for an empty or
 *  unparsable string (shown as "—", not a false 0 vs 0 match). */
function parseSmsFigure(raw: string): number | null {
  const trimmed = normalizeDigits(raw).trim();
  if (trimmed === "" || trimmed === "-") return null;
  const cleaned = trimmed.replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

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

function DiffBadge({
  diff,
  eps,
  format,
}: {
  diff: number | null;
  eps: number;
  format: (n: number) => string;
}) {
  const { t } = useTranslation("suppliers");
  if (diff === null) {
    return (
      <span className="text-slate-500 text-xs">
        {t("statement.typeSmsFigure")}
      </span>
    );
  }
  const matches = Math.abs(diff) <= eps;
  return (
    <span
      data-testid="omt-statement-diff-badge"
      className={`text-xs font-semibold ${
        matches ? "text-emerald-400" : "text-amber-400"
      }`}
    >
      {matches ? (
        t("statement.matches")
      ) : (
        <Trans
          t={t}
          i18nKey="statement.offBy"
          values={{ money: format(diff) }}
          // The same element <Ltr> renders: amounts keep their sign on the left.
          components={{ ltr: <bdi dir="ltr" /> }}
        />
      )}
    </span>
  );
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

  // Lazy-initialized from localStorage (never in an effect — a synchronous
  // setState-in-effect on mount is exactly the cascading-render pattern
  // rule 25's neighbourhood warns about). `accountSupplierId` is read once,
  // on first render of this component instance; a different account parent
  // mounts a NEW instance (React remounts on a changed `key`/conditional
  // branch, same as every other per-account panel on this page), so this
  // never shows a stale account's leftover typed values.
  const [smsUsdInput, setSmsUsdInput] = useState(
    () => loadSavedInputs(accountSupplierId).usd,
  );
  const [smsLbpInput, setSmsLbpInput] = useState(
    () => loadSavedInputs(accountSupplierId).lbp,
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

  const smsUsd = parseSmsFigure(smsUsdInput);
  const smsLbp = parseSmsFigure(smsLbpInput);
  const diffUsd = smsUsd === null ? null : smsUsd - expectedUsd;
  const diffLbp = smsLbp === null ? null : smsLbp - expectedLbp;
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

      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">
            {t("statement.smsUsd")}
          </label>
          <input
            data-testid="omt-statement-sms-usd-input"
            type="text"
            inputMode="decimal"
            placeholder="-1,160.99"
            value={smsUsdInput}
            onChange={(e) => {
              const v = e.target.value;
              setSmsUsdInput(v);
              saveInputs(accountSupplierId, v, smsLbpInput);
            }}
            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-white text-sm font-mono"
          />
          <div className="mt-1">
            <DiffBadge diff={diffUsd} eps={DIFF_EPS_USD} format={formatUsd} />
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">
            {t("statement.smsLbp")}
          </label>
          <input
            data-testid="omt-statement-sms-lbp-input"
            type="text"
            inputMode="decimal"
            placeholder="11,584,062"
            value={smsLbpInput}
            onChange={(e) => {
              const v = e.target.value;
              setSmsLbpInput(v);
              saveInputs(accountSupplierId, smsUsdInput, v);
            }}
            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-white text-sm font-mono"
          />
          <div className="mt-1">
            <DiffBadge diff={diffLbp} eps={DIFF_EPS_LBP} format={formatLbp} />
          </div>
        </div>
      </div>
    </div>
  );
}
