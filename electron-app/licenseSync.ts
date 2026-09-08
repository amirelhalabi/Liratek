/**
 * Desktop licence sync — the ONLY outbound call the desktop app makes.
 *
 * The shape, and why it is this shape:
 *
 * A desktop install owns a LOCAL database and never logs in to the server —
 * its users authenticate against its own `users` table. So it cannot ask
 * "what is my subscription" with a JWT. Instead the owner issues it a licence
 * key, which it presents to `GET /api/subscription/by-key`, and the answer is
 * written into its OWN `tenant_subscriptions` row.
 *
 * That last part is the point. Once the row is up to date, every gate in the
 * app reads it through the same `SubscriptionService` the web transport uses —
 * one implementation of "is this module entitled", not a second copy living in
 * the main process (rules 13/19). Sync is the only thing that is
 * desktop-specific.
 *
 * FAILS OPEN, always. No key, no network, a 404, a 500, a timeout, malformed
 * JSON — every one of them leaves the local row untouched and the app fully
 * usable. That is the owner's decision ("never lock when offline") and it is
 * not a fallback to tidy up later: the server here is a laptop behind a home
 * tunnel, and a shop that cannot sell because the licence server is down is a
 * far worse outcome than a shop trading a month unpaid. The check only ever
 * REMOVES capability when it succeeds and says so explicitly.
 */

import {
  getSettingsService,
  getSubscriptionService,
  getSubscriptionRepository,
  authLogger,
} from "@liratek/core";

/** Where the owner-issued key lives. Settings, not a .env — see below. */
export const LICENSE_KEY_SETTING = "license_key";

/**
 * Which server to ask. A setting too, so a customer can be pointed at a
 * different deployment without a rebuild, and so this works before any
 * hosting decision is final.
 */
export const LICENSE_SERVER_SETTING = "license_server_url";
const DEFAULT_LICENSE_SERVER = "https://www.liratek.shop";

/** Desktop is always tenant 1 — `initFixedTenantContext(1)` at boot. */
const DESKTOP_TENANT_ID = 1;

/** On app start, then on a slow timer (the owner's choice of cadence). */
export const LICENSE_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Short, because nothing waits on this and a hung socket must not linger. */
const REQUEST_TIMEOUT_MS = 8000;

export interface LicenseCheckOutcome {
  /** Did we manage to talk to the server and understand the answer? */
  checked: boolean;
  /** Human-readable, shown in Settings so support can see what happened. */
  detail: string;
}

/**
 * Ask the server about this install and store the answer locally.
 *
 * Returns an outcome rather than throwing: every caller (boot, timer, the
 * Settings "check now" button) wants to carry on regardless.
 */
export async function syncLicense(): Promise<LicenseCheckOutcome> {
  let key: string | undefined;
  let baseUrl = DEFAULT_LICENSE_SERVER;

  try {
    const settings = getSettingsService();
    key = settings.getSettingValue(LICENSE_KEY_SETTING)?.value?.trim();
    const configured = settings
      .getSettingValue(LICENSE_SERVER_SETTING)
      ?.value?.trim();
    if (configured) baseUrl = configured.replace(/\/+$/, "");
  } catch (error) {
    authLogger.warn({ error }, "licence sync: could not read settings");
    return { checked: false, detail: "Could not read local settings" };
  }

  if (!key) {
    // The normal state for every install that predates licensing, including
    // the two paying desktop customers live when this shipped. Unlicensed
    // means unrestricted, on purpose.
    return { checked: false, detail: "No licence key set — no restrictions" };
  }

  let payload: unknown;
  try {
    const response = await fetch(`${baseUrl}/api/subscription/by-key`, {
      headers: { "x-liratek-license-key": key },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Includes 404 "unknown key". A key the server does not recognise must
      // NOT strip the customer's modules: the likeliest causes are a typo and
      // a server restored from an old backup, and both would punish the wrong
      // party.
      authLogger.warn(
        { status: response.status },
        "licence sync: server refused",
      );
      return {
        checked: false,
        detail: `Server returned ${response.status} — keeping current access`,
      };
    }
    payload = await response.json();
  } catch (error) {
    authLogger.info(
      { error },
      "licence sync: server unreachable — keeping current access",
    );
    return { checked: false, detail: "Server unreachable — no changes" };
  }

  const view = readStatus(payload);
  if (!view) {
    authLogger.warn({ payload }, "licence sync: unrecognised response");
    return { checked: false, detail: "Unrecognised server response" };
  }

  try {
    // Write the server's answer into the local row, so every gate in the app
    // reads it through the shared service.
    const repo = getSubscriptionRepository();
    repo.createForTenant(DESKTOP_TENANT_ID);
    repo.update(DESKTOP_TENANT_ID, {
      plan: view.plan,
      status: view.status,
      current_period_end: view.currentPeriodEnd,
      grace_ends_at: view.graceEndsAt,
      entitled_modules:
        view.entitledModules === null
          ? null
          : JSON.stringify(view.entitledModules),
    });
  } catch (error) {
    authLogger.error({ error }, "licence sync: could not store the answer");
    return { checked: false, detail: "Could not save the server's answer" };
  }

  authLogger.info(
    { status: view.status, modules: view.entitledModules?.length ?? "all" },
    "licence synced",
  );
  return {
    checked: true,
    detail:
      view.status === "active"
        ? "Active"
        : view.status === "grace"
          ? `Payment overdue — full access until ${view.graceEndsAt ?? "soon"}`
          : "Read-only — contact support",
  };
}

/**
 * Validate the server's response shape before trusting it.
 *
 * Not paranoia about our own API: this parses a network response, and writing
 * an unvalidated `status` into a column with a CHECK constraint would fail the
 * whole sync at the database instead of here, where it can be logged and
 * ignored.
 */
function readStatus(payload: unknown): {
  plan: string;
  status: "active" | "grace" | "read_only";
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  entitledModules: string[] | null;
} | null {
  if (typeof payload !== "object" || payload === null) return null;
  const envelope = payload as { success?: unknown; data?: unknown };
  if (envelope.success !== true) return null;

  const d = envelope.data as Record<string, unknown> | undefined;
  if (!d) return null;

  const status = d.status;
  if (status !== "active" && status !== "grace" && status !== "read_only") {
    return null;
  }

  const modules = d.entitledModules;
  const entitledModules = Array.isArray(modules)
    ? modules.filter((m): m is string => typeof m === "string")
    : null;

  return {
    plan: typeof d.plan === "string" ? d.plan : "standard",
    status,
    currentPeriodEnd:
      typeof d.currentPeriodEnd === "string" ? d.currentPeriodEnd : null,
    graceEndsAt: typeof d.graceEndsAt === "string" ? d.graceEndsAt : null,
    entitledModules,
  };
}

/**
 * What the local row currently says, for the Settings screen and the module
 * gate. Reads the LOCAL row only — never the network — so it is instant and
 * works offline.
 */
export function localLicenseStatus() {
  try {
    return getSubscriptionService().statusFor(DESKTOP_TENANT_ID);
  } catch (error) {
    authLogger.error({ error }, "could not read the local subscription");
    return null;
  }
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start syncing: once now, then every `LICENSE_REFRESH_INTERVAL_MS`.
 *
 * `unref()` so a pending timer never keeps the process alive on quit — a
 * background licence check must not delay an app closing.
 */
export function startLicenseSync(): void {
  void syncLicense();
  if (timer) clearInterval(timer);
  timer = setInterval(() => void syncLicense(), LICENSE_REFRESH_INTERVAL_MS);
  timer.unref?.();
}

export function stopLicenseSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
