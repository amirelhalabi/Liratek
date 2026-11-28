import { useState, useMemo } from "react";
import { businessDayOf } from "@/shared/utils/localDay";

/**
 * Hook to filter an array of items by a date range based on a date field.
 * Returns the filtered data plus from/to state + setters.
 *
 * Each row is filed under its BUSINESS (local) day (`businessDayOf`), the day
 * its Date / Time column shows — never the raw UTC day of a SQLite timestamp
 * (rule 27).
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
      const dateVal = businessDayOf(item[dateKey]);
      if (from && dateVal < from) return false;
      if (to && dateVal > to) return false;
      return true;
    });
  }, [data, from, to, dateKey]);

  return { filteredData, from, to, setFrom, setTo };
}
