import { useEffect, useState } from "react";
import { Select, useApi } from "@liratek/ui";
import { DataTable, TextInput } from "@liratek/ui";
import PasswordInput from "@/shared/components/PasswordInput";
import { validatePassword } from "@/shared/utils/validatePassword";

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

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.getNonAdminUsers();
      const normalized = rows.map((u: any) => ({
        ...u,
        role: (u.role === "admin" ? "admin" : "staff") as "admin" | "staff",
      }));
      setList(normalized);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (id: number, is_active: number) => {
    await api.setUserActive(id, is_active ? false : true);
    load();
  };

  const changeRole = async (id: number, role: "admin" | "staff") => {
    const newRole = role === "admin" ? "staff" : "admin";
    await api.setUserRole(id, newRole);
    load();
  };

  const createUser = async () => {
    if (!newUsername || !newPassword) {
      alert("Username and password required");
      return;
    }
    const pwResult = validatePassword(newPassword);
    if (!pwResult.valid) {
      alert(pwResult.errors.join("\n"));
      return;
    }
    const res = await api.createUser({
      username: newUsername,
      password: newPassword,
      role: newRole,
    });
    if (!res.success) {
      alert(res.error);
      return;
    }
    setNewUsername("");
    setNewPassword("");
    setNewRole("staff");
    load();
  };

  const setPassword = async (id: number) => {
    const pwd = prompt("Enter new password");
    if (!pwd) return;
    const res = await api.setUserPassword(id, pwd);
    if (!res.success) alert(res.error);
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
          className="px-3 py-1 bg-violet-600 rounded text-white"
        >
          Create
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
