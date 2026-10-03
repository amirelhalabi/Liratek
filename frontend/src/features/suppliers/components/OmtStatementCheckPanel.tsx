import { useState } from "react";
import {
  useSupplierAccountExpectedStatementQuery,
  type AccountBalance,
} from "../hooks/useSuppliers";

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
  const trimmed = raw.trim();
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
  return `${sign}${Math.abs(Math.round(n)).toLocaleString()} LBP`;
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
  if (diff === null) {
    return <span className="text-slate-500 text-xs">Type the SMS figure</span>;
  }
  const matches = Math.abs(diff) <= eps;
  return (
    <span
      data-testid="omt-statement-diff-badge"
      className={`text-xs font-semibold ${
        matches ? "text-emerald-400" : "text-amber-400"
      }`}
    >
      {matches ? "Matches" : `Off by ${format(diff)}`}
    </span>
  );
}

export function OmtStatementCheckPanel({
  account,
}: {
  account: AccountBalance;
}) {
  const accountSupplierId = account.account_supplier_id;
  const statementQuery =
    useSupplierAccountExpectedStatementQuery(accountSupplierId);

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

  return (
    <div
      data-testid="omt-statement-check-panel"
      className="mt-3 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3"
    >
      <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
        Check against OMT&apos;s statement
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
        <div className="text-slate-400">Owed to OMT (gross)</div>
        <div />
        <div data-testid="omt-statement-gross-usd" className="text-slate-200">
          {formatUsd(grossUsd)}
        </div>
        <div data-testid="omt-statement-gross-lbp" className="text-slate-200">
          {formatLbp(grossLbp)}
        </div>

        <div className="text-slate-400">− Unsettled commission</div>
        <div />
        <div
          data-testid="omt-statement-commission-usd"
          className="text-slate-200"
        >
          {formatUsd(commissionUsd)}
        </div>
        <div
          data-testid="omt-statement-commission-lbp"
          className="text-slate-200"
        >
          {formatLbp(commissionLbp)}
        </div>

        <div className="text-slate-300 font-semibold border-t border-slate-700/60 pt-1">
          = Expected on OMT&apos;s statement
        </div>
        <div className="border-t border-slate-700/60 pt-1" />
        <div
          data-testid="omt-statement-expected-usd"
          className="text-white font-semibold"
        >
          {formatUsd(expectedUsd)}
        </div>
        <div
          data-testid="omt-statement-expected-lbp"
          className="text-white font-semibold"
        >
          {formatLbp(expectedLbp)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">
            OMT SMS says (USD)
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
            OMT SMS says (LBP)
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
