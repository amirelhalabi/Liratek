import { useState, useEffect, type ReactNode } from "react";
import LeftPanelLayout from "./LeftPanelLayout";
import HomeViewLayout from "./HomeViewLayout";
import { NotificationCenter, appEvents } from "@liratek/ui";

import CheckpointModal from "@/features/closing/pages/Checkpoint";

import { useAuth } from "@/features/auth/context/AuthContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";

interface MainLayoutProps {
  children: ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [layoutMode, setLayoutMode] = useState(
    () => localStorage.getItem("layout_mode") || "left-panel",
  );

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem("sidebar_collapsed") === "true";
  });

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const newState = !prev;
      localStorage.setItem("sidebar_collapsed", String(newState));
      return newState;
    });
  };

  const [checkpointDrawer, setCheckpointDrawer] = useState<string | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { flags } = useFeatureFlags();
  // Expose user id for downstream calls (Closing)
  if (user?.id != null) {
    window.currentUserId = user.id;
  } else {
    delete window.currentUserId;
  }

  // Listen to app-wide events so modals work from anywhere
  // Only open if the feature flag is enabled
  useEffect(() => {
    const offCheckpoint = appEvents.on(
      "checkpoint:open",
      (...args: unknown[]) => {
        const payload = args[0] as { drawerName?: string } | undefined;
        if (flags.sessionManagement && payload?.drawerName) {
          setCheckpointDrawer(payload.drawerName);
        }
      },
    );

    return () => {
      offCheckpoint();
    };
  }, [flags.sessionManagement]);

  // Listen for layout mode changes from ShopConfig
  useEffect(() => {
    const handler = () =>
      setLayoutMode(localStorage.getItem("layout_mode") || "left-panel");
    window.addEventListener("layout-mode-changed", handler);
    return () => window.removeEventListener("layout-mode-changed", handler);
  }, []);

  // Auto-open Checkpoint after login if opening is required — only when session management is enabled

  const layoutContent =
    layoutMode === "page-view" ? (
      <HomeViewLayout>{children}</HomeViewLayout>
    ) : (
      <LeftPanelLayout
        isSidebarCollapsed={isSidebarCollapsed}
        toggleSidebar={toggleSidebar}
      >
        {children}
      </LeftPanelLayout>
    );

  return (
    <>
      {layoutContent}
      <NotificationCenter />
      {/* Per-drawer Checkpoint Modal */}
      {isAdmin && checkpointDrawer != null && (
        <CheckpointModal
          isOpen={checkpointDrawer != null}
          drawerName={checkpointDrawer}
          onClose={() => setCheckpointDrawer(null)}
        />
      )}
    </>
  );
}
