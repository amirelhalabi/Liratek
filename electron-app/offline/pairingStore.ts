/**
 * LIRA-306 — `<userData>/offline/pairing.json` (data-model "PC files").
 *
 * The device key (O-new-8) is kept ONLY encrypted by Electron's `safeStorage`
 * (DPAPI on Windows, Keychain on macOS). When encryption is unavailable the
 * PC refuses to pair rather than storing the key in plain text (O-impl-E-3).
 * Writes go to a temp file and are renamed into place, so a power cut never
 * leaves half a file. A corrupt file reads as "not paired" — boot must never
 * throw on it.
 *
 * Pure of Electron: `safeStorage` is injected (main.ts passes the real one;
 * tests pass a fake), so ts-jest can load this module.
 */
import fs from "node:fs";
import path from "node:path";

export type PairedMode = "standby" | "offline" | "finishing";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface PairingFile {
  tenantId: number;
  shopSlug: string;
  shopName: string;
  serverUrl: string;
  deviceNo: number;
  /** base64 of safeStorage.encryptString(deviceKey) */
  deviceKeyEncrypted: string;
  /** what the next boot should be (a mode change relaunches the app) */
  mode: PairedMode;
  /** highest event sequence this PC ever used (FR-011) */
  lastSeq: number;
  /** per table: the highest offline counter `n` this PC ever used (FR-008a) */
  lastUsedIds: Record<string, number>;
  /** server's data version from the last pair/check-in (FR-007) */
  serverSchemaVersion: number | null;
  /** server's last sequence for this PC (check-in `maxSeq`) */
  serverMaxSeq: number;
  /** server's per-table maximum offline id for this PC (check-in `maxOfflineIds`) */
  serverMaxOfflineIds: Record<string, number>;
  /**
   * The last offline period: when "Back to the web app" finished, and when
   * the server had processed every one of its events (none left "received").
   * Readiness needs a copy built after `settledAt` (FR-008).
   */
  lastPeriod: { finishedAt: string; settledAt: string | null } | null;
  lastSnapshotAt?: string | null;
  copyId?: string | null;
  /** plain words for the standby screen (revoked, SEQ_CONFLICT, …) */
  lastError?: string | null;
  /** server-held items of this PC, from check-in (spec edge case) */
  heldItems?: Array<{ eventId: string; label: string; amount: number | null }>;
}

export interface PairedIdentity {
  tenantId: number;
  shopSlug: string;
  shopName: string;
  serverUrl: string;
  deviceNo: number;
  serverSchemaVersion: number;
}

export class PairingStoreError extends Error {
  constructor(
    message: string,
    readonly code: "ENCRYPTION_UNAVAILABLE",
  ) {
    super(message);
    this.name = "PairingStoreError";
  }
}

export const PAIRING_FILE = "pairing.json";

export class PairingStore {
  private readonly file: string;

  constructor(
    private readonly dir: string,
    private readonly deps: { safeStorage: SafeStorageLike },
  ) {
    this.file = path.join(dir, PAIRING_FILE);
  }

  read(): PairingFile | null {
    try {
      if (!fs.existsSync(this.file)) return null;
      const parsed = JSON.parse(
        fs.readFileSync(this.file, "utf8"),
      ) as Partial<PairingFile>;
      if (
        typeof parsed.tenantId !== "number" ||
        typeof parsed.deviceNo !== "number" ||
        typeof parsed.deviceKeyEncrypted !== "string"
      ) {
        return null;
      }
      return {
        lastSeq: 0,
        lastUsedIds: {},
        serverSchemaVersion: null,
        serverMaxSeq: 0,
        serverMaxOfflineIds: {},
        lastPeriod: null,
        mode: "standby",
        ...parsed,
      } as PairingFile;
    } catch {
      return null;
    }
  }

  isPaired(): boolean {
    return this.read() !== null;
  }

  /** The decrypted device key, or null (not paired / cannot decrypt). */
  deviceKey(): string | null {
    const p = this.read();
    if (!p) return null;
    try {
      return this.deps.safeStorage.decryptString(
        Buffer.from(p.deviceKeyEncrypted, "base64"),
      );
    } catch {
      return null;
    }
  }

  /**
   * First pairing or a re-key (same PC number, FR-001a): the identity and key
   * are replaced; sequence, counters, mode and the last period are KEPT so
   * waiting events still fit (O-new-25).
   */
  savePairing(identity: PairedIdentity, deviceKey: string): PairingFile {
    if (!this.deps.safeStorage.isEncryptionAvailable()) {
      throw new PairingStoreError(
        "This PC cannot encrypt the pairing key (Windows protected storage unavailable) — pairing refused",
        "ENCRYPTION_UNAVAILABLE",
      );
    }
    const encrypted = this.deps.safeStorage
      .encryptString(deviceKey)
      .toString("base64");
    const prev = this.read();
    const keep =
      prev &&
      prev.deviceNo === identity.deviceNo &&
      prev.tenantId === identity.tenantId
        ? prev
        : null;
    const next: PairingFile = {
      mode: "standby",
      lastSeq: 0,
      lastUsedIds: {},
      serverMaxSeq: 0,
      serverMaxOfflineIds: {},
      lastPeriod: null,
      ...(keep ?? {}),
      ...identity,
      deviceKeyEncrypted: encrypted,
      lastError: null,
    };
    this.write(next);
    return next;
  }

  update(
    patch: Partial<
      Omit<PairingFile, "deviceKeyEncrypted" | "tenantId" | "deviceNo">
    >,
  ): PairingFile | null {
    const prev = this.read();
    if (!prev) return null;
    const next = { ...prev, ...patch };
    this.write(next);
    return next;
  }

  clear(): void {
    try {
      fs.unlinkSync(this.file);
    } catch {
      // already gone
    }
  }

  private write(p: PairingFile): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(p, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }
}
