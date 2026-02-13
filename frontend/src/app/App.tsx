import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "../features/auth/context/AuthContext";
import { SessionProvider } from "../features/sessions/context/SessionContext";
import Login from "../features/auth/pages/Login";
import Dashboard from "../features/dashboard/pages/Dashboard";
import CommissionsDashboard from "../features/dashboard/pages/CommissionsDashboard";
import ProductList from "../features/inventory/pages/Inventory/ProductList";
import ClientList from "../features/clients/pages/Clients/ClientList";
import POS from "../features/sales/pages/POS";
import Debts from "../features/debts/pages/Debts";
import Exchange from "../features/exchange/pages/Exchange";
import Services from "../features/services/pages/Services";
import Recharge from "../features/recharge/pages/Recharge";
import Expenses from "../features/expenses/pages/Expenses";
import Maintenance from "../features/maintenance/pages/Maintenance";
import Settings from "../features/settings/pages/Settings";
import MainLayout from "../shared/components/layouts/MainLayout";
import "../index.css";

// Wrapper for protected routes
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return <MainLayout>{children}</MainLayout>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/commissions"
        element={
          <ProtectedRoute>
            <CommissionsDashboard />
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
      {/* 404 Redirect */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    // HashRouter is recommended for Electron to avoid path issues in production
    <HashRouter>
      <AuthProvider>
        <SessionProvider>
          <AppRoutes />
        </SessionProvider>
      </AuthProvider>
    </HashRouter>
  );
}

export default App;
