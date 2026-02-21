import { useEffect, useState, useRef } from "react";
import { Select, useApi } from "@liratek/ui";
import { ExportBar } from "@/shared/components/ExportBar";

export default function UsersManager() {
  const api = useApi();
  const tableRef = useRef<HTMLTableElement>(null);
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
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(newPassword)) {
      alert("Password must be at least 8 chars with upper, lower, and a digit");
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
        <input
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          placeholder="Username"
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white"
        />
        <input
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Password"
          type="password"
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white"
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
        <ExportBar
          exportExcel
          exportPdf
          exportFilename="users"
          tableRef={tableRef}
          rowCount={list.length}
        />
        <table ref={tableRef} className="w-full text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="p-2">Username</th>
              <th className="p-2">Role</th>
              <th className="p-2">Active</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="p-3 text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-3 text-slate-500">
                  No users
                </td>
              </tr>
            ) : (
              list.map((u) => (
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
