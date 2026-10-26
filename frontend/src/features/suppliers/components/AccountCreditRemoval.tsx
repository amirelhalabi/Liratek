import { useId, useState } from "react";
import { appEvents } from "@liratek/ui";
import { useTranslation } from "react-i18next";
import {
  ACCOUNT_CREDIT_REASON_MAX,
  ACCOUNT_CREDIT_REASON_MIN,
  isRemovableAccountCredit,
} from "@liratek/core";
import {
  defaultFormatLbp,
  defaultFormatUsd,
} from "@/shared/components/settleCalendar";
import { localDay } from "@/shared/utils/localDay";
import {
  useRemoveSupplierAccountCreditMutation,
  type AccountUnsettledRow,
  type RemoveAccountCreditRequest,
} from "../hooks/useSuppliers";

/** "$40.00" / "450,000 LBP" (+ joined when both). Magnitudes only. */
function creditMoney(row: AccountUnsettledRow): string {
  const parts: string[] = [];
  if (Math.round(row.remaining_usd * 100) !== 0)
    parts.push(defaultFormatUsd(Math.abs(row.remaining_usd)));
  if (Math.round(row.remaining_lbp) !== 0)
    parts.push(defaultFormatLbp(Math.abs(row.remaining_lbp)));
  return parts.join(" + ");
}

/**
 * LIRA-344 — "Remove credit" (admin only): every open OMT account credit
 * (`isRemovableAccountCredit`, the same rule the server refuses by) gets a
 * button. The confirm shows the amount and asks for a reason (3–200
 * characters); the server closes the credit and books it as an "OMT credit
 * not accepted" expense, with no drawer move. Undone by voiding it in
 * Transactions.
 *
 * The payload is built ONCE here (rule 22) from the row as shown: its id,
 * its remaining (the server refuses a stale amount) and this device's day
 * for the expense (rule 27).
 */
export function AccountCreditRemoval({
  accountSupplierId,
  accountName,
  rows,
  dayLabel,
  onRemoved,
  onStale,
}: {
  accountSupplierId: number;
  accountName: string;
  /** The open queue (any rows; only removable credits are listed). */
  rows: readonly AccountUnsettledRow[];
  dayLabel: (day: string) => string;
  /** After a successful removal (the queue is already being refetched). */
  onRemoved: () => void;
  /** The server said the amounts changed: read the queue again. */
  onStale: () => void;
}) {
  const { t } = useTranslation("suppliers");
  const { t: tc } = useTranslation("common");
  const reasonId = useId();
  const mutation = useRemoveSupplierAccountCreditMutation(accountSupplierId);
  const [target, setTarget] = useState<AccountUnsettledRow | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const credits = rows.filter(isRemovableAccountCredit);
  if (credits.length === 0) return null;

  const trimmed = reason.trim();
  const reasonOk =
    trimmed.length >= ACCOUNT_CREDIT_REASON_MIN &&
    trimmed.length <= ACCOUNT_CREDIT_REASON_MAX;

  const close = () => {
    setTarget(null);
    setReason("");
    setError(null);
  };

  const confirm = async () => {
    if (!target || !reasonOk) return;
    setError(null);
    const payload: RemoveAccountCreditRequest = {
      ledger_row_id: target.id,
      reason: trimmed,
      expected_remaining: {
        usd: target.remaining_usd,
        lbp: target.remaining_lbp,
      },
      client_day: localDay(),
    };
    try {
      const res = await mutation.mutateAsync(payload);
      if (!res.success) {
        const message = res.error ?? t("accountSettle.removeCredit.failed");
        setError(message);
        if (message.startsWith("OMT's balance changed")) onStale();
        return;
      }
      appEvents.emit(
        "notification:show",
        t("accountSettle.removeCredit.done", { name: accountName }),
        "success",
      );
      close();
      onRemoved();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("accountSettle.removeCredit.failed"),
      );
    }
  };

  return (
    <div
      className="space-y-1"
      data-testid="supplier-account-settle-remove-credit-list"
    >
      {credits.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-slate-300 bg-slate-800/60"
        >
          <span className="flex-1">
            {t("accountSettle.removeCredit.row", {
              amount: creditMoney(r),
              source: r.source_name,
              day: dayLabel(r.shop_day),
            })}
          </span>
          <button
            type="button"
            data-testid={`supplier-account-settle-remove-credit-${r.id}`}
            onClick={() => {
              setTarget(r);
              setReason("");
              setError(null);
            }}
            className="font-semibold text-rose-300 underline underline-offset-[3px] hover:text-rose-200"
          >
            {t("accountSettle.removeCredit.button")}
          </button>
        </div>
      ))}

      {target && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${reasonId}-title`}
          data-testid="supplier-account-settle-remove-credit-dialog"
          className="bg-slate-800 border border-rose-900/60 rounded-xl p-4 space-y-3 mt-2"
        >
          <div>
            <div
              id={`${reasonId}-title`}
              className="text-white font-bold text-sm"
            >
              {t("accountSettle.removeCredit.heading", { name: accountName })}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {t("accountSettle.removeCredit.intro", { name: accountName })}
            </p>
          </div>
          <div className="text-sm text-white">
            {t("accountSettle.removeCredit.amount", {
              amount: creditMoney(target),
            })}
          </div>
          <div className="space-y-1">
            <label htmlFor={reasonId} className="text-xs text-slate-400">
              {t("accountSettle.removeCredit.reasonLabel")}
            </label>
            <textarea
              id={reasonId}
              data-testid="supplier-account-settle-remove-credit-reason"
              value={reason}
              maxLength={ACCOUNT_CREDIT_REASON_MAX}
              rows={2}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("accountSettle.removeCredit.reasonPlaceholder")}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-rose-400"
            />
            <div className="text-[11px] text-slate-500">
              {t("accountSettle.removeCredit.reasonHint", {
                min: ACCOUNT_CREDIT_REASON_MIN,
                max: ACCOUNT_CREDIT_REASON_MAX,
              })}
            </div>
          </div>
          {error && (
            <div role="alert" className="text-xs text-red-400">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="flex-1 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:bg-slate-700 hover:text-white"
            >
              {tc("actions.cancel")}
            </button>
            <button
              type="button"
              data-testid="supplier-account-settle-remove-credit-confirm"
              onClick={() => void confirm()}
              disabled={!reasonOk || mutation.isPending}
              className="flex-1 py-2 rounded-lg text-sm font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:bg-slate-700 disabled:text-slate-500"
            >
              {t("accountSettle.removeCredit.confirm")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
