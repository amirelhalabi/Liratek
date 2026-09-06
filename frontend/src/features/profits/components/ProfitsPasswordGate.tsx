import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, AlertCircle, ShieldAlert } from "lucide-react";
import { useApi } from "@liratek/ui";
import { PROFITS_UNLOCK_TTL_MS } from "@liratek/core";
import { useAuth } from "@/features/auth/context/AuthContext";

/**
 * Per-page password gate for `/profits` (PROFITS_GATE_CONTRACT.md). Admin
 * included — the owner's decision is that the profits password replaces the
 * role check for THIS page. The unlock lives in component state only (never
 * a context, never local/sessionStorage): navigating away from `/profits`
 * must re-lock it, which the unmount effect below enforces by revoking the
 * server-side unlock.
 */
export function ProfitsPasswordGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const api = useApi();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [statusLoading, setStatusLoading] = useState(true);
  const [passwordIsSet, setPasswordIsSet] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards the unmount-time lock() call against React StrictMode's
  // mount->unmount->mount dev double-invoke: at the throwaway first unmount
  // `unlockedRef.current` is still false (the real unlock only happens after
  // a user submits the form), so nothing is revoked prematurely.
  const unlockedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    unlockedRef.current = unlocked;
  }, [unlocked]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { isSet } = await api.getProfitsPasswordStatus();
        if (!cancelled) setPasswordIsSet(isSet);
      } catch {
        if (!cancelled) setPasswordIsSet(false);
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revoke the server-side unlock the moment this gate unmounts (navigating
  // away from /profits), guarded against StrictMode's throwaway first
  // unmount by unlockedRef.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (unlockedRef.current) {
        void api.lockProfits();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setUnlocked(false);
      setTimedOut(true);
      void api.lockProfits();
    }, PROFITS_UNLOCK_TTL_MS);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.unlockProfits(password);
      if (res.success) {
        setUnlocked(true);
        setTimedOut(false);
        setPassword("");
        startTimer();
      } else {
        setError(res.error || "Incorrect password");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock");
    } finally {
      setSubmitting(false);
    }
  }

  if (statusLoading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        Loading...
      </div>
    );
  }

  if (!passwordIsSet) {
    return (
      <div
        data-testid="profits-no-password-set"
        className="h-full flex items-center justify-center p-6"
      >
        <div className="max-w-md w-full bg-slate-800/80 border border-slate-700/50 rounded-2xl p-8 text-center backdrop-blur-xl">
          <ShieldAlert className="w-10 h-10 text-orange-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">
            Profits password not set
          </h2>
          <p className="text-sm text-slate-400 mb-6">
            No profits password has been set yet. An admin must set one in
            Settings &rsaquo; Profits Password before anyone can view this
            page.
          </p>
          {user?.role === "admin" && (
            <button
              onClick={() => navigate("/settings?tab=profits")}
              className="w-full py-3 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg transition-colors"
            >
              Go to Settings &rsaquo; Profits Password
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div
        data-testid="profits-lock-screen"
        className="h-full flex items-center justify-center p-6"
      >
        <div className="max-w-md w-full bg-slate-800/80 border border-slate-700/50 rounded-2xl p-8 backdrop-blur-xl">
          <div className="text-center mb-6">
            <Lock className="w-10 h-10 text-violet-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-1">
              Profits are locked
            </h2>
            <p className="text-sm text-slate-400">
              Enter the profits password to continue.
            </p>
            {timedOut && (
              <p className="text-xs text-orange-400 mt-2">
                Your session timed out. Please unlock again.
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div
                data-testid="profits-unlock-error"
                className="p-3 rounded-lg flex items-start gap-2 text-sm bg-red-500/15 border border-red-500/40 text-red-300"
              >
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <input
              type="password"
              data-testid="profits-password-input"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Profits password"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
            />

            <button
              type="submit"
              data-testid="profits-unlock-submit"
              disabled={submitting || password.length === 0}
              className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            >
              {submitting ? "Unlocking..." : "Unlock"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default ProfitsPasswordGate;
