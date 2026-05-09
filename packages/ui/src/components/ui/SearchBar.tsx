/**
 * SearchBar Component
 *
 * Reusable search input with clear button, loading indicator,
 * and dropdown results. Extracted from the KATCH form pattern.
 */

import { useState, useRef, useEffect, useCallback } from "react";

export interface SearchBarProps<T> {
  /** Placeholder text for the input */
  placeholder?: string;
  /** Async search function called on input change */
  onSearch: (query: string) => Promise<T[]>;
  /** Called when user selects a result */
  onSelect: (item: T) => void;
  /** Called when no results and user confirms free text */
  onFreeText?: (text: string) => void;
  /** Render each result item in the dropdown */
  renderItem: (item: T) => React.ReactNode;
  /** Extract a unique key from each item */
  getKey: (item: T) => string | number;
  /** Minimum characters before triggering search */
  minChars?: number;
  /** Debounce delay in ms */
  debounceMs?: number;
  /** Ring color class for focus state */
  ringColor?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Show "no results" message and allow free text entry */
  noResultsMessage?: string;
}

export function SearchBar<T>({
  placeholder = "Search...",
  onSearch,
  onSelect,
  onFreeText,
  renderItem,
  getKey,
  minChars = 2,
  debounceMs = 300,
  ringColor = "ring-teal-500/50",
  disabled = false,
  noResultsMessage = "No results found. Press Enter to use as description.",
}: SearchBarProps<T>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < minChars) {
        setResults([]);
        setHasSearched(false);
        return;
      }
      setIsSearching(true);
      try {
        const items = await onSearch(q);
        setResults(items);
        setHasSearched(true);
        setShowDropdown(true);
      } catch {
        setResults([]);
        setHasSearched(true);
      } finally {
        setIsSearching(false);
      }
    },
    [onSearch, minChars],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length >= minChars) {
      debounceRef.current = setTimeout(() => doSearch(value), debounceMs);
    } else {
      setResults([]);
      setHasSearched(false);
      setShowDropdown(false);
    }
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setShowDropdown(false);
    setHasSearched(false);
  };

  const handleSelect = (item: T) => {
    onSelect(item);
    setQuery("");
    setResults([]);
    setShowDropdown(false);
    setHasSearched(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key === "Enter" &&
      hasSearched &&
      results.length === 0 &&
      onFreeText
    ) {
      onFreeText(query);
      setShowDropdown(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          if (query.length >= minChars) {
            setShowDropdown(true);
            if (!hasSearched) doSearch(query);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-4 py-2.5 pl-10 bg-slate-900/80 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:border-transparent ${ringColor} transition-all`}
      />
      {/* Search icon */}
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      {/* Loading spinner or clear button */}
      {isSearching ? (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <svg
            className="w-4 h-4 text-slate-400 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
      ) : (
        query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Clear search"
            type="button"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )
      )}
      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute z-20 top-full mt-1 w-full bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-56 overflow-auto">
          {results.length > 0 ? (
            results.map((item) => (
              <button
                key={getKey(item)}
                onClick={() => handleSelect(item)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-700 text-sm text-white transition-colors first:rounded-t-xl last:rounded-b-xl"
                type="button"
              >
                {renderItem(item)}
              </button>
            ))
          ) : hasSearched && !isSearching ? (
            <div className="px-4 py-3 text-sm text-slate-400 text-center">
              {noResultsMessage}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
