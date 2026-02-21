import { createContext, useContext, type ReactNode } from "react";
import type { ApiAdapter } from "./types";

const ApiContext = createContext<ApiAdapter | null>(null);

export function ApiProvider({
  adapter,
  children,
}: {
  adapter: ApiAdapter;
  children: ReactNode;
}) {
  return <ApiContext.Provider value={adapter}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiAdapter {
  const ctx = useContext(ApiContext);
  if (!ctx) {
    throw new Error("ApiProvider is missing in the component tree");
  }
  return ctx;
}
