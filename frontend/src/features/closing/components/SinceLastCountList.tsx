/**
 * LIRA-289 FR-010 — "N movements since the last count" on the drawer count screen.
 *
 * Lists the transactions that moved THIS drawer after its latest count (the
 * expected amount above already includes them; this explains why it moved).
 * Admin-only on both transports: when the list cannot load (a staff user, or
 * a failed read) nothing is shown. Collapsed by default.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatMoneyAmount,
  transactionSummary,
  transactionTitle,
  type SinceLastCountDrawer,
} from "@liratek/core";
import { useApi } from "@liratek/ui";
import { DirIcon } from "@liratek/ui/components/ui/DirIcon";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { formatDateTime } from "@liratek/ui/i18n/format";
import type { Language } from "@liratek/core";
import { useFormat } from "@/i18n/useFormat";

interface Props {
  drawer: string;
}

function signedAmount(amount: number, currency: string): string {
  return amount < 0
    ? `-${formatMoneyAmount(-amount, currency)}`
    : `+${formatMoneyAmount(amount, currency)}`;
}

/** Stored UTC (`YYYY-MM-DD HH:MM:SS` or ISO `…Z`) shown in this device's time. */
function localTime(ts: string, lang: Language): string {
  const d = new Date(ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime())
    ? ts
    : formatDateTime(d, lang, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function SinceLastCountList({ drawer }: Props) {
  const { t } = useTranslation("closing");
  const { language } = useFormat();
  const api = useApi();
  // Rule 25: read `api` through a ref so an unstable identity can't loop.
  // Synced in an effect (declared before the loader below, so it runs first)
  // because refs may not be written during render.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const [data, setData] = useState<SinceLastCountDrawer | null | undefined>(
    undefined,
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // An extra on the count screen: any failure — including an adapter that
    // does not offer this read — hides the panel and never breaks counting.
    const load = async () => {
      try {
        const res = await apiRef.current.getTransactionsSinceLastCount([
          drawer,
        ]);
        if (!cancelled) setData(res?.[0] ?? null);
      } catch {
        if (!cancelled) setData(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [drawer]);

  if (!data) return null;
  const count = data.transactions.length;
  if (count === 0) {
    return (
      <p className="text-sm text-slate-400">{t("since.none")}</p>
    );
  }
  // Every movement of this drawer — sales, top ups, cash outs, transfers —
  // not only sales: a Top Up alone used to read "1 sale".
  const label = t(count === 1 ? "since.one" : "since.many", { n: count });

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-start text-sm font-medium text-slate-200"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={16} />
        ) : (
          <DirIcon icon={ChevronRight} width={16} height={16} />
        )}
        <span>{label}</span>
      </button>
      {open && (
        <ul className="divide-y divide-slate-700/60 border-t border-slate-700/60">
          {data.transactions.map((tx) => (
            <li
              key={tx.id}
              className="flex items-start justify-between gap-3 px-4 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-white">
                  {transactionTitle(tx)}
                  {tx.client_name ? ` · ${tx.client_name}` : ""}
                </p>
                {transactionSummary(tx) ? (
                  <p className="truncate text-xs text-slate-300">
                    {transactionSummary(tx)}
                  </p>
                ) : null}
                <p className="text-xs text-slate-400">
                  {localTime(tx.created_at, language)}
                </p>
              </div>
              <div className="shrink-0 text-end font-semibold text-white">
                {Object.entries(tx.drawer_amounts).map(([cur, amt]) => (
                  <p key={cur}>
                    <Ltr>{signedAmount(amt, cur)}</Ltr>
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
