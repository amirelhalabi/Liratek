/**
 * Loads Cloudflare's Turnstile script once per page (LIRA-267 US4). Kept
 * apart from TurnstileWidget.tsx so that file exports only a component
 * (react-refresh).
 */

/** `render=explicit`: the script only renders where we call render(). */
export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The slice of Cloudflare's `window.turnstile` API this component uses. */
export interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string | undefined;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptEl: HTMLScriptElement | null = null;

/** Adds the Cloudflare script to the page once and returns it. */
export function ensureTurnstileScript(): HTMLScriptElement {
  if (scriptEl && scriptEl.isConnected) return scriptEl;
  const el = document.createElement("script");
  el.src = TURNSTILE_SCRIPT_URL;
  el.async = true;
  el.defer = true;
  document.head.appendChild(el);
  scriptEl = el;
  return el;
}

/** Test seam: forget the cached script between tests. */
export function __resetTurnstileLoaderForTests(): void {
  scriptEl = null;
}
