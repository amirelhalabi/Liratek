/**
 * ClientDebtDetailModal (LIRA-350)
 *
 * The details window of ANY row on a client's Accounts page, in the
 * client's words: what it was (fields, items, a basket's items), how each
 * part was paid (method + currency) and what went on the account. It only
 * lays out `client_details`, which core builds from the transaction's
 * saved data (`buildClientDebtDetails`, one definition for the row line,
 * this window, the repayment picker and the statement export — rule 14).
 *
 * Safe to turn towards the client (review finding C13): the builder never
 * emits cost, profit, commission, product ids or internal status codes, so
 * there is nothing here to hide.
 */
import { useMemo } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import {
  clientMoney,
  fallbackMethodLabel,
  type ClientDebtDetails,
  type ClientDebtField,
} from "@liratek/core";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useFormat } from "@/i18n/useFormat";
import { parseDbDate } from "@/shared/utils/parseDbDate";

interface Props {
  details: ClientDebtDetails;
  createdAt: string;
  onClose: () => void;
}

/** "$20" / "600,000 LBP" / "$5 + 300,000 LBP" — the builder's formatter. */
function usdLbp(v: { usd: number; lbp: number }): string {
  const parts: string[] = [];
  if (Math.abs(v.usd) > 0.004) parts.push(clientMoney(Math.abs(v.usd), "USD"));
  if (Math.abs(v.lbp) > 0.5) parts.push(clientMoney(Math.abs(v.lbp), "LBP"));
  return parts.join(" + ");
}

/**
 * The window's content without its frame — also used inside the session
 * basket window for one basket item (C13: in place of the full
 * Transactions-page details, which list cost and internal codes).
 */
export function ClientDebtDetailsBody({
  details,
  showLine = true,
}: {
  details: ClientDebtDetails;
  showLine?: boolean;
}) {
  const { t } = useTranslation("debts");
  const { formatDate } = useFormat();
  const { allMethods } = usePaymentMethods();
  const methodLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of allMethods ?? []) map.set(m.code, m.label);
    return (code: string) => map.get(code) ?? fallbackMethodLabel(code);
  }, [allMethods]);

  const fieldValue = (f: ClientDebtField) =>
    f.type === "date"
      ? formatDate(parseDbDate(f.value), {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : f.value;
  // A charge puts money ON the account; a repayment, refund or discount
  // row (stored negative) takes it off — shown apart, never as a debt.
  const onAccount = usdLbp({
    usd: Math.max(0, details.onAccount.usd),
    lbp: Math.max(0, details.onAccount.lbp),
  });
  const offAccount = usdLbp({
    usd: Math.min(0, details.onAccount.usd),
    lbp: Math.min(0, details.onAccount.lbp),
  });

  return (
    <div className="space-y-4">
      {showLine && (
        <p className="text-sm text-slate-200 leading-snug">{details.line}</p>
      )}

      {details.fields.length > 0 && (
        <dl className="bg-slate-800/60 rounded-xl p-3 space-y-1.5 border border-slate-700/40">
          {details.fields.map((f) => (
            <div key={f.key} className="flex justify-between gap-3 text-sm">
              <dt className="text-slate-400 shrink-0">
                {t(`clientDebt.field.${f.key}`)}
              </dt>
              <dd className="text-white text-end break-words min-w-0">
                {fieldValue(f)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {details.items.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-2">
            {t("clientDebt.items")}
          </h3>
          <ul className="space-y-1">
            {details.items.map((item, idx) => (
              <li
                key={`${item.name}-${idx}`}
                className="flex justify-between gap-3 text-sm"
              >
                <span className="text-slate-300 min-w-0">
                  {item.quantity !== 1 && (
                    <span className="text-slate-500">
                      <Ltr>{`${item.quantity}× `}</Ltr>
                    </span>
                  )}
                  <span>{item.name}</span>
                  {item.unitPrice && item.quantity !== 1 && (
                    <span className="text-slate-500">
                      {" "}
                      <Ltr>{`@ ${item.unitPrice}`}</Ltr>
                    </span>
                  )}
                </span>
                {item.total && (
                  <span className="font-mono text-white shrink-0">
                    <Ltr>{item.total}</Ltr>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {details.members && details.members.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-2">
            {t("clientDebt.basketItems")}
          </h3>
          <ul className="space-y-1.5">
            {details.members.map((m, idx) => {
              const owed = usdLbp(m.onAccount);
              return (
                <li
                  key={`${m.line}-${idx}`}
                  className="flex justify-between gap-3 text-sm"
                >
                  <span className="text-slate-300 min-w-0">
                    <span className="text-slate-500">
                      {t(`clientDebt.kind.${m.kind}`)}:{" "}
                    </span>
                    {m.line}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${owed ? "text-red-300" : "text-emerald-400"}`}
                  >
                    {owed ? (
                      <Ltr>
                        {t("clientDebt.onAccountAmount", { amount: owed })}
                      </Ltr>
                    ) : (
                      t("clientDebt.paidAtCheckout")
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {details.payments.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-2">
            {t("clientDebt.howPaid")}
          </h3>
          <ul className="space-y-1">
            {details.payments.map((p, idx) => (
              <li
                key={`${p.method}-${p.currency}-${idx}`}
                className="flex justify-between gap-3 text-sm px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/30"
              >
                <span className="text-slate-300">
                  <span className="text-slate-500">
                    {p.direction === "OUT"
                      ? t("clientDebt.givenToClient")
                      : t("clientDebt.paid")}
                    {" · "}
                  </span>
                  <span>{methodLabel(p.method)}</span>
                </span>
                <span className="font-mono text-white shrink-0">
                  <Ltr>{p.text}</Ltr>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onAccount && (
        <div className="flex justify-between gap-3 text-sm font-semibold px-3 py-2 rounded-lg bg-red-950/30 border border-red-500/20">
          <span className="text-red-300">{t("clientDebt.onAccount")}</span>
          <span className="font-mono text-red-200">
            <Ltr>{onAccount}</Ltr>
          </span>
        </div>
      )}

      {offAccount && (
        <div className="flex justify-between gap-3 text-sm font-semibold px-3 py-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20">
          <span className="text-emerald-300">{t("clientDebt.offAccount")}</span>
          <span className="font-mono text-emerald-200">
            <Ltr>{offAccount}</Ltr>
          </span>
        </div>
      )}

      {details.note && (
        <div className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">
            {t("clientDebt.note")}
          </div>
          <p className="text-slate-300 whitespace-pre-wrap break-words">
            {details.note}
          </p>
        </div>
      )}
    </div>
  );
}

export function ClientDebtDetailModal({ details, createdAt, onClose }: Props) {
  const { t } = useTranslation("debts");
  const { formatDateTime } = useFormat();
  useModalFocusFix(true);

  const title = `${t(`clientDebt.kind.${details.kind}`)}${
    details.ref ? ` ${details.ref}` : ""
  }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="client-debt-detail"
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-700/60">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white">{title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {formatDateTime(parseDbDate(createdAt), {
                year: "numeric",
                month: "numeric",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("clientDebt.close")}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          <ClientDebtDetailsBody details={details} />
        </div>
      </div>
    </div>
  );
}
