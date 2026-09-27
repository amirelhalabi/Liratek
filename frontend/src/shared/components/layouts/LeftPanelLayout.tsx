import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

interface LeftPanelLayoutProps {
  children: ReactNode;
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Passed through to Sidebar's version label — see MainLayout. */
  onOpenWhatsNew?: () => void;
}

export default function LeftPanelLayout({
  children,
  isSidebarCollapsed,
  toggleSidebar,
  onOpenWhatsNew,
}: LeftPanelLayoutProps) {
  return (
    <div className="flex h-screen bg-slate-900 text-white overflow-hidden">
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        toggleSidebar={toggleSidebar}
        {...(onOpenWhatsNew ? { onOpenWhatsNew } : {})}
      />
      <div className="flex-1 flex flex-col overflow-hidden transition-all duration-300">
        <TopBar />
        <main className="flex-1 overflow-auto bg-slate-950">{children}</main>
      </div>
    </div>
  );
}
