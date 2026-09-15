import { useState, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import LeftPanelLayout from "./LeftPanelLayout";
import HomeViewLayout from "./HomeViewLayout";
import { NotificationCenter, appEvents } from "@liratek/ui";

import CheckpointModal from "@/features/closing/pages/Checkpoint";

import { useAuth } from "@/features/auth/context/AuthContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";
import { ImpersonationBanner } from "@/features/admin/components/ImpersonationBanner";
import { SubscriptionBanner } from "@/shared/components/SubscriptionBanner";

interface MainLayoutProps {
  children: ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation();

  // Cycle BrowserWindow focus on every route change — fixes the Chromium/Windows
  // compositor bug where navigating to a page leaves keyboard input unresponsive.
  useEffect(() => {
    if (navigator.userAgent.includes("Windows")) {
      window.api?.display?.fixFocus?.();
    }
  }, [location.pathname]);

  // The shop app's layouts (LeftPanelLayout, HomeViewLayout) are both
  // `h-screen overflow-hidden` wrapping a `<main overflow-auto>` — the
  // document itself is never meant to scroll, only `<main>` is. Nothing
  // enforced that: there are no `html`/`body` rules anywhere in the app's
  // CSS. A portaled element outside this shell (e.g. the shared `Select`'s
  // option panel, which @headlessui/react appends to <body>) can still make
  // the DOCUMENT scrollable, and focusing it then drags the whole shell
  // sideways — the sidebar and header scroll out of view. Locking
  // `html`/`body` overflow while the shop app is mounted closes that off
  // structurally, regardless of what any individual portaled element does.
  //
  // Scoped to MainLayout, not global: Signup and SuperAdminLayout are both
  // `min-h-screen` with no overflow guard of their own and are mounted
  // OUTSIDE MainLayout (see App.tsx — `/login`/`/signup` are standalone
  // routes, SuperAdminRoute uses SuperAdminLayout, never MainLayout). A
  // blanket html/body rule would make their content unreachable on a short
  // window. Restoring the previous inline value on unmount matters too:
  // logging out unmounts MainLayout and returns to `/login`, which must
  // still be able to scroll.
  useEffect(() => {
    const { documentElement, body } = document;
    const previousHtmlOverflow = documentElement.style.overflow;
    const previousBodyOverflow = body.style.overflow;

    documentElement.style.overflow = "hidden";
    body.style.overflow = "hidden";

    return () => {
      documentElement.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, []);

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
      <ImpersonationBanner />
      <SubscriptionBanner />
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
