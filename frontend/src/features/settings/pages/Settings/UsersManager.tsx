import { useEffect, useState } from "react";
import { Select, appEvents, useApi } from "@liratek/ui";
import { DataTable, TextInput } from "@liratek/ui";
import PasswordInput from "@/shared/components/PasswordInput";
import { validatePassword } from "@/shared/utils/validatePassword";
import { messageFrom } from "@/api/apiError";

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
  }, []);

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
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex items-center gap-2">
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
        <Select
          value={newRole}
          onChange={(value) => setNewRole(value as "admin" | "staff")}
          options={[
            { value: "staff", label: "Staff" },
            { value: "admin", label: "Admin" },
          ]}
          ringColor="ring-violet-500"
          buttonClassName="bg-slate-800 px-2 py-1"
        />
        <button
          onClick={createUser}
          disabled={creating}
          className="px-3 py-1 bg-violet-600 rounded text-white disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </div>

      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <DataTable
          columns={[
            "Username",
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
          renderRow={(u) => (
            <tr key={u.id} className="border-t border-slate-800">
              <td className="p-2">{u.username}</td>
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
              </td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}
