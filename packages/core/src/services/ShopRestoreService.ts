/**
 * LIRA-377 — web shop restore (Settings › Backup › Restore): put ONE shop's
 * data back to an earlier moment (Litestream history), to an uploaded backup
 * file, or to the "before restore" copy of an earlier restore (undo).
 *
 * Two steps, both driven by the shop's admin:
 *   prepare  build a CANDIDATE file under the work dir, check it, migrate it,
 *            prepare it (sessions emptied, offline set / secrets / Google
 *            links carried, sequences raised — `ShopRestoreRepository`),
 *            compute the preview, record a `prepared` row;
 *   confirm  same admin, within 15 minutes, typed shop name equal to the
 *            platform `tenants.name` → the backend swap copies the candidate
 *            into the live file → `done`, then (after the swap, research
 *            R10) the audit row, the sign-in directory sync, the owner email
 *            and an offline merge round.
 *
 * Every refusal is a value (`RestoreOutcome`), never a throw, with a code
 * from `contracts/rest.md` and a plain message. Every "now" is the caller's
 * request instant (rule 27): this file never reads the clock.
 *
 * File system work (copies, deletes) happens here like `ShopBackupService`;
 * every SQL statement is in a repository (rule 13). The live swap and the
 * Litestream fetch are ports implemented in `backend/`. Uses `fs`/`path`:
 * exported from `index.ts` only, never `browser.ts` (rule 29).
 */
import fs from "node:fs";
import path from "node:path";
import type { ShopFilePort, RestoreSourcePort } from "./restorePorts.js";
import type {
  ShopRestoreKind,
  ShopRestoreRow,
  ShopRestoresRepository,
} from "../repositories/ShopRestoresRepository.js";
import type { ShopRestoreRepository, RestorePreviewData } from "../repositories/ShopRestoreRepository.js";
import type { SchemaObject, ShopRestoreFileRepository } from "../repositories/ShopRestoreFileRepository.js";
import { getTenantRepository, type TenantEntity } from "../repositories/TenantRepository.js";
import type { CreateAuditLogData } from "../repositories/AuditRepository.js";
import { getEmailOutboxRepository, type EnqueueEmailData } from "../repositories/EmailOutboxRepository.js";
import { getUserRepository } from "../repositories/UserRepository.js";
import { getAuditService } from "./AuditService.js";
import { getSigninDirectoryService } from "./SigninDirectoryService.js";
import { runWithTenant, runWithoutTenant } from "../db/tenantContext.js";
import { MIGRATIONS } from "../db/migrations/index.js";
import { dbLogger } from "../utils/logger.js";

/** `email_outbox.template` of the owner notice (backend `templates/shopRestored.ts`). */
export const SHOP_RESTORED_TEMPLATE = "shop-restored";

/** How far back a time restore (and an undo) may go (owner, 2026-11-10). */
export const RESTORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A prepared restore must be confirmed within this (FR-009 flow). */
export const RESTORE_CONFIRM_WINDOW_MS = 15 * 60 * 1000;
/** Work files no open restore points at are removed after this. */
const ORPHAN_WORK_FILE_MS = 60 * 60 * 1000;
const EMAIL_GIVE_UP_MS = 24 * 60 * 60 * 1000;

export type RestoreRefusalCode =
  | "RESTORE_RUNNING"
  | "OUT_OF_WINDOW"
  | "BEFORE_SHOP_EXISTED"
  | "NO_BACKUP_AT_TIME"
  | "PREPARE_FAILED"
  | "NOT_A_SHOP_FILE"
  | "FILE_DAMAGED"
  | "OTHER_SHOP"
  | "MIXED_SHOPS"
  | "NEWER_VERSION"
  | "UNEXPECTED_SCHEMA_OBJECT"
  | "NAME_MISMATCH"
  | "EXPIRED"
  | "NOT_YOURS"
  | "RESTORE_FAILED";

