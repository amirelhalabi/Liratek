import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazyWithReload } from "@/shared/utils/lazyWithReload";
import { Suspense, useEffect } from "react";
import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SessionProvider } from "@/features/sessions/context/SessionContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { ActiveModuleProvider } from "@/contexts/ActiveModuleContext";
import { MobileServiceItemsProvider } from "@/contexts/MobileServiceItemsContext";
import Login from "@/features/auth/pages/Login";
import Dashboard from "@/features/dashboard/pages/Dashboard";

// Lazy-loaded routes
const ProductList = lazyWithReload(
  () => import("@/features/inventory/pages/Inventory/ProductList"),
);
const PhoneUnits = lazyWithReload(
  () => import("@/features/inventory/pages/PhoneUnits"),
);
const ClientList = lazyWithReload(
  () => import("@/features/clients/pages/Clients/ClientList"),
);
const POS = lazyWithReload(() => import("@/features/sales/pages/POS"));
const Debts = lazyWithReload(() => import("@/features/debts/pages/Debts"));
const Exchange = lazyWithReload(
  () => import("@/features/exchange/pages/Exchange"),
);
const Services = lazyWithReload(
  () => import("@/features/services/pages/Services"),
);
const Recharge = lazyWithReload(
  () => import("@/features/recharge/pages/Recharge"),
);
const Expenses = lazyWithReload(
  () => import("@/features/expenses/pages/Expenses"),
);
const Loto = lazyWithReload(() => import("@/features/loto/pages/Loto"));
const Maintenance = lazyWithReload(
  () => import("@/features/maintenance/pages/Maintenance"),
);
const CustomServices = lazyWithReload(
  () => import("@/features/custom-services/pages/CustomServices"),
);
const Settings = lazyWithReload(
  () => import("@/features/settings/pages/Settings"),
);
const Profits = lazyWithReload(
  () => import("@/features/profits/pages/Profits"),
);
const CheckpointTimeline = lazyWithReload(
  () => import("@/features/closing/pages/CheckpointTimeline"),
);
const SetupWizard = lazyWithReload(
  () => import("@/features/setup/SetupWizard"),
);
const AuditPage = lazyWithReload(
  () => import("@/features/audit/pages/AuditPage"),
);
const CustomerSessions = lazyWithReload(
  () => import("@/features/sessions/pages/CustomerSessions"),
);
const Partners = lazyWithReload(
  () => import("@/features/partners/pages/Partners"),
);
const Suppliers = lazyWithReload(
  () => import("@/features/suppliers/pages/Suppliers"),
);
const Vouchers = lazyWithReload(
  () => import("@/features/vouchers/pages/Vouchers"),
);
// Super-admin control plane (web-only — plan §5). No Electron equivalent.
const Tenants = lazyWithReload(() => import("@/features/admin/pages/Tenants"));
import { ProfitsPasswordGate } from "@/features/profits/components/ProfitsPasswordGate";
import MainLayout from "@/shared/components/layouts/MainLayout";
import { SuperAdminLayout } from "@/features/admin/components/SuperAdminLayout";
import HomeGrid from "@/shared/components/layouts/HomeGrid";
import "@/index.css";
import { ApiProvider } from "@liratek/ui";
import { backendApiAdapter } from "@/api/adapter";
import { FeatureFlagProvider } from "@/contexts/FeatureFlagContext";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { useVoiceBotSettings } from "@/hooks/useVoiceBotSettings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Local IPC calls don't benefit from retry/window-focus refetch
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

// Wrapper for protected routes
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isSetupRequired, user } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        Loading...
      </div>
    );
  }

  if (isSetupRequired) {
    return <Navigate to="/setup" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  // Super admins (web-only, plan §5) have no tenant context: every POS route
  // under MainLayout would 500 fail-closed (repositories throw with no
  // tenant in scope). Defensively redirect into their own realm instead of
  // ever mounting MainLayout for them. An impersonation session carries
  // role "admin" (not "super_admin"), so this never catches it.
  if (user?.role === "super_admin") {
    return <Navigate to="/admin/tenants" replace />;
  }

  return <MainLayout>{children}</MainLayout>;
}

