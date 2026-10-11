/**
 * LIRA-306 — what a paired desktop shows (plan diagram B):
 *   standby / blocked  → the standby screen ONLY (the app and its sign-in
 *                        never mount — O-new-16: the web app is opened in
 *                        the browser, never inside the desktop window)
 *   offline / finishing → the offline banner above the normal app
 *   standalone desktop, web app, or any failure → the app, unchanged
 *
 * Status is polled every 5 s while paired. `api` is read through a ref
 * (rule 25).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useApi } from "@liratek/ui";
import type { OfflineStatusView } from "@liratek/core";
import logger from "@/utils/logger";
import { StandbyScreen } from "./StandbyScreen";
import { OfflineBanner } from "./OfflineBanner";

const POLL_MS = 5_000;

export function OfflineGate({ children }: { children: ReactNode }) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [status, setStatus] = useState<OfflineStatusView | null>(null);
  const [resolved, setResolved] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiRef.current.getOfflineStatus();
      setStatus(r.success && r.data ? r.data : null);
    } catch (err) {
      logger.error("offline status failed:", err);
      setStatus(null);
    } finally {
      setResolved(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const paired = status !== null && status.mode !== "standalone";
  useEffect(() => {
    if (!paired) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [paired, load]);

  if (!resolved) return null;
  if (status && (status.mode === "standby" || status.mode === "blocked")) {
    return <StandbyScreen status={status} onChanged={() => void load()} />;
  }
  if (status && (status.mode === "offline" || status.mode === "finishing")) {
    return (
      <div className="flex h-screen flex-col">
        <OfflineBanner status={status} onChanged={() => void load()} />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    );
  }
  return <>{children}</>;
}

export default OfflineGate;
