/**
 * LIRA-377 T046 — "Shop restored to <time> by <name>" on a paired PC, until
 * someone dismisses it. Shown on the standby screen (nobody is signed in
 * there) and above the app while the PC works offline. The restore time is a
 * UTC instant from the server and is shown in this PC's local time.
 * Desktop-only by nature (E1); dismiss goes through `useApi()`.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import type { OfflineRestoreNotice } from "@liratek/core";
import { useFormat } from "@/i18n/useFormat";
import logger from "@/utils/logger";

export interface RestoreNoticeBannerProps {
  notice: OfflineRestoreNotice | null | undefined;
  /** ask the parent to re-read the status after dismissing */
  onChanged: () => void;
}

const WHEN_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

export function RestoreNoticeBanner({
  notice,
  onChanged,
}: RestoreNoticeBannerProps) {
  const api = useApi();
  const { t } = useTranslation("offline");
  const { formatDateTime } = useFormat();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!notice) return null;

  const at = notice.restoredTo ? new Date(notice.restoredTo) : null;
  const when =
    at && !Number.isNaN(at.getTime())
      ? formatDateTime(at, WHEN_OPTIONS)
      : notice.restoredTo;
  const by = notice.byName;
  const text = when
    ? by
      ? t("restore.restoredTo", { when, by })
      : t("restore.restoredToNoName", { when })
    : by
      ? t("restore.fromFile", { by })
      : t("restore.fromFileNoName");

  async function dismiss() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.dismissOfflineRestoreNotice();
      if (!r.success) setMessage(r.error ?? t("common.failed"));
      onChanged();
    } catch (err) {
      logger.error("dismiss restore notice failed:", err);
      setMessage(t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 bg-sky-900 px-4 py-2 text-sm text-sky-50"
    >
      <span className="font-semibold">{text}</span>
      <button
        type="button"
        disabled={busy}
        aria-label={t("restore.dismissLabel")}
        className="ms-auto rounded border border-sky-300 px-3 py-1 hover:bg-sky-800 disabled:opacity-50"
        onClick={() => void dismiss()}
      >
        {t("restore.dismiss")}
      </button>
      {message ? <span className="w-full text-sky-200">{message}</span> : null}
    </div>
  );
}

export default RestoreNoticeBanner;
