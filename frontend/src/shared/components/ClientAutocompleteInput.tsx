import { useState, useEffect, useRef, useCallback } from "react";
import type { Client } from "@liratek/ui";
import logger from "@/utils/logger";

export interface ClientAutocompleteInputProps {
  /** Current input value (controlled) */
  value: string;
  /** Called when the text value changes (typing or selection) */
  onChange: (value: string) => void;
  /** Called when a client is selected from the dropdown */
  onClientSelect?: (client: Client) => void;
  /** Input placeholder */
  placeholder?: string;
  /** Additional CSS class for the input */
  className?: string;
  /** Input id */
  id?: string;
  /** Input type (default: "text") */
  type?: string;
  /** Whether to search by phone instead of name */
  searchByPhone?: boolean;
  /** Disable the autocomplete dropdown (just render a plain input) */
  disabled?: boolean;
}

/**
 * A text input with client autocomplete dropdown.
 * Searches clients by name or phone as the user types.
 * When a client is selected, fires onClientSelect with the full client object.
 */
export function ClientAutocompleteInput({
  value,
  onChange,
  onClientSelect,
  placeholder,
  className,
  id,
  type = "text",
  searchByPhone = false,
  disabled = false,
}: ClientAutocompleteInputProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch clients once on mount
  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await window.api.clients.getAll("");
        setClients(data);
      } catch (err) {
        logger.error("ClientAutocompleteInput: failed to fetch clients", err);
      }
    };
    fetch();
  }, []);

  // Filter clients based on current value
  const filtered =
    value.trim().length > 0
      ? clients
          .filter((c) => {
            const query = value.toLowerCase();
            if (searchByPhone) {
              return (c.phone_number || "").includes(value);
            }
            return (
              c.full_name.toLowerCase().includes(query) ||
              (c.phone_number || "").includes(value)
            );
          })
          .slice(0, 8)
      : [];

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
      setShowDropdown(true);
      setHighlightIndex(-1);
    },
    [onChange],
  );

  const handleSelect = useCallback(
    (client: Client) => {
      if (searchByPhone) {
        onChange(client.phone_number || "");
      } else {
        onChange(client.full_name);
      }
      onClientSelect?.(client);
      setShowDropdown(false);
      setHighlightIndex(-1);
    },
    [onChange, onClientSelect, searchByPhone],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showDropdown || filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && highlightIndex >= 0) {
        e.preventDefault();
        handleSelect(filtered[highlightIndex]);
      } else if (e.key === "Escape") {
        setShowDropdown(false);
      }
    },
    [showDropdown, filtered, highlightIndex, handleSelect],
  );

  if (disabled) {
    return (
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        type={type}
        value={value}
        onChange={handleChange}
        onFocus={() =>
          value.trim().length > 0 &&
          filtered.length > 0 &&
          setShowDropdown(true)
        }
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {showDropdown && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {filtered.map((client, idx) => (
            <button
              key={client.id}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-slate-700 transition-colors ${
                idx === highlightIndex ? "bg-slate-700" : ""
              } ${idx === 0 ? "rounded-t-lg" : ""} ${idx === filtered.length - 1 ? "rounded-b-lg" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent input blur
                handleSelect(client);
              }}
            >
              <span className="text-white truncate">{client.full_name}</span>
              {client.phone_number && (
                <span className="text-slate-400 text-xs ml-2 shrink-0">
                  {client.phone_number}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
