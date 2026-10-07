/**
 * "Continue with Google" on the login and sign-up pages (LIRA-280). Web only.
 *
 * Rendered only when the backend says Google sign-in is enabled — it is
 * dormant until the owner sets GOOGLE_CLIENT_ID/SECRET — so a deployment
 * without Google never shows a door that is bolted. Both actions are plain
 * links to the www start URL: Google's flow is a full-page navigation, and it
 * must run on www (the one origin registered with Google), not on the shop's
 * own subdomain. `shop` brings a person with several shops back to this one.
 */

import { useEffect, useState, type ReactNode } from "react";
import { googleAuthStatus, isElectron } from "@/api/backendApi";

interface Links {
  login: string;
  signup: string;
}

function startLink(startUrl: string, params: Record<string, string>): string {
  return `${startUrl}?${new URLSearchParams(params).toString()}`;
}

interface GoogleSignInButtonProps {
  /**
   * "login" (default, the login page): "Continue with Google" signs in, and
   * a second line offers "Create a shop with Google". "signup" (the Signup
   * page): the one button starts a Google sign-up. Creating a shop with
   * Google is open whenever Google is configured (owner decision
   * 2026-10-07), inside the one public sign-up daily cap.
   */
  intent?: "login" | "signup";
  /** Rendered instead of the button once the backend says Google is off
   * (dormant, or unreachable). Nothing is rendered while it is asked. */
  fallback?: ReactNode;
}

export default function GoogleSignInButton({
  intent = "login",
  fallback = null,
}: GoogleSignInButtonProps = {}) {
  // undefined = still asking; null = Google is not available here.
  const [links, setLinks] = useState<Links | null | undefined>(() =>
    isElectron() ? null : undefined,
  );

  useEffect(() => {
    if (isElectron()) return;
    let cancelled = false;
    // Promise.resolve() first so a synchronous throw (desktop guard, a
    // missing function) lands in the same catch as a network failure.
    Promise.resolve()
      .then(() => googleAuthStatus())
      .then((res) => {
        if (cancelled) return;
        const data = res.success ? res.data : undefined;
        if (!data?.enabled || !data.startUrl) {
          setLinks(null);
          return;
        }
        setLinks({
          login: startLink(data.startUrl, {
            intent: "login",
            ...(data.shop ? { shop: data.shop } : {}),
          }),
          signup: startLink(data.startUrl, { intent: "signup" }),
        });
      })
      // A backend that cannot answer cannot sign anyone in with Google either.
      .catch(() => {
        if (!cancelled) setLinks(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (links === undefined) return null;
  if (links === null) return <>{fallback}</>;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span className="h-px flex-1 bg-slate-600/40" />
        or
        <span className="h-px flex-1 bg-slate-600/40" />
      </div>
      <a
        href={intent === "signup" ? links.signup : links.login}
        data-testid="google-sign-in"
        // Fixed colours on purpose: index.css repaints theme classes such as
        // text-gray-800 as white in dark mode (!important), which made the
        // label invisible on the white button. Arbitrary values are not remapped.
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-500/40 bg-[#ffffff] px-4 py-3 font-semibold text-[#1f2937] transition-colors hover:bg-[#f3f4f6]"
      >
        <span aria-hidden="true" className="font-bold text-[#4285F4]">
          G
        </span>
        Continue with Google
      </a>
      {intent === "login" && (
        <p className="text-center text-xs text-slate-500">
          Or{" "}
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
