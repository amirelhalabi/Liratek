/**
 * My account (LIRA-291, LIRA-292) — route `/account`, open to EVERY signed-in
 * shop user (admin and staff), unlike Settings, which is admin-only. Opened
 * from the top bar's person icon, on desktop and web.
 *
 *   - Profile: who is signed in (read-only).
 *   - Display (this device): navigation style, POS display, UI scale … —
 *     per-browser preferences, moved here from Settings → Shop Config so
 *     staff can set their own (LIRA-292).
 *   - Web only: the user's OWN sign-in methods (connect / disconnect Google,
 *     "Set a password" for someone who joined with Google) and their
 *     account email, password and signed-in devices. Both panels are the
 *     existing components, not copies; the Google link flow lands back here
 *     (`/#/account?google=…`).
 *     On desktop they are not rendered: Sign-in methods is web-only, and
 *     desktop admins keep Settings → Signed-in Devices.
 *   - LIRA-293: email and password changes in Sign-in methods (web); the
 *     desktop app has its own password section.
 */

import { useEffect, useState } from "react";
import GoogleAccountPanel from "@/features/settings/pages/Settings/GoogleAccountPanel";
import SignedInDevices from "@/features/settings/pages/Settings/SignedInDevices";
import ProfileSection from "@/features/account/components/ProfileSection";
import DisplayPreferences from "@/features/account/components/DisplayPreferences";
import ChangePasswordForm from "@/features/account/components/ChangePasswordForm";
import {
  getMyEmail,
  isElectron,
  type OwnEmailView,
} from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";

export default function MyAccount() {
  const desktop = isElectron();
  const [accountEmail, setAccountEmail] = useState<OwnEmailView | null>(null);
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [emailLoadError, setEmailLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (desktop) return;
    let cancelled = false;
    getMyEmail()
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setAccountEmail(res.data ?? null);
          setEmailLoadError(null);
        } else {
          setEmailLoadError(
            messageFrom(res.error, "Could not load account email."),
          );
        }
        setEmailLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setEmailLoadError(messageFrom(error, "Could not load account email."));
        setEmailLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-auto animate-in fade-in duration-500">
      <h1 className="sr-only">My account</h1>
      <ProfileSection email={accountEmail?.email ?? null} />
      {desktop ? (
        // LIRA-293: desktop users always have a password (no Google there).
        <section
          aria-label="Password"
          className="rounded-xl border border-slate-700 bg-slate-800 p-4 pb-6"
        >
          <ChangePasswordForm />
        </section>
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 pb-6">
          <GoogleAccountPanel
            accountEmail={accountEmail}
            emailLoaded={emailLoaded}
            emailLoadError={emailLoadError}
          />
          <SignedInDevices />
        </div>
      )}
      <DisplayPreferences />
    </div>
  );
}
