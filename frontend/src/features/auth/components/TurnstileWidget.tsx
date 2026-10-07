/**
 * Cloudflare Turnstile bot check (LIRA-267 US4) for the public "email me a
 * sign-up link" form.
 *
 * Rendered EXPLICITLY with the site key the server reports from
 * `/api/auth/signup-status`, rather than by the script's auto-scan of
 * `.cf-turnstile` elements, so the key is never baked into the bundle and the
 * widget's lifetime follows React's.
 *
 * Tokens are single-use: the server spends one on every request, so a page
 * that needs a second attempt must REMOUNT this component (give it a new
 * `key`); unmounting removes the widget so the remount starts a fresh
 * challenge.
 *
 * The script origin must be allowed by the CSP in `index.html` (script-src
 * AND frame-src https://challenges.cloudflare.com) — the challenge runs in an
 * iframe.
 */

import { useEffect, useRef } from "react";
import { ensureTurnstileScript } from "./turnstileLoader";

export interface TurnstileWidgetProps {
  siteKey: string;
  /** A fresh, single-use token. */
  onSuccess: (token: string) => void;
  /** The token expired or the challenge errored — any held token is dead. */
  onExpire: () => void;
}

export function TurnstileWidget({
  siteKey,
  onSuccess,
  onExpire,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Callbacks read through refs so a parent re-render with new function
  // identities never re-renders (and re-challenges) the widget (rule 25).
  const onSuccessRef = useRef(onSuccess);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;

    const renderWidget = () => {
      const api = window.turnstile;
      const container = containerRef.current;
      if (cancelled || !api || !container) return;
      widgetId = api.render(container, {
        sitekey: siteKey,
        callback: (token) => onSuccessRef.current(token),
        "expired-callback": () => onExpireRef.current(),
        "error-callback": () => onExpireRef.current(),
      });
    };

    let script: HTMLScriptElement | null = null;
    if (window.turnstile) {
      renderWidget();
    } else {
      script = ensureTurnstileScript();
      script.addEventListener("load", renderWidget);
    }

    return () => {
      cancelled = true;
      script?.removeEventListener("load", renderWidget);
      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  return <div ref={containerRef} data-testid="turnstile-container" />;
}

export default TurnstileWidget;
