/**
 * LIRA-306 — desktop-only `offline:*` channels (contracts/ipc-offline.md;
 * constitution exception E1, approved at gate G0). Classified `local` in the
 * core channel policy: they run in every mode and are never recorded.
 *
 * Pre-login by design (standby has no signed-in user): status, pair, unpair
 * (admin password unless the PC holds no shop data), go-offline,
 * open-web-app, install-update. back-to-web and send-now need a signed-in
 * user. Every reply is the `{ success, data?, error?, code? }` envelope.
 *
 * Everything the channels touch comes from the runtime main.ts sets at boot
 * (offline/runtime.ts); importing this file does nothing.
 */
import { ipcMain } from "electron";
import { desktopPairSchema, desktopUnpairSchema, logger } from "@liratek/core";
import { getOfflineRuntime, type OfflineRuntime } from "../offline/runtime.js";
import { PairingStoreError } from "../offline/pairingStore.js";
import { isAuthenticated } from "../session.js";

export const OFFLINE_CHANNELS = [
  "offline:status",
  "offline:pair",
  "offline:unpair",
  "offline:go-offline",
  "offline:back-to-web",
  "offline:send-now",
  "offline:open-web-app",
  "offline:install-update",
] as const;

/** "Work offline" appears after this long without the server (O-new-22). */
export const GO_OFFLINE_AFTER_SECONDS = 30;

type Envelope = {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
};

const NOT_WIRED: Envelope = {
  success: false,
  error: "Offline mode is not available in this app",
};

function firstIssue(err: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  const i = err.issues[0];
  return i
    ? `${i.path.map(String).join(".") || "form"}: ${i.message}`
    : "Invalid form";
}

export function offlineStatus(rt: OfflineRuntime | null): Envelope {
  if (!rt) {
    return { success: true, data: { mode: "standalone", paired: false } };
  }
  const p = rt.store.read();
  const mode = rt.decision.mode;
  const unreachableSeconds = rt.sync?.unreachableSeconds() ?? 0;
  const serverReachable = rt.sync?.isReachable() ?? false;
  return {
    success: true,
    data: {
      mode,
      paired: p !== null,
      deviceNo: p?.deviceNo ?? null,
      shopName: p?.shopName ?? null,
      copyAgeSeconds: rt.copyAgeSeconds(),
      copyAgeWarning: rt.decision.copyAgeWarning,
      ready: rt.decision.ready,
      notReadyReason: rt.decision.notReadyReason,
      serverReachable,
      unreachableSeconds,
      canGoOffline:
        mode === "standby" &&
        rt.decision.ready &&
        unreachableSeconds >= GO_OFFLINE_AFTER_SECONDS,
      pendingCount: rt.pendingCount(),
      lastError: p?.lastError ?? null,
      heldItems: p?.heldItems ?? [],
    },
  };
}

