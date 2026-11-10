/**
 * Settings › Backup › Restore (web app, admins — LIRA-377).
 *
 * Three sources, each ending in the same preview card:
 *   1. a "Before restore" copy (undo a restore) — listed first;
 *   2. a moment inside `points.earliest…latest`, picked in THIS browser's
 *      local time and sent as a UTC instant + the browser's offset (rule 27);
 *   3. a backup file from "Download backup".
 * The preview says what will be lost (Money in and Money out as separate
 * lines, never netted); Restore stays disabled until the shop's name is typed
 * exactly. After the swap the session is over: the panel says so and signs
 * out the way the app signs out everywhere (`useAuth().logout`).
 *
 * Web-only and admin-only, like ShopBackupPanel. Goes through `useApi()`
 * (rule 19); `api` is read through a ref (rule 25).
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import type {
  PreparedRestore,
  RestoreBeforeCopy,
  RestoreErrorCode,
  RestoreMoney,
  RestorePoints,
} from "@liratek/ui";
import type { PrepareRestorePayload } from "@liratek/core";
import { isElectron } from "@/api/backendApi";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useFormat } from "@/i18n/useFormat";
import logger from "@/utils/logger";
import { browserTzOffsetMin, isoToLocalInput, localInputToUtcIso } from "./restoreTime";

/** Shown long enough to be read before the sign-out takes the page away. */
const SIGN_OUT_AFTER_MS = 4_000;

const KNOWN_CODES: ReadonlySet<string> = new Set<RestoreErrorCode>([
  "RESTORE_RUNNING",
  "OUT_OF_WINDOW",
  "BEFORE_SHOP_EXISTED",
  "NO_BACKUP_AT_TIME",
  "PREPARE_FAILED",
  "NOT_A_SHOP_FILE",
  "FILE_DAMAGED",
  "OTHER_SHOP",
  "MIXED_SHOPS",
  "NEWER_VERSION",
  "UNEXPECTED_SCHEMA_OBJECT",
  "NAME_MISMATCH",
  "EXPIRED",
  "NOT_YOURS",
  "RESTORE_FAILED",
  "FILE_TOO_LARGE",
]);

type Refusal = { error?: string; code?: string; shopName?: string };
type Busy = "prepare" | "upload" | "confirm" | null;

/** The refusal's code: `code` when sent, else `error` when it IS a code. */
function isKnownCode(v: string | undefined): v is RestoreErrorCode {
  return v !== undefined && KNOWN_CODES.has(v);
}

function refusalCode(r: Refusal): RestoreErrorCode | undefined {
  if (isKnownCode(r.code)) return r.code;
  if (isKnownCode(r.error)) return r.error;
  return undefined;
}

const inputClass =
  "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 disabled:opacity-50";

