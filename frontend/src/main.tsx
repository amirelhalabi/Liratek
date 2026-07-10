import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./app/App";
import { bootstrapImpersonationSession } from "@/features/admin/utils/impersonation";

// Web-only super-admin impersonation handoff: if `?impersonation_token=` is
// present, move it into sessionStorage and strip it from the URL/history
// BEFORE anything else runs — in particular before AuthContext's restore
// effect fires, so the very first auth check already sees the impersonation
// token via httpClient.getToken()'s precedence rule. No-ops (and does
// nothing observable) when the param isn't present, which covers every
// Electron/desktop boot and every normal web login.
bootstrapImpersonationSession();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
