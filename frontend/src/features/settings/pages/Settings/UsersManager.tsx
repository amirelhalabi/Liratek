import { useEffect, useState } from "react";
import { Select, appEvents, useApi } from "@liratek/ui";
import { DataTable, TextInput } from "@liratek/ui";
import type {
  CreateUserInvitationInput,
  SetUserEmailInput,
  UserEmailView,
  UserInvitationView,
} from "@liratek/core";
import PasswordInput from "@/shared/components/PasswordInput";
import { validatePassword } from "@/shared/utils/validatePassword";
import { messageFrom } from "@/api/apiError";
import {
  isElectron,
  listUserEmails,
  setUserEmail,
  sendUserEmailVerification,
  listUserInvitations,
  createUserInvitation,
  revokeUserInvitation,
  resendUserInvitation,
  sendPasswordReset,
  type AccountRouteResult,
} from "@/api/backendApi";

/**
 * User creation used to fail completely silently on the web transport: no
 * success feedback ever existed on either transport (the only positive
 * signal was the table refreshing), and none of the actions below had a
 * try/catch — `requestJson` throws a plain `{status,message,details}` OBJECT
 * on any non-2xx (see `apiError.ts`'s `messageFrom` doc comment), not an
 * `Error`, so a 401/403 from `requireRole` rejected, React swallowed the
 * unhandled rejection, and nothing rendered. Every action here now goes
 * through `messageFrom` + the app's shared toast (`appEvents` +
 * `notification:show`, same mechanism `SignedInDevices.tsx` and
 * `ModulesManager.tsx` already use) for both success and failure, instead of
 * `alert()`.
 */
function notifySuccess(message: string) {
  appEvents.emit("notification:show", message, "success");
}

function notifyError(err: unknown, fallback: string) {
  appEvents.emit("notification:show", messageFrom(err, fallback), "error");
}

/**
 * Web-only account actions (LIRA-279/281/276) answer with the
 * `{ success, data?, error: { code, message } }` envelope, and THROW
 * requestJson's plain object on a 401/403/429. One place turns both into a
 * toast and says whether the action went through.
 */
async function runAccountAction<T>(
  action: () => Promise<AccountRouteResult<T>>,
  fallback: string,
): Promise<T | null> {
  try {
    const res = await action();
    if (!res.success) {
      notifyError(res.error, fallback);
      return null;
    }
    return (res.data ?? null) as T | null;
  } catch (e) {
    notifyError(e, fallback);
    return null;
  }
}

const EMAIL_INPUT_CLASS =
  "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500";

/** Invites the Users tab keeps showing: still usable, or lapsed (resendable). */
const VISIBLE_INVITE_STATUSES: ReadonlySet<UserInvitationView["status"]> = new Set([
  "pending",
  "expired",
]);

type AddUserMode = "create" | "invite";

const ADD_USER_MODE_OPTIONS = [
  { value: "create", label: "Create username/password" },
  { value: "invite", label: "Send invitation" },
];

