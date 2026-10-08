/**
 * Profile — LIRA-292. The top of My account: who is signed in. Read-only.
 *
 * Username and role come from the auth context and the shop name from
 * `useShopName` (both work on desktop and web). The email comes from
 * `GET /api/user-email/me`, the user's OWN row (the id is taken from the
 * session on the server). The desktop app has no email, so there the row is
 * left out; `getMyEmail` answers `null` there without a call.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useShopName } from "@/hooks/useShopName";
import { getMyEmail, isElectron, type OwnEmailView } from "@/api/backendApi";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  staff: "Staff",
};

function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-700/60 last:border-b-0">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className="text-sm text-white text-right">{children}</dd>
    </div>
  );
}

export default function ProfileSection() {
  const { user } = useAuth();
  const shopName = useShopName();
  const [email, setEmail] = useState<OwnEmailView | null>(null);
  const desktop = isElectron();

  useEffect(() => {
    if (desktop) return;
    let cancelled = false;
    getMyEmail()
      .then((res) => {
        if (!cancelled && res.success && res.data) setEmail(res.data);
      })
      .catch(() => {
        // Decoration only: Profile still shows who is signed in.
      });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  const role = user?.role ?? "";

  return (
    <section
      aria-labelledby="profile-heading"
      className="rounded-xl border border-slate-700 bg-slate-800 p-4"
    >
      <h2 id="profile-heading" className="text-sm font-semibold text-white">
        Profile
      </h2>
      <dl className="mt-2">
        <Row label="Username">{user?.username ?? ""}</Row>
        <Row label="Role">{ROLE_LABELS[role] ?? role}</Row>
        {shopName && <Row label="Shop">{shopName}</Row>}
        {!desktop && (
          <Row label="Email">
            {email?.email ? (
              <span className="inline-flex items-center gap-2">
                <span data-testid="profile-email">{email.email}</span>
                {email.emailVerifiedAt ? (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300">
                    Verified
                  </span>
                ) : (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300">
                    Not confirmed
                  </span>
                )}
              </span>
            ) : (
              <span className="text-slate-500">None</span>
            )}
          </Row>
        )}
      </dl>
    </section>
  );
}
