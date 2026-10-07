/**
 * The `?sso=<token>` hand-off on a shop's login page (LIRA-280).
 *
 * After "Continue with Google" on www, the backend sends the browser to
 * `https://<shop>.<base>/#/login?sso=<token>`: a 60-second, single-use token
 * naming one user of this shop. This hook trades it for a normal session
 * (`ssoExchange` stores it exactly as a password login does) and restarts
 * the app at home, where AuthProvider picks the session up.
 *
 * Exactly once per token — a ref, not a `cancelled` flag, because under
 * StrictMode a second run would present an already-used token and paint an
 * error over a sign-in that worked. The token leaves the address bar at once.
 * Read from `window.location.hash` (HashRouter) rather than the router so the
 * login page needs no extra router hook.
 */

import { useEffect, useRef, useState } from "react";
import { isElectron, ssoExchange } from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import {
  hashQuery,
  reloadAtHome,
  removeHashParam,
} from "@/features/auth/utils/browserNavigation";

const SSO_FAILED = "This sign-in link is not valid. Please sign in again.";

export function useSsoHandoff(): { exchanging: boolean; error: string | null } {
  const [token] = useState<string | null>(() =>
    isElectron() ? null : hashQuery().get("sso")?.trim() || null,
  );
  const [exchanging, setExchanging] = useState(token !== null);
  const [error, setError] = useState<string | null>(null);
  const exchangedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!token || exchangedFor.current === token) return;
    exchangedFor.current = token;
    removeHashParam("sso");
    ssoExchange({ token })
      .then((res) => {
        if (res.success && res.data) {
          reloadAtHome();
          return;
        }
        setError(messageFrom(res.error, SSO_FAILED));
        setExchanging(false);
      })
      .catch((err: unknown) => {
        setError(messageFrom(err, SSO_FAILED));
        setExchanging(false);
      });
  }, [token]);

  return { exchanging, error };
}