const ROLE_OPTIONS = [
  { value: "staff", label: "Staff" },
  { value: "admin", label: "Admin" },
];

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export default function UsersManager() {
  const api = useApi();
  const [list, setList] = useState<
    Array<{
      id: number;
      username: string;
      role: "admin" | "staff";
      is_active: number;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "staff">("staff");
  const [creating, setCreating] = useState(false);
  // Desktop has no email, so it only ever creates username/password accounts.
  const [addMode, setAddMode] = useState<AddUserMode>("create");

  // Web-only (LIRA-279/281): desktop keeps manual accounts and has no email.
  const web = !isElectron();
  const [emails, setEmails] = useState<Record<number, UserEmailView>>({});
  const [editingEmailFor, setEditingEmailFor] = useState<number | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [invites, setInvites] = useState<UserInvitationView[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [busyInviteId, setBusyInviteId] = useState<number | null>(null);

  const loadEmails = async () => {
    try {
      const rows = await listUserEmails();
      setEmails(Object.fromEntries(rows.map((row) => [row.id, row])));
    } catch (e) {
      notifyError(e, "Failed to load user emails");
    }
  };

  const loadInvites = async () => {
    try {
      const data = await listUserInvitations();
      setEmailConfigured(data.emailConfigured);
      setInvites(data.invitations);
    } catch (e) {
      notifyError(e, "Failed to load invitations");
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.getNonAdminUsers();
      const normalized = rows.map((u: any) => ({
        ...u,
        role: (u.role === "admin" ? "admin" : "staff") as "admin" | "staff",
      }));
      setList(normalized);
    } catch (e) {
      notifyError(e, "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Mount-only, as before. The runtime cannot change while the page is open.
    if (!isElectron()) {
      loadEmails();
      loadInvites();
    }
  }, []);

  const startEditEmail = (id: number) => {
    setEditingEmailFor(id);
    setEmailDraft(emails[id]?.email ?? "");
  };

  const saveEmail = async (id: number) => {
    const trimmed = emailDraft.trim();
    // Built ONCE (rule 22); an empty field clears the address.
    const payload: SetUserEmailInput = { email: trimmed === "" ? null : trimmed };
    setBusyUserId(id);
    const result = await runAccountAction(
      () => setUserEmail(id, payload),
      "Failed to save the email",
    );
    setBusyUserId(null);
    if (!result) return;
    setEditingEmailFor(null);
    notifySuccess(
      result.email === null
        ? "Email removed"
        : result.verificationSent
          ? `Email saved. A verification link was sent to ${result.email}`
          : "Email saved. It is not verified yet",
    );
    await loadEmails();
  };

  const sendVerification = async (id: number) => {
    setBusyUserId(id);
    const result = await runAccountAction(
      () => sendUserEmailVerification(id),
      "Failed to send the verification email",
    );
    setBusyUserId(null);
    if (result) notifySuccess("Verification email sent");
  };

  const sendReset = async (id: number) => {
    setBusyUserId(id);
    const result = await runAccountAction(
      () => sendPasswordReset(id),
      "Failed to send the password reset email",
    );
    setBusyUserId(null);
    if (result) notifySuccess("Password reset email sent");
  };

  const inviteByEmail = async () => {
    const email = inviteEmail.trim();
    if (!email) {
      notifyError(null, "Enter an email address to invite");
      return;
    }
    // Built ONCE (rule 22).
    const payload: CreateUserInvitationInput = { email, role: newRole };
    setInviting(true);
    const result = await runAccountAction(
      () => createUserInvitation(payload),
      "Failed to send the invitation",
    );
    setInviting(false);
    if (!result) return;
    notifySuccess(`Invitation sent to ${result.invitation.email}`);
    setInviteEmail("");
    setNewRole("staff");
    await loadInvites();
  };

  const revokeInvite = async (id: number) => {
    setBusyInviteId(id);
    const result = await runAccountAction(
      () => revokeUserInvitation(id),
      "Failed to revoke the invitation",
    );
    setBusyInviteId(null);
    if (!result) return;
    notifySuccess("Invitation revoked");
    await loadInvites();
  };

  const resendInvite = async (id: number) => {
    setBusyInviteId(id);
    const result = await runAccountAction(
      () => resendUserInvitation(id),
      "Failed to resend the invitation",
    );
    setBusyInviteId(null);
    if (!result) return;
    notifySuccess(`Invitation re-sent to ${result.invitation.email}`);
    await loadInvites();
  };

  const visibleInvites = invites.filter((i) => VISIBLE_INVITE_STATUSES.has(i.status));

  const toggleActive = async (id: number, is_active: number) => {
    try {
      const res = await api.setUserActive(id, is_active ? false : true);
      if (!res.success) {
        notifyError(res.error, "Failed to update user status");
        return;
      }
      notifySuccess(is_active ? "User deactivated" : "User activated");
      await load();
    } catch (e) {
      notifyError(e, "Failed to update user status");
    }
  };

  const changeRole = async (id: number, role: "admin" | "staff") => {
    const newRole = role === "admin" ? "staff" : "admin";
    try {
      const res = await api.setUserRole(id, newRole);
      if (!res.success) {
        notifyError(res.error, "Failed to change role");
        return;
      }
      notifySuccess(`Role changed to ${newRole}`);
      await load();
    } catch (e) {
      notifyError(e, "Failed to change role");
    }
  };

  const createUser = async () => {
    if (!newUsername || !newPassword) {
      notifyError(null, "Username and password required");
      return;
    }
    const pwResult = validatePassword(newPassword);
    if (!pwResult.valid) {
      notifyError(null, pwResult.errors.join(" "));
      return;
    }
    setCreating(true);
    try {
      const res = await api.createUser({
        username: newUsername,
        password: newPassword,
        role: newRole,
      });
      if (!res.success) {
        notifyError(res.error, "Failed to create user");
        return;
      }
      notifySuccess(`User "${newUsername}" created`);
      setNewUsername("");
      setNewPassword("");
      setNewRole("staff");
      await load();
    } catch (e) {
      notifyError(e, "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const setPassword = async (id: number) => {
    const pwd = prompt("Enter new password");
    if (!pwd) return;
    try {
      const res = await api.setUserPassword(id, pwd);
      if (!res.success) {
        notifyError(res.error, "Failed to set password");
        return;
      }
      notifySuccess("Password updated");
    } catch (e) {
      notifyError(e, "Failed to set password");
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2">
        {web && !emailConfigured && (
          <p className="text-xs text-amber-400">
            Email is not set up on this server, so invitations and
            verification emails cannot be sent.
          </p>
        )}
        <div className="flex items-center gap-2">
          {web && (
            <div data-testid="add-user-mode" className="w-56 shrink-0">
              <Select
                value={addMode}
                onChange={(value) => setAddMode(value as AddUserMode)}
                options={ADD_USER_MODE_OPTIONS}
                ringColor="ring-violet-500"
                buttonClassName="bg-slate-800 px-2 py-1"
              />
            </div>
          )}
          {addMode === "create" ? (
            <>
              <TextInput
                value={newUsername}
                onChange={setNewUsername}
                label=""
                placeholder="Username"
                compact
                className="w-48"
              />
              <PasswordInput
                value={newPassword}
                onChange={setNewPassword}
                label=""
                placeholder="Password"
                compact
                className="flex-1"
              />
            </>
          ) : (
            <input
              type="email"
              data-testid="invite-email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Email address (they choose their own username and password)"
              aria-label="Email address to invite"
              autoComplete="off"
              className={EMAIL_INPUT_CLASS}
            />
          )}
          <Select
            value={newRole}
            onChange={(value) => setNewRole(value as "admin" | "staff")}
            options={ROLE_OPTIONS}
            ringColor="ring-violet-500"
            buttonClassName="bg-slate-800 px-2 py-1"
          />
          {addMode === "create" ? (
            <button
              onClick={createUser}
              disabled={creating}
              className="px-3 py-1 bg-violet-600 rounded text-white disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          ) : (
            <button
              data-testid="invite-submit"
              onClick={inviteByEmail}
              disabled={inviting || !emailConfigured}
              className="px-3 py-1 bg-violet-600 rounded text-white disabled:opacity-50 whitespace-nowrap"
            >
              {inviting ? "Sending…" : "Send invitation"}
            </button>
          )}
        </div>
      </div>

      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <DataTable
          columns={[
            "Username",
            ...(web ? ["Email"] : []),
            "Role",
            "Active",
            { header: "Actions", className: "p-2 text-right" },
          ]}
          data={list}
          loading={loading}
          emptyMessage="No users"
          exportExcel
          exportPdf
          exportFilename="users"
          renderRow={(u) => {
            const info = emails[u.id];
            const verified = Boolean(info?.email && info.emailVerifiedAt);
            const busy = busyUserId === u.id;
            return (
              <tr key={u.id} className="border-t border-slate-800">
                <td className="p-2">{u.username}</td>
                {web && (
                  <td className="p-2">
                    {editingEmailFor === u.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="email"
                          data-testid={`user-email-input-${u.id}`}
                          value={emailDraft}
                          onChange={(e) => setEmailDraft(e.target.value)}
                          placeholder="name@example.com"
                          aria-label={`Email for ${u.username}`}
                          autoFocus
                          className={EMAIL_INPUT_CLASS}
                        />
                        <button
                          data-testid={`user-email-save-${u.id}`}
                          onClick={() => saveEmail(u.id)}
                          disabled={busy}
                          className="text-xs px-2 py-1 bg-violet-600 rounded text-white disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingEmailFor(null)}
                          className="text-xs px-2 py-1 bg-slate-700 rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {info?.email ? (
                          <>
                            <span>{info.email}</span>
                            <span
                              className={
                                verified
                                  ? "text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400"
                                  : "text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400"
                              }
                            >
                              {verified ? "Verified" : "Not verified"}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-500">No email</span>
                        )}
                        <button
                          onClick={() => startEditEmail(u.id)}
                          className="text-xs text-violet-400 hover:text-violet-300"
                        >
                          {info?.email ? "Change email" : "Add email"}
                        </button>
                        {info?.email && !verified && (
                          <button
                            onClick={() => sendVerification(u.id)}
                            disabled={busy || !emailConfigured}
                            className="text-xs text-violet-400 hover:text-violet-300 disabled:opacity-50"
                          >
                            Send verification
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                )}
                <td className="p-2">{u.role}</td>
                <td className="p-2">{u.is_active ? "Yes" : "No"}</td>
                <td className="p-2 text-right space-x-2">
                  <button
                    onClick={() => toggleActive(u.id, u.is_active)}
                    className="text-xs px-2 py-1 bg-slate-700 rounded"
                  >
                    {u.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={() => changeRole(u.id, u.role)}
                    className="text-xs px-2 py-1 bg-violet-600 rounded text-white"
                  >
                    Make {u.role === "admin" ? "Staff" : "Admin"}
                  </button>
                  <button
                    onClick={() => setPassword(u.id)}
                    className="text-xs px-2 py-1 bg-slate-600 rounded text-white"
                  >
                    Set Password
                  </button>
                  {web && (
                    <button
                      onClick={() => sendReset(u.id)}
                      disabled={busy || !verified || !emailConfigured}
                      title={
                        verified
                          ? "Email this user a link to choose a new password"
                          : "Needs a verified email"
                      }
                      className="text-xs px-2 py-1 bg-slate-600 rounded text-white disabled:opacity-50"
                    >
                      Send password reset
                    </button>
                  )}
                </td>
              </tr>
            );
          }}
        />
      </div>

      {web && visibleInvites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-300">Invitations</h3>
          <div className="border border-slate-700 rounded-lg overflow-hidden">
            <DataTable
              columns={[
                "Email",
                "Role",
                "Status",
                "Expires",
                { header: "Actions", className: "p-2 text-right" },
              ]}
              data={visibleInvites}
              emptyMessage="No invitations"
              renderRow={(inv) => (
                <tr key={inv.id} className="border-t border-slate-800">
                  <td className="p-2">{inv.email}</td>
                  <td className="p-2">{inv.role}</td>
                  <td className="p-2">
                    {inv.status === "pending" ? "Waiting" : "Expired"}
                    {inv.emailDelivery?.status === "failed" && (
                      <span className="ml-2 text-xs text-red-400">
                        Email not delivered
                      </span>
                    )}
                  </td>
                  <td className="p-2">{formatDay(inv.expiresAt)}</td>
                  <td className="p-2 text-right space-x-2">
                    <button
                      onClick={() => resendInvite(inv.id)}
                      disabled={busyInviteId === inv.id || !emailConfigured}
                      className="text-xs px-2 py-1 bg-violet-600 rounded text-white disabled:opacity-50"
                    >
                      Resend
                    </button>
                    {inv.status === "pending" && (
                      <button
                        onClick={() => revokeInvite(inv.id)}
                        disabled={busyInviteId === inv.id}
                        className="text-xs px-2 py-1 bg-slate-700 rounded disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}
