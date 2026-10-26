/**
 * LIRA-346 — settle partners by day: the calendar reads and the settle
 * write, through `useApi()` (rule 19). Same shape as the supplier calendar
 * hooks (`useSupplierAccountMonthRowsQuery` …): `api` never enters a
 * dependency list or a query key (rule 25); the query functions only close
 * over it.
 */
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  PartnerDayDetailRow,
  PartnerSettleDaysPayload,
  PartnerSettleRow,
} from "@liratek/core";
import { useApi } from "@liratek/ui";

export const PARTNER_SETTLE_KEYS = {
  all: ["partnerSettle"] as const,
  openRows: (partnerId: number) =>
    ["partnerSettle", partnerId, "open"] as const,
  monthRows: (partnerId: number, month: string) =>
    ["partnerSettle", partnerId, "month", month] as const,
  dayDetail: (partnerId: number, day: string) =>
    ["partnerSettle", partnerId, "day", day] as const,
};

/**
 * The settle queue: every open day row + every open account row. This read
 * decides how much money changes hands, so it is never served from a cache
 * that predates a change made elsewhere: `staleTime: 0` and a refetch every
 * time the sheet mounts.
 */
export function usePartnerSettleOpenRowsQuery(partnerId: number) {
  const api = useApi();
  return useQuery<PartnerSettleRow[]>({
    queryKey: PARTNER_SETTLE_KEYS.openRows(partnerId),
    queryFn: () => api.partners.getSettleOpenRows(partnerId),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** One calendar month (`YYYY-MM`): its day rows, open or closed. */
export function usePartnerSettleMonthRowsQuery(
  partnerId: number,
  month: string,
) {
  const api = useApi();
  return useQuery<PartnerSettleRow[]>({
    queryKey: PARTNER_SETTLE_KEYS.monthRows(partnerId, month),
    queryFn: () => api.partners.getSettleMonthRows(partnerId, month),
    // Other partner money actions (write-off, add credit / debt, the old
    // by-amount settle) do not invalidate these keys: always re-read.
    staleTime: 0,
  });
}

/**
 * "See transactions" (owner mock 2026-10-26 §7): the month reads for every
 * month that holds a picked day, sharing the calendar's cache keys. Off
 * while the table is closed.
 */
export function usePartnerSettleMonthsRowsQueries(
  partnerId: number,
  months: readonly string[],
  enabled: boolean,
) {
  const api = useApi();
  return useQueries({
    queries: months.map((month) => ({
      queryKey: PARTNER_SETTLE_KEYS.monthRows(partnerId, month),
      queryFn: () => api.partners.getSettleMonthRows(partnerId, month),
      enabled,
      staleTime: 0,
    })),
  });
}

/** One shop day (`YYYY-MM-DD`) with who paid each row; off while no day is open. */
export function usePartnerSettleDayDetailQuery(
  partnerId: number,
  day: string | null,
) {
  const api = useApi();
  return useQuery<PartnerDayDetailRow[]>({
    queryKey: PARTNER_SETTLE_KEYS.dayDetail(partnerId, day ?? ""),
    queryFn: () => api.partners.getSettleDayDetail(partnerId, day!),
    enabled: !!day,
    staleTime: 0,
  });
}

/**
 * Settle picked days (also "settle old history"). Resolves with the
 * envelope — the sheet shows `error` on `{ success: false }` — and refreshes
 * every partner calendar read on success.
 */
export function usePartnerSettleDaysMutation() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PartnerSettleDaysPayload) =>
      api.partners.settleDays(payload),
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: PARTNER_SETTLE_KEYS.all,
        });
      }
    },
  });
}
