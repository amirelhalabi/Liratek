import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { CheckCircle, CreditCard, Info } from "lucide-react";
import type { PaymentLine } from "@liratek/ui";
import { maxRechargeDiscount } from "@liratek/core";
import { PaymentSheet, type PaymentSheetItem } from "./PaymentSheet";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import {
  PROVIDER_BRANDS,
  type ProviderBrandKey,
} from "@/shared/brand/providerBrands";

/** A single selectable card in the grid (Alfa gift tier or MTC voucher). */
export interface CardGridPayItem {
  /** Stable selection identity + React key. */
  id: string;
  label: string;
  costLbp: number;
  sellLbp: number;
  /** Optional USD face value, shown as "Value: $X" (gift tiers only). */
  valueUsd?: number;
}

/** The carriers whose screens use this card grid (Alfa Gift, MTC Voucher). */
export type CardGridBrand = Extract<ProviderBrandKey, "MTC" | "ALFA">;

/** Every accent class comes from the shared brand module (rule 14) — literal
 *  strings there, so Tailwind's scanner sees them. */
function themeFor(brand: CardGridBrand) {
  const b = PROVIDER_BRANDS[brand];
  return {
    selectedCard: `${b.border} ${b.tint} ring-2 ${b.ring}`,
    check: b.text,
    payButton: b.button,
    sheetAccent: b.button,
    inputFocus: b.focusBorder,
  };
}

interface CardGridPayViewProps {
  /** Label shown above the grid, e.g. "Select MTC Voucher". */
  heading: string;
  items: CardGridPayItem[];
  selectedId: string | null;
  onSelect: (item: CardGridPayItem) => void;
  /** Carrier whose brand colours paint the selection, Pay button and sheet. */
  brand: CardGridBrand;
  /** Show cost + profit margin on cards. Gate behind admin to avoid leaking margin. */
  showProfit: boolean;
  sheetTitle: string;
  onConfirm: () => void;
  isSubmitting: boolean;
  paymentMethods: { code: string; label: string }[];
  clientId: number | null;
  exchangeRate: number;
  onPaymentChange: (lines: PaymentLine[]) => void;
  /** Change/return legs (shop hands money back) — forwarded to the PaymentSheet. */
  onReturnChange?: (legs: PaymentLine[]) => void;
  /** Kept change (shop keeps what it does not hand back) — forwarded to the
   *  PaymentSheet. Wire only when the caller sends `kept_change_*` on its
   *  submit payload (owner decision 2026-10-06: kept change is automatic). */
  onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
  /** Payment-Legs Integrity plan (false-reject fix): fires with the rate the
   *  PaymentSheet is ACTUALLY using — the `exchangeRate` prop default, or the
   *  operator's own edit of the sheet's header rate field. The caller should
   *  send this as `tender_exchange_rate` on submit instead of re-sending the
   *  static `exchangeRate` prop, which is wrong the moment the operator edits
   *  the field. */
  onExchangeRateChange?: (rate: number) => void;
  onDiscountChange: (discount: number) => void;
  /** LIRA-319 — the sheet's "+ Extra" (LBP), forwarded to the PaymentSheet.
   *  Wire only when the caller sends `extra_lbp` on its submit payload. */
  onExtraChange?: (extra: number) => void;
  clientName: string;
  onClientNameChange: (value: string) => void;
  transactionTime: string | undefined;
  onTransactionTimeChange: (time: string | undefined) => void;
  /**
   * A customer session is active — the basket owns the single payment at
   * checkout, so this swaps the trigger button to "Add to Cart" and confirms
   * directly instead of opening the PaymentSheet. Mirrors the sibling
   * TelecomForm/KatshForm gating pattern. Defaults to false (unchanged
   * standalone Pay-and-open-sheet behavior).
   */
  hasActiveSession?: boolean;
}

/**
 * Shared card-grid → sticky trigger bar → payment-sheet flow used by both the
 * Alfa Gift and MTC Voucher screens. Differences between the two (data, accent
 * color, submit handler, titles) come in via props; the layout and the
 * price/discount math are identical and live here.
 */
