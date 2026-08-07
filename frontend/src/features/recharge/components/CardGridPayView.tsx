import { useState } from "react";
import { CheckCircle, CreditCard, Info } from "lucide-react";
import type { PaymentLine } from "@liratek/ui";
import { PaymentSheet } from "./PaymentSheet";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";

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

type Accent = "cyan" | "red";

const ACCENTS: Record<
  Accent,
  {
    selectedCard: string;
    check: string;
    payButton: string;
    sheetAccent: string;
    inputFocus: string;
  }
> = {
  cyan: {
    selectedCard: "border-cyan-500/40 bg-cyan-500/5 ring-2 ring-cyan-500/50",
    check: "text-cyan-400",
    payButton: "bg-cyan-600 hover:bg-cyan-500 shadow-lg shadow-cyan-500/20",
    sheetAccent: "bg-cyan-600 hover:bg-cyan-500 text-white",
    inputFocus: "focus:border-cyan-500",
  },
  red: {
    selectedCard: "border-red-500/40 bg-red-500/5 ring-2 ring-red-500/50",
    check: "text-red-400",
    payButton: "bg-red-600 hover:bg-red-500 shadow-lg shadow-red-500/20",
    sheetAccent: "bg-red-600 hover:bg-red-500 text-white",
    inputFocus: "focus:border-red-500",
  },
};

interface CardGridPayViewProps {
  /** Label shown above the grid, e.g. "Select MTC Voucher". */
  heading: string;
  items: CardGridPayItem[];
  selectedId: string | null;
  onSelect: (item: CardGridPayItem) => void;
  accent: Accent;
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
  /** Payment-Legs Integrity plan (false-reject fix): fires with the rate the
   *  PaymentSheet is ACTUALLY using — the `exchangeRate` prop default, or the
   *  operator's own edit of the sheet's header rate field. The caller should
   *  send this as `tender_exchange_rate` on submit instead of re-sending the
   *  static `exchangeRate` prop, which is wrong the moment the operator edits
   *  the field. */
  onExchangeRateChange?: (rate: number) => void;
  onDiscountChange: (discount: number) => void;
  clientName: string;
  onClientNameChange: (value: string) => void;
  transactionTime: string | undefined;
  onTransactionTimeChange: (time: string | undefined) => void;
  /**
   * A customer session is active — the basket owns the single payment at
   * checkout, so this swaps the trigger button to "Add to Cart" and confirms
   * directly instead of opening the PaymentSheet. Mirrors the sibling
   * TelecomForm/KatchForm gating pattern. Defaults to false (unchanged
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
  accent,
  showProfit,
  sheetTitle,
  onConfirm,
  isSubmitting,
  paymentMethods,
  clientId,
  exchangeRate,
  onPaymentChange,
  onReturnChange,
  onExchangeRateChange,
  onDiscountChange,
  clientName,
  onClientNameChange,
  transactionTime,
  onTransactionTimeChange,
  hasActiveSession = false,
}: CardGridPayViewProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const theme = ACCENTS[accent];
  const selected = items.find((i) => i.id === selectedId) ?? null;

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
                  <div className={`absolute top-2 right-2 ${theme.check}`}>
                    <CheckCircle size={16} />
                  </div>
                )}

                <div className="text-white font-bold text-lg mb-1">
                  {item.label}
                </div>

                {item.valueUsd !== undefined && (
                  <div className="text-sm text-slate-400 mb-2">
                    Value: ${item.valueUsd}
                  </div>
                )}

                <div className="text-sm text-emerald-400 font-mono">
                  Sell: {item.sellLbp.toLocaleString()} LBP
                </div>

                {/* Admin-only margin info — revealed on hover to keep cards clean */}
                {showProfit && (
                  <div
                    className="group/info absolute bottom-2 right-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      aria-label="Margin details"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
                    >
                      <Info size={12} />
                    </button>
                    <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 hidden w-40 rounded-lg border border-slate-700 bg-slate-900 p-2.5 shadow-xl group-hover/info:block">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Cost</span>
                        <span className="font-mono text-slate-300">
                          {item.costLbp.toLocaleString()} LBP
                        </span>
                      </div>
                      <div className="mt-1 flex justify-between text-xs">
                        <span className="text-slate-400">Profit</span>
                        <span
                          className={`font-mono ${profit >= 0 ? "text-green-400" : "text-red-400"}`}
                        >
                          {profit.toLocaleString()} LBP
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
          <div className="text-right flex-1">
            <div className="text-xs text-slate-400">
              {selected ? selected.label : "Select an option"}
            </div>
            <div className="text-base text-emerald-400 font-mono font-bold">
              {selected ? `${selected.sellLbp.toLocaleString()} LBP` : "—"}
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
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : theme.payButton
            }`}
          >
            <CreditCard size={18} />
            {hasActiveSession ? "Add to Cart" : "Pay"}
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
        totalAmount={selected?.sellLbp ?? 0}
        totalAmountCurrency="LBP"
        currency="LBP"
        paymentMethods={paymentMethods}
        clientId={clientId}
        fetchClientVouchers={fetchClientVouchers}
        exchangeRate={exchangeRate}
        {...(onExchangeRateChange ? { onExchangeRateChange } : {})}
        showDiscount={true}
        maxDiscount={Math.max(
          0,
          selected ? selected.sellLbp - selected.costLbp : 0,
        )}
        onPaymentChange={onPaymentChange}
        {...(onReturnChange ? { onReturnChange } : {})}
        onDiscountChange={onDiscountChange}
        summary={[
          ...(selected && selected.valueUsd !== undefined
            ? [{ label: "Value", value: `$${selected.valueUsd}` }]
            : []),
          {
            label: "Price",
            value: `${(selected?.sellLbp ?? 0).toLocaleString()} LBP`,
            color: "text-emerald-400",
          },
        ]}
      >
        <input
          type="text"
          value={clientName}
          onChange={(e) => onClientNameChange(e.target.value)}
          placeholder="Client name (optional)"
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
