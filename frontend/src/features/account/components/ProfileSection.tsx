/**
 * Profile — LIRA-292. The top of My account: who is signed in. Read-only.
 *
 * Username and role come from the auth context; the optional account email
 * is supplied by My account alongside this identity.
 */

import { useAuth } from "@/features/auth/context/AuthContext";
import AccountAvatar from "@/features/account/components/AccountAvatar";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  staff: "Staff",
};

export default function ProfileSection({ email }: { email?: string | null }) {
  const { user } = useAuth();

  const role = user?.role ?? "";

  return (
    <section
      aria-label="Profile"
      className="flex items-center gap-3 px-1 py-1"
    >
      <AccountAvatar
        url={user?.pictureUrl}
        size={56}
        alt="Account photo"
        className="shrink-0 text-slate-400"
      />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 text-lg font-semibold text-white">
          <span>{user?.username ?? ""}</span>
          <span aria-hidden="true" className="text-slate-500">
            {" - "}
          </span>
          <span className="text-slate-300">{ROLE_LABELS[role] ?? role}</span>
        </p>
        {email && <p className="mt-0.5 text-sm text-slate-400">{email}</p>}
      </div>
    </section>
  );
}
