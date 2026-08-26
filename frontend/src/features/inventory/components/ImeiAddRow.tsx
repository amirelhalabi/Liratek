import { useRef, useState, type KeyboardEvent } from "react";

export interface ImeiAddRowResult {
  success: boolean;
  error?: string;
}

export interface ImeiAddRowProps {
  /** Registers exactly one IMEI. Resolve `{ success: false, error }` for an
   *  expected business-rule rejection (e.g. the named duplicate-IMEI error)
   *  — a thrown error is caught the same way, so either style works. */
  onAdd: (imei: string) => Promise<ImeiAddRowResult>;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  buttonLabel?: string;
  inputTestId?: string;
  buttonTestId?: string;
}

/**
 * LIRA-143 follow-up (owner-requested UI rework) — a scan-friendly, single-
 * IMEI add row: one input + one Add button, same UI pattern as Settings →
 * Users' create row (`UsersManager.tsx`). Replaces the old multi-line
 * textarea that split a pasted/typed paragraph into a batch — the owner
 * disliked that pattern; this is the shared replacement used by both
 * `ProductUnitsSection` (the product form's persistent Units/IMEIs list)
 * and `AdjustStockModal`'s optional post-increase intake step.
 *
 * Enter in the input submits too — a barcode scanner sends a trailing Enter,
 * so scan-scan-scan intake (decision #6's whole point) never needs a click.
 * On success the input clears and refocuses for the next scan. On failure
 * (e.g. "already registered in stock on product ...") the input KEEPS its
 * value so the operator can see exactly what was rejected, and the error
 * renders inline directly under the row.
 */
export function ImeiAddRow({
  onAdd,
  placeholder = "Scan or type an IMEI",
  autoFocus = false,
  disabled = false,
  buttonLabel = "Add",
  inputTestId = "imei-add-input",
  buttonTestId = "imei-add-button",
}: ImeiAddRowProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await onAdd(trimmed);
      if (!result.success) {
        setError(result.error ?? "Failed to add unit");
        return;
      }
      setValue("");
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add unit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div>
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          data-testid={inputTestId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          // Deliberately NOT also gated on `submitting` — re-entrancy is
          // already blocked at the top of `submit()`, and a disabled input
          // cannot be the target of the post-success `.focus()` call below
          // (a disabled element never takes focus, and React's state commit
          // for `setSubmitting(false)` isn't guaranteed to have landed yet
          // at that synchronous point).
          disabled={disabled}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-violet-500"
        />
        <button
          type="button"
          data-testid={buttonTestId}
          onClick={() => void submit()}
          disabled={disabled || submitting || value.trim().length === 0}
          className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors shrink-0"
        >
          {submitting ? "Adding…" : buttonLabel}
        </button>
      </div>
      {error && <p className="text-sm text-red-400 mt-1">{error}</p>}
    </div>
  );
}

export default ImeiAddRow;
