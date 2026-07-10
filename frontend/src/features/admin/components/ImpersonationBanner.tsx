import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/context/AuthContext";

/**
 * Sticky orange bar rendered app-wide whenever this tab is impersonating a
 * tenant (plan §5). Mounted inside MainLayout so it shows over the
 * impersonated tenant's POS UI on every protected route.
 */
export function ImpersonationBanner() {
  const { isImpersonating, impersonationInfo, logout } = useAuth();
  const navigate = useNavigate();

  if (!isImpersonating || !impersonationInfo) return null;

  const who =
    impersonationInfo.username ??
    (impersonationInfo.tenantId != null
      ? `the tenant admin (tenant #${impersonationInfo.tenantId})`
      : "the tenant admin");
  const tenant = impersonationInfo.tenantName ?? "this tenant";

  const handleDisconnect = async () => {
    // logout() is impersonation-aware: it revokes this session server-side
    // and clears only the impersonation sessionStorage keys — the super
    // admin's own tab (localStorage) is never touched.
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div
      role="status"
      className="sticky top-0 z-[200] flex flex-wrap items-center justify-between gap-3 bg-orange-500 px-4 py-2 text-sm font-medium text-white shadow-md"
    >
      <span>
        You are viewing as <strong>{who}</strong> — {tenant}. Any changes are
        recorded.
      </span>
      <button
        onClick={handleDisconnect}
        className="shrink-0 rounded-lg border border-white/50 px-3 py-1 text-xs font-semibold transition-colors hover:bg-white/10"
      >
        Disconnect
      </button>
    </div>
  );
}

export default ImpersonationBanner;
