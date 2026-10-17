/**
 * LIRA-306 US3 — "Offline work to review" (web app, admins; FR-037).
 *
 * What a PC did while the internet was down and the server could not book by
 * itself: possible duplicates, drawer counts, items waiting on another item,
 * refusals, and notes on booked work. Each item shows what, when, which PC,
 * who and why, with Apply / Dismiss / Mark reviewed / Book anyway. Data goes
 * through `useApi()` (web-only routes; the desktop branch answers "Available
 * on the web app", E1). `api` is read through a ref (rule 25).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useApi } from "@liratek/ui";
import type {
  CheckpointExpectedFigure,
  OfflineHistoryView,
  ReviewAction,
  ReviewDismissInput,
  ReviewItemView,
} from "@liratek/core";
import { useAuth } from "@/features/auth/context/AuthContext";
import logger from "@/utils/logger";
import { useFormat } from "@/i18n/useFormat";

type Group = { kind: string; label: string; count: number };

const ACTION_LABEL_KEY = {
  apply: "review.action.apply",
  dismiss: "review.action.dismiss",
  reviewed: "review.action.reviewed",
  book_anyway: "review.action.book_anyway",
} as const satisfies Record<ReviewAction, string>;

/** Actions that book or drop money ask for a confirmation first. */
const NEEDS_CONFIRM: readonly ReviewAction[] = [
  "apply",
  "dismiss",
  "book_anyway",
];

const CONFIRM_TEXT_KEY = {
  apply: "review.confirmText.apply",
  dismiss: "review.confirmText.dismiss",
  reviewed: null,
  book_anyway: "review.confirmText.book_anyway",
} as const satisfies Record<ReviewAction, string | null>;

/** en-US output identical to the old `toLocaleString()`. */
const WHEN_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

function matchText(
  item: ReviewItemView,
  t: TFunction<"offline">,
): string | null {
  const m = item.details?.match as
    | { table?: string; id?: number; at?: string }
    | undefined;
  if (!m?.table || m.id === undefined) return null;
  return m.at
    ? t("review.matchesAt", { table: m.table, id: m.id, at: m.at })
    : t("review.matches", { table: m.table, id: m.id });
}