export function CardGridPayView({
  heading,
  items,
  selectedId,
  onSelect,
  brand,
  showProfit,
  sheetTitle,
  onConfirm,
  isSubmitting,
  paymentMethods,
  clientId,
  exchangeRate,
  onPaymentChange,
  onReturnChange,
  onKeptChange,
  onExchangeRateChange,
  onDiscountChange,
  onExtraChange,
  clientName,
  onClientNameChange,
  transactionTime,
  onTransactionTimeChange,
  hasActiveSession = false,
}: CardGridPayViewProps) {
  const { t } = useTranslation("recharge");
  const [sheetOpen, setSheetOpen] = useState(false);
  const theme = themeFor(brand);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  // The one picked card, as the payment window lists it (charged in LBP).
  const sheetItems: PaymentSheetItem[] = selected
    ? [
        {
          key: selected.id,
          name: selected.label,
          quantity: 1,
          unitPrice: selected.sellLbp,
          currency: "LBP",
          ...(selected.valueUsd !== undefined
            ? { note: t("cardGrid.valueNote", { value: selected.valueUsd }) }
            : {}),
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* Card Grid */}
      <div className="flex-1 min-h-0 overflow-auto pb-2">
        <div className="text-sm text-slate-400 mb-3">{heading}</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {items.map((item) => {
            const isSelected = item.id === selectedId;
            const profit = item.sellLbp - item.costLbp;

            return (
              <div
                key={item.id}
                onClick={() => onSelect(item)}
                className={`relative p-4 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? theme.selectedCard
                    : "border-slate-700 bg-slate-800 hover:border-slate-600"
                }`}
              >
                {isSelected && (
                  <div className={`absolute top-2 end-2 ${theme.check}`}>
                    <CheckCircle size={16} />
                  </div>
                )}

                <div className="text-white font-bold text-lg mb-1">
                  {item.label}
                </div>

                {item.valueUsd !== undefined && (
                  <div className="text-sm text-slate-400 mb-2">
                    {t("cardGrid.value", { value: item.valueUsd })}
                  </div>
                )}

                <div className="text-sm text-emerald-400 font-mono">
                  {t("cardGrid.sell", { amount: formatNumber(item.sellLbp) })}
                </div>

                {/* Admin-only margin info — revealed on hover to keep cards clean */}
                {showProfit && (
                  <div
                    className="group/info absolute bottom-2 end-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      aria-label={t("cardGrid.marginDetails")}
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
                    >
                      <Info size={12} />
                    </button>
                    <div className="pointer-events-none absolute bottom-full end-0 z-20 mb-2 hidden w-40 rounded-lg border border-slate-700 bg-slate-900 p-2.5 shadow-xl group-hover/info:block">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">
                          {t("cardGrid.cost")}
                        </span>
                        <span className="font-mono text-slate-300">
                          {formatNumber(item.costLbp)} LBP
                        </span>
                      </div>
                      <div className="mt-1 flex justify-between text-xs">
                        <span className="text-slate-400">
                          {t("cardGrid.profit")}
                        </span>
                        <span
                          className={`font-mono ${profit >= 0 ? "text-green-400" : "text-red-400"}`}
                        >
                          {formatNumber(profit)} LBP
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky Trigger Bar */}
      <div className="shrink-0 bg-slate-800 rounded-xl border border-slate-700/50 p-4 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="text-end flex-1">
            <div className="text-xs text-slate-400">
              {selected ? selected.label : t("cardGrid.selectOption")}
            </div>
            <div className="text-base text-emerald-400 font-mono font-bold">
              {selected ? `${formatNumber(selected.sellLbp)} LBP` : "—"}
            </div>
          </div>

          <button
            onClick={() => {
              // Session mode: add to cart directly (basket owns the payment),
              // skipping the PaymentSheet. Non-session: open the PaymentSheet.
              if (hasActiveSession) {
                onConfirm();
              } else {
                setSheetOpen(true);
              }
            }}
            disabled={!selected}
            className={`px-6 py-3 rounded-lg font-bold text-white transition-all flex items-center gap-2 ${
              !selected
                ? "bg-slate-700 text-slate-300 cursor-not-allowed"
                : theme.payButton
            }`}
          >
            <CreditCard size={18} />
            {hasActiveSession ? t("common.addToCart") : t("cardGrid.pay")}
          </button>
        </div>
      </div>

      {/* Payment Sheet */}
      <PaymentSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onConfirm={onConfirm}
        isSubmitting={isSubmitting}
        title={sheetTitle}
        {...(selected ? { subtitle: selected.label } : {})}
        accentColor={theme.sheetAccent}
        items={sheetItems}
        totalAmount={selected?.sellLbp ?? 0}
        totalAmountCurrency="LBP"
        currency="LBP"
        paymentMethods={paymentMethods}
        clientId={clientId}
        fetchClientVouchers={fetchClientVouchers}
        exchangeRate={exchangeRate}
        {...(onExchangeRateChange ? { onExchangeRateChange } : {})}
        showDiscount={true}
        // LIRA-185 #1 follow-up (2026-10-02): this view's only caller is the
        // Alfa Gift card grid (TelecomForm.tsx), a type with no SMS transfer
        // fee — the plain margin, from the SAME helper RechargeRepository
        // enforces (rule 14). `maxRechargeDiscount`'s `extraFee` defaults to
        // 0, so this is byte-for-byte the previous `Math.max(0, sell-cost)`.
        maxDiscount={maxRechargeDiscount(
          selected?.sellLbp ?? 0,
          selected?.costLbp ?? 0,
        )}
        onPaymentChange={onPaymentChange}
        {...(onReturnChange ? { onReturnChange } : {})}
        {...(onKeptChange ? { onKeptChange } : {})}
        onDiscountChange={onDiscountChange}
        {...(onExtraChange ? { onExtraChange } : {})}
        summary={[
          ...(selected && selected.valueUsd !== undefined
            ? [{ label: t("cardGrid.valueLabel"), value: `$${selected.valueUsd}` }]
            : []),
          {
            label: t("cardGrid.price"),
            value: `${formatNumber(selected?.sellLbp ?? 0)} LBP`,
            color: "text-emerald-400",
          },
        ]}
      >
        <input
          type="text"
          value={clientName}
          onChange={(e) => onClientNameChange(e.target.value)}
          placeholder={t("common.clientNameOptional")}
          className={`w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none ${theme.inputFocus}`}
        />
        <TransactionTimeOverride
          value={transactionTime}
          onChange={onTransactionTimeChange}
        />
      </PaymentSheet>
    </div>
  );
}
