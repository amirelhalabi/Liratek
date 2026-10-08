/**
 * Profile — LIRA-292. The top of My account: who is signed in. Read-only.
 *
 * Username and role come from the auth context and the shop name from
 * `useShopName` (both work on desktop and web). The email comes from
 * `GET /api/user-email/me`, the user's OWN row (the id is taken from the
 * session on the server). The desktop app has no email, so there the row is
 * left out; `getMyEmail` answers `null` there without a call.
 *
 * LIRA-293 (web): "Change email" asks for a new address. A confirmation link
 * goes to that address and the email shown here changes only once the link
 * is opened ("check your inbox"); the old confirmed address is told.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useShopName } from "@/hooks/useShopName";
import {
  getMyEmail,
  isElectron,
  requestEmailChange,
  type OwnEmailView,
} from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";

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

/** LIRA-293: the new address, a confirmation link, then "check your inbox". */
function ChangeEmail() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await requestEmailChange({ email: value.trim() });
      if (!res.success || !res.data) {
        setError(messageFrom(res.error, "Could not change the email."));
        return;
      }
      setSentTo(res.data.pendingEmail);
      setOpen(false);
      setValue("");
    } catch (err) {
      setError(messageFrom(err, "Could not change the email."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-2">
      {sentTo && (
        <p role="status" className="text-sm text-green-400">
          Check your inbox at {sentTo}: open the link we sent to finish the
          change. Your email stays the same until then.
        </p>
      )}
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSentTo(null);
          }}
          className="text-sm text-violet-400 hover:text-violet-300"
        >
          Change email
        </button>
      ) : (
        <form
          onSubmit={submit}
          aria-label="Change email"
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <div className="flex-1 min-w-[12rem]">
            <label
              htmlFor="change-email-new"
              className="block text-xs text-slate-400 mb-1"
            >
              New email
            </label>
            <input
              id="change-email-new"
              type="email"
              autoComplete="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500 disabled:opacity-60"
          >
            Send confirmation link
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-3 py-1.5 text-sm text-slate-300 hover:text-white"
          >
            Cancel
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-400">
          {error}
        </p>
      )}
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
      {!desktop && <ChangeEmail />}
    </section>
  );
}
