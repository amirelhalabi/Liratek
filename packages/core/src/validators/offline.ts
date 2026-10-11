/**
 * LIRA-306 offline desktop fallback — request contracts
 * (specs/306-offline-desktop-fallback/contracts/rest-offline.md). Pure, shared
 * by the backend routes, the desktop recorder/sender and the review page
 * (rule 14). Browser-safe.
 */
import { z } from "zod";
import { OFFLINE_EVENT_STATUSES, OFFLINE_REVIEW_KINDS } from "../offline/reviewKinds.js";

const isoInstant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/, "ISO instant expected")
  .refine((s) => Number.isFinite(Date.parse(s)), "Invalid instant");
const uuid = z.string().uuid();
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD expected");

export const OFFLINE_PC_STATES = ["standby", "blocked", "offline", "finishing"] as const;

/** POST /api/offline/pair — admin signs in on the PC. `deviceNo` re-keys
 *  that existing PC (FR-001a). */
export const pairDeviceSchema = z.object({
  shop: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(500),
  deviceName: z.string().trim().min(1).max(80),
  deviceNo: z.number().int().min(1).max(9006).optional(),
});
export type PairDeviceInput = z.input<typeof pairDeviceSchema>;

/** POST /api/offline/checkin — every ~30 s while online (FR-004). */
export const checkinSchema = z.object({
  state: z.enum(OFFLINE_PC_STATES),
  pendingCount: z.number().int().min(0),
  appVersion: z.string().min(1).max(50),
  schemaVersion: z.number().int().min(0),
  pcClock: isoInstant,
});
export type CheckinInput = z.input<typeof checkinSchema>;

/** One currency's rates as the PC had them (strict — no partial records,
 *  O-new-24). `direction` is `exchange_rates.is_stronger`. */
export const offlineRateSchema = z
  .object({
    sell: z.number().positive(),
    buy: z.number().positive(),
    market: z.number().positive(),
    direction: z.union([z.literal(1), z.literal(-1)]),
  })
  .strict();

export const offlineRatesSchema = z
  .record(z.string().regex(/^[A-Z]{3,4}$/), offlineRateSchema)
  .refine((r) => Object.keys(r).length > 0, "At least one currency rate is required");
export type OfflineRates = z.infer<typeof offlineRatesSchema>;

/** One recorded action (FR-011). */
export const offlineEventSchema = z.object({
  eventId: uuid,
  seq: z.number().int().min(1),
  channel: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()),
  actorUserId: z.number().int().positive(),
  occurredAt: isoInstant,
  clientDay: dayString,
  clientTzOffsetMinutes: z.number().int().min(-720).max(840),
  copyId: uuid,
  schemaShape: z.record(z.string(), z.unknown()),
  rates: offlineRatesSchema,
  created: z.record(z.string(), z.array(z.number().int().positive())),
  dependsOn: z.array(uuid),
});
export type OfflineEventInput = z.input<typeof offlineEventSchema>;
export type OfflineEvent = z.infer<typeof offlineEventSchema>;

/** POST /api/offline/events — 1–100 events per batch. */
export const uploadEventsSchema = z.object({
  appVersion: z.string().min(1).max(50),
  schemaVersion: z.number().int().min(0),
  pcClock: isoInstant,
  events: z.array(offlineEventSchema).min(1).max(100),
});
export type UploadEventsInput = z.input<typeof uploadEventsSchema>;

/** GET /api/offline/snapshot?schemaVersion=n — the PC names its data version
 *  (O-impl-E-1); any difference from the server's is VERSION_MISMATCH (FR-007). */
export const snapshotQuerySchema = z.object({
  schemaVersion: z.coerce.number().int().min(0),
});
export type SnapshotQuery = z.input<typeof snapshotQuerySchema>;

/** Desktop `offline:pair` (IPC only, E1): what the admin types on the PC. The
 *  PC's own `deviceNo` for a re-key comes from `pairing.json`, never the form
 *  (FR-001a); `serverUrl` overrides the built-in API address (tests, staging). */
export const desktopPairSchema = z.object({
  serverUrl: z.string().url().max(200).optional(),
  shop: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(500),
  deviceName: z.string().trim().min(1).max(80),
});
export type DesktopPairInput = z.input<typeof desktopPairSchema>;

/** Desktop `offline:unpair` — admin password, unless the PC holds no shop data. */
export const desktopUnpairSchema = z.object({
  username: z.string().trim().min(1).max(100).optional(),
  password: z.string().min(1).max(500).optional(),
});
export type DesktopUnpairInput = z.input<typeof desktopUnpairSchema>;

/** Desktop `offline:status` data (contracts/ipc-offline.md) — the standby
 *  screen and the offline banner read it. */
export type OfflinePcMode = "standalone" | "standby" | "blocked" | "offline" | "finishing";
export interface OfflineStatusView {
  mode: OfflinePcMode;
  paired: boolean;
  deviceNo?: number | null;
  shopName?: string | null;
  copyAgeSeconds?: number | null;
  copyAgeWarning?: boolean;
  ready?: boolean;
  notReadyReason?: string | null;
  serverReachable?: boolean;
  unreachableSeconds?: number;
  canGoOffline?: boolean;
  pendingCount?: number;
  lastError?: string | null;
  /** this PC's offline items the server holds for review (spec edge case) */
  heldItems?: Array<{ eventId: string; label: string; amount: number | null }>;
}

/** GET /api/offline/events/status?fromSeq=n */
export const eventsStatusQuerySchema = z.object({
  fromSeq: z.coerce.number().int().min(0).optional().transform((v) => v ?? 0),
});

/** POST /api/offline/manifest — N5 cross-check (FR-035, FR-036). */
export const manifestSchema = z.object({
  copyId: uuid,
  tables: z.record(z.string(), z.array(z.number().int().positive())),
  readWrites: z.array(z.object({ channel: z.string().min(1), changes: z.number().int().min(0) })),
});
export type ManifestInput = z.input<typeof manifestSchema>;

// ── Review routes (JWT, admin) ────────────────────────────────────────────

export const reviewListQuerySchema = z.object({
  state: z.enum(["open", "applied", "dismissed", "reviewed"]).optional(),
  kind: z.enum(OFFLINE_REVIEW_KINDS).optional(),
});
export type ReviewListQuery = z.input<typeof reviewListQuerySchema>;

export const reviewIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const reviewDismissSchema = z.object({
  note: z.string().max(500).optional(),
});
export type ReviewDismissInput = z.input<typeof reviewDismissSchema>;

export const offlineHistoryQuerySchema = z.object({
  deviceId: z.coerce.number().int().positive().optional(),
  from: dayString.optional(),
  to: dayString.optional(),
  status: z.enum(OFFLINE_EVENT_STATUSES).optional(),
});
export type OfflineHistoryQuery = z.input<typeof offlineHistoryQuerySchema>;

/** Recorded rates → `exchange_rates`-shaped rows for the replay context. */
export function offlineRatesToRows(rates: OfflineRates): Array<{
  to_code: string;
  market_rate: number;
  buy_rate: number;
  sell_rate: number;
  is_stronger: 1 | -1;
}> {
  return Object.entries(rates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, r]) => ({
      to_code: code,
      market_rate: r.market,
      buy_rate: r.buy,
      sell_rate: r.sell,
      is_stronger: r.direction,
    }));
}
