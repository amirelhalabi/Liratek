import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "../features/auth/context/AuthContext";
import { SessionProvider } from "../features/sessions/context/SessionContext";
import { ModuleProvider } from "../contexts/ModuleContext";
import { CurrencyProvider } from "../contexts/CurrencyContext";
import Login from "../features/auth/pages/Login";
import Dashboard from "../features/dashboard/pages/Dashboard";
import ProductList from "../features/inventory/pages/Inventory/ProductList";
import ClientList from "../features/clients/pages/Clients/ClientList";
import POS from "../features/sales/pages/POS";
import Debts from "../features/debts/pages/Debts";
import Exchange from "../features/exchange/pages/Exchange";
import Services from "../features/services/pages/Services";
import Recharge from "../features/recharge/pages/Recharge";
import Expenses from "../features/expenses/pages/Expenses";
import Maintenance from "../features/maintenance/pages/Maintenance";
import CustomServices from "../features/custom-services/pages/CustomServices";
import Settings from "../features/settings/pages/Settings";
import Reports from "../features/reports/pages/Reports";
import TransactionHistory from "../features/transactions/pages/TransactionHistory";
import Profits from "../features/profits/pages/Profits";
import MainLayout from "../shared/components/layouts/MainLayout";
import HomeGrid from "../shared/components/layouts/HomeGrid";
import "../index.css";
import { ApiProvider } from "@liratek/ui";
import { backendApiAdapter } from "../api/adapter";
import { FeatureFlagProvider } from "../contexts/FeatureFlagContext";
import SetupWizard from "../features/setup/SetupWizard";

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

function AppRoutes() {
  const { isSetupRequired } = useAuth();
  return (
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
      {/* 404 Redirect */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    // HashRouter is recommended for Electron to avoid path issues in production
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
  );
}

export default App;
