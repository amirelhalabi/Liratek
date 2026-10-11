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
import { useApi } from "@liratek/ui";
import type {
  OfflineHistoryView,
  ReviewAction,
  ReviewDismissInput,
  ReviewItemView,
} from "@liratek/core";
import { useAuth } from "@/features/auth/context/AuthContext";
import logger from "@/utils/logger";

type Group = { kind: string; label: string; count: number };

const ACTION_LABEL: Record<ReviewAction, string> = {
  apply: "Apply",
  dismiss: "Dismiss",
  reviewed: "Mark reviewed",
  book_anyway: "Book anyway",
};

/** Actions that book or drop money ask for a confirmation first. */
const NEEDS_CONFIRM: readonly ReviewAction[] = [
  "apply",
  "dismiss",
  "book_anyway",
];

const CONFIRM_TEXT: Record<ReviewAction, string> = {
  apply: "Book this item now, through the same rules as the web app?",
  dismiss: "Drop this item? Nothing will be booked.",
  reviewed: "",
  book_anyway: "Book this transfer/recharge as a second, separate one?",
};

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function matchText(item: ReviewItemView): string | null {
  const m = item.details?.match as
    | { table?: string; id?: number; at?: string }
    | undefined;
  if (!m?.table || m.id === undefined) return null;
  return `Matches ${m.table} #${m.id}${m.at ? ` (${m.at})` : ""}`;
}

export function OfflineReview() {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
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

  const load = useCallback(async () => {
    try {
      const r = await apiRef.current.getOfflineReviewItems({ state: "open" });
      if (r.success && r.data) {
        setItems(r.data.items);
        setGroups(r.data.groups);
      } else {
        setError(r.error ?? "Could not load the review list");
      }
    } catch (err) {
      logger.error("Failed to load offline review items:", err);
      setError("Could not load the review list");
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
        setError(r.success ? null : (r.error ?? "The action failed"));
      } catch (err) {
        logger.error("Offline review action failed:", err);
        setError("The action failed");
      } finally {
        setBusy(false);
        setPending(null);
      }
    },
    [load],
  );

  const onAction = (id: number, action: ReviewAction) => {
    if (NEEDS_CONFIRM.includes(action)) setPending({ id, action });
    else void run(id, action);
  };

  if (!isAdmin) {
    return (
      <div className="h-full p-6">
        <h1 className="text-2xl font-bold text-white">
          Offline work to review
        </h1>
        <p className="mt-4 text-slate-400">This page is only for admins.</p>
      </div>
    );
  }

  return (
    <div className="h-full p-6 overflow-y-auto">
      <h1 className="text-2xl font-bold text-white">Offline work to review</h1>
      <p className="mt-1 text-sm text-slate-400">
        Work done on a PC while the internet was down that could not be booked
        by itself.
      </p>

      <div className="mt-4 flex gap-2" role="tablist">
        {(["open", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm ${tab === t ? "bg-violet-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            {t === "open" ? "To review" : "History"}
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
          aria-label="Confirm"
          className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
        >
          <p className="text-sm text-amber-200">
            {CONFIRM_TEXT[pending.action]}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(pending.id, pending.action)}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {tab === "open" && (
        <div className="mt-4 space-y-6">
          {groups.length === 0 && !error && (
            <p className="text-slate-400">Nothing to review.</p>
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
                          {i.channelLabel ?? "PC data check"}
                        </span>
                        <span className="text-xs text-slate-400">
                          {when(i.occurredAt ?? i.createdAt)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-slate-300">
                        {i.deviceName ?? "PC"} (PC {i.deviceNo ?? "?"})
                        {i.actorName ? ` · ${i.actorName}` : ""}
                      </div>
                      {i.reason && (
                        <div className="mt-1 text-sm text-slate-400">
                          {i.reason}
                        </div>
                      )}
                      {matchText(i) && (
                        <div className="mt-1 text-sm text-violet-300">
                          {matchText(i)}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {i.actions.map((a) => (
                          <button
                            key={a}
                            type="button"
                            disabled={busy}
                            aria-label={`${ACTION_LABEL[a]} item ${i.id}`}
                            onClick={() => onAction(i.id, a)}
                            className="px-3 py-1 rounded-lg bg-slate-700 text-sm text-white hover:bg-slate-600"
                          >
                            {ACTION_LABEL[a]}
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
            <tr className="text-left text-slate-400">
              <th className="py-1">When</th>
              <th>PC</th>
              <th>What</th>
              <th>Outcome</th>
              <th>Offline receipt</th>
            </tr>
          </thead>
          <tbody>
            {history.map((e) => (
              <tr key={e.eventId} className="border-t border-slate-700/50">
                <td className="py-1">{when(e.correctedAt ?? e.occurredAt)}</td>
                <td>PC {e.deviceNo ?? "?"}</td>
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
