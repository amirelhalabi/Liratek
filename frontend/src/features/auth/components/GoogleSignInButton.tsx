/**
 * "Continue with Google" on the login page (LIRA-280). Web only.
 *
 * Rendered only when the backend says Google sign-in is enabled — it is
 * dormant until the owner sets GOOGLE_CLIENT_ID/SECRET — so a deployment
 * without Google never shows a door that is bolted. Both actions are plain
 * links to the www start URL: Google's flow is a full-page navigation, and it
 * must run on www (the one origin registered with Google), not on the shop's
 * own subdomain. `shop` brings a person with several shops back to this one.
 */

import { useEffect, useState } from "react";
import { googleAuthStatus, isElectron } from "@/api/backendApi";

interface Links {
  login: string;
  /** Null while shop sign-up is closed (self-serve off). */
  signup: string | null;
}

function startLink(startUrl: string, params: Record<string, string>): string {
  return `${startUrl}?${new URLSearchParams(params).toString()}`;
}

export default function GoogleSignInButton() {
  const [links, setLinks] = useState<Links | null>(null);

  useEffect(() => {
    if (isElectron()) return;
    let cancelled = false;
    // Promise.resolve() first so a synchronous throw (desktop guard, a
    // missing function) lands in the same catch as a network failure.
    Promise.resolve()
      .then(() => googleAuthStatus())
      .then((res) => {
        const data = res.success ? res.data : undefined;
        if (cancelled || !data?.enabled || !data.startUrl) return;
        setLinks({
          login: startLink(data.startUrl, {
            intent: "login",
            ...(data.shop ? { shop: data.shop } : {}),
          }),
          signup: data.signupEnabled
            ? startLink(data.startUrl, { intent: "signup" })
            : null,
        });
      })
      // A backend that cannot answer cannot sign anyone in with Google either.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!links) return null;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span className="h-px flex-1 bg-slate-600/40" />
        or
        <span className="h-px flex-1 bg-slate-600/40" />
      </div>
      <a
        href={links.login}
        data-testid="google-sign-in"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-500/40 bg-white px-4 py-3 font-semibold text-gray-800 transition-colors hover:bg-gray-100"
      >
        <span aria-hidden="true" className="font-bold text-blue-600">
          G
        </span>
        Continue with Google
      </a>
      {links.signup && (
        <p className="text-center text-xs text-slate-500">
          New here?{" "}
          <a
            href={links.signup}
            className="text-orange-500 hover:text-orange-400"
          >
            Create a shop with Google
          </a>
        </p>
      )}
    </div>
  );
}
