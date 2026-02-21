import { useState, useEffect, type ReactNode } from "react";
import LeftPanelLayout from "./LeftPanelLayout";
import HomeViewLayout from "./HomeViewLayout";
import { NotificationCenter, appEvents } from "@liratek/ui";
import { SessionFloatingWindow } from "../../../features/sessions/components/SessionFloatingWindow";
import { MessengerStyleSessionButton } from "../../../features/sessions/components/MessengerStyleSessionButton";

import Closing from "../../../features/closing/pages/Closing";
import Opening from "../../../features/closing/pages/Opening";
import { useAuth } from "../../../features/auth/context/AuthContext";

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

  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [isOpeningModalOpen, setIsOpeningModalOpen] = useState(false);
  const { user, needsOpening, clearOpeningFlag } = useAuth();
  const isAdmin = user?.role === "admin";
  // Expose user id for downstream calls (Closing)
  if (user?.id != null) {
    window.currentUserId = user.id;
  } else {
    delete window.currentUserId;
  }

  // Listen to app-wide events so modals work from anywhere
  useEffect(() => {
    const offClosing = appEvents.on("openClosingModal", () => {
      setIsClosingModalOpen(true);
    });
    const offOpening = appEvents.on("openOpeningModal", () => {
      setIsOpeningModalOpen(true);
    });

    return () => {
      offClosing();
      offOpening();
    };
  }, []);

  // Listen for layout mode changes from ShopConfig
  useEffect(() => {
    const handler = () =>
      setLayoutMode(localStorage.getItem("layout_mode") || "left-panel");
    window.addEventListener("layout-mode-changed", handler);
    return () => window.removeEventListener("layout-mode-changed", handler);
  }, []);

  // Auto-open Opening after login if required
  useEffect(() => {
    if (isAdmin && needsOpening) {
      setIsOpeningModalOpen(true);
    }
  }, [isAdmin, needsOpening]);

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
      {/* Session Components */}
      <MessengerStyleSessionButton />
      <SessionFloatingWindow />
      {isAdmin && isOpeningModalOpen && (
        <Opening
          isOpen={isOpeningModalOpen}
          onClose={() => {
            setIsOpeningModalOpen(false);
            clearOpeningFlag();
          }}
        />
      )}
      {isAdmin && isClosingModalOpen && (
        <Closing
          isOpen={isClosingModalOpen}
          onClose={() => setIsClosingModalOpen(false)}
        />
      )}
    </>
  );
}
