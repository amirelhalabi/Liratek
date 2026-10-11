/**
 * LIRA-306 — what the updater may do in each desktop mode (R9; old O11 kept).
 *
 *   standalone       today's behaviour: setting-gated automatic check, the
 *                    user downloads/installs from Settings
 *   standby/blocked  check AND download automatically; install only when
 *                    someone presses the button (never on quit — a PC could
 *                    restart into a version the server does not run yet)
 *   offline/finishing  nothing: an update mid-outage could change a form
 *                    while events still wait (O-new-26)
 */
import type { OfflineMode } from "./bootDecision";

export interface UpdatePolicy {
  autoCheck: boolean;
  autoDownload: boolean;
  installOnButton: boolean;
  installOnQuit: boolean;
}

export function updatePolicy(mode: OfflineMode): UpdatePolicy {
  switch (mode) {
    case "standalone":
      return {
        autoCheck: true,
        autoDownload: false,
        installOnButton: true,
        installOnQuit: true,
      };
    case "standby":
    case "blocked":
      return {
        autoCheck: true,
        autoDownload: true,
        installOnButton: true,
        installOnQuit: false,
      };
    case "offline":
    case "finishing":
      return {
        autoCheck: false,
        autoDownload: false,
        installOnButton: false,
        installOnQuit: false,
      };
  }
}