export default function ShopRestorePanel() {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const { user, logout } = useAuth();
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  const { t } = useTranslation("settings");
  const { formatDateTime, formatMoney, formatNumber } = useFormat();

  const shown = !isElectron() && user?.role === "admin";

  const [points, setPoints] = useState<RestorePoints | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedRestore | null>(null);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const messageFor = useCallback(
    (r: Refusal): string => {
      const code = refusalCode(r);
      if (code === "OTHER_SHOP") {
        return r.shopName
          ? t("restore.errors.OTHER_SHOP", { shopName: r.shopName })
          : t("restore.errors.OTHER_SHOP_UNNAMED");
      }
      if (code) return t(`restore.errors.${code}`);
      return r.error || t("restore.errors.generic");
    },
    [t],
  );

  const loadPoints = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const r = await apiRef.current.getRestorePoints();
      if (r.success) setPoints(r.data);
      else setLoadFailed(true);
    } catch (err) {
      logger.error("Restore points failed to load:", err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (shown) void loadPoints();
  }, [shown, loadPoints]);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => void logoutRef.current(), SIGN_OUT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [done]);

  if (!shown) return null;

  const showPrepared = (r: Awaited<ReturnType<typeof api.prepareRestore>>) => {
    if (r.success) {
      setPrepared(r.data);
      setTyped("");
    } else {
      setError(messageFor(r));
    }
  };

  const prepare = async (payload: PrepareRestorePayload) => {
    setBusy("prepare");
    setError(null);
    try {
      showPrepared(await apiRef.current.prepareRestore(payload));
    } catch (err) {
      logger.error("Restore prepare failed:", err);
      setError(t("restore.errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  const prepareAtTime = () => {
    const restoredTo = localInputToUtcIso(picked);
    if (!restoredTo) return;
    void prepare({ kind: "time", restoredTo, clientTzOffsetMin: browserTzOffsetMin() });
  };

  const prepareUndo = (restoreId: number) =>
    void prepare({ kind: "undo", restoreId, clientTzOffsetMin: browserTzOffsetMin() });

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy("upload");
    setError(null);
    try {
      showPrepared(await apiRef.current.uploadRestoreFile(file, browserTzOffsetMin()));
    } catch (err) {
      logger.error("Restore file upload failed:", err);
      setError(t("restore.errors.generic"));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const cancel = async () => {
    const current = prepared;
    // Local state clears even when the server call fails: the candidate
    // expires on its own after 15 minutes.
    setPrepared(null);
    setTyped("");
    setError(null);
    if (!current) return;
    try {
      await apiRef.current.cancelRestore({ restoreId: current.restoreId });
    } catch (err) {
      logger.warn("Restore cancel failed", { err });
    }
  };

  const expectedName = prepared?.shopName ?? points?.shopName ?? null;
  const nameMatches = expectedName !== null && typed === expectedName;

  const confirm = async () => {
    if (!prepared || !nameMatches) return;
    setBusy("confirm");
    setError(null);
    try {
      const r = await apiRef.current.confirmRestore({
        restoreId: prepared.restoreId,
        typedShopName: typed,
      });
      if (r.success) {
        setDone(true);
        return;
      }
      if (refusalCode(r) === "EXPIRED") setPrepared(null);
      setError(messageFor(r));
    } catch (err) {
      logger.error("Restore confirm failed:", err);
      setError(t("restore.errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <div className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
        <p className="text-sm font-semibold text-emerald-300">{t("restore.done")}</p>
        <button
          type="button"
          onClick={() => void logoutRef.current()}
          className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm"
        >
          {t("restore.signInAgain")}
        </button>
      </div>
    );
  }

  const locked = busy !== null || prepared !== null;
  const min = points ? isoToLocalInput(points.earliest, true) : "";
  const max = points ? isoToLocalInput(points.latest) : "";

  const moneyList = (rows: RestoreMoney[]) =>
    rows.length === 0
      ? t("restore.preview.none")
      : rows.map((m) => formatMoney(m.amount, m.currency)).join(" · ");

  return (
    <div className="space-y-4 border-t border-slate-700 pt-6">
      <div>
        <h2 className="text-lg font-semibold text-white">{t("restore.title")}</h2>
        <p className="text-sm text-slate-400">{t("restore.intro")}</p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-slate-400">{t("restore.loading")}</p>}

      {loadFailed && !loading && (
        <div className="flex items-center gap-3 text-sm text-red-300">
          <span>{t("restore.loadFailed")}</span>
          <button
            type="button"
            onClick={() => void loadPoints()}
            className="px-2 py-1 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            {t("restore.retry")}
          </button>
        </div>
      )}

      {points && points.beforeCopies.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-200">{t("restore.beforeCopiesTitle")}</h3>
          {points.beforeCopies.map((c: RestoreBeforeCopy) => (
            <div
              key={c.restoreId}
              data-testid={`restore-before-copy-${c.restoreId}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            >
              <span className="text-sm text-slate-200">
                {t("restore.beforeCopy", { time: formatDateTime(c.takenAt), name: c.byName })}
              </span>
              <button
                type="button"
                disabled={locked}
                onClick={() => prepareUndo(c.restoreId)}
                className="px-3 py-1.5 rounded-lg border border-red-500/50 text-red-300 hover:bg-red-500/10 text-sm disabled:opacity-50"
              >
                {t("restore.restoreButton")}
              </button>
            </div>
          ))}
        </section>
      )}

      {points && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-200">{t("restore.timeTitle")}</h3>
          <label htmlFor="restore-time" className="text-xs text-slate-400 block">
            {t("restore.timeLabel")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="restore-time"
              type="datetime-local"
              min={min}
              max={max}
              value={picked}
              disabled={locked}
              onChange={(e) => setPicked(e.target.value)}
              className={`${inputClass} max-w-xs`}
            />
            <button
              type="button"
              disabled={locked || !localInputToUtcIso(picked)}
              onClick={prepareAtTime}
              className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm disabled:opacity-50"
            >
              {busy === "prepare" ? t("restore.preparing") : t("restore.prepare")}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {t("restore.timeHint", {
              from: formatDateTime(points.earliest),
              to: formatDateTime(points.latest),
            })}
          </p>
        </section>
      )}

      {points && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-200">{t("restore.fileTitle")}</h3>
          <label htmlFor="restore-file" className="text-xs text-slate-400 block">
            {t("restore.fileLabel")}
          </label>
          <input
            id="restore-file"
            ref={fileRef}
            type="file"
            accept=".db,application/vnd.sqlite3,application/octet-stream"
            disabled={locked}
            onChange={(e) => void upload(e)}
            className="block text-sm text-slate-300 file:me-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-white disabled:opacity-50"
          />
          <p className="text-xs text-slate-500">
            {busy === "upload" ? t("restore.uploading") : t("restore.fileHint")}
          </p>
        </section>
      )}

      {prepared && (
        <div
          data-testid="restore-preview"
          className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg text-red-400 bg-red-400/10">
              <AlertTriangle size={20} />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">
                {t("restore.preview.title", { time: formatDateTime(prepared.preview.restoredTo) })}
              </h3>
              <p className="text-sm text-slate-300">
                {prepared.preview.lastSaleInCopy
                  ? prepared.preview.lastSaleInCopy.client
                    ? t("restore.preview.lastSaleClient", {
                        time: formatDateTime(prepared.preview.lastSaleInCopy.at),
                        amount: formatMoney(
                          prepared.preview.lastSaleInCopy.amount,
                          prepared.preview.lastSaleInCopy.currency,
                        ),
                        client: prepared.preview.lastSaleInCopy.client,
                      })
                    : t("restore.preview.lastSale", {
                        time: formatDateTime(prepared.preview.lastSaleInCopy.at),
                        amount: formatMoney(
                          prepared.preview.lastSaleInCopy.amount,
                          prepared.preview.lastSaleInCopy.currency,
                        ),
                      })
                  : t("restore.preview.noSale")}
              </p>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-red-300 mb-2">{t("restore.preview.lostTitle")}</h4>
            <ul className="space-y-1 text-sm text-slate-200">
              <li data-testid="restore-lost-sales">
                {t("restore.preview.sales", {
                  n: formatNumber(prepared.preview.lost.sales.count),
                  amount: formatMoney(prepared.preview.lost.sales.totalUsd, "USD"),
                })}
              </li>
              <li data-testid="restore-lost-money-in">
                {t("restore.preview.moneyIn")}: {moneyList(prepared.preview.lost.moneyIn)}
              </li>
              <li data-testid="restore-lost-money-out">
                {t("restore.preview.moneyOut")}: {moneyList(prepared.preview.lost.moneyOut)}
              </li>
              <li data-testid="restore-lost-payments">
                {t("restore.preview.payments", { n: formatNumber(prepared.preview.lost.payments) })}
              </li>
              <li data-testid="restore-lost-expenses">
                {t("restore.preview.expenses", { n: formatNumber(prepared.preview.lost.expenses) })}
              </li>
              <li data-testid="restore-lost-day-closings">
                {t("restore.preview.dayClosings", { n: formatNumber(prepared.preview.lost.dayClosings) })}
              </li>
              <li data-testid="restore-lost-checkpoints">
                {t("restore.preview.checkpoints", { n: formatNumber(prepared.preview.lost.checkpoints) })}
              </li>
              <li data-testid="restore-lost-settlements">
                {(() => {
                  const s = prepared.preview.lost.settlements;
                  const subs = (
                    [
                      { key: "settlementSuppliers", n: s.suppliers },
                      { key: "settlementPartners", n: s.partners },
                      { key: "settlementLoto", n: s.loto },
                    ] as const
                  ).filter((x) => x.n > 0);
                  return (
                    <>
                      {t("restore.preview.settlements", {
                        n: formatNumber(s.suppliers + s.partners + s.loto),
                      })}
                      {subs.length > 0 && (
                        <ul className="ms-4 text-red-100/80">
                          {subs.map((x) => (
                            <li key={x.key}>{t(`restore.preview.${x.key}`, { n: formatNumber(x.n) })}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  );
                })()}
              </li>
            </ul>
          </div>

          {prepared.preview.youAreMissing && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              {t("restore.preview.youAreMissing")}
            </div>
          )}

          <div className="space-y-2">
            {expectedName !== null ? (
              <p className="text-sm text-red-100/80">
                {t("restore.preview.typeBefore")}: <strong className="text-white">{expectedName}</strong>
              </p>
            ) : (
              <p className="text-sm text-red-300">{t("restore.preview.noName")}</p>
            )}
            <input
              type="text"
              aria-label={t("restore.preview.typeLabel")}
              value={typed}
              disabled={busy === "confirm" || expectedName === null}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              placeholder={expectedName ?? ""}
              className="w-full bg-slate-950 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500 disabled:opacity-50"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void cancel()}
              disabled={busy === "confirm"}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors font-medium disabled:opacity-50"
            >
              {t("restore.preview.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={!nameMatches || busy === "confirm"}
              aria-label={t("restore.preview.confirm")}
              className="flex-1 px-4 py-2.5 rounded-lg text-white font-bold transition-all shadow-lg bg-red-600 hover:bg-red-500 shadow-red-900/20 disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none"
            >
              {busy === "confirm" ? t("restore.preview.restoring") : t("restore.preview.confirm")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