// Wrapper for the super-admin control plane (plan §5) — a separate realm
// from the POS app entirely. Renders a minimal standalone shell, never
// MainLayout. An active impersonation session (even one that somehow carries
// role super_admin) is excluded — /api/admin/* rejects impersonation tokens
// server-side (no re-escalation), so there is nothing useful to show here.
function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user, isImpersonating } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== "super_admin" || isImpersonating) {
    return <Navigate to="/" replace />;
  }

  return <SuperAdminLayout>{children}</SuperAdminLayout>;
}

// Wrapper for admin-only routes (defense-in-depth on top of ProtectedRoute).
// Reuses the same admin check as the rest of the app: useAuth().user?.role.
// Non-admins are redirected home instead of seeing profit/margin data.
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();

  // While auth is resolving (or before login), defer to ProtectedRoute, which
  // handles the loading spinner and login/setup redirects. This avoids a
  // premature "home" redirect for an admin whose session is still restoring.
  if (isLoading || !isAuthenticated) {
    return <ProtectedRoute>{children}</ProtectedRoute>;
  }

  if (user?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <ProtectedRoute>{children}</ProtectedRoute>;
}

/** Renders HomeGrid or Dashboard based on layout mode */
function HomeRoute() {
  const mode = localStorage.getItem("layout_mode") || "left-panel";
  return mode === "page-view" ? <HomeGrid /> : <Dashboard />;
}

/** Fallback loader for Suspense */
function PageLoader() {
  return (
    <div className="min-h-[400px] w-full flex flex-col items-center justify-center gap-4 text-slate-400">
      <div className="w-12 h-12 border-4 border-slate-700 border-t-violet-500 rounded-full animate-spin"></div>
      <p className="text-sm font-medium animate-pulse">Loading experience...</p>
    </div>
  );
}

