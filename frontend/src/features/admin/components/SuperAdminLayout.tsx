import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/context/AuthContext";

interface SuperAdminLayoutProps {
  children: ReactNode;
}

/**
 * Minimal standalone shell for the super-admin control plane — deliberately
 * NOT the POS `MainLayout` (its nav/drawer/sidebar are meaningless outside a
 * tenant context, and every one of its data widgets would 500 fail-closed
 * with no tenant in scope).
 */
export function SuperAdminLayout({ children }: SuperAdminLayoutProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-900">
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700/50">
        <span className="text-lg font-bold text-white">LiraTek Admin</span>
        <button
          onClick={handleLogout}
          className="text-sm text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-500 transition-colors"
        >
          Logout
        </button>
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

export default SuperAdminLayout;
