/**
 * TransactionTimeOverride
 *
 * Collapsed by default — shows a "⏱ Set custom time" toggle.
 * When expanded, lets the user pick a past/present datetime and
 * converts it to an ISO string for the parent form.
 * Future dates are blocked via the `max` attribute and runtime guard.
 *
 * LIRA-335: when a time is set, one line per checkpoint difference that
 * money saved at that time would resolve (`hint.resolvesOver` /
 * `hint.resolvesShort`, by the difference's direction). Every form gets
 * it without new props. Anything unexpected — no ApiProvider, an adapter
 * without the read, a rejection, a refused or empty read — shows no line.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useApi, type ApiAdapter } from "@liratek/ui";
import type { CheckpointDifferenceView } from "@liratek/core";
import { useFormat } from "@/i18n/useFormat";
import { useDrawerText } from "@/features/closing/hooks/useDrawerText";
import {
  formatShopMoney,
  formatWeekdayTime,
} from "@/features/closing/utils/differenceDisplay";

interface TransactionTimeOverrideProps {
  value?: string | undefined;
  onChange: (time: string | undefined) => void;
}

/** Convert an ISO string to the value expected by <input type="datetime-local"> */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Return the current local datetime in the format required by the `max` attribute */
function getMaxDatetime(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

/** `useApi()` without the throw: a form rendered outside an ApiProvider (or
 *  under a test mock that leaves `useApi` out, which makes the call itself
 *  throw) still works, minus the hint. The call happens on every render
 *  either way, so hook order is stable. */
function useOptionalApi(): Partial<ApiAdapter> | null {
  try {
    return useApi() ?? null;
  } catch {
    return null;
  }
}

/** The open differences money saved at `at` would resolve; [] on anything
 *  unexpected. Asked once per value (rule 25: `api` read through a ref). */
function useOpenDifferencesAfter(at: string | undefined) {
  const api = useOptionalApi();
  // Rule 25: the effect below reads `api` through this ref and is keyed on
  // `at` only, so an unstable `api` identity can never re-fire it. Kept
  // current before any passive effect runs.
  const apiRef = useRef(api);
  useLayoutEffect(() => {
    apiRef.current = api;
  });
  // The answer is kept with the time it was asked for, so a line from an
  // earlier time never shows under a new one.
  const [answer, setAnswer] = useState<{
    at: string;
    list: CheckpointDifferenceView[];
  } | null>(null);

  useEffect(() => {
    if (!at) return;
    const read = apiRef.current?.getOpenDifferencesAfter;
    if (typeof read !== "function") return;
    let cancelled = false;
    Promise.resolve()
      .then(() => read({ at }))
      .then((result) => {
        if (cancelled) return;
        const list =
          result?.success && Array.isArray(result.data) ? result.data : [];
        setAnswer({ at, list });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ at, list: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [at]);

  return at && answer?.at === at ? answer.list : NO_DIFFERENCES;
}

const NO_DIFFERENCES: CheckpointDifferenceView[] = [];

export function TransactionTimeOverride({
  value,
  onChange,
}: TransactionTimeOverrideProps) {
  const { t } = useTranslation("shared");
  const { t: tClosing } = useTranslation("closing");
  const fmt = useFormat();
  const { label: drawerLabel } = useDrawerText();
  const [expanded, setExpanded] = useState(!!value);
  const openDifferences = useOpenDifferencesAfter(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) {
      onChange(undefined);
      return;
    }
    const date = new Date(val);
    // Guard against future dates even if the browser doesn't enforce `max`
    if (date > new Date()) return;
    onChange(date.toISOString());
  };

  const handleClear = () => {
    onChange(undefined);
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        data-testid="txn-time-toggle"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors mt-1"
      >
        <span>⏱</span>
        <span>{t("txnTime.set")}</span>
      </button>
    );
  }

  return (
    <div className="mt-1">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-slate-400 whitespace-nowrap">
          {t("txnTime.label")}
        </label>
        <input
          type="datetime-local"
          data-testid="txn-time-input"
          value={toLocalInput(value)}
          onChange={handleChange}
          max={getMaxDatetime()}
          className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
        <button
          type="button"
          data-testid="txn-time-clear"
          onClick={handleClear}
          className="text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          {t("txnTime.clear")}
        </button>
      </div>
      {openDifferences.map((d) => {
        const drawer = drawerLabel(d.drawer_name);
        const amount = formatShopMoney(d.open, d.currency_code);
        return (
          <div
            key={d.id}
            data-testid="txn-time-hint"
            className="mt-2 flex gap-2 items-start rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200"
          >
            <Check className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
            <span>
              {tClosing(
                // FR-004: an Over is resolved by money in, a Short by money out.
                d.direction === "SHORT"
                  ? "hint.resolvesShort"
                  : "hint.resolvesOver",
                {
                  drawer,
                  time: formatWeekdayTime(fmt, d.closing_created_at),
                  amount,
                },
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