/** The plain message shown for each code (the frontend may word its own). */
export const RESTORE_REFUSAL_MESSAGES: Readonly<Record<RestoreRefusalCode, string>> = {
  RESTORE_RUNNING: "A restore is already running for this shop",
  OUT_OF_WINDOW: "That moment is outside the time the shop can be restored to",
  BEFORE_SHOP_EXISTED: "The shop did not exist yet at that moment",
  NO_BACKUP_AT_TIME: "No copy of the shop is available for that moment",
  PREPARE_FAILED: "Could not prepare the restore. Nothing was changed.",
  NOT_A_SHOP_FILE: "This is not a LiraTek shop backup file",
  FILE_DAMAGED: "This file is damaged",
  OTHER_SHOP: "This file is from another shop",
  MIXED_SHOPS: "This file contains data of more than one shop",
  NEWER_VERSION: "This file was made by a newer version",
  UNEXPECTED_SCHEMA_OBJECT: "This file contains something a LiraTek backup never contains",
  NAME_MISMATCH: "The shop name you typed does not match",
  EXPIRED: "This restore is no longer available. Prepare it again.",
  NOT_YOURS: "Only the admin who prepared this restore can do this",
  RESTORE_FAILED: "The restore failed. The shop was not changed.",
};

export interface RestoreRefusal {
  ok: false;
  code: RestoreRefusalCode;
  message: string;
  /** OTHER_SHOP only: the shop the file belongs to. */
  shopName?: string;
}
export type RestoreOutcome<T> = { ok: true; data: T } | RestoreRefusal;

/** Thrown by a `RestoreSourcePort` (the Litestream fetch). */
export class RestoreSourceError extends Error {
  constructor(
    /** OUT_OF_WINDOW = "timestamp does not exist"; NO_BACKUP_AT_TIME = "no matching backup files". */
    readonly code: "OUT_OF_WINDOW" | "NO_BACKUP_AT_TIME" | "FAILED",
    message: string,
  ) {
    super(message);
    this.name = "RestoreSourceError";
  }
}

/** A refusal raised inside a pipeline step; caught and turned into a value. */
class Refusal extends Error {
  constructor(
    readonly code: RestoreRefusalCode,
    readonly shopName?: string,
  ) {
    super(code);
  }
}

export interface ShopRestoreDirs {
  /** The live `<id>.db` files. */
  tenantsDir: string;
  /** Uploads and candidates (`*.upload`, `*.candidate`). */
  workDir: string;
  /** Before-restore copies, `<pointsDir>/<tenantId>/before-<stamp>.sqlite`. */
  pointsDir: string;
}

export interface ShopRestorePorts {
  shopFile: ShopFilePort;
  source: RestoreSourcePort;
  dirs: ShopRestoreDirs;
  /** The verbatim `create_db.sql` (the reference schema is built once from it). */
  createDbSql: () => string;
  /** After a successful restore (backend: schedule an offline merge round). */
  afterRestore?: (tenantId: number) => void;
  supportEmail?: () => string;
}

export interface ShopRestoreServiceDeps {
  restores: ShopRestoresRepository;
  candidates: Pick<ShopRestoreRepository, "prepareCandidate" | "previewCandidate">;
  files: ShopRestoreFileRepository;
  ports: ShopRestorePorts;
  /** Platform `tenants` row. Default: `TenantRepository` in platform scope. */
  platformTenant?: (tenantId: number) => TenantEntity | null;
  /** Runs in the shop's scope. Default: `UserRepository.getEmail`. */
  userEmail?: (userId: number) => { email: string | null; email_verified_at: string | null } | null;
  /** Runs in the shop's scope. Default: `AuditService.log`. */
  audit?: (entry: CreateAuditLogData) => void;
  /** Default: `SigninDirectoryService.syncTenant`. */
  syncDirectory?: (tenantId: number, now: string) => void;
  /** Runs in platform scope. Default: `EmailOutboxRepository.enqueue`. */
  enqueueEmail?: (data: EnqueueEmailData) => void;
}

export interface RestoreActor {
  tenantId: number;
  userId: number;
  username: string;
  role: string;
  /** UTC ISO instant of the request (rule 27). */
  now: string;
}

/** The repository's preview passed through unchanged, plus the moment. */
export type RestorePreview = RestorePreviewData & { restoredTo: string };

export interface PreparedRestore {
  restoreId: number;
  expiresAt: string;
  /** The platform name the admin must type to confirm. */
  shopName: string;
  preview: RestorePreview;
}