export function OfflineReview() {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const { t } = useTranslation("offline");
  const tRef = useRef(t);
  tRef.current = t;
  const { formatDateTime, formatNumber } = useFormat();
  const when = (iso: string | null): string => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : formatDateTime(d, WHEN_OPTIONS);
  };
  const confirmText = (action: ReviewAction): string => {
    const key = CONFIRM_TEXT_KEY[action];
    return key ? t(key) : "";
  };
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [items, setItems] = useState<ReviewItemView[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [history, setHistory] = useState<OfflineHistoryView[]>([]);
  const [tab, setTab] = useState<"open" | "history">("open");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    id: number;
    action: ReviewAction;
  } | null>(null);
  // FR-032 / O-new-27: a drawer count's PC vs server figures, shown before Apply
  const [figures, setFigures] = useState<CheckpointExpectedFigure[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiRef.current.getOfflineReviewItems({ state: "open" });
      if (r.success && r.data) {
        setItems(r.data.items);
        setGroups(r.data.groups);
      } else {
        setError(r.error ?? tRef.current("review.loadFailed"));
      }
    } catch (err) {
      logger.error("Failed to load offline review items:", err);
      setError(tRef.current("review.loadFailed"));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const r = await apiRef.current.getOfflineHistory({});
      if (r.success && r.data) setHistory(r.data.events);
    } catch (err) {
      logger.error("Failed to load offline history:", err);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  useEffect(() => {
    if (isAdmin && tab === "history") void loadHistory();
  }, [isAdmin, tab, loadHistory]);

  const run = useCallback(
    async (id: number, action: ReviewAction) => {
      setBusy(true);
      try {
        const a = apiRef.current;
        const dismissBody: ReviewDismissInput = {};
        const r =
          action === "apply"
            ? await a.applyOfflineReviewItem(id)
            : action === "dismiss"
              ? await a.dismissOfflineReviewItem(id, dismissBody)
              : action === "reviewed"
                ? await a.markOfflineReviewItemReviewed(id)
                : await a.bookOfflineReviewItemAnyway(id);
        await load();
        setError(
          r.success ? null : (r.error ?? tRef.current("review.actionFailed")),
        );
      } catch (err) {
        logger.error("Offline review action failed:", err);
        setError(tRef.current("review.actionFailed"));
      } finally {
        setBusy(false);
        setPending(null);
        setFigures(null);
      }
    },
    [load],
  );

  const onAction = async (id: number, action: ReviewAction) => {
    if (!NEEDS_CONFIRM.includes(action)) {
      void run(id, action);
      return;
    }
    setFigures(null);
    const it = items.find((i) => i.id === id);
    if (action === "apply" && it?.kind === "held_checkpoint") {
      try {
        const p = await apiRef.current.getOfflineReviewPreview(id);
        if (p.success && p.data?.kind === "drawer_count") setFigures(p.data.figures);
      } catch (err) {
        logger.error("Failed to load the drawer-count preview:", err);
      }
    }
    setPending({ id, action });
  };

  if (!isAdmin) {
    return (
      <div className="h-full p-6">
        <h1 className="text-2xl font-bold text-white">{t("review.title")}</h1>
        <p className="mt-4 text-slate-400">{t("review.adminsOnly")}</p>
      </div>
    );
  }

  return (
    <div className="h-full p-6 overflow-y-auto">
      <h1 className="text-2xl font-bold text-white">{t("review.title")}</h1>
      <p className="mt-1 text-sm text-slate-400">
        {t("review.intro")}
      </p>

      <div className="mt-4 flex gap-2" role="tablist">
        {(["open", "history"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-sm ${tab === k ? "bg-violet-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            {k === "open" ? t("review.tabOpen") : t("review.tabHistory")}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      {pending && (
        <div
          role="dialog"
          aria-label={t("review.confirm")}
          className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
        >
          <p className="text-sm text-amber-200">
            {confirmText(pending.action)}
          </p>
          {figures && figures.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-amber-200/80">
                {t("review.figuresNote")}
              </p>
              <table className="mt-1 w-full text-sm text-slate-200">
                <thead>
                  <tr className="text-start text-xs text-slate-400">
                    <th className="py-1">{t("review.col.drawer")}</th>
                    <th>{t("review.col.currency")}</th>
                    <th>{t("review.col.pcExpected")}</th>
                    <th>{t("review.col.serverExpected")}</th>
                    <th>{t("review.col.counted")}</th>
                  </tr>
                </thead>
                <tbody>
                  {figures.map((f) => (
                    <tr
                      key={`${f.drawer_name}-${f.currency_code}`}
                      aria-label={`${f.drawer_name} ${f.currency_code}`}
                    >
                      <td className="py-1">{f.drawer_name}</td>
                      <td>{f.currency_code}</td>
                      <td>{formatNumber(f.pc_expected)}</td>
                      <td>{formatNumber(f.server_expected)}</td>
                      <td>{formatNumber(f.physical)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(pending.id, pending.action)}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm"
            >
              {t("review.confirm")}
            </button>
            <button
              type="button"
              onClick={() => {
                setPending(null);
                setFigures(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm"
            >
              {t("review.cancel")}
            </button>
          </div>
        </div>
      )}

      {tab === "open" && (
        <div className="mt-4 space-y-6">
          {groups.length === 0 && !error && (
            <p className="text-slate-400">{t("review.nothing")}</p>
          )}
          {groups.map((g) => (
            <section key={g.kind} aria-label={g.label}>
              <h2 className="text-lg font-semibold text-white">
                {g.label} ({g.count})
              </h2>
              <ul className="mt-2 space-y-2">
                {items
                  .filter((i) => i.kind === g.kind)
                  .map((i) => (
                    <li
                      key={i.id}
                      className="rounded-xl border border-slate-700/50 bg-slate-800 p-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-white">
                          {i.channelLabel ?? t("review.pcDataCheck")}
                        </span>
                        <span className="text-xs text-slate-400">
                          {when(i.occurredAt ?? i.createdAt)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-slate-300">
                        {i.deviceName ?? t("review.pc")} (
                        {t("review.pcNo", { deviceNo: i.deviceNo ?? "?" })})
                        {i.actorName ? ` · ${i.actorName}` : ""}
                      </div>
                      {i.reason && (
                        <div className="mt-1 text-sm text-slate-400">
                          {i.reason}
                        </div>
                      )}
                      {matchText(i, t) && (
                        <div className="mt-1 text-sm text-violet-300">
                          {matchText(i, t)}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {i.actions.map((a) => (
                          <button
                            key={a}
                            type="button"
                            disabled={busy}
                            aria-label={t("review.itemAction", {
                              action: t(ACTION_LABEL_KEY[a]),
                              id: i.id,
                            })}
                            onClick={() => void onAction(i.id, a)}
                            className="px-3 py-1 rounded-lg bg-slate-700 text-sm text-white hover:bg-slate-600"
                          >
                            {t(ACTION_LABEL_KEY[a])}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {tab === "history" && (
        <table className="mt-4 w-full text-sm text-slate-300">
          <thead>
            <tr className="text-start text-slate-400">
              <th className="py-1">{t("review.col.when")}</th>
              <th>{t("review.col.pc")}</th>
              <th>{t("review.col.what")}</th>
              <th>{t("review.col.outcome")}</th>
              <th>{t("review.col.receipt")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((e) => (
              <tr key={e.eventId} className="border-t border-slate-700/50">
                <td className="py-1">{when(e.correctedAt ?? e.occurredAt)}</td>
                <td>{t("review.pcNo", { deviceNo: e.deviceNo ?? "?" })}</td>
                <td>{e.channelLabel}</td>
                <td>{e.status}</td>
                <td>{e.receiptNumber ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default OfflineReview;
