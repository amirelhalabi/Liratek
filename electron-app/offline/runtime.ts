/**
 * LIRA-306 — what the `offline:*` handlers and the recorder need from the
 * running app. main.ts builds it at boot (after the boot decision) and sets
 * it here; nothing is read at import time, so loading the handlers in the
 * channel-policy guard (no Electron, no userData) does nothing.
 */
import type { BootDecision } from "./bootDecision";
import type { PairingStore } from "./pairingStore";
import type { FetchLike, SyncClient } from "./syncClient";

export interface OfflineRuntime {
  /** the mode this process booted into (a mode change relaunches) */
  decision: BootDecision;
  store: PairingStore;
  sync: Pick<SyncClient, "unreachableSeconds" | "isReachable" | "kick"> | null;
  /** the API address a first pairing uses when the form gives none */
  defaultServerUrl: string;
  /** the shop's web app address (system browser, O-new-16) */
  webAppUrl: (shopSlug: string) => string;
  fetch: FetchLike;
  /** epoch ms */
  now: () => number;
  /** events in the outbox not yet sent */
  pendingCount: () => number;
  hasWorkingCopy: () => boolean;
  copyAgeSeconds: () => number | null;
  /** checks an active admin's password against the open copy's users */
  verifyLocalAdmin: (username: string, password: string) => boolean;
  /** any copy / working copy of the shop on this PC */
  hasShopData: () => boolean;
  /** delete the copies after unpairing (never the working copy) */
  removeShopData: () => void;
  /** app.relaunch() + app.exit(0) — after the reply is sent */
  relaunch: () => void;
  openExternal: (url: string) => Promise<void>;
  installUpdate: () => Promise<{ success: boolean; error?: string }>;
  /** T136: start offline mode (creates the working copy) */
  goOffline?: () => Promise<{
    success: boolean;
    error?: string;
    code?: string;
  }>;
  /** T136: finish (upload, manifest, keep the working copy as finished) */
  backToWeb?: () => Promise<{
    success: boolean;
    error?: string;
    code?: string;
  }>;
  /** T136: upload now */
  sendNow?: () => Promise<{ sent: number; waiting: number }>;
}

let current: OfflineRuntime | null = null;

export function setOfflineRuntime(rt: OfflineRuntime | null): void {
  current = rt;
}

export function getOfflineRuntime(): OfflineRuntime | null {
  return current;
}
