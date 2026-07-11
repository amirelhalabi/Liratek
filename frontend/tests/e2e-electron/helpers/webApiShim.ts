/**
 * Phase-3 web-mode `window.api` shim.
 *
 * The desktop e2e specs seed/verify money state by calling `window.api.<ns>.<method>`
 * inside `page.evaluate`. In the browser there is no Electron preload bridge, so
 * this installs a browser-side `window.api` that proxies each call to the Express
 * REST backend — letting the IPC-driven specs run UNCHANGED over HTTP.
 *
 * Installed via `context.addInitScript` (web-shared fixture only) so it exists
 * before any app code runs. Two consequences, both handled here:
 *
 *  1. `isElectron()` (== `!!window.api`) flips TRUE app-wide. App code that goes
 *     through `ipcOrHttp` will now try the ipc branch (this shim) first. Unmapped
 *     methods REJECT, so `ipcOrHttp` catches and falls back to HTTP — app pages
 *     keep working on a partial shim. Spec direct-calls (no try/catch) surface a
 *     loud "web-api-shim miss: ns.method" telling you exactly what to map next.
 *  2. The shim implements the IPC CONTRACT (preload.ts): reads return the RAW
 *     value (array / object), writes return the `{ success, ... }` envelope —
 *     because both the specs and the (now-ipc-routed) app expect that shape.
 *     REST paths/verbs MUST match the existing backend/src/api/* routes; field
 *     translations (IPC arg → REST body) are centralized here.
 *
 * Grow the route table per-spec: enable a spec, run it, add whatever it reports
 * missing. Reads unwrap the REST envelope; writes pass it through.
 */
import type { BrowserContext } from "@playwright/test";

export async function installWebApiShim(context: BrowserContext): Promise<void> {
  await context.addInitScript(webApiShimBody);
}

// Serialized and executed in the browser page context by addInitScript.
// MUST be fully self-contained — browser globals only (fetch, localStorage,
// Proxy), no outer references, no app imports.
function webApiShimBody(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const g = globalThis as any;

  function backendUrl(): string {
    return g.__LIRATEK_BACKEND_URL || "http://127.0.0.1:3000";
  }
  function token(): string | null {
    try {
      return localStorage.getItem("liratek.jwt");
    } catch {
      return null;
    }
  }
  async function rest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const t = token();
    const res = await fetch(backendUrl() + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(t ? { Authorization: "Bearer " + t } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    try {
      return await res.json();
    } catch {
      return { success: false, error: "non-JSON response " + res.status };
    }
  }
  function qs(params: Record<string, unknown>): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    }
    const s = p.toString();
    return s ? "?" + s : "";
  }

  // "ns.method" -> (args) => Promise. Reads unwrap to raw; writes pass envelope.
  const routes: Record<string, (args: any[]) => Promise<any>> = {
    // ── Debts (the Debts page still has raw window.api ternaries; app.spec
    //    renders it, so the canary needs these mapped) ──
    "debt.getDebtors": async () =>
      (await rest("GET", "/api/debts/debtors")).debtors,
    "debt.getClientHistory": async ([clientId]) =>
      (await rest("GET", `/api/debts/clients/${clientId}/history`)).history,
    "debt.getClientTotal": async ([clientId]) =>
      (await rest("GET", `/api/debts/clients/${clientId}/total`)).total,
    "debt.getClientBalance": async ([clientId]) =>
      rest("GET", `/api/debts/clients/${clientId}/balance`),
    "debt.addRepayment": async ([payload]) =>
      rest("POST", "/api/debts/repayments", payload),
  };

  const RESERVED = new Set(["then", "catch", "finally"]);

  const nsProxy = (ns: string) =>
    new Proxy(
      {},
      {
        get(_t, method: string | symbol) {
          // Guard thenable/symbol probes so `await window.api.<ns>` and
          // structuredClone-style introspection don't trigger a bogus call.
          if (typeof method !== "string" || RESERVED.has(method))
            return undefined;
          return (...args: any[]) => {
            // Event-subscription methods (onSessionExpired, onUpdateAvailable, …)
            // return an unsubscribe fn SYNCHRONOUSLY in the Electron preload, and
            // callers use the result as a useEffect cleanup. A Promise there makes
            // React call it as destroy() → crash. In web mode these events never
            // fire, so hand back a synchronous no-op unsubscribe.
            if (/^on[A-Z]/.test(method)) return () => {};
            const key = ns + "." + method;
            const fn = routes[key];
            if (!fn)
              return Promise.reject(new Error("web-api-shim miss: " + key));
            return fn(args);
          };
        },
      },
    );

  // Marker so the app's isElectron() treats this as web, NOT a real preload
  // bridge — app code keeps using HTTP; only the specs' direct window.api.*
  // calls resolve to this shim.
  g.__LIRATEK_WEB_API_SHIM = true;

  g.api = new Proxy(
    {},
    {
      get(_t, ns: string | symbol) {
        if (typeof ns !== "string" || RESERVED.has(ns)) return undefined;
        return nsProxy(ns);
      },
    },
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
