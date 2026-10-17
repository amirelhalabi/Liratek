import { Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["profits", "common"]);

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
        setError(res.error || t("gate.incorrectPassword"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("gate.unlockFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (statusLoading) {
    // data-testid lets e2e wait for this initial status fetch to settle
    // before deciding whether the gate needs a password entered.
    return (
      <div
        data-testid="profits-gate-loading"
        className="h-full flex items-center justify-center text-slate-400"
      >
        {t("common:state.loading")}
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
            {t("gate.notSetTitle")}
          </h2>
          <p className="text-sm text-slate-400 mb-6">{t("gate.notSetBody")}</p>
          {user?.role === "admin" && (
            <button
              onClick={() => navigate("/settings?tab=profits")}
              className="w-full py-3 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg transition-colors"
            >
              {t("gate.goToSettings")}
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
              {t("gate.lockedTitle")}
            </h2>
            <p className="text-sm text-slate-400">{t("gate.lockedHint")}</p>
            {timedOut && (
              <p className="text-xs text-orange-400 mt-2">
                {t("gate.timedOut")}
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
              placeholder={t("gate.passwordPlaceholder")}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
            />

            <button
              type="submit"
              data-testid="profits-unlock-submit"
              disabled={submitting || password.length === 0}
              className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            >
              {submitting ? t("gate.unlocking") : t("gate.unlock")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // This gate needs its OWN Suspense boundary here, below the gate's own
  // state/effects, rather than relying on App.tsx's single top-level
  // <Suspense> above <ProfitsPasswordGate>. Reasoning (do not "simplify"
  // this away): `<Profits />` is a lazy() page rendered as `children`
  // INSIDE this gate. The instant `unlocked` flips true, `children` (the
  // not-yet-loaded Profits chunk) suspends. If the nearest Suspense
  // boundary is the one ABOVE this gate (App.tsx), React hides this gate's
  // ENTIRE subtree — including the gate itself — while that chunk loads.
  // React 18+ DESTROYS effects for a hidden Suspense subtree while
  // PRESERVING its component state: the gate's unmount cleanup (the one
  // above that calls `api.lockProfits()`) fires, revoking the server-side
  // unlock, and then the subtree is shown again with `unlocked` still
  // `true` in state. Net effect: the UI displays the page as unlocked
  // while the server has already re-locked it, so every profits IPC/REST
  // call then fails with "Profits locked". Giving `children` its own
  // Suspense boundary HERE means the lazy chunk suspends at a boundary
  // BELOW the gate, so the gate's own tree (and its effects) is never
  // hidden/destroyed by the chunk load.
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-slate-400">
          {t("common:state.loading")}
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default ProfitsPasswordGate;
