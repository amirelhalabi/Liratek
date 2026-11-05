/**
 * SettleDiscountLine — the ONE Discount line on every settle screen
 * (LIRA-372, owner 2026-11-05): Debts Repay, Suppliers Pay / Receive, batch
 * Settle, Settle Account (incl. OMT), Partners by day and by amount. Rendered
 * through MultiPaymentInput's `discountRow` slot, so it sits in the same
 * place everywhere: under "Total Amount", inside the payment box.
 *
 * Layout only. The page owns the typed text, the room (from core's
 * `settleDiscountRoom`, i.e. min($5 / 450,000 LBP, owed)) and the payload;
 * the page sends the CLAMPED amount (`clampSettleDiscount`). This line
 * draws one field per currency, the "Capped to max" note when a typed value
 * is above the room, and an optional reason.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DiscountLine, discountFieldClass } from "./DiscountLine";
import { normalizeDigits } from "../../i18n/digits";
import { formatNumber } from "../../i18n/format";

export type SettleDiscountCurrencyCode = "USD" | "LBP";

export interface SettleDiscountLineProps {
  /** One field per currency, in this order. */
  currencies: SettleDiscountCurrencyCode[];
  /** The typed text per currency. */
  values: Partial<Record<SettleDiscountCurrencyCode, string>>;
  onChange: (currency: SettleDiscountCurrencyCode, raw: string) => void;
  /** The most the line accepts per currency (core `settleDiscountRoom`). */
  room: Partial<Record<SettleDiscountCurrencyCode, number>>;
  reason?: { value: string; onChange: (value: string) => void } | undefined;
  hint?: ReactNode | undefined;
}

/** Cents / whole-lira slack before a typed value counts as "over". */
const OVER_TOLERANCE: Record<SettleDiscountCurrencyCode, number> = {
  USD: 0.005,
  LBP: 0.5,
};

function parseTyped(raw: string | undefined): number {
  const n = parseFloat(raw ?? "");
  return Number.isFinite(n) ? n : 0;
}

export function SettleDiscountLine({
  currencies,
  values,
  onChange,
  room,
  reason,
  hint,
}: SettleDiscountLineProps) {
  const { t } = useTranslation("ui");
  const over = (c: SettleDiscountCurrencyCode): boolean =>
    parseTyped(values[c]) > (room[c] ?? 0) + OVER_TOLERANCE[c];
  const overParts = currencies
    .filter(over)
    .map((c) =>
      c === "USD"
        ? `$${(room.USD ?? 0).toFixed(2)}`
        : `${formatNumber(Math.round(room.LBP ?? 0))} LBP`,
    );
  const capNote =
    overParts.length > 0
      ? t("discountLine.cappedToMax", { amount: overParts.join(" + ") })
      : undefined;

  const field = (c: SettleDiscountCurrencyCode) => {
    const pattern = c === "USD" ? /^\d*\.?\d*$/ : /^\d*$/;
    const input = (
      <input
        type="text"
        inputMode={c === "USD" ? "decimal" : "numeric"}
        data-testid={
          c === "USD" ? "settle-discount-usd" : "settle-discount-lbp"
        }
        aria-label={t(
          c === "USD" ? "discountLine.settleUsd" : "discountLine.settleLbp",
        )}
        value={values[c] ?? ""}
        onChange={(e) => {
          const raw = normalizeDigits(e.target.value).replace(/,/g, "");
          if (raw === "" || pattern.test(raw)) onChange(c, raw);
        }}
        className={`${discountFieldClass(over(c))}${c === "USD" ? " ps-5" : ""}`}
        placeholder={c === "USD" ? "0.00" : "0"}
      />
    );
    return c === "USD" ? (
      <span key={c} className="relative">
        <span className="absolute start-2 top-1/2 -translate-y-1/2 text-emerald-400 text-xs">
          $
        </span>
        {input}
      </span>
    ) : (
      <span key={c} className="flex items-center gap-1">
        {input}
        <span className="text-emerald-400 text-xs">LBP</span>
      </span>
    );
  };

  return (
    <DiscountLine
      label={t("discountLine.settleLabel")}
      testId="settle-discount-line"
      capNote={capNote}
      hint={hint}
      reason={
        reason
          ? {
              value: reason.value,
              onChange: reason.onChange,
              testId: "settle-discount-reason",
            }
          : undefined
      }
    >
      {currencies.map(field)}
    </DiscountLine>
  );
}
