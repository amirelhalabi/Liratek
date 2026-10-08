/**
 * My account (LIRA-291) — route `/account`, open to EVERY signed-in shop user
 * (admin and staff), unlike Settings, which is admin-only.
 *
 * Shows the user's OWN sign-in methods (connect / disconnect Google, and
 * "Set a password" for someone who joined with Google and has none) and
 * their own signed-in devices. Both panels are the existing components,
 * not copies; on the web build Settings no longer has its own "Signed-in
 * Devices" tab, so there is one place for them. The Google link flow lands
 * back here (`/#/account?google=…`).
 *
 * Web only in practice: the top-bar link is hidden on desktop, and the
 * Sign-in methods panel renders nothing there. Desktop admins keep the
 * Signed-in Devices tab in Settings.
 */

import { PageHeader } from "@liratek/ui";
import GoogleAccountPanel from "@/features/settings/pages/Settings/GoogleAccountPanel";
import SignedInDevices from "@/features/settings/pages/Settings/SignedInDevices";

export default function MyAccount() {
  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 pt-6 flex flex-col gap-6 overflow-y-auto animate-in fade-in duration-500">
      <PageHeader title="My account" />
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 pb-6">
        <GoogleAccountPanel />
        <SignedInDevices />
      </div>
    </div>
  );
}
