import { useState, useEffect, useRef } from "react";

export interface NumInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

/** Format number with commas: 5000 → "5,000" */
function fmt(n: number): string {
  if (!n) return "";
  const parts = n.toString().split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

/**
 * Number input that formats with commas on blur.
 */
export function NumInput({
  value,
  onChange,
  className,
  placeholder,
  disabled,
}: NumInputProps) {
  const [raw, setRaw] = useState(value ? fmt(value) : "");
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setRaw(value ? fmt(value) : "");
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9.]/g, "");
        setRaw(v);
        onChange(parseFloat(v) || 0);
      }}
      onFocus={() => {
        focused.current = true;
        // Show raw number while editing
        const n = parseFloat(raw.replace(/,/g, "")) || 0;
        setRaw(n ? n.toString() : "");
      }}
      onBlur={() => {
        focused.current = false;
        const n = parseFloat(raw) || 0;
        setRaw(n ? fmt(n) : "");
      }}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

export default NumInput;