function AppRoutes() {
  const { isSetupRequired } = useAuth();
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route
          path="/setup"
          element={isSetupRequired ? <SetupWizard /> : <Navigate to="/" />}
        />
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomeRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/products"
          element={
            <ProtectedRoute>
              <ProductList />
            </ProtectedRoute>
          }
        />
        {/* LIRA-143 — the shop-wide IMEI register. Reached from the Inventory
            header, not the sidebar (no nav entry by design). */}
        <Route
          path="/inventory/units"
          element={
            <ProtectedRoute>
              <PhoneUnits />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clients"
          element={
            <ProtectedRoute>
              <ClientList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pos"
          element={
            <ProtectedRoute>
              <POS />
            </ProtectedRoute>
          }
        />
        <Route
          path="/debts"
          element={
            <ProtectedRoute>
              <Debts />
            </ProtectedRoute>
          }
        />
        <Route
          path="/exchange"
          element={
            <ProtectedRoute>
              <Exchange />
            </ProtectedRoute>
          }
        />
        <Route
          path="/omt-whish"
          element={
            <ProtectedRoute>
              <Services />
            </ProtectedRoute>
          }
        />
        {/* LIRA-116: `/services` was the OMT/Whish route until the rename to
            `/omt-whish` (it collided with the `custom_services` module, whose UI
            label is "Services"). Kept as a transitional redirect so old deep links,
            bookmarks and a user mid-session still land on the same page. */}
        <Route
          path="/services"
          element={<Navigate to="/omt-whish" replace />}
        />
        <Route
          path="/recharge"
          element={
            <ProtectedRoute>
              <Recharge />
            </ProtectedRoute>
          }
        />
        <Route
          path="/maintenance"
          element={
            <ProtectedRoute>
              <Maintenance />
            </ProtectedRoute>
          }
        />
        <Route
          path="/custom-services"
          element={
            <ProtectedRoute>
              <CustomServices />
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses"
          element={
            <ProtectedRoute>
              <Expenses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/loto"
          element={
            <ProtectedRoute>
              <Loto />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <AdminRoute>
              <Settings />
            </AdminRoute>
          }
        />
        {/* Profits password gate (PROFITS_GATE_CONTRACT.md): visible to both
            roles now (migration v163) — the per-page password replaces the
            role gate, admin included. ProfitsPasswordGate is imported eagerly
            (not lazy) so it renders instantly; Profits itself stays lazy so
            its heavy chunk only loads after a successful unlock. */}
        <Route
          path="/profits"
          element={
            <ProtectedRoute>
              <ProfitsPasswordGate>
                <Profits />
              </ProfitsPasswordGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkpoint-timeline"
          element={
            <ProtectedRoute>
              <CheckpointTimeline />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute>
              <AuditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-sessions"
          element={
            <ProtectedRoute>
              <CustomerSessions />
            </ProtectedRoute>
          }
        />
        <Route
          path="/partners"
          element={
            <ProtectedRoute>
              <Partners />
            </ProtectedRoute>
          }
        />
        <Route
          path="/suppliers"
          element={
            <ProtectedRoute>
              <Suppliers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vouchers"
          element={
            <ProtectedRoute>
              <Vouchers />
            </ProtectedRoute>
          }
        />
        {/* Super-admin control plane (web-only, plan §5) — its own realm,
            SuperAdminRoute + a minimal shell, never MainLayout/ProtectedRoute. */}
        <Route
          path="/admin/tenants"
          element={
            <SuperAdminRoute>
              <Tenants />
            </SuperAdminRoute>
          }
        />
        {/* Redirect all other paths to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  const { isLoaded } = useVoiceBotSettings();

  // Apply saved UI scale on startup
  useEffect(() => {
    const saved = localStorage.getItem("ui_scale");
    if (saved && window.api?.display?.setZoomFactor) {
      const factor = parseFloat(saved);
      if (factor > 0 && isFinite(factor)) {
        window.api.display.setZoomFactor(factor);
      }
    }
  }, []);

  // Don't render until settings are loaded
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        Loading...
      </div>
    );
  }

  return (
    // ErrorBoundary catches any unhandled render crash and shows a recovery screen
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {/* HashRouter is recommended for Electron to avoid path issues in production */}
          <ApiProvider adapter={backendApiAdapter}>
            <HashRouter>
              <ActiveModuleProvider>
                <AuthProvider>
                  {/* ModuleProvider and FeatureFlagProvider sit BELOW
                    AuthProvider for the same reason CurrencyProvider does
                    (see its comment below): both fetch JWT-gated REST
                    endpoints, so mounting them above AuthProvider meant a
                    cold login fetched before the token existed, cached an
                    empty result and never retried. The visible symptom was a
                    half-empty first render — sidebar showing only Checkpoint
                    Timeline, one drawer card of ten — that a reload fixed.
                    They ALSO need to be here for their auth gate to work at
                    all: useAuth() throws outside AuthProvider. */}
                  <ModuleProvider>
                    <FeatureFlagProvider>
                      {/* Mounted below AuthProvider so the currency load runs
                        with an authenticated session — in web mode
                        GET /api/currencies is JWT-gated, so a boot-time fetch
                        (before login) 401ed, left `currencies` empty, and every
                        amount rendered with its CODE instead of its SYMBOL
                        ("300.00 EUR" instead of "€300.00"). Re-runs when the
                        user logs in (see the auth gate inside CurrencyContext). */}
                      <CurrencyProvider>
                        <SessionProvider>
                          {/* Mounted below AuthProvider so the catalog seed/load
                            runs with an authenticated session (seeding requires
                            admin/staff role) and re-runs when the user logs in. */}
                          <MobileServiceItemsProvider>
                            <AppRoutes />
                          </MobileServiceItemsProvider>
                        </SessionProvider>
                      </CurrencyProvider>
                    </FeatureFlagProvider>
                  </ModuleProvider>
                </AuthProvider>
              </ActiveModuleProvider>
            </HashRouter>
          </ApiProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
