/**
 * DecimalInput
 *
 * The single decimal/amount input for the app. Renders a thousands-separator
 * formatted value ("1,234.50") while keeping a raw typed string internally, so
 * in-progress entries like "0.", "0.10" or "-" survive without snapping back to
 * a number. This is what makes typing "0.1" from scratch work — a number prop
 * alone cannot represent the intermediate "0." state.
 *
 * Value model is numeric: `value: number` in, `onChange(value: number)` out.
 */

import { useLayoutEffect, useRef, useState } from "react";
import {
  caretAfterFormat,
  formatWithCommas,
  parseDecimal,
  sanitizeDecimal,
  type DecimalConstraints,
} from "../../utils/number";

export interface DecimalInputProps {
  value: number;
  onChange: (value: number) => void;
  /** Allow a leading minus sign. Default false. */
  allowNegative?: boolean;
  /** Max number of fraction digits (e.g. 2 for USD). Omit for unlimited. */
  decimals?: number;
  /** Optional adornment rendered inside the field on the left (e.g. "$"). */
  prefix?: React.ReactNode;
  /** Optional adornment rendered inside the field on the right (e.g. "LBP"). */
  suffix?: React.ReactNode;
  /** Render 0 as an empty field so the placeholder shows. Default true. */
  zeroAsEmpty?: boolean;
  /** Classes for the <input> itself — pass the call site's existing styling. */
  className?: string;
  /** Classes for the wrapper (only rendered when a prefix/suffix is present). */
  wrapperClassName?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  "aria-label"?: string;
  "data-testid"?: string;
}

const DEFAULT_INPUT_CLASS =
  "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-violet-500";

export function DecimalInput({
  value,
  onChange,
  allowNegative = false,
  decimals,
  prefix,
  suffix,
  zeroAsEmpty = true,
  className,
  wrapperClassName = "relative",
  placeholder,
  disabled = false,
  autoFocus = false,
  id,
  name,
  required = false,
  onBlur,
  onFocus,
  onKeyDown,
  "aria-label": ariaLabel,
  "data-testid": dataTestId,
}: DecimalInputProps) {
  // Raw typed string, authoritative while the field is focused.
  const [raw, setRaw] = useState("");
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);

  // Restore the caret after a live reformat (commas inserted/removed shift it).
  useLayoutEffect(() => {
    if (caretRef.current !== null && inputRef.current) {
      const pos = caretRef.current;
      inputRef.current.setSelectionRange(pos, pos);
      caretRef.current = null;
    }
  });

  const constraints: DecimalConstraints = {
    allowNegative,
    ...(decimals !== undefined ? { decimals } : {}),
  };

  const displayValue = focused.current
    ? formatWithCommas(raw)
    : zeroAsEmpty && value === 0
      ? ""
      : formatWithCommas(String(value));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const typed = el.value;
    const selectionStart = el.selectionStart ?? typed.length;

    const cleaned = sanitizeDecimal(typed, constraints);
    const formatted = formatWithCommas(cleaned);
    // Significant (non-comma) chars to the left of the caret, so it lands in
    // the same logical spot after commas are re-laid-out.
    const significantLeft = typed
      .slice(0, selectionStart)
      .replace(/[^0-9.-]/g, "").length;
    caretRef.current = caretAfterFormat(formatted, significantLeft);

    setRaw(cleaned);
    onChange(parseDecimal(cleaned));
  };

  const input = (
    <input
      ref={inputRef}
      id={id}
      name={name}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={displayValue}
      onChange={handleChange}
      onFocus={() => {
        focused.current = true;
        setRaw(value === 0 ? "" : String(value));
        onFocus?.();
      }}
      onBlur={() => {
        focused.current = false;
        onBlur?.();
      }}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      required={required}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      className={className ?? DEFAULT_INPUT_CLASS}
    />
  );

  if (!prefix && !suffix) return input;

  return (
    <div className={wrapperClassName}>
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
          {prefix}
        </span>
      )}
      {input}
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

export default DecimalInput;
