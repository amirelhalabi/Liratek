import { useState, useMemo } from "react";

/**
 * Hook to filter an array of items by a date range based on a date field.
 * Returns the filtered data plus from/to state + setters.
 */
export function useDateRangeFilter<T>(
  data: T[],
  dateKey: keyof T = "created_at" as keyof T,
) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filteredData = useMemo(() => {
    if (!from && !to) return data;
    return data.filter((item) => {
      const dateVal = String(item[dateKey] ?? "").slice(0, 10);
      if (from && dateVal < from) return false;
      if (to && dateVal > to) return false;
      return true;
    });
  }, [data, from, to, dateKey]);

  return { filteredData, from, to, setFrom, setTo };
}
