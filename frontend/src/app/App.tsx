import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
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
import { ApiProvider, appEvents } from "@liratek/ui";
import { backendApiAdapter } from "../api/adapter";
import { FeatureFlagProvider } from "../contexts/FeatureFlagContext";
import SetupWizard from "../features/setup/SetupWizard";
import { Download, RotateCcw, X } from "lucide-react";

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

/**
 * Persistent update notification bar.
 * Listens for push events from the main process and shows
 * actionable banners when an update is available or downloaded.
 */
function UpdateNotifier() {
  const [state, setState] = useState<
    | { phase: "available"; version: string }
    | { phase: "downloading"; percent: number }
    | { phase: "ready"; version: string }
    | null
  >(null);
  const [dismissed, setDismissed] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  useEffect(() => {
    // Fetch current app version so we can filter same-version "updates"
    window.api?.updater
      ?.getStatus?.()
      .then((s: any) => {
        if (s?.version) setCurrentVersion(s.version);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const updater = window.api?.updater;
    if (!updater?.onUpdateAvailable) return;

    const unsubs: (() => void)[] = [];

    unsubs.push(
      updater.onUpdateAvailable((_e, info) => {
        // Skip if the "update" version matches our current version
        if (currentVersion && info.version === currentVersion) return;
        setState({ phase: "available", version: info.version });
        setDismissed(false);
        appEvents.emit(
          "notification:show",
          `Update available: v${info.version}`,
          "info",
          8000,
        );
      }),
    );

    unsubs.push(
      updater.onDownloadProgress((_e, progress) => {
        setState({
          phase: "downloading",
          percent: Math.round(progress.percent),
        });
      }),
    );

    unsubs.push(
      updater.onUpdateDownloaded((_e, info) => {
        setState({ phase: "ready", version: info.version });
        setDismissed(false);
        appEvents.emit(
          "notification:show",
          `Update v${info.version} ready to install`,
          "success",
          8000,
        );
      }),
    );

    unsubs.push(
      updater.onError((_e, message) => {
        // Only show error notification, don't change state bar
        appEvents.emit(
          "notification:show",
          `Update error: ${message}`,
          "error",
        );
      }),
    );

    return () => unsubs.forEach((fn) => fn());
  }, [currentVersion]);

  const handleDownload = useCallback(async () => {
    // Immediately show downloading state — progress events may be sparse
    setState({ phase: "downloading", percent: 0 });
    try {
      const res = await window.api.updater.download();
      if (!res.success) {
        // Download failed — revert to available state if we still have version info
        setState((prev) =>
          prev?.phase === "downloading"
            ? { phase: "available", version: "unknown" }
            : prev,
        );
        appEvents.emit(
          "notification:show",
          res.error || "Download failed",
          "error",
        );
      }
    } catch (e) {
      setState((prev) =>
        prev?.phase === "downloading"
          ? { phase: "available", version: "unknown" }
          : prev,
      );
      appEvents.emit(
        "notification:show",
        e instanceof Error ? e.message : "Download failed",
        "error",
      );
    }
  }, []);

  const handleInstall = useCallback(async () => {
    try {
      await window.api.updater.quitAndInstall();
    } catch {
      appEvents.emit("notification:show", "Install failed", "error");
    }
  }, []);

  if (!state || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[999] flex items-center justify-center gap-3 px-4 py-2 bg-violet-600 text-white text-sm shadow-lg">
      {state.phase === "available" && (
        <>
          <span>Update available: v{state.version}</span>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-medium transition-colors"
          >
            <Download size={12} />
            Download
          </button>
        </>
      )}
      {state.phase === "downloading" && (
        <>
          <span>
            Downloading update... {state.percent > 0 ? `${state.percent}%` : ""}
          </span>
          <div className="w-32 h-1.5 bg-white/20 rounded-full overflow-hidden">
            {state.percent > 0 ? (
              <div
                className="h-full bg-white rounded-full transition-all duration-300"
                style={{ width: `${state.percent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 bg-white/60 rounded-full animate-pulse" />
            )}
          </div>
        </>
      )}
      {state.phase === "ready" && (
        <>
          <span>Update v{state.version} ready to install</span>
          <button
            onClick={handleInstall}
            className="flex items-center gap-1 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-medium transition-colors"
          >
            <RotateCcw size={12} />
            Restart Now
          </button>
        </>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="ml-2 text-white/70 hover:text-white transition-colors"
      >
        <X size={14} />
      </button>
    </div>
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
    // HashRouter is recommended for Electron to avoid path issues in production
    <ApiProvider adapter={backendApiAdapter}>
      <UpdateNotifier />
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