async function pair(rt: OfflineRuntime, raw: unknown): Promise<Envelope> {
  const mode = rt.decision.mode;
  if (mode === "offline" || mode === "finishing") {
    return {
      success: false,
      error: "Finish offline work first (Back to the web app), then pair again",
    };
  }
  const v = desktopPairSchema.safeParse(raw);
  if (!v.success) return { success: false, error: firstIssue(v.error) };
  const existing = rt.store.read();
  const serverUrl = (
    v.data.serverUrl ??
    existing?.serverUrl ??
    rt.defaultServerUrl
  ).replace(/\/+$/, "");
  const body = {
    shop: v.data.shop,
    username: v.data.username,
    password: v.data.password,
    deviceName: v.data.deviceName,
    // re-key: this PC's own number, never the form's (FR-001a)
    ...(existing ? { deviceNo: existing.deviceNo } : {}),
  };
  let env: Envelope & {
    data?: {
      deviceKey: string;
      deviceNo: number;
      tenantId: number;
      shopName: string;
      shopSlug: string;
      serverSchemaVersion: number;
    };
  };
  try {
    const res = await rt.fetch(`${serverUrl}/api/offline/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    env = (await res.json()) as typeof env;
  } catch (error) {
    logger.warn({ error }, "offline:pair — server unreachable");
    return {
      success: false,
      error:
        "Cannot reach the LiraTek server — check the internet and try again",
    };
  }
  if (!env.success || !env.data) {
    return {
      success: false,
      error: env.error ?? "Pairing refused",
      ...(env.code ? { code: env.code } : {}),
    };
  }
  const d = env.data;
  try {
    rt.store.savePairing(
      {
        tenantId: d.tenantId,
        shopSlug: d.shopSlug,
        shopName: d.shopName,
        serverUrl,
        deviceNo: d.deviceNo,
        serverSchemaVersion: d.serverSchemaVersion,
      },
      d.deviceKey,
    );
  } catch (error) {
    if (error instanceof PairingStoreError)
      return { success: false, code: error.code, error: error.message };
    throw error;
  }
  logger.info(
    { deviceNo: d.deviceNo, tenantId: d.tenantId, rekey: existing !== null },
    "PC paired",
  );
  if (mode === "standalone") rt.relaunch();
  return {
    success: true,
    data: { deviceNo: d.deviceNo, shopName: d.shopName },
  };
}

function unpair(rt: OfflineRuntime, raw: unknown): Envelope {
  if (!rt.store.read())
    return { success: false, error: "This PC is not paired" };
  if (rt.hasWorkingCopy() || rt.pendingCount() > 0) {
    return {
      success: false,
      error:
        "This PC still has offline work to send — go back to the web app first",
    };
  }
  const v = desktopUnpairSchema.safeParse(raw ?? {});
  if (!v.success) return { success: false, error: firstIssue(v.error) };
  if (rt.hasShopData()) {
    const { username, password } = v.data;
    if (!username || !password || !rt.verifyLocalAdmin(username, password)) {
      return {
        success: false,
        error: "An admin's username and password are needed to unpair this PC",
      };
    }
  }
  rt.store.clear();
  rt.removeShopData();
  logger.info("PC unpaired");
  rt.relaunch();
  return { success: true, data: {} };
}

export function registerOfflineHandlers(): void {
  ipcMain.handle("offline:status", async () => {
    try {
      return offlineStatus(getOfflineRuntime());
    } catch (error) {
      logger.error({ error }, "offline:status failed");
      return { success: false, error: "Status unavailable" };
    }
  });

  ipcMain.handle("offline:pair", async (_e, payload: unknown) => {
    const rt = getOfflineRuntime();
    if (!rt) return NOT_WIRED;
    try {
      return await pair(rt, payload);
    } catch (error) {
      logger.error({ error }, "offline:pair failed");
      return { success: false, error: "Pairing failed" };
    }
  });

  ipcMain.handle("offline:unpair", async (_e, payload: unknown) => {
    const rt = getOfflineRuntime();
    if (!rt) return NOT_WIRED;
    try {
      return unpair(rt, payload);
    } catch (error) {
      logger.error({ error }, "offline:unpair failed");
      return { success: false, error: "Unpairing failed" };
    }
  });

  ipcMain.handle("offline:open-web-app", async () => {
    const rt = getOfflineRuntime();
    const p = rt?.store.read();
    if (!rt || !p)
      return { success: false, error: "This PC is not paired with a shop" };
    try {
      await rt.openExternal(rt.webAppUrl(p.shopSlug));
      return { success: true, data: {} };
    } catch (error) {
      logger.error({ error }, "offline:open-web-app failed");
      return { success: false, error: "Could not open the browser" };
    }
  });

  ipcMain.handle("offline:install-update", async () => {
    const rt = getOfflineRuntime();
    if (!rt) return NOT_WIRED;
    const mode = rt.decision.mode;
    if (mode !== "standby" && mode !== "blocked") {
      return {
        success: false,
        error: "Updates install only on the standby screen",
      };
    }
    try {
      return await rt.installUpdate();
    } catch (error) {
      logger.error({ error }, "offline:install-update failed");
      return { success: false, error: "Update failed" };
    }
  });

  ipcMain.handle("offline:go-offline", async () => {
    const rt = getOfflineRuntime();
    if (!rt?.goOffline) return NOT_WIRED;
    const st = offlineStatus(rt).data as {
      canGoOffline?: boolean;
      ready?: boolean;
    };
    if (rt.decision.mode !== "standby")
      return {
        success: false,
        error: "Offline mode starts from the standby screen",
      };
    if (!st.ready)
      return {
        success: false,
        error: rt.decision.notReadyReason ?? "No usable copy on this PC",
      };
    if (!st.canGoOffline) {
      return {
        success: false,
        error: `The server must be unreachable for ${GO_OFFLINE_AFTER_SECONDS} seconds first`,
      };
    }
    try {
      return await rt.goOffline();
    } catch (error) {
      logger.error({ error }, "offline:go-offline failed");
      return { success: false, error: "Could not start offline mode" };
    }
  });

  ipcMain.handle("offline:back-to-web", async (e) => {
    const rt = getOfflineRuntime();
    if (!rt?.backToWeb) return NOT_WIRED;
    if (!isAuthenticated(e.sender.id))
      return { success: false, error: "Sign in first" };
    if (rt.decision.mode !== "offline")
      return { success: false, error: "This PC is not in offline mode" };
    if (!(rt.sync?.isReachable() ?? false)) {
      return {
        success: false,
        error: "The internet is not back yet — keep working offline",
      };
    }
    try {
      return await rt.backToWeb();
    } catch (error) {
      logger.error({ error }, "offline:back-to-web failed");
      return { success: false, error: "Could not return to the web app" };
    }
  });

  ipcMain.handle("offline:send-now", async (e) => {
    const rt = getOfflineRuntime();
    if (!rt?.sendNow) return NOT_WIRED;
    if (!isAuthenticated(e.sender.id))
      return { success: false, error: "Sign in first" };
    try {
      return { success: true, data: await rt.sendNow() };
    } catch (error) {
      logger.error({ error }, "offline:send-now failed");
      return { success: false, error: "Sending failed" };
    }
  });
}
