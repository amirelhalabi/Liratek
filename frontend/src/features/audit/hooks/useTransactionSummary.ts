import { useEffect, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import {
  summaryModuleOf,
  type TransactionListOption,
  type TransactionSummaryGroupBy,
  type TransactionSummaryInput,
  type TransactionSummaryResult,
} from "@liratek/core";
import { selectedListOptions } from "../auditConstants";
import logger from "@/utils/logger";

/**
 * LIRA-389 — the Summary view's data: the server groups the list's own rows
 * (`useApi().getTransactionSummary`, both transports). The request is built
 * from the SAME selection, search and days the list sends
 * (`selectedListOptions`, rule 22); nothing is aggregated in the browser
 * (FR-008).
 */

/**
 * The grouping Summary opens on (owner-approved default): Product when the
 * selection is Sales only, Service type when every selected option is one
 * module, Type otherwise (All types included).
 */
export function defaultSummaryGroup(
  options: readonly TransactionListOption[],
): TransactionSummaryGroupBy {
  if (options.length === 0 || options.some((o) => !o.type)) return "type";
  if (options.every((o) => o.type === "SALE")) return "product";
  const modules = new Set(options.map((o) => summaryModuleOf(o.type!)));
  return modules.size === 1 ? "service" : "type";
}

/** The request for a selection — the payload the adapter sends. */
export function buildSummaryRequest(input: {
  selectedFilters: readonly string[];
  search: string;
  from: string;
  to: string;
  groupBy: TransactionSummaryGroupBy;
  includeRefunded: boolean;
}): TransactionSummaryInput {
  return {
    group_by: input.groupBy,
    include_refunded: input.includeRefunded,
    // FilterOption.type is a plain string; FILTER_GROUPS holds real
    // transaction types (the core schema refuses anything else).
    options: selectedListOptions(
      input.selectedFilters,
    ) as TransactionSummaryInput["options"],
    ...(input.search ? { search: input.search } : {}),
    ...(input.from ? { day_from: input.from } : {}),
    ...(input.to ? { day_to: input.to } : {}),
  };
}

export interface UseTransactionSummaryResult {
  result: TransactionSummaryResult | null;
  loading: boolean;
  error: string | null;
}

export function useTransactionSummary(
  enabled: boolean,
  request: TransactionSummaryInput,
): UseTransactionSummaryResult {
  const api = useApi();
  // rule 25: the fetch effect reads `api` through a ref, never as its own
  // dependency. The ref is kept current by an effect that sets no state
  // (declared first, so it runs before the fetch effect).
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  // The last answer, with the request it answers. Only the async callbacks
  // set state; "loading" is derived (an answer for another request is
  // still shown, dimmed, until the new one lands).
  const [answer, setAnswer] = useState<{
    key: string;
    result: TransactionSummaryResult | null;
    error: string | null;
  } | null>(null);
  // A content key, so a request rebuilt each render does not refetch.
  const key = JSON.stringify(request);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiRef.current
      .getTransactionSummary(JSON.parse(key) as TransactionSummaryInput)
      .then((res) => {
        if (cancelled) return;
        setAnswer(
          res.success && res.data
            ? { key, result: res.data, error: null }
            : { key, result: null, error: res.error ?? "error" },
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error("Failed to load the transactions summary", { err });
        setAnswer({
          key,
          result: null,
          error: err instanceof Error ? err.message : "error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  return {
    result: answer?.result ?? null,
    loading: enabled && answer?.key !== key,
    error: answer?.key === key ? answer.error : null,
  };
}
