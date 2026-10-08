/**
 * Settings -> Connect Google (LIRA-280). Web only; shown on the "Signed-in
 * Devices" tab because it is about how THIS user signs in.
 *
 * The ONLY way an existing account gets linked to Google (owner decision
 * 2026-10-07): never automatically by matching an email. Connect asks the
 * server for the www start URL and a signed ticket that names the caller,
 * POSTs the ticket there as a form (never in a URL) and so leaves for Google; the callback returns here with
 * `?tab=devices&google=linked|already_linked|error|cancelled`, which this
 * panel reports once and removes from the address bar.
 *
 * LIRA-288: one Google account = one user PER SHOP, so the same account may
 * be connected here and in other shops; `already_linked` means another user
 * of THIS shop has it (or this user already has another one). The callback
 * no longer sends `in_other_shop`; its text is kept for one release for a
 * page left open from before.
 *
 * Hidden on desktop and while Google sign-in is dormant (no GOOGLE_CLIENT_ID).
 * Disconnecting never locks anyone out: every account keeps its password.
 */

import { useCallback, useEffect, useState } from "react";
import { GOOGLE_ACCOUNT_IN_OTHER_SHOP_MESSAGE } from "@liratek/core";
import {
  googleLinkStart,
  googleLinkStatus,
  googleUnlink,
  isElectron,
} from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import {
  hashQuery,
  removeHashParam,
  submitPostForm,
} from "@/features/auth/utils/browserNavigation";

const RESULT_TEXT: Record<string, { ok: boolean; text: string }> = {
  linked: { ok: true, text: "Google is now connected. You can sign in with it." },
  already_linked: {
    ok: false,
    text: "That Google account is already connected to another user in this shop, or you already have one connected.",
  },
  // Deprecated (LIRA-288): no longer sent; kept for one release.
  in_other_shop: { ok: false, text: GOOGLE_ACCOUNT_IN_OTHER_SHOP_MESSAGE },
  error: { ok: false, text: "Google could not be connected. Please try again." },
  cancelled: { ok: false, text: "Connecting Google was cancelled." },
};

interface LinkState {
  linked: boolean;
  email: string | null;
}

export default function GoogleAccountPanel() {
  const [state, setState] = useState<LinkState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    () => {
      if (isElectron()) return null;
      const result = hashQuery().get("google");
      return result ? (RESULT_TEXT[result] ?? null) : null;
    },
  );

  // The link result is reported once, then leaves the address bar.
  useEffect(() => {
    if (!isElectron()) removeHashParam("google");
  }, []);

  const load = useCallback(async () => {
    if (isElectron()) return;
    try {
      const res = await googleLinkStatus();
      if (res.success && res.data?.enabled) {
        setState({ linked: res.data.linked, email: res.data.email });
      } else {
        setState(null);
      }
    } catch {
      // A backend that cannot answer cannot link either: stay hidden.
      setState(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!state) return null;

  const connect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await googleLinkStart();
      if (res.success && res.data?.url && res.data.ticket) {
        submitPostForm(res.data.url, { intent: "link", ticket: res.data.ticket });
        return;
      }
      setNotice({ ok: false, text: messageFrom(res.error, RESULT_TEXT.error!.text) });
    } catch (err) {
      setNotice({ ok: false, text: messageFrom(err, RESULT_TEXT.error!.text) });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (
      !confirm(
        "Disconnect Google? You will sign in with your username and password.",
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await googleUnlink();
      if (!res.success) {
        setNotice({
          ok: false,
          text: messageFrom(res.error, "Could not disconnect Google."),
        });
      }
      await load();
    } catch (err) {
      setNotice({ ok: false, text: messageFrom(err, "Could not disconnect Google.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-6 rounded-lg border border-slate-700 bg-slate-900/40 p-4">
      <h3 className="text-sm font-semibold text-white">Sign in with Google</h3>
      {notice && (
        <p
          role="status"
          className={`mt-2 text-sm ${notice.ok ? "text-green-400" : "text-red-400"}`}
        >
          {notice.text}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-400">
          {state.linked
            ? `Connected to ${state.email ?? "a Google account"}.`
            : "Connect your Google account to sign in without typing your password."}
        </p>
        {state.linked ? (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="shrink-0 rounded px-3 py-1.5 text-sm text-red-300 border border-red-500/40 hover:bg-red-500/10 disabled:opacity-60"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="shrink-0 rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500 disabled:opacity-60"
          >
            Connect Google
          </button>
        )}
      </div>
    </section>
  );
}
