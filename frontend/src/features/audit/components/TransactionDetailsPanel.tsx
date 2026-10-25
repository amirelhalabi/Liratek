/**
 * The Transactions page's "Details" panel (owner request 2026-10-16): every
 * fact saved with one transaction — the row's own columns, LIRA-329's
 * `details` and payment snapshot, and any older metadata keys.
 *
 * Generic on purpose: ONE layout for every kind (`buildTransactionDetailsView`
 * turns the metadata into label/value rows), so a new kind shows without a
 * change here. Pure rendering of the row already loaded — no API call, so it
 * works the same on desktop and web.
 *
 * Shell copied from `ReceiptPreviewModal` (overlay, card, header + X).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fallbackMethodLabel } from "@liratek/core";
import { Collapsible } from "@/shared/components/Collapsible";
import type { TransactionRow } from "../hooks/useTransactionRows";
import { amountCellText, deriveRow } from "../rowDerived";
import {
  hasReturnedCredits,
  returnedCreditsText,
  reversedTransactionId,
  rowStatus,
} from "../rowBadges";
import { translateTitle } from "../typeTitleText";
import { fullTimeText } from "../transactionCellText";
import {
  displaySummary,
  getTypeColor,
  getTypeLabel,
} from "../transactionDisplay";
import {
  buildTransactionDetailsView,
  readableTitle,
  type DetailRow,
  type PaymentView,
} from "../transactionDetailsView";

export interface TransactionDetailsPanelProps {
  row: TransactionRow;
  isAdmin: boolean;
  /** Payment-method code → label, as the table's Method column uses. */
  methodLabelByCode: Map<string, string>;
  onClose: () => void;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase text-slate-400 mb-2 flex items-center gap-2">
      {children}
    </h3>
  );
}

function FactList({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {rows.map((r) => (
        <DetailItem key={r.key} row={r} />
      ))}
    </dl>
  );
}

function DetailItem({ row }: { row: DetailRow }) {
  const { value } = row;
  if (value.kind === "text") {
    return (
      <>
        <dt className="text-slate-400">{row.label}</dt>
        <dd className="text-white break-words whitespace-pre-wrap">
          {value.text}
        </dd>
      </>
    );
  }
  if (value.kind === "group") {
    return (
      <>
        <dt className="text-slate-400">{row.label}</dt>
        <dd className="border-s border-slate-700 ps-3">
          <FactList rows={value.rows} />
        </dd>
      </>
    );
  }
  return (
    <>
      <dt className="text-slate-400 col-span-2">{row.label}</dt>
      <dd className="col-span-2">
        <MiniTable
          headers={value.columns.map((c) => c.label)}
          rows={value.rows}
        />
      </dd>
    </>
  );
}

function MiniTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="rounded-lg border border-slate-700 overflow-x-auto">
      <table className="w-full text-xs text-start">
        <thead className="bg-slate-800 text-slate-400">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-1.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => (
                <td key={j} className="px-3 py-1.5 text-slate-200">
                  {c || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentSection({ payment }: { payment: PaymentView }) {
  const { t } = useTranslation("audit");
  return (
    <section>
      <SectionTitle>{t("details.payment")}</SectionTitle>
      {payment.lines.length > 0 && (
        <MiniTable
          headers={[
            t("details.direction"),
            t("details.method"),
            t("details.currency"),
            t("details.amount"),
          ]}
          rows={payment.lines.map((l) => [
            l.direction,
            l.note ? `${l.method} (${l.note})` : l.method,
            l.currency,
            l.amount,
          ])}
        />
      )}
      <div className="mt-2 space-y-0.5 text-sm">
        {payment.changeReturned && (
          <p className="text-slate-300">
            <span className="text-slate-400">{payment.changeLabel}: </span>
            {payment.changeReturned}
          </p>
        )}
        {payment.kept && (
          <p className="text-slate-300">
            <span className="text-slate-400">{payment.keptLabel}: </span>
            {payment.kept}
          </p>
        )}
        {payment.sessionId !== null && (
          <p className="text-sky-400">
            {t("details.paidInSession", { id: payment.sessionId })}
          </p>
        )}
      </div>
    </section>
  );
}

export interface TransactionDetailsBodyProps {
  row: TransactionRow;
  isAdmin: boolean;
  /** Payment-method code → label, as the table's Method column uses. */
  methodLabelByCode: Map<string, string>;
}

/**
 * Every saved fact of one transaction, without the dialog shell. Shared by
 * this panel and the Debts page basket window (one view, never two copies).
 */
export function TransactionDetailsBody({
  row,
  isAdmin,
  methodLabelByCode,
}: TransactionDetailsBodyProps) {
  const { t, i18n } = useTranslation("audit");
  const language = i18n.language;
  const view = useMemo(
    () =>
      buildTransactionDetailsView(row.metadata_json, {
        isAdmin,
        methodLabel: (code) =>
          methodLabelByCode.get(code) ?? fallbackMethodLabel(code),
        row,
      }),
    [row, isAdmin, methodLabelByCode],
  );
  // Older rows have only these keys — open them straight away there.
  const [otherOpen, setOtherOpen] = useState(
    view.details.length === 0 && view.payment === null,
  );

  const reverses = reversedTransactionId(row);
  const client = [row.client_name, row.client_phone]
    .filter((x): x is string => !!x)
    .join(" · ");
  // The stored summary is shown as stored, in every language (OD-2).
  const headerFacts: { label: string; value: string }[] = [
    { label: t("details.summary"), value: displaySummary(row) ?? "" },
    { label: t("details.client"), value: client },
    {
      label: t("details.amount"),
      // Exactly what the table's Amount column shows for this row.
      value: amountCellText(row, deriveRow(row)),
    },
    { label: t("details.time"), value: fullTimeText(row, language) },
    { label: t("details.user"), value: row.username || `#${row.user_id}` },
    // Always listed — the table only tags the rare cases (rowBadges).
    { label: t("details.status"), value: t(`status.${rowStatus(row)}`) },
    { label: t("details.reverses"), value: reverses ? `#${reverses}` : "" },
    {
      label: t("details.returnedCredits"),
      value: hasReturnedCredits(row)
        ? returnedCreditsText(row.returned_credits_usd)
        : "",
    },
  ].filter((f) => f.value !== "");

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {headerFacts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-slate-400">{f.label}</dt>
            <dd className="text-white break-words">{f.value}</dd>
          </div>
        ))}
      </dl>

      {view.details.length > 0 && (
        <section>
          <SectionTitle>
            {t("details.details")}
            {view.kindLabel && (
              <span className="normal-case font-medium text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                {view.kindLabel}
              </span>
            )}
          </SectionTitle>
          <FactList rows={view.details} />
        </section>
      )}

      {view.payment && <PaymentSection payment={view.payment} />}

      {view.other.length > 0 && (
        <section>
          <button
            onClick={() => setOtherOpen((o) => !o)}
            aria-expanded={otherOpen}
            className="text-xs font-semibold uppercase text-slate-400 hover:text-slate-300 transition-colors"
          >
            {otherOpen ? "▾" : "▸"} {t("details.otherSavedData")}
          </button>
          <Collapsible open={otherOpen}>
            <div className="pt-2">
              <FactList rows={view.other} />
            </div>
          </Collapsible>
        </section>
      )}

      {view.isEmpty && (
        <p className="text-sm text-slate-500 italic">
          {t("details.nothingElse")}
        </p>
      )}
    </div>
  );
}

export function TransactionDetailsPanel({
  row,
  isAdmin,
  methodLabelByCode,
  onClose,
}: TransactionDetailsPanelProps) {
  const { t, i18n } = useTranslation("audit");
  const language = i18n.language;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The English title as before; in Arabic the translated title (LIRA-331).
  const englishTitle = getTypeLabel(row);
  const shownTitle = translateTitle(englishTitle, t, language);
  const typeLabel =
    shownTitle === englishTitle ? readableTitle(englishTitle) : shownTitle;

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-details-title"
        data-testid={`transaction-details-${row.id}`}
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-700 flex justify-between items-start gap-4">
          <div className="min-w-0">
            <h2
              id="transaction-details-title"
              className="text-xl font-bold text-white"
            >
              <span className={getTypeColor(row)}>{typeLabel}</span>{" "}
              <span className="text-slate-400 font-medium">#{row.id}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {fullTimeText(row, language)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("details.close")}
            title={t("details.close")}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <TransactionDetailsBody
            row={row}
            isAdmin={isAdmin}
            methodLabelByCode={methodLabelByCode}
          />
        </div>
      </div>
    </div>
  );
}

export default TransactionDetailsPanel;
