import { useEffect, useState } from "react";
import { appEvents, useApi, type UINotification } from "@liratek/ui";
import { LogOut, Bell, X, Home, Sun, Moon } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useShopName } from "@/hooks/useShopName";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";
import { CustomerSessionButton } from "@/features/sessions/components/CustomerSessionButton";
import { VoiceBotButton } from "@/components/VoiceBotButton";
import { useTheme } from "@/contexts/ThemeContext";
import { useOnlineStatus } from "@/shared/hooks/useOnlineStatus";
import { useVoiceBotSettings } from "@/hooks/useVoiceBotSettings";
import { useSession } from "@/features/sessions/context/SessionContext";
import { arePhoneNumbersEqual } from "@/utils/phoneNumber";
import logger from "@/utils/logger";

interface TopBarProps {
  showHomeButton?: boolean;
  showShopName?: boolean;
}

function NotificationHistory() {
  const [items, setItems] = useState<UINotification[]>(
    () => window.notificationHistory || [],
  );
  const [filter, setFilter] = useState<
    "all" | "error" | "warning" | "info" | "success"
  >("all");
  useEffect(() => {
    const off = appEvents.on("notification:history", (h: UINotification[]) =>
      setItems(h || []),
    );
    return () => off();
  }, []);
  const filtered = useMemo(
    () =>
      filter === "all"
        ? items
        : items.filter((i: UINotification) => i.type === filter),
    [items, filter],
  );
  return (
    <div>
      <div className="flex items-center gap-1 p-2 border-b border-slate-700 text-xs">
        {["all", "success", "info", "warning", "error"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f as UINotification["type"] | "all")}
            className={`px-2 py-1 rounded ${filter === f ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800"}`}
          >
            {f}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="p-4 text-center text-slate-400 text-sm">
          No notifications
        </div>
      ) : (
        <ul className="divide-y divide-slate-700">
          {filtered
            .slice()
            .reverse()
            .map((n, idx) => (
              <li key={n.id + "_" + idx} className="p-3 text-sm text-slate-200">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${n.type === "success" ? "bg-emerald-500" : n.type === "error" ? "bg-red-500" : n.type === "warning" ? "bg-amber-500" : "bg-blue-500"}`}
                  ></span>
                  <span>{n.message}</span>
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export default function TopBar({
  showHomeButton = false,
  showShopName = false,
}: TopBarProps) {
  const api = useApi();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const shopName = useShopName();
  const { flags } = useFeatureFlags();
  const { config: voiceBotConfig } = useVoiceBotSettings();
  const isOnline = useOnlineStatus();
  const { theme, toggleTheme } = useTheme();
  const { activeSession } = useSession();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(
    () => (window.notificationHistory || []).length,
  );

  // Client debt balance for active session
  const [clientBalance, setClientBalance] = useState<{
    balance_usd: number;
    balance_lbp: number;
  } | null>(null);
  const [clients, setClients] = useState<any[]>([]);

  // Load clients once
  useEffect(() => {
    const load = async () => {
      try {
        const result = await api.getClients();
        setClients(result);
      } catch {
        // ignore
      }
    };
    load();
  }, [api]);

  // Derive matched client ID
  const matchedClientId = (() => {
    if (!activeSession?.customer_phone || clients.length === 0) return null;
    const match = clients.find((c: any) =>
      arePhoneNumbersEqual(c.phone_number, activeSession.customer_phone),
    );
    return match?.id ?? null;
  })();

  // Fetch balance when matched client changes
  useEffect(() => {
    if (!matchedClientId) {
      setClientBalance(null);
      return;
    }
    const fetchBalance = async () => {
      try {
        const result = await window.api.debt.getClientBalance(matchedClientId);
        if (result.success) {
          setClientBalance(result.data ?? null);
        }
      } catch (err) {
        logger.error("Failed to fetch client balance:", err);
      }
    };
    fetchBalance();

    const handler = () => fetchBalance();
    const offSale = appEvents.on("sale:completed", handler);
    const offDebt = appEvents.on("debt:repayment", handler);
    return () => {
      offSale();
      offDebt();
    };
  }, [matchedClientId]);

  const showBalance =
    clientBalance &&
    (clientBalance.balance_usd !== 0 || clientBalance.balance_lbp !== 0);
  const isCredit = clientBalance ? clientBalance.balance_usd < 0 : false;

  // Track notification count changes
  useEffect(() => {
    const off = appEvents.on("notification:history", (h: UINotification[]) =>
      setNotificationCount((h || []).length),
    );
    return () => off();
  }, []);

  // Extended notifications: poll and react to events
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const low = await api.getLowStockProducts();
        if (!mounted) return;
        const settings = await api.getAllSettings();
        const map = new Map(settings.map((s: any) => [s.key_name, s.value]));
        const warnLow =
          Number(map.get("notifications_warn_low_stock") ?? 1) === 1;
        if (warnLow && Array.isArray(low) && low.length > 0)
          appEvents.emit(
            "notification:show",
            `${low.length} products are low on stock`,
            "warning",
          );
        const genLimit = Number(map.get("drawer_limit_general") || 0);
        const omtLimit = Number(map.get("drawer_limit_omt") || 0);
        const balances = await api.getSystemExpectedBalancesDynamic();
        const genUsd = balances?.["General"]?.["USD"] || 0;
        const omtUsd = balances?.["OMT_System"]?.["USD"] || 0;
        const warnDrawer =
          Number(map.get("notifications_warn_drawer_limits") ?? 1) === 1;
        if (warnDrawer && genLimit > 0 && genUsd > genLimit)
          appEvents.emit(
            "notification:show",
            `General Drawer exceeds limit: $${genUsd.toFixed(2)} > $${genLimit.toFixed(2)}`,
            "warning",
          );
        if (warnDrawer && omtLimit > 0 && omtUsd > omtLimit)
          appEvents.emit(
            "notification:show",
            `OMT Drawer exceeds limit: $${omtUsd.toFixed(2)} > $${omtLimit.toFixed(2)}`,
            "warning",
          );
      } catch {
        // Silently ignore notification polling errors
      }
    };
    const offSale = appEvents.on("sale:completed", refresh);
    const offDebt = appEvents.on("debt:repayment", refresh);
    const offInv = appEvents.on("inventory:updated", refresh);
    refresh();
    // Use a fixed poll interval (async IIFE for settings is not worth the complexity)
    const pollMs = 60_000;
    const t = setInterval(refresh, pollMs);
    return () => {
      mounted = false;
      offSale();
      offDebt();
      offInv();
      clearInterval(t);
    };
  }, []);
  return (
    <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-6 relative z-50">
      <div className="flex items-center gap-3 flex-1">
        {/* Home Button (Page View mode) */}
        {showHomeButton && (
          <button
            onClick={() => navigate("/")}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            title="Home"
          >
            <Home size={20} />
          </button>
        )}

        {/* Shop Name (Page View mode) */}
        {showShopName && shopName && (
          <span
            className="text-lg font-bold bg-gradient-to-r from-violet-600 to-indigo-600 dark:from-violet-400 dark:to-indigo-400 bg-clip-text whitespace-nowrap mr-2"
            style={{ WebkitTextFillColor: "transparent" }}
          >
            {shopName}
          </span>
        )}

        {/* Customer Session Button (embedded in topbar) */}
        {flags.customerSessions && (
          <CustomerSessionButton isKnownClient={!!matchedClientId} />
        )}

        {/* Client Debt Balance */}
        {showBalance && (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${isCredit ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}
          >
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
              {isCredit ? "Credit" : "Debt"}
            </span>
            <span
              className={`font-mono text-sm font-bold ${isCredit ? "text-emerald-400" : "text-red-400"}`}
            >
              ${Math.abs(clientBalance!.balance_usd).toFixed(2)}
            </span>
            {clientBalance!.balance_lbp !== 0 && (
              <>
                <span className="text-slate-600">|</span>
                <span
                  className={`font-mono text-sm font-bold ${isCredit ? "text-emerald-400" : "text-red-400"}`}
                >
                  {Math.abs(clientBalance!.balance_lbp).toLocaleString()} LBP
                </span>
              </>
            )}
          </div>
        )}

        {/* Voice Bot Button */}
        {voiceBotConfig.enabled && (
          <div className="relative">
            <VoiceBotButton />
          </div>
        )}
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
        <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400">
          <span
            className={`w-2 h-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-red-500"}`}
          ></span>
          <span>{isOnline ? "Online" : "Offline"}</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className={`p-2 transition-colors relative ${isNotificationsOpen ? "text-white bg-slate-700 rounded-lg" : "text-slate-400 hover:text-white"}`}
          >
            <Bell size={20} />
            {notificationCount > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>
            )}
          </button>

          {/* Notification Panel */}
          {isNotificationsOpen && (
            <div className="absolute right-0 top-full mt-2 w-96 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="p-3 border-b border-slate-700 flex items-center justify-between bg-slate-900/50">
                <h3 className="font-bold text-white text-sm">Notifications</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      window.notificationHistory = [];
                      appEvents.emit("notification:history", []);
                    }}
                    className="text-xs px-2 py-1 bg-slate-700 rounded text-slate-200"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setIsNotificationsOpen(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto p-2">
                <NotificationHistory />
              </div>
            </div>
          )}
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 text-slate-400 hover:text-white transition-colors"
          title={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
        >
          {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        <div className="h-8 w-px bg-slate-700"></div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-white">
              {user?.username || "Admin"}
            </p>
            <p className="text-xs text-slate-400 capitalize">
              {user?.role || "Administrator"}
            </p>
          </div>

          <button
            onClick={() => {
              logout();
            }}
            className="p-2 text-slate-400 hover:text-red-400 transition-colors"
            title="Logout"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}
