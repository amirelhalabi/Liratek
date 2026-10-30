import { useQuery } from "@tanstack/react-query";
import { useApi } from "@liratek/ui";

export const KPI_KEYS = {
  progress: ["kpi-progress"] as const,
};

/**
 * LIRA-364 — the Monthly progress read. Throws the failure envelope's error;
 * `enabled: false` (switch off for the shop) is a normal answer.
 */
export function useKpiProgressQuery(options?: { enabled?: boolean }) {
  const api = useApi();
  return useQuery({
    queryKey: KPI_KEYS.progress,
    queryFn: async () => {
      const res = await api.getKpiSnapshots();
      if (!res.success) throw new Error(res.error);
      return { enabled: res.enabled, snapshots: res.snapshots };
    },
    enabled: options?.enabled ?? true,
  });
}
