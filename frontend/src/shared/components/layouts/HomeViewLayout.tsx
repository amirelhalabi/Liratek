import type { ReactNode } from "react";
import TopBar from "./TopBar";

interface HomeViewLayoutProps {
  children: ReactNode;
}

export default function HomeViewLayout({ children }: HomeViewLayoutProps) {
  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white overflow-hidden">
      <TopBar showHomeButton showShopName />
      <main className="flex-1 overflow-auto p-6 bg-slate-950">{children}</main>
    </div>
  );
}
