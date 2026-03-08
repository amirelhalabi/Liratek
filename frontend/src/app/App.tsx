import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import { SessionProvider } from "@/features/sessions/context/SessionContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import Login from "@/features/auth/pages/Login";
import Dashboard from "@/features/dashboard/pages/Dashboard";

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
const Reports = lazy(() => import("@/features/reports/pages/Reports"));
const TransactionHistory = lazy(
  () => import("@/features/transactions/pages/TransactionHistory"),
);
const Profits = lazy(() => import("@/features/profits/pages/Profits"));
const SetupWizard = lazy(() => import("@/features/setup/SetupWizard"));
import MainLayout from "@/shared/components/layouts/MainLayout";
import HomeGrid from "@/shared/components/layouts/HomeGrid";
import "@/index.css";
import { ApiProvider } from "@liratek/ui";
import { backendApiAdapter } from "@/api/adapter";
import { FeatureFlagProvider } from "@/contexts/FeatureFlagContext";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";

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

  return <MainLayout>{children}</MainLayout>;
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
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/transactions"
          element={
            <ProtectedRoute>
              <TransactionHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profits"
          element={
            <ProtectedRoute>
              <Profits />
            </ProtectedRoute>
          }
        />
        {/* Redirect all other paths to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function App() {
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

  return (
    // ErrorBoundary catches any unhandled render crash and shows a recovery screen
    <ErrorBoundary>
      {/* HashRouter is recommended for Electron to avoid path issues in production */}
      <ApiProvider adapter={backendApiAdapter}>
        <ModuleProvider>
          <CurrencyProvider>
            <FeatureFlagProvider>
              <HashRouter>
                <AuthProvider>
                  <SessionProvider>
                    <AppRoutes />
                  </SessionProvider>
                </AuthProvider>
              </HashRouter>
            </FeatureFlagProvider>
          </CurrencyProvider>
        </ModuleProvider>
      </ApiProvider>
    </ErrorBoundary>
  );
}

export default App;
