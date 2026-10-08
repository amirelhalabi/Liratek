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
 *     signed-in devices. Both panels are the existing components, not
 *     copies; the Google link flow lands back here (`/#/account?google=…`).
 *     On desktop they are not rendered: Sign-in methods is web-only, and
 *     desktop admins keep Settings → Signed-in Devices.
 *   - LIRA-293: "Change password" (web: inside Sign-in methods for a user
 *     who has a password; desktop: its own section) and, on the web,
 *     Profile → "Change email".
 */

import { PageHeader } from "@liratek/ui";
import GoogleAccountPanel from "@/features/settings/pages/Settings/GoogleAccountPanel";
import SignedInDevices from "@/features/settings/pages/Settings/SignedInDevices";
import ProfileSection from "@/features/account/components/ProfileSection";
import DisplayPreferences from "@/features/account/components/DisplayPreferences";
import ChangePasswordForm from "@/features/account/components/ChangePasswordForm";
import { isElectron } from "@/api/backendApi";

export default function MyAccount() {
  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 pt-6 pb-6 flex flex-col gap-6 overflow-y-auto animate-in fade-in duration-500">
      <PageHeader title="My account" />
      <ProfileSection />
      {isElectron() ? (
        // LIRA-293: desktop users always have a password (no Google there).
        <section
          aria-label="Password"
          className="rounded-xl border border-slate-700 bg-slate-800 p-4 pb-6"
        >
          <ChangePasswordForm />
        </section>
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 pb-6">
          <GoogleAccountPanel />
          <SignedInDevices />
        </div>
      )}
      <DisplayPreferences />
    </div>
  );
}
