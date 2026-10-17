import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal, Select, appEvents, useApi } from "@liratek/ui";
import { DataTable, TextInput } from "@liratek/ui";
import type {
  CreateUserInvitationInput,
  SetUserEmailInput,
  UserEmailView,
  UserInvitationView,
} from "@liratek/core";
import PasswordInput from "@/shared/components/PasswordInput";
import { signinMethodLabel, validatePasswordComplexity } from "@liratek/core";
import { messageFrom } from "@/api/apiError";
import { useFormat } from "@/i18n/useFormat";
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
  adminRemoveUserGoogle,
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
const VISIBLE_INVITE_STATUSES: ReadonlySet<UserInvitationView["status"]> =
  new Set(["pending", "expired"]);

type AddUserMode = "create" | "invite";


export default function UsersManager() {
  const api = useApi();
  const { t } = useTranslation(["settings", "common"]);
  const { formatDate } = useFormat();
  // Option values are the stored codes; only the labels translate.
  const addUserModeOptions = useMemo(
    () => [
      { value: "create", label: t("users.mode.create") },
      { value: "invite", label: t("users.mode.invite") },
    ],
    [t],
  );
  const roleOptions = useMemo(
    () => [
      { value: "staff", label: t("users.role.staff") },
      { value: "admin", label: t("users.role.admin") },
    ],
    [t],
  );
  const formatDay = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : formatDate(d);
  };
  const roleText = (role: string): string =>
    role === "admin" || role === "staff" ? t(`users.roleValue.${role}`) : role;
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
  // LIRA-288: the member whose Google sign-in the admin is about to remove.
  const [confirmGoogleFor, setConfirmGoogleFor] = useState<{
    id: number;
    username: string;
  } | null>(null);

  const loadEmails = async () => {
    try {
      const rows = await listUserEmails();
      setEmails(Object.fromEntries(rows.map((row) => [row.id, row])));
    } catch (e) {
      notifyError(e, t("users.loadEmailsFailed"));
    }
  };

  const loadInvites = async () => {
    try {
      const data = await listUserInvitations();
      setEmailConfigured(data.emailConfigured);
      setInvites(data.invitations);
    } catch (e) {
      notifyError(e, t("users.loadInvitesFailed"));
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
      notifyError(e, t("users.loadFailed"));
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
    const payload: SetUserEmailInput = {
      email: trimmed === "" ? null : trimmed,
    };
    setBusyUserId(id);
    const result = await runAccountAction(
      () => setUserEmail(id, payload),
      t("users.saveEmailFailed"),
    );
    setBusyUserId(null);
    if (!result) return;
    setEditingEmailFor(null);
    notifySuccess(
      result.email === null
        ? t("users.emailRemoved")
        : result.verificationSent
          ? t("users.emailSavedSent", { email: result.email })
          : t("users.emailSavedUnverified"),
    );
    await loadEmails();
  };

  const sendVerification = async (id: number) => {
    setBusyUserId(id);
    const result = await runAccountAction(
      () => sendUserEmailVerification(id),
      t("users.verifyFailed"),
    );
    setBusyUserId(null);
    if (result) notifySuccess(t("users.verifySent"));
  };

  const sendReset = async (id: number) => {
    setBusyUserId(id);
    const result = await runAccountAction(
      () => sendPasswordReset(id),
      t("users.resetFailed"),
    );
    setBusyUserId(null);
    if (result) notifySuccess(t("users.resetSent"));
  };

  /** LIRA-288: an admin disconnects a member's Google (after confirming).
   * That Google account no longer signs in to this shop; the member can
   * still use their password.
   *
   * LIRA-291: a member with NO password gets an emailed "Set a password"
   * link from the server; `passwordLink` reports whether it went out. */
  const removeGoogle = async (target: { id: number; username: string }) => {
    setConfirmGoogleFor(null);
    setBusyUserId(target.id);
    const result = await runAccountAction(
      () => adminRemoveUserGoogle(target.id),
      t("users.googleRemoveFailed"),
    );
    setBusyUserId(null);
    if (!result) return;
    if (result.passwordLink === "sent") {
      notifySuccess(
        t("users.googleRemovedLinkSent", { username: target.username }),
      );
    } else if (result.passwordLink === "not_sent") {
      notifySuccess(t("users.googleRemoved"));
      notifyError(
        null,
        t("users.googleRemovedNoEmail", { username: target.username }),
      );
    } else {
      notifySuccess(t("users.googleRemoved"));
    }
    await loadEmails();
  };

  /** LIRA-291: the Disconnect Google confirm text, from what the list knows. */
  const googleConfirmText = (target: { id: number; username: string }) => {
    const info = emails[target.id];
    const base = t("users.googleConfirmBase", { username: target.username });
    if (info?.hasPassword !== false) {
      return t("users.googleConfirmHasPassword", { base });
    }
    const canEmail =
      emailConfigured && Boolean(info.email && info.emailVerifiedAt);
    return canEmail
      ? t("users.googleConfirmEmail", { base, username: target.username })
      : t("users.googleConfirmNoEmail", { base, username: target.username });
  };

  const inviteByEmail = async () => {
    const email = inviteEmail.trim();
    if (!email) {
      notifyError(null, t("users.inviteEmailRequired"));
      return;
    }
    // Built ONCE (rule 22).
    const payload: CreateUserInvitationInput = { email, role: newRole };
    setInviting(true);
    const result = await runAccountAction(
      () => createUserInvitation(payload),
      t("users.inviteFailed"),
    );
    setInviting(false);
    if (!result) return;
    notifySuccess(t("users.inviteSent", { email: result.invitation.email }));
    setInviteEmail("");
    setNewRole("staff");
    await loadInvites();
  };

  const revokeInvite = async (id: number) => {
    setBusyInviteId(id);
    const result = await runAccountAction(
      () => revokeUserInvitation(id),
      t("users.revokeFailed"),
    );
    setBusyInviteId(null);
    if (!result) return;
    notifySuccess(t("users.revoked"));
    await loadInvites();
  };

  const resendInvite = async (id: number) => {
    setBusyInviteId(id);
    const result = await runAccountAction(
      () => resendUserInvitation(id),
      t("users.resendFailed"),
    );
    setBusyInviteId(null);
    if (!result) return;
    notifySuccess(t("users.resent", { email: result.invitation.email }));
    await loadInvites();
  };

  const visibleInvites = invites.filter((i) =>
    VISIBLE_INVITE_STATUSES.has(i.status),
  );

  const toggleActive = async (id: number, is_active: number) => {
    try {
      const res = await api.setUserActive(id, is_active ? false : true);
      if (!res.success) {
        notifyError(res.error, t("users.statusFailed"));
        return;
      }
      notifySuccess(
        is_active ? t("users.deactivated") : t("users.activated"),
      );
      await load();
    } catch (e) {
      notifyError(e, t("users.statusFailed"));
    }
  };

  const changeRole = async (id: number, role: "admin" | "staff") => {
    const newRole = role === "admin" ? "staff" : "admin";
    try {
      const res = await api.setUserRole(id, newRole);
      if (!res.success) {
        notifyError(res.error, t("users.roleFailed"));
        return;
      }
      notifySuccess(t("users.roleChanged", { role: roleText(newRole) }));
      await load();
    } catch (e) {
      notifyError(e, t("users.roleFailed"));
    }
  };

  const createUser = async () => {
    if (!newUsername || !newPassword) {
      notifyError(null, t("users.credsRequired"));
      return;
    }
    const pwResult = validatePasswordComplexity(newPassword);
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
        notifyError(res.error, t("users.createFailed"));
        return;
      }
      notifySuccess(t("users.created", { username: newUsername }));
      setNewUsername("");
      setNewPassword("");
      setNewRole("staff");
      await load();
    } catch (e) {
      notifyError(e, t("users.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const setPassword = async (id: number) => {
    const pwd = prompt(t("users.passwordPrompt"));
    if (!pwd) return;
    try {
      const res = await api.setUserPassword(id, pwd);
      if (!res.success) {
        notifyError(res.error, t("users.passwordFailed"));
        return;
      }
      notifySuccess(t("users.passwordUpdated"));
    } catch (e) {
      notifyError(e, t("users.passwordFailed"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2">
        {web && !emailConfigured && (
          <p className="text-xs text-amber-400">
            {t("users.emailNotConfigured")}
          </p>
        )}
        <div className="flex items-center gap-2">
          {web && (
            <div data-testid="add-user-mode" className="w-56 shrink-0">
              <Select
                value={addMode}
                onChange={(value) => setAddMode(value as AddUserMode)}
                options={addUserModeOptions}
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
                placeholder={t("users.username")}
                compact
                className="w-48"
              />
              <PasswordInput
                value={newPassword}
                onChange={setNewPassword}
                label=""
                placeholder={t("users.password")}
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
              placeholder={t("users.invitePlaceholder")}
              aria-label={t("users.inviteAria")}
              autoComplete="off"
              className={EMAIL_INPUT_CLASS}
            />
          )}
          <Select
            value={newRole}
            onChange={(value) => setNewRole(value as "admin" | "staff")}
            options={roleOptions}
            ringColor="ring-violet-500"
            buttonClassName="bg-slate-800 px-2 py-1"
          />
          {addMode === "create" ? (
            <button
              onClick={createUser}
              disabled={creating}
              className="px-3 py-1 bg-violet-600 rounded text-white disabled:opacity-50"
            >
              {creating ? t("users.creating") : t("users.create")}
            </button>
          ) : (
            <button
              data-testid="invite-submit"
              onClick={inviteByEmail}
              disabled={inviting || !emailConfigured}
              className="px-3 py-1 bg-violet-600 rounded text-white disabled:opacity-50 whitespace-nowrap"
            >
              {inviting ? t("users.sending") : t("users.sendInvite")}
            </button>
          )}
        </div>
      </div>

      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <DataTable
          columns={[
            t("users.col.username"),
            ...(web
              ? [
                  t("users.col.email"),
                  t("users.col.google"),
                  t("users.col.signin"),
                ]
              : []),
            t("users.col.role"),
            t("users.col.active"),
            { header: t("users.col.actions"), className: "p-2 text-end" },
          ]}
          data={list}
          loading={loading}
          emptyMessage={t("users.empty")}
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
                          placeholder={t("users.emailPlaceholder")}
                          aria-label={t("users.emailAria", { username: u.username })}
                          autoFocus
                          className={EMAIL_INPUT_CLASS}
                        />
                        <button
                          data-testid={`user-email-save-${u.id}`}
                          onClick={() => saveEmail(u.id)}
                          disabled={busy}
                          className="text-xs px-2 py-1 bg-violet-600 rounded text-white disabled:opacity-50"
                        >
                          {t("common:actions.save")}
                        </button>
                        <button
                          onClick={() => setEditingEmailFor(null)}
                          className="text-xs px-2 py-1 bg-slate-700 rounded"
                        >
                          {t("common:actions.cancel")}
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
                              {verified
                                ? t("users.verified")
                                : t("users.notVerified")}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-500">
                            {t("users.noEmail")}
                          </span>
                        )}
                        <button
                          onClick={() => startEditEmail(u.id)}
                          className="text-xs text-violet-400 hover:text-violet-300"
                        >
                          {info?.email
                            ? t("users.changeEmail")
                            : t("users.addEmail")}
                        </button>
                        {info?.email && !verified && (
                          <button
                            onClick={() => sendVerification(u.id)}
                            disabled={busy || !emailConfigured}
                            className="text-xs text-violet-400 hover:text-violet-300 disabled:opacity-50"
                          >
                            {t("users.sendVerification")}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                )}
                {web && (
                  <td className="p-2" data-testid={`user-google-${u.id}`}>
                    {info?.google ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span>
                          {info.google.email ?? t("users.googleConnected")}
                        </span>
                        <button
                          onClick={() =>
                            setConfirmGoogleFor({
                              id: u.id,
                              username: u.username,
                            })
                          }
                          disabled={busy}
                          className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
                        >
                          {t("users.disconnectGoogle")}
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                )}
                {web && (
                  <td className="p-2" data-testid={`user-signin-${u.id}`}>
                    {info
                      ? signinMethodLabel({
                          hasPassword: info.hasPassword !== false,
                          google: Boolean(info.google),
                        })
                      : "—"}
                  </td>
                )}
                <td className="p-2">{roleText(u.role)}</td>
                <td className="p-2">
                  {u.is_active ? t("common:yes") : t("common:no")}
                </td>
                <td className="p-2 text-end space-x-2">
                  <button
                    onClick={() => toggleActive(u.id, u.is_active)}
                    className="text-xs px-2 py-1 bg-slate-700 rounded"
                  >
                    {u.is_active ? t("users.deactivate") : t("users.activate")}
                  </button>
                  <button
                    onClick={() => changeRole(u.id, u.role)}
                    className="text-xs px-2 py-1 bg-violet-600 rounded text-white"
                  >
                    {u.role === "admin"
                      ? t("users.makeStaff")
                      : t("users.makeAdmin")}
                  </button>
                  <button
                    onClick={() => setPassword(u.id)}
                    className="text-xs px-2 py-1 bg-slate-600 rounded text-white"
                  >
                    {t("users.setPassword")}
                  </button>
                  {web && (
                    <button
                      onClick={() => sendReset(u.id)}
                      disabled={busy || !verified || !emailConfigured}
                      title={
                        verified
                          ? t("users.resetTitle")
                          : t("users.needsVerified")
                      }
                      className="text-xs px-2 py-1 bg-slate-600 rounded text-white disabled:opacity-50"
                    >
                      {t("users.sendReset")}
                    </button>
                  )}
                </td>
              </tr>
            );
          }}
        />
      </div>

      <ConfirmModal
        isOpen={confirmGoogleFor !== null}
        title={t("users.disconnectTitle")}
        message={confirmGoogleFor ? googleConfirmText(confirmGoogleFor) : ""}
        confirmLabel={t("users.disconnect")}
        onConfirm={() => {
          if (confirmGoogleFor) void removeGoogle(confirmGoogleFor);
        }}
        onCancel={() => setConfirmGoogleFor(null)}
      />

      {web && visibleInvites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-300">
            {t("users.invitations")}
          </h3>
          <div className="border border-slate-700 rounded-lg overflow-hidden">
            <DataTable
              columns={[
                t("users.col.email"),
                t("users.col.role"),
                t("users.col.status"),
                t("users.col.expires"),
                { header: t("users.col.actions"), className: "p-2 text-end" },
              ]}
              data={visibleInvites}
              emptyMessage={t("users.noInvitations")}
              renderRow={(inv) => (
                <tr key={inv.id} className="border-t border-slate-800">
                  <td className="p-2">{inv.email}</td>
                  <td className="p-2">{roleText(inv.role)}</td>
                  <td className="p-2">
                    {inv.status === "pending"
                      ? t("users.waiting")
                      : t("users.expired")}
                    {inv.emailDelivery?.status === "failed" && (
                      <span className="ms-2 text-xs text-red-400">
                        {t("users.notDelivered")}
                      </span>
                    )}
                  </td>
                  <td className="p-2">{formatDay(inv.expiresAt)}</td>
                  <td className="p-2 text-end space-x-2">
                    <button
                      onClick={() => resendInvite(inv.id)}
                      disabled={busyInviteId === inv.id || !emailConfigured}
                      className="text-xs px-2 py-1 bg-violet-600 rounded text-white disabled:opacity-50"
                    >
                      {t("users.resend")}
                    </button>
                    {inv.status === "pending" && (
                      <button
                        onClick={() => revokeInvite(inv.id)}
                        disabled={busyInviteId === inv.id}
                        className="text-xs px-2 py-1 bg-slate-700 rounded disabled:opacity-50"
                      >
                        {t("users.revoke")}
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
