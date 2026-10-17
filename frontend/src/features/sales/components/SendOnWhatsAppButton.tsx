/**
 * LIRA-333 — "Send on WhatsApp" for a saved POS sale (FR-001, FR-002).
 *
 * Opens WhatsApp outside LiraTek on the sale's own number with the receipt
 * already written; the cashier presses Send in WhatsApp. When the sale has
 * no number, a small inline field asks for one for this send only (never
 * saved, FR-013). The client's "Receive updates via WhatsApp" switch is not
 * read here at all (FR-020): it governs business messaging, not a receipt
 * the cashier sends by hand.
 */
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toWhatsAppNumber } from "@liratek/core";
import { useSendReceiptOnWhatsApp } from "@/features/sales/hooks/useSendReceiptOnWhatsApp";

export type WhatsAppSender = ReturnType<typeof useSendReceiptOnWhatsApp>;

/** The control itself, driven by a sender the caller already holds (the
 *  post-sale strip shares one sender between Send and Print). */
export function SendOnWhatsAppControl({
  sender,
  compact = false,
}: {
  sender: WhatsAppSender;
  compact?: boolean;
}) {
  const { t } = useTranslation("sales");
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");

  const typedCheck = toWhatsAppNumber(typed);
  const liveInvalid =
    typed.trim() !== "" && !typedCheck.ok ? t("whatsapp.numberInvalid") : null;
  const message =
    sender.status === "error"
      ? t("whatsapp.loadFailed")
      : (sender.error ?? (asking ? liveInvalid : null));

  // Synchronous on purpose: WhatsApp must open inside this click.
  const onMainClick = () => {
    if (sender.needsNumber) {
      sender.clearError();
      setAsking(true);
      return;
    }
    sender.send();
  };

  const onConfirm = () => {
    sender.send(typed);
  };

  const cancel = () => {
    setAsking(false);
    setTyped("");
    sender.clearError();
  };

  const pad = compact ? "px-3 py-1.5 text-sm" : "px-4 py-2.5";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onMainClick}
        disabled={sender.status !== "ready"}
        className={`${pad} text-emerald-300 hover:text-emerald-100 hover:bg-emerald-900/30 rounded-lg font-medium border border-emerald-500/30 flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <MessageCircle size={16} />
        {t("whatsapp.send")}
      </button>

      {asking && sender.needsNumber && (
        <div className="flex items-center gap-2">
          <input
            type="tel"
            aria-label={t("whatsapp.numberLabel")}
            placeholder={t("whatsapp.numberPlaceholder")}
            dir="ltr"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              sender.clearError();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm();
              if (e.key === "Escape") {
                e.stopPropagation();
                cancel();
              }
            }}
            className={`w-44 bg-slate-900 border rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none ${
              liveInvalid
                ? "border-red-500"
                : "border-slate-600 focus:border-emerald-500"
            }`}
          />
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium"
          >
            {t("whatsapp.sendShort")}
          </button>
          <button
            type="button"
            onClick={cancel}
            className="px-3 py-1.5 text-sm text-slate-300 hover:text-white rounded-lg"
          >
            {t("actions.cancel")}
          </button>
        </div>
      )}

      {message && (
        <p role="alert" className="text-xs text-red-400">
          {message}
        </p>
      )}
    </div>
  );
}

export default function SendOnWhatsAppButton({
  saleId,
  refreshKey = 0,
  compact = false,
}: {
  saleId: number;
  /** Bump to re-read the sale (e.g. after its customer phone was edited). */
  refreshKey?: number;
  compact?: boolean;
}) {
  const sender = useSendReceiptOnWhatsApp(saleId, refreshKey);
  return <SendOnWhatsAppControl sender={sender} compact={compact} />;
}
