/**
 * LIRA-366 — the one optional Note box on every money-in payment form.
 * The text is sent as `typedNote` (trimmed by the core schema; blank is
 * never stored). Max 500 characters, matching `typedNoteField`.
 */
import { useTranslation } from "react-i18next";

export const PAYMENT_NOTE_MAX = 500;

export interface PaymentNoteFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Defaults to "payment-note". */
  testId?: string;
  className?: string;
  disabled?: boolean;
}

export function PaymentNoteField({
  value,
  onChange,
  testId = "payment-note",
  className = "",
  disabled = false,
}: PaymentNoteFieldProps) {
  const { t } = useTranslation("payment");
  return (
    <div className={className}>
      <label
        htmlFor={testId}
        className="block text-xs font-medium text-slate-400 mb-1"
      >
        {t("note.label")}
      </label>
      <input
        id={testId}
        data-testid={testId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={PAYMENT_NOTE_MAX}
        placeholder={t("note.placeholder")}
        autoComplete="off"
        disabled={disabled}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
      />
    </div>
  );
}
