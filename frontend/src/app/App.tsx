import {
  HashRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import { SessionProvider } from "@/features/sessions/context/SessionContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { ActiveModuleProvider } from "@/contexts/ActiveModuleContext";
import Login from "@/features/auth/pages/Login";
import Dashboard from "@/features/dashboard/pages/Dashboard";
import SubscriptionGuard from "@/shared/components/SubscriptionGuard";

// Lazy-loaded routes
const ProductList = lazy(
  () => import("@/features/inventory/pages/Inventory/ProductList"),
);
const ClientList = lazy(
  () => import("@/features/clients/pages/Clients/ClientList"),
);
const POS = lazy(() => import("@/features/sales/pages/POS"));
const Debts = lazy(() => import("@/features/debts/pages/Debts"));
const Exchange = lazy(() => import("@/features/exchange/pages/Exchange"));
const Services = lazy(() => import("@/features/services/pages/Services"));
const Recharge = lazy(() => import("@/features/recharge/pages/Recharge"));
const Expenses = lazy(() => import("@/features/expenses/pages/Expenses"));
const Maintenance = lazy(
  () => import("@/features/maintenance/pages/Maintenance"),
);
const CustomServices = lazy(
  () => import("@/features/custom-services/pages/CustomServices"),
);
const Settings = lazy(() => import("@/features/settings/pages/Settings"));
const AdminClients = lazy(
  () => import("@/features/settings/pages/AdminClients"),
);
// const Profits = lazy(() => import("@/features/profits/pages/Profits")); // Unused
const CheckpointTimeline = lazy(
  () => import("@/features/closing/pages/CheckpointTimeline"),
);
const SetupWizard = lazy(() => import("@/features/setup/SetupWizard"));
import MainLayout from "@/shared/components/layouts/MainLayout";
import HomeGrid from "@/shared/components/layouts/HomeGrid";
import "@/index.css";
import { ApiProvider } from "@liratek/ui";
import { backendApiAdapter } from "@/api/adapter";
import { FeatureFlagProvider } from "@/contexts/FeatureFlagContext";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { VoiceBotButton } from "@/components/VoiceBotButton";
import { useVoiceBotSettings } from "@/hooks/useVoiceBotSettings";

// Wrapper for protected routes
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isSetupRequired } = useAuth();

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

  return (
    <SubscriptionGuard allowOffline={true}>
      <MainLayout>{children}</MainLayout>
    </SubscriptionGuard>
  );
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
          path="/services"
          element={
            <ProtectedRoute>
              <Services />
            </ProtectedRoute>
          }
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
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        {/* Admin page - standalone, no auth, no MainLayout */}
        <Route
          path="/admin"
          element={
            <div className="min-h-screen bg-slate-900">
              <AdminClients />
            </div>
          }
        />
        {/* Redirect /admin (no hash) to /#/admin for HashRouter compatibility */}
        <Route
          path="admin"
          element={
            <div className="min-h-screen bg-slate-900">
              <AdminClients />
            </div>
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
        {/* Redirect all other paths to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function VoiceBotWrapper() {
  const { config } = useVoiceBotSettings();
  const location = useLocation();

  // Don't show voice bot on login or admin pages (hash-based routing)
  const hash = location.hash;
  if (hash === "#/login" || hash === "#/admin" || hash === "" || hash === "#") {
    return null;
  }

  return config.enabled ? <VoiceBotButton /> : null;
}

/**
 * Providers that require authentication before fetching data.
 * ModuleProvider, CurrencyProvider, and FeatureFlagProvider all call
 * authenticated API endpoints on mount. Rendering them above AuthProvider
 * causes 401 errors on the login page. This wrapper defers them until
 * the user is authenticated.
 */
function AuthenticatedProviders({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  // Before auth resolves or when not authenticated, render children
  // without the data providers — the login page doesn't need them.
  if (isLoading || !isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <ModuleProvider>
      <CurrencyProvider>
        <FeatureFlagProvider>{children}</FeatureFlagProvider>
      </CurrencyProvider>
    </ModuleProvider>
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
      {/* HashRouter is recommended for Electron to avoid path issues in production */}
      <ApiProvider adapter={backendApiAdapter}>
        <HashRouter>
          <ActiveModuleProvider>
            <AuthProvider>
              <AuthenticatedProviders>
                <SessionProvider>
                  <AppRoutes />
                  <VoiceBotWrapper />
                </SessionProvider>
              </AuthenticatedProviders>
            </AuthProvider>
          </ActiveModuleProvider>
        </HashRouter>
      </ApiProvider>
    </ErrorBoundary>
  );
}

export default App;
