import { createContext, useContext, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

const routeToModule: Record<string, string> = {
  "/pos": "pos",
  "/debts": "debts",
  "/products": "inventory",
  "/clients": "clients",
  "/exchange": "exchange",
  "/services": "omt_whish",
  "/recharge": "recharge",
  "/expenses": "expenses",
  "/maintenance": "maintenance",
  "/custom-services": "custom_services",
  "/profits": "profits",
  "/checkpoint-timeline": "checkpoint_timeline",
  "/settings": "settings",
};

interface ActiveModuleContextType {
  activeModule: string | null;
}

const ActiveModuleContext = createContext<ActiveModuleContextType | undefined>(
  undefined,
);

export function ActiveModuleProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const activeModule = routeToModule[location.pathname] ?? null;

  return (
    <ActiveModuleContext.Provider value={{ activeModule }}>
      {children}
    </ActiveModuleContext.Provider>
  );
}

export function useActiveModule() {
  const context = useContext(ActiveModuleContext);
  if (context === undefined) {
    throw new Error(
      "useActiveModule must be used within an ActiveModuleProvider",
    );
  }
  return context;
}
