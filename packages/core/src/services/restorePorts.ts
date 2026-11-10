/**
 * LIRA-377 shop restore — the file-level ports `ShopRestoreService` drives.
 * Pure types, zero imports (rule 29): the implementations live in `backend/`
 * (Node fs + better-sqlite3), core only describes them.
 */

export interface ShopFileSwapArgs {
  tenantId: number;
  /** A candidate file already brought to the current schema by `migrateCandidate`. */
  candidatePath: string;
  /** Root for before-restore copies; the copy lands in `<dir>/<tenantId>/`. */
  beforeCopyDir: string;
  /** UTC stamp for the before-copy file name, supplied by the caller (rule 27). */
  stampUtc: string;
}

export interface ShopFileSwapResult {
  beforeCopyPath: string;
}

export interface ShopFilePort {
  /** Brings a candidate shop file to the current schema, by path, before any swap. */
  migrateCandidate(candidatePath: string): Promise<void>;
  /** Copies the candidate into the live shop file; the live file is unchanged on failure. */
  swap(args: ShopFileSwapArgs): Promise<ShopFileSwapResult>;
}

export interface RestoreSourcePort {
  /** Writes the shop's file as at `isoUtc` (null = latest) to `outPath`. */
  fetchAt(tenantId: number, isoUtc: string | null, outPath: string): Promise<void>;
}
