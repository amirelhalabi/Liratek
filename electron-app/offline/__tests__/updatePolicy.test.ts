/**
 * LIRA-306 T120 — app updates by mode (R9, old O11 kept): standby/blocked
 * download automatically and install only when someone presses the button;
 * offline/finishing never touch updates (a mid-outage update could change a
 * form while events wait — O-new-26). Standalone keeps today's behaviour.
 */
import { updatePolicy } from "../updatePolicy";

describe("updatePolicy", () => {
  it("standalone: today's automatic check (setting-gated), unchanged", () => {
    expect(updatePolicy("standalone")).toEqual({
      autoCheck: true,
      autoDownload: false,
      installOnButton: true,
      installOnQuit: true,
    });
  });
  it.each(["standby", "blocked"] as const)(
    "%s: download automatically, install on the button only",
    (m) => {
      expect(updatePolicy(m)).toEqual({
        autoCheck: true,
        autoDownload: true,
        installOnButton: true,
        installOnQuit: false,
      });
    },
  );
  it.each(["offline", "finishing"] as const)(
    "%s: no update activity at all",
    (m) => {
      expect(updatePolicy(m)).toEqual({
        autoCheck: false,
        autoDownload: false,
        installOnButton: false,
        installOnQuit: false,
      });
    },
  );
});
