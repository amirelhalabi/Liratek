/**
 * LIRA-312 — credits sent back for a wrong-number card.
 *
 * Owner rules (2026-10-12): the owner types what actually arrived on the
 * shop line (no SMS-fee math). That line and the MTC/Alfa drawer go up by
 * it, and the loss falls by it at the resold-credit price. Credits can come
 * in several parts, up to what the card carried. Undo is the admin-only Void
 * on the Transactions page (newest first: credits, then the loss).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi, type CarrierLineEntity } from "@liratek/ui";
import { normalizeDigits } from "@liratek/ui/i18n/digits";
import type {
  WrongNumberCardRow,
  WrongNumberCreditsInput,
} from "@liratek/core";
import { localDay } from "@/shared/utils/localDay";
import logger from "@/utils/logger";
import { carrierLabel, lbp, PROVIDER_LABELS } from "../wrongNumberFormat";

const STATUS_LABEL_KEYS = {
  WAITING: "status.WAITING",
  PARTLY_RECOVERED: "status.PARTLY_RECOVERED",
  RECOVERED: "status.RECOVERED",
  VOIDED: "status.VOIDED",
} as const satisfies Record<WrongNumberCardRow["status"], string>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function CreditsReceivedPanel({
  record,
  onDone,
}: {
  record: WrongNumberCardRow;
  /** Called after credits are saved, so the caller reloads the record. */
  onDone: () => void;
}) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const { t } = useTranslation("wrongNumbers");

  const [lines, setLines] = useState<CarrierLineEntity[]>([]);
  const [lineId, setLineId] = useState<number | null>(null);
  const [credits, setCredits] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const remainingCredit = round2(
    record.card_credit_usd - record.total_recovered_usd,
  );
  const canAdd = record.status !== "VOIDED" && remainingCredit > 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const active = await apiRef.current.getAllActiveCarrierLines();
        if (cancelled) return;
        setLines(Array.isArray(active) ? active : []);
      } catch (err) {
        logger.error("Failed to load shop lines", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const carrierLines = useMemo(
    () =>
      lines.filter((l) => l.carrier === record.carrier && l.is_active === 1),
    [lines, record.carrier],
  );
  useEffect(() => {
    const primary =
      carrierLines.find((l) => l.is_primary === 1) ?? carrierLines[0];
    setLineId(primary ? primary.id : null);
  }, [carrierLines]);

  const lineNumber = (id: number | null) =>
    lines.find((l) => l.id === id)?.phone_number ?? (id ? `#${id}` : "—");

  const handleSave = async () => {
    setError("");
    const amount = Number(credits);
    if (!(amount > 0) || !lineId) {
      setError(t("credits.enterCredits"));
      return;
    }
    // ONE payload, typed from the schema (rules 21, 22).
    const payload: WrongNumberCreditsInput = {
      wrong_number_card_id: record.id,
      amount_usd: amount,
      carrier_line_id: lineId,
      client_day: localDay(),
    };
    setSaving(true);
    try {
      const res = await apiRef.current.recordWrongNumberCredits(payload);
      if (!res.success) {
        setError(res.error || t("credits.saveFailed"));
        return;
      }
      setCredits("");
      onDone();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("credits.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm";

  return (
    <div
      className="border border-slate-700 rounded-lg p-3 space-y-3"
      data-testid={`wrong-number-record-${record.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-white">
          {PROVIDER_LABELS[record.provider]} {carrierLabel(record.carrier)}{" "}
          {record.card_label}
          <div className="text-xs text-slate-400">
            {t("credits.wrongNumber", { number: record.wrong_number ?? "—" })}
            {record.right_number
              ? t("credits.rightNumber", { number: record.right_number })
              : ""}
          </div>
        </div>
        <span
          data-testid="wrong-number-status"
          className="text-[11px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-200 whitespace-nowrap"
        >
          {t(STATUS_LABEL_KEYS[record.status])}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-400">{t("credits.cardCost")}</dt>
          <dd className="text-slate-200">{lbp(record.card_cost_lbp)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">{t("credits.creditsBack")}</dt>
          <dd className="text-slate-200">
            {t("credits.creditsBackValue", {
              recovered: record.total_recovered_usd,
              total: record.card_credit_usd,
            })}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">{t("credits.loss")}</dt>
          <dd className="text-slate-200" data-testid="wrong-number-loss">
            {lbp(record.remaining_loss_lbp)}
          </dd>
        </div>
      </dl>

      {record.credits.length > 0 && (
        <ul className="text-xs text-slate-300 space-y-0.5">
          {record.credits.map((c) => (
            <li key={c.transaction_id}>
              {t("credits.creditLine", {
                amount: c.amount_usd,
                line: lineNumber(c.carrier_line_id),
              })}
              {c.created_at.slice(0, 10)}
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`wn-cr-amount-${record.id}`}
                className="text-xs text-slate-400 block mb-1"
              >
                {t("credits.amountLabel", { max: remainingCredit })}
              </label>
              <input
                id={`wn-cr-amount-${record.id}`}
                type="text"
                inputMode="decimal"
                value={credits}
                onChange={(e) => setCredits(normalizeDigits(e.target.value))}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor={`wn-cr-line-${record.id}`}
                className="text-xs text-slate-400 block mb-1"
              >
                {t("credits.lineLabel")}
              </label>
              <select
                id={`wn-cr-line-${record.id}`}
                value={lineId ?? ""}
                onChange={(e) => setLineId(Number(e.target.value) || null)}
                className={inputClass}
              >
                {carrierLines.length === 0 && (
                  <option value="">
                    {t("credits.noLine", {
                      carrier: carrierLabel(record.carrier),
                    })}
                  </option>
                )}
                {carrierLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.phone_number}
                    {l.is_primary === 1 ? t("credits.primary") : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">
              {error}
            </div>
          )}
          <button
            data-testid="wrong-number-credits-save"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded text-sm"
          >
            {saving ? t("credits.saving") : t("credits.save")}
          </button>
        </div>
      )}
    </div>
  );
}
