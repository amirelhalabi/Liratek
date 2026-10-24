import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";
import { MultiPaymentInput, useApi, type PaymentLine } from "@liratek/ui";
import { formatNumber } from "@liratek/ui/i18n/format";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import type { Voucher } from "@/types/electron";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { localDay } from "@/shared/utils/localDay";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import {
  legsMatch,
  toVoucherRefundLegs,
  voucherRefundMethodOptions,
  voucherRefundParts,
} from "../utils/voucherLegs";

interface VoucherCancelSheetProps {
  voucher: Voucher;
  onClose: () => void;
  /** Called after a successful cancel — the caller reloads its list. */
  onCancelled: () => void;
}

function money(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (usd > 0) parts.push(`$${usd.toFixed(2)}`);
  if (lbp > 0) parts.push(`${formatNumber(Math.round(lbp))} LBP`);
  return parts.join(" + ");
}

/**
 * LIRA-339 — cancel = refund what the sale took in. The on-account part goes
 * back to the customer's account (server side, no leg); the cash part is paid
 * out with the shared payout picker, the way `HoldMoneyPickupSheet` does it.
 * A legacy voucher (never sold) refunds nothing.
 */
export function VoucherCancelSheet({
  voucher,
  onClose,
  onCancelled,
}: VoucherCancelSheetProps) {
  const api = useApi();
  const { t } = useTranslation(["vouchers", "common"]);
  const { methods } = usePaymentMethods();
  const { buyRate } = useSellRate();
  const parts = voucherRefundParts(voucher);
  const cashUsd = parts.cash.usd;
  const cashLbp = parts.cash.lbp;
  const hasCash = !parts.legacy && (cashUsd > 0 || cashLbp > 0);
  const hasAccount = !parts.legacy && (parts.account.usd > 0 || parts.account.lbp > 0);
  const payoutCurrency: "USD" | "LBP" = cashUsd > 0 || cashLbp <= 0 ? "USD" : "LBP";

  const allowedMethods = useMemo(() => voucherRefundMethodOptions(methods), [methods]);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [effectiveRate, setEffectiveRate] = useState<number | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rate = effectiveRate ?? buyRate;
  // Built ONCE and used for both the coverage check and the payload (rule 22).
  const payoutLegs = useMemo(() => toVoucherRefundLegs(paymentLines), [paymentLines]);
  const covered = !hasCash || legsMatch(payoutLegs, { usd: cashUsd, lbp: cashLbp }, rate);
  const canConfirm = !submitting && covered;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.vouchers.cancel(voucher.id, {
        payments: hasCash ? payoutLegs : [],
        ...(rate > 0 ? { exchange_rate: rate } : {}),
        client_day: localDay(),
      });
      if (res.success) {
        onCancelled();
        onClose();
      } else {
        setError(res.error ?? t("list.cancelFailed"));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, t("list.cancelFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="voucher-cancel-sheet"
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-white">
              {t("cancel.title")} <Ltr className="font-mono">{voucher.code}</Ltr>
            </h3>
            {voucher.client_name && (
              <p className="text-xs text-slate-400 mt-1">{voucher.client_name}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label={t("common:actions.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {parts.legacy ? (
            <p className="p-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300">
              {t("cancel.noRefund")}
            </p>
          ) : (
            <>
              {hasAccount && (
                <p className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-300">
                  {t("cancel.toAccount", {
                    amount: money(parts.account.usd, parts.account.lbp),
                  })}
                </p>
              )}
              {hasCash && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                    {t("cancel.paidBackVia", {
                      amount: money(cashUsd, cashLbp),
                    })}
                  </label>
                  <MultiPaymentInput
                    totals={[
                      ...(cashUsd > 0 ? [{ amount: cashUsd, currency: "USD" }] : []),
                      ...(cashLbp > 0 ? [{ amount: cashLbp, currency: "LBP" }] : []),
                    ]}
                    side="buy"
                    payer="payout"
                    currency={payoutCurrency}
                    totalAmountCurrency={payoutCurrency}
                    onChange={setPaymentLines}
                    showDiscount={false}
                    showPmFee={false}
                    paymentMethods={allowedMethods}
                    currencies={[
                      { code: "USD", symbol: "$" },
                      { code: "LBP", symbol: "LBP" },
                    ]}
                    exchangeRate={buyRate}
                    onExchangeRateChange={setEffectiveRate}
                    paidLabel={t("cancel.handBack")}
                  />
                </div>
              )}
            </>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="button"
            data-testid="voucher-cancel-confirm"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="w-full py-3 bg-red-500 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> {t("cancel.processing")}
              </>
            ) : (
              t("cancel.confirm")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