export interface RestoreBeforeCopy {
  restoreId: number;
  takenAt: string | null;
  byName: string | null;
}

export interface RestorePoints {
  earliest: string;
  latest: string;
  shopName: string;
  beforeCopies: RestoreBeforeCopy[];
  lastRestore: { restoreId: number; restoredTo: string | null; finishedAt: string | null; byName: string | null } | null;
}

export interface ConfirmedRestore {
  restoreId: number;
  restoredTo: string | null;
  beforeCopy: { takenAt: string };
}

export type PrepareInput =
  | { kind: "time"; restoredTo: string; clientTzOffsetMin: number }
  | { kind: "undo"; restoreId: number; clientTzOffsetMin: number };

export interface SweepResult {
  expired: number;
  beforeCopiesDeleted: number;
  workFilesDeleted: number;
}

// =============================================================================
// Pure helpers (no clock: every instant is an argument)
// =============================================================================

/** SQLite `YYYY-MM-DD HH:MM:SS` (UTC) or ISO text → epoch ms (NaN when unparsable). */
function parseUtc(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const sqlite = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(value);
  return Date.parse(sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : value);
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** `20261110T122004Z` — file-name safe. */
function compactStamp(nowIso: string): string {
  return iso(parseUtc(nowIso)).replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** `before-20261110T122004Z.sqlite` → epoch ms. */
function stampOfBeforeCopy(fileName: string): number {
  const m = /^before-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.sqlite$/.exec(fileName);
  return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : Number.NaN;
}

/** `YYYY-MM-DD HH:MM` in the shop's time, from the browser's offset (rule 27). */
export function formatRestoreMoment(isoUtc: string, offsetMin: number | null): string {
  const d = new Date(parseUtc(isoUtc) + (offsetMin ?? 0) * 60_000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function removeQuietly(file: string | null | undefined): void {
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
    for (const suffix of ["-wal", "-shm", "-journal"]) fs.rmSync(`${file}${suffix}`, { force: true });
  } catch (error) {
    dbLogger.warn({ error, file }, "shop restore: could not delete a work file");
  }
}

const SERVER_SCHEMA_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

let candidateSeq = 0;

// =============================================================================
// Service
// =============================================================================

export class ShopRestoreService {
  /** One restore step per shop at a time in this process (R10, one Fly machine). */
  private readonly busy = new Set<number>();
  private referenceSchema: Set<string> | null = null;

  constructor(private readonly deps: ShopRestoreServiceDeps) {}

  // ---- default collaborators -------------------------------------------------

  private platformTenant(tenantId: number): TenantEntity | null {
    return this.deps.platformTenant
      ? this.deps.platformTenant(tenantId)
      : runWithoutTenant(() => getTenantRepository().getById(tenantId));
  }

  private refuse(code: RestoreRefusalCode, shopName?: string): RestoreRefusal {
    const base = RESTORE_REFUSAL_MESSAGES[code];
    return shopName === undefined
      ? { ok: false, code, message: base }
      : { ok: false, code, message: `${base} (${shopName})`, shopName };
  }

  private livePath(tenantId: number): string {
    return path.join(this.deps.ports.dirs.tenantsDir, `${tenantId}.db`);
  }

  private newCandidatePath(actor: RestoreActor): string {
    candidateSeq += 1;
    fs.mkdirSync(this.deps.ports.dirs.workDir, { recursive: true });
    return path.join(
      this.deps.ports.dirs.workDir,
      `${actor.tenantId}-${compactStamp(actor.now)}-${candidateSeq}.candidate`,
    );
  }

  /** Where the route stages an uploaded file (`<workDir>/<tenant>-<stamp>-<n>.upload`). */
  newUploadPath(actor: RestoreActor): string {
    return this.newCandidatePath(actor).replace(/\.candidate$/, ".upload");
  }

  // ---- points ------------------------------------------------------------------

  points(actor: RestoreActor): RestorePoints {
    const tenant = this.platformTenant(actor.tenantId);
    const now = parseUtc(actor.now);
    const created = parseUtc(tenant?.created_at);
    const floor = now - RESTORE_WINDOW_MS;
    const beforeCopies = this.deps.restores
      .listBeforeCopies(actor.tenantId, iso(floor))
      .filter((r) => r.before_copy_path !== null && fs.existsSync(r.before_copy_path))
      .map((r) => ({ restoreId: r.id, takenAt: r.finished_at, byName: r.requested_by_name }));
    const last = this.deps.restores.latestDone(actor.tenantId);
    return {
      earliest: iso(Number.isNaN(created) ? floor : Math.max(floor, created)),
      latest: iso(now),
      shopName: tenant?.name ?? "",
      beforeCopies,
      lastRestore: last
        ? { restoreId: last.id, restoredTo: last.restored_to, finishedAt: last.finished_at, byName: last.requested_by_name }
        : null,
    };
  }

  // ---- prepare -----------------------------------------------------------------

  prepare(actor: RestoreActor, input: PrepareInput): Promise<RestoreOutcome<PreparedRestore>> {
    return this.preparing(actor, null, input.clientTzOffsetMin, async (work, tenant) =>
      input.kind === "time"
        ? this.buildFromTime(actor, tenant, input.restoredTo, work)
        : this.buildFromUndo(actor, input.restoreId, work),
    );
  }

  prepareFile(
    actor: RestoreActor,
    input: { uploadPath: string; clientTzOffsetMin: number },
  ): Promise<RestoreOutcome<PreparedRestore>> {
    return this.preparing(actor, input.uploadPath, input.clientTzOffsetMin, async (work) =>
      this.buildFromFile(actor, input.uploadPath, work),
    );
  }

  /** The shared prepare frame: guards, lock, open-restore check, cleanup on
   * every failure, then preparation + preview + the `prepared` row. */
  private async preparing(
    actor: RestoreActor,
    uploadPath: string | null,
    clientTzOffsetMin: number,
    build: (work: string[], tenant: TenantEntity) => Promise<BuiltCandidate>,
  ): Promise<RestoreOutcome<PreparedRestore>> {
    const work: string[] = uploadPath ? [uploadPath] : [];
    const cleanup = (): void => work.forEach(removeQuietly);

    if (this.busy.has(actor.tenantId)) {
      cleanup();
      return this.refuse("RESTORE_RUNNING");
    }
    this.busy.add(actor.tenantId);
    try {
      const open = this.deps.restores.getOpenForTenant(actor.tenantId);
      if (open) {
        if (open.status === "prepared" && open.requested_by_user_id === actor.userId) {
          // The same admin preparing again replaces their own unconfirmed one.
          this.deps.restores.markExpired(open.id, actor.now);
          removeQuietly(open.candidate_path);
        } else {
          cleanup();
          return this.refuse("RESTORE_RUNNING");
        }
      }
      const tenant = this.platformTenant(actor.tenantId);
      if (!tenant) throw new Error(`shop restore: no platform tenants row for shop ${actor.tenantId}`);

      const built = await build(work, tenant);
      const kind = built.kind;

      const { idFloor } = this.deps.candidates.prepareCandidate({
        candidatePath: built.candidatePath,
        currentPath: this.livePath(actor.tenantId),
        platformTenant: tenant,
      });
      if (built.verifyOwnShopAfterPrepare) {
        const problem = this.deps.files.ownShopProblem(built.candidatePath, actor.tenantId);
        if (problem) {
          dbLogger.warn({ tenantId: actor.tenantId, problem }, "shop restore: before-restore copy holds other rows");
          throw new Refusal("MIXED_SHOPS");
        }
      }
      const preview: RestorePreview = {
        ...this.deps.candidates.previewCandidate({
          candidatePath: built.candidatePath,
          currentPath: this.livePath(actor.tenantId),
          tenantId: actor.tenantId,
          userId: actor.userId,
        }),
        restoredTo: built.restoredTo,
      };
      const row = this.deps.restores.createPrepared({
        targetTenantId: actor.tenantId,
        kind,
        restoredTo: built.restoredTo,
        clientTzOffsetMin,
        requestedByUserId: actor.userId,
        requestedByName: actor.username,
        candidatePath: built.candidatePath,
        previewJson: JSON.stringify(preview),
        idFloorJson: JSON.stringify(idFloor),
        preparedAt: actor.now,
      });
      dbLogger.info({ tenantId: actor.tenantId, restoreId: row.id, kind }, "shop restore prepared");
      return {
        ok: true,
        data: {
          restoreId: row.id,
          expiresAt: iso(parseUtc(actor.now) + RESTORE_CONFIRM_WINDOW_MS),
          shopName: tenant.name,
          preview,
        },
      };
    } catch (error) {
      cleanup();
      if (error instanceof Refusal) return this.refuse(error.code, error.shopName);
      dbLogger.error({ error, tenantId: actor.tenantId }, "shop restore: prepare failed");
      return this.refuse("PREPARE_FAILED");
    } finally {
      this.busy.delete(actor.tenantId);
    }
  }

  private async buildFromTime(actor: RestoreActor, tenant: TenantEntity, restoredTo: string, work: string[]): Promise<BuiltCandidate> {
    const t = parseUtc(restoredTo);
    const now = parseUtc(actor.now);
    if (Number.isNaN(t) || t > now || t < now - RESTORE_WINDOW_MS) throw new Refusal("OUT_OF_WINDOW");
    if (t < parseUtc(tenant.created_at)) throw new Refusal("BEFORE_SHOP_EXISTED");

    const candidatePath = this.newCandidatePath(actor);
    work.push(candidatePath);
    try {
      await this.deps.ports.source.fetchAt(actor.tenantId, iso(t), candidatePath);
    } catch (error) {
      if (!(error instanceof RestoreSourceError)) throw error;
      if (error.code === "NO_BACKUP_AT_TIME") throw new Refusal("NO_BACKUP_AT_TIME");
      if (error.code !== "OUT_OF_WINDOW") throw error;
      // Litestream answers "timestamp does not exist" both BEFORE its kept
      // history and AFTER the shop's last write (research R2). Fetch the
      // latest copy and decide from its own newest write time: if nothing
      // was written after T, the latest copy IS the shop at T (clamp);
      // otherwise T is older than the kept history. `lastWriteAt` may only
      // over-estimate, so a wrong answer can only be a refusal, never a
      // restore to the wrong moment.
      removeQuietly(candidatePath);
      await this.deps.ports.source.fetchAt(actor.tenantId, null, candidatePath);
      const last = parseUtc(this.deps.files.lastWriteAt(candidatePath));
      if (!Number.isNaN(last) && last > t) throw new Refusal("OUT_OF_WINDOW");
      dbLogger.info({ tenantId: actor.tenantId, restoredTo }, "shop restore: moment after the last write — using the latest copy");
    }
    await this.deps.ports.shopFile.migrateCandidate(candidatePath);
    return { kind: "time", candidatePath, restoredTo: iso(t), verifyOwnShopAfterPrepare: false };
  }

  private async buildFromUndo(actor: RestoreActor, restoreId: number, work: string[]): Promise<BuiltCandidate> {
    const source = this.deps.restores.getById(restoreId);
    if (!source || source.target_tenant_id !== actor.tenantId) throw new Refusal("NOT_YOURS");
    if (source.status !== "done" || !source.before_copy_path) throw new Refusal("NO_BACKUP_AT_TIME");
    if (parseUtc(source.finished_at) < parseUtc(actor.now) - RESTORE_WINDOW_MS) throw new Refusal("OUT_OF_WINDOW");
    if (!fs.existsSync(source.before_copy_path)) throw new Refusal("NO_BACKUP_AT_TIME");

    const candidatePath = this.newCandidatePath(actor);
    work.push(candidatePath);
    fs.copyFileSync(source.before_copy_path, candidatePath); // the copy itself is never modified
    this.checkShopFile(candidatePath, actor.tenantId, { ownShopBeforeMigration: false });
    await this.deps.ports.shopFile.migrateCandidate(candidatePath);
    return {
      kind: "undo",
      candidatePath,
      restoredTo: source.finished_at ?? actor.now,
      // A before-copy is the live file itself (sessions, sync plumbing):
      // only the PREPARED candidate must hold nothing but this shop.
      verifyOwnShopAfterPrepare: true,
    };
  }

  private async buildFromFile(actor: RestoreActor, uploadPath: string, work: string[]): Promise<BuiltCandidate> {
    const candidatePath = this.newCandidatePath(actor);
    fs.renameSync(uploadPath, candidatePath); // same work dir
    work.push(candidatePath);
    this.checkShopFile(candidatePath, actor.tenantId, { ownShopBeforeMigration: true });
    // A backup file carries no build-time marker: its newest write is the
    // closest truthful "this file is the shop as at" (before migrating,
    // which may stamp rows).
    const restoredTo = this.deps.files.lastWriteAt(candidatePath) ?? actor.now;
    await this.deps.ports.shopFile.migrateCandidate(candidatePath);
    const unexpected = this.unexpectedObjects(this.deps.files.schemaObjects(candidatePath));
    if (unexpected.length > 0) {
      dbLogger.warn({ tenantId: actor.tenantId, unexpected }, "shop restore: uploaded file has unexpected schema objects");
      throw new Refusal("UNEXPECTED_SCHEMA_OBJECT");
    }
    return { kind: "file", candidatePath, restoredTo, verifyOwnShopAfterPrepare: false };
  }

  /** FR-006 checks before any migration. Throws a `Refusal`. */
  private checkShopFile(filePath: string, tenantId: number, opts: { ownShopBeforeMigration: boolean }): void {
    const files = this.deps.files;
    if (!files.hasSqliteHeader(filePath)) throw new Refusal("NOT_A_SHOP_FILE");
    const facts = files.inspect(filePath);
    if (!facts.openable || facts.integrity !== "ok") {
      dbLogger.warn({ tenantId, integrity: facts.integrity }, "shop restore: file failed the integrity check");
      throw new Refusal("FILE_DAMAGED");
    }
    if (!facts.hasShopTables || facts.tenants.length === 0) throw new Refusal("NOT_A_SHOP_FILE");
    if (facts.tenants.length > 1) throw new Refusal("MIXED_SHOPS");
    const own = facts.tenants[0]!;
    if (own.id !== tenantId) throw new Refusal("OTHER_SHOP", own.name);
    if (facts.maxMigration > SERVER_SCHEMA_VERSION) throw new Refusal("NEWER_VERSION");
    if (opts.ownShopBeforeMigration) {
      const problem = files.ownShopProblem(filePath, tenantId);
      if (problem) {
        dbLogger.warn({ tenantId, problem }, "shop restore: uploaded file holds rows of another shop");
        throw new Refusal("MIXED_SHOPS");
      }
    }
  }

  private unexpectedObjects(objects: SchemaObject[]): SchemaObject[] {
    if (!this.referenceSchema) {
      this.referenceSchema = new Set(
        this.deps.files.buildReferenceSchema(this.deps.ports.createDbSql()).map((o) => `${o.type}:${o.name}`),
      );
    }
    const ref = this.referenceSchema;
    return objects.filter((o) => !ref.has(`${o.type}:${o.name}`));
  }

  // ---- confirm / cancel --------------------------------------------------------

  /** The row the caller may act on, or why not. */
  private ownedPrepared(actor: RestoreActor, restoreId: number): ShopRestoreRow | RestoreRefusal {
    const row = this.deps.restores.getById(restoreId);
    if (!row || row.target_tenant_id !== actor.tenantId || row.requested_by_user_id !== actor.userId) {
      return this.refuse("NOT_YOURS");
    }
    if (row.status !== "prepared") return this.refuse("EXPIRED");
    if (parseUtc(actor.now) - parseUtc(row.prepared_at) > RESTORE_CONFIRM_WINDOW_MS) {
      this.deps.restores.markExpired(row.id, actor.now);
      removeQuietly(row.candidate_path);
      return this.refuse("EXPIRED");
    }
    return row;
  }

  async confirm(
    actor: RestoreActor,
    input: { restoreId: number; typedShopName: string },
  ): Promise<RestoreOutcome<ConfirmedRestore>> {
    if (this.busy.has(actor.tenantId)) return this.refuse("RESTORE_RUNNING");
    this.busy.add(actor.tenantId);
    try {
      const row = this.ownedPrepared(actor, input.restoreId);
      if ("ok" in row) return row;
      const tenant = this.platformTenant(actor.tenantId);
      if (!tenant || input.typedShopName !== tenant.name) return this.refuse("NAME_MISMATCH");

      // Read BEFORE the swap: the admin may not exist in the restored copy.
      const adminEmail = this.safely("admin email", () =>
        runWithTenant(actor.tenantId, () =>
          this.deps.userEmail ? this.deps.userEmail(actor.userId) : getUserRepository().getEmail(actor.userId),
        ),
      );

      if (!this.deps.restores.markRunning(row.id, actor.now)) return this.refuse("EXPIRED");
      let beforeCopyPath: string;
      try {
        ({ beforeCopyPath } = await this.deps.ports.shopFile.swap({
          tenantId: actor.tenantId,
          candidatePath: row.candidate_path ?? "",
          beforeCopyDir: this.deps.ports.dirs.pointsDir,
          stampUtc: compactStamp(actor.now),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.restores.markFailed(row.id, message, actor.now);
        removeQuietly(row.candidate_path);
        dbLogger.error({ error, tenantId: actor.tenantId, restoreId: row.id }, "shop restore: swap failed — shop unchanged");
        return this.refuse("RESTORE_FAILED");
      }
      this.deps.restores.markDone(row.id, { finishedAt: actor.now, beforeCopyPath });
      removeQuietly(row.candidate_path);
      dbLogger.info({ tenantId: actor.tenantId, restoreId: row.id, kind: row.kind }, "shop restored");

      this.afterSwap(actor, row, tenant, adminEmail);
      return {
        ok: true,
        data: { restoreId: row.id, restoredTo: row.restored_to, beforeCopy: { takenAt: actor.now } },
      };
    } finally {
      this.busy.delete(actor.tenantId);
    }
  }

  /** Everything after a successful swap; none of it can fail the restore. */
  private afterSwap(
    actor: RestoreActor,
    row: ShopRestoreRow,
    tenant: TenantEntity,
    adminEmail: { email: string | null; email_verified_at: string | null } | null | undefined,
  ): void {
    const moment = formatRestoreMoment(row.restored_to ?? actor.now, row.client_tz_offset_min);
    const at = formatRestoreMoment(actor.now, row.client_tz_offset_min);

    // Audit into the NEW shop file (written after the swap, R10).
    this.safely("audit", () =>
      runWithTenant(actor.tenantId, () => {
        const entry: CreateAuditLogData = {
          user_id: actor.userId,
          username: actor.username,
          role: actor.role,
          action: "shop_restore",
          entity_type: "shop",
          entity_id: String(actor.tenantId),
          summary: `Shop restored to ${moment}`,
          metadata: { restore_id: row.id, kind: row.kind, restored_to: row.restored_to },
        };
        if (this.deps.audit) this.deps.audit(entry);
        else getAuditService().log(entry);
      }),
    );

    this.safely("signin directory", () => {
      if (this.deps.syncDirectory) this.deps.syncDirectory(actor.tenantId, actor.now);
      else getSigninDirectoryService().syncTenant(actor.tenantId, actor.now);
    });

    const recipients: string[] = [];
    if (tenant.contact_email) recipients.push(tenant.contact_email);
    if (
      adminEmail?.email &&
      adminEmail.email_verified_at &&
      !recipients.some((r) => r.toLowerCase() === adminEmail.email!.toLowerCase())
    ) {
      recipients.push(adminEmail.email);
    }
    const kindText = row.kind === "file" ? "a backup file" : row.kind === "undo" ? "the copy taken before an earlier restore" : "an earlier time";
    for (const to of recipients) {
      this.safely("owner email", () =>
        runWithoutTenant(() => {
          const data: EnqueueEmailData = {
            idempotencyKey: `shop-restored:${actor.tenantId}:${row.id}:${to.toLowerCase()}`,
            template: SHOP_RESTORED_TEMPLATE,
            toEmail: to,
            data: {
              shopName: tenant.name,
              restoredToText: moment,
              restoredAtText: at,
              byName: actor.username,
              kindText,
              supportEmail: this.deps.ports.supportEmail?.() ?? "",
            },
            now: actor.now,
            giveUpAt: iso(parseUtc(actor.now) + EMAIL_GIVE_UP_MS),
          };
          if (this.deps.enqueueEmail) this.deps.enqueueEmail(data);
          else getEmailOutboxRepository().enqueue(data);
        }),
      );
    }

    this.safely("offline merge round", () => this.deps.ports.afterRestore?.(actor.tenantId));
  }

  private safely<T>(what: string, fn: () => T): T | undefined {
    try {
      return fn();
    } catch (error) {
      dbLogger.error({ error, what }, "shop restore: follow-up step failed (the restore itself succeeded)");
      return undefined;
    }
  }

  cancel(actor: RestoreActor, input: { restoreId: number }): RestoreOutcome<{ restoreId: number }> {
    if (this.busy.has(actor.tenantId)) return this.refuse("RESTORE_RUNNING");
    const row = this.ownedPrepared(actor, input.restoreId);
    if ("ok" in row) return row;
    this.deps.restores.markExpired(row.id, actor.now);
    removeQuietly(row.candidate_path);
    return { ok: true, data: { restoreId: row.id } };
  }

  // ---- sweep (T028) ------------------------------------------------------------

  /** Expired candidates, before-copies older than 7 days (the newest per shop
   * always kept), and orphaned work files. `now` comes from the caller. */
  sweep(now: string): SweepResult {
    const nowMs = parseUtc(now);
    const result: SweepResult = { expired: 0, beforeCopiesDeleted: 0, workFilesDeleted: 0 };

    for (const row of this.deps.restores.listPreparedOlderThan(iso(nowMs - RESTORE_CONFIRM_WINDOW_MS))) {
      if (this.busy.has(row.target_tenant_id)) continue;
      if (this.deps.restores.markExpired(row.id, now)) result.expired += 1;
      removeQuietly(row.candidate_path);
    }

    const { pointsDir, workDir } = this.deps.ports.dirs;
    if (fs.existsSync(pointsDir)) {
      for (const shopDir of fs.readdirSync(pointsDir)) {
        if (!/^[1-9]\d*$/.test(shopDir)) continue;
        const dir = path.join(pointsDir, shopDir);
        const copies = fs
          .readdirSync(dir)
          .filter((f) => f.startsWith("before-") && f.endsWith(".sqlite"))
          .map((f) => {
            const stamped = stampOfBeforeCopy(f);
            return { f, at: Number.isNaN(stamped) ? fs.statSync(path.join(dir, f)).mtimeMs : stamped };
          })
          .sort((a, b) => b.at - a.at);
        for (const c of copies.slice(1)) {
          if (c.at < nowMs - RESTORE_WINDOW_MS) {
            removeQuietly(path.join(dir, c.f));
            result.beforeCopiesDeleted += 1;
          }
        }
      }
    }

    if (fs.existsSync(workDir)) {
      const busyShops = new Set(this.busy);
      for (const f of fs.readdirSync(workDir)) {
        const shop = Number(f.split("-")[0]);
        if (busyShops.has(shop)) continue;
        if (this.deps.restores.getOpenForTenant(shop)?.candidate_path === path.join(workDir, f)) continue;
        const full = path.join(workDir, f);
        if (nowMs - fs.statSync(full).mtimeMs > ORPHAN_WORK_FILE_MS) {
          removeQuietly(full);
          result.workFilesDeleted += 1;
        }
      }
    }
    if (result.expired + result.beforeCopiesDeleted + result.workFilesDeleted > 0) {
      dbLogger.info({ ...result }, "shop restore sweep");
    }
    return result;
  }
}

interface BuiltCandidate {
  kind: ShopRestoreKind;
  candidatePath: string;
  restoredTo: string;
  verifyOwnShopAfterPrepare: boolean;
}

// =============================================================================
// Singleton — the ports come from the backend wiring (one Fly process).
// =============================================================================

let instance: ShopRestoreService | null = null;

export function getShopRestoreService(
  build: () => ShopRestoreService,
): ShopRestoreService {
  if (!instance) instance = build();
  return instance;
}

export function resetShopRestoreService(): void {
  instance = null;
}
