/**
 * LIRA-306 T117/T118 — pairing.json (data-model "PC files"). The device key
 * is stored only encrypted by Electron's safeStorage (DPAPI on Windows); when
 * encryption is unavailable the PC refuses to pair rather than writing the
 * key in plain text (O-impl-E-3). Writes are atomic (temp file + rename) so a
 * power cut never leaves half a file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PairingStore, type SafeStorageLike } from "../pairingStore";

const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from(`enc:${s}`, "utf8"),
  decryptString: (b: Buffer) => {
    const s = b.toString("utf8");
    if (!s.startsWith("enc:")) throw new Error("bad");
    return s.slice(4);
  },
});

const KEY = `ltd_7_abcdef012345_${"a".repeat(64)}`;
const PAIRED = {
  tenantId: 7,
  shopSlug: "cornertech",
  shopName: "Corner Tech",
  serverUrl: "https://api.liratek.shop",
  deviceNo: 3,
  serverSchemaVersion: 210,
};

let dir = "";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lira306-pairing-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("PairingStore", () => {
  it("is empty when never paired", () => {
    const s = new PairingStore(dir, { safeStorage: fakeSafe() });
    expect(s.read()).toBeNull();
    expect(s.deviceKey()).toBeNull();
    expect(s.isPaired()).toBe(false);
  });

  it("saves a pairing with the key encrypted, never in plain text", () => {
    const s = new PairingStore(dir, { safeStorage: fakeSafe() });
    s.savePairing(PAIRED, KEY);
    const raw = fs.readFileSync(path.join(dir, "pairing.json"), "utf8");
    expect(raw).not.toContain(KEY);
    expect(s.deviceKey()).toBe(KEY);
    expect(s.read()).toMatchObject({
      ...PAIRED,
      mode: "standby",
      lastSeq: 0,
      lastUsedIds: {},
      lastPeriod: null,
    });
  });

  it("refuses to pair when safeStorage encryption is unavailable (no plain-text fallback)", () => {
    const s = new PairingStore(dir, { safeStorage: fakeSafe(false) });
    expect(() => s.savePairing(PAIRED, KEY)).toThrow(/encrypt/i);
    expect(fs.existsSync(path.join(dir, "pairing.json"))).toBe(false);
  });

  it("re-pairing (new key, same PC number) keeps sequence and counters (FR-001a, O-new-25)", () => {
    const s = new PairingStore(dir, { safeStorage: fakeSafe() });
    s.savePairing(PAIRED, KEY);
    s.update({ lastSeq: 41, lastUsedIds: { sales: 12 }, mode: "offline" });
    const KEY2 = KEY.replace("abcdef012345", "0123456789ab");
    s.savePairing(PAIRED, KEY2);
    expect(s.deviceKey()).toBe(KEY2);
    expect(s.read()).toMatchObject({
      lastSeq: 41,
      lastUsedIds: { sales: 12 },
      mode: "offline",
      deviceNo: 3,
    });
  });

  it("update merges and writes atomically (no temp file left)", () => {
    const s = new PairingStore(dir, { safeStorage: fakeSafe() });
    s.savePairing(PAIRED, KEY);
    s.update({ serverMaxSeq: 9 });
    expect(s.read()?.serverMaxSeq).toBe(9);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("a corrupt file reads as not paired, and is never thrown at boot", () => {
    fs.writeFileSync(path.join(dir, "pairing.json"), "{not json");
    const s = new PairingStore(dir, { safeStorage: fakeSafe() });
    expect(s.read()).toBeNull();
  });

  it("clear() removes the pairing", () => {
    const s = new PairingStore(dir, { safeStorage: fakeSafe() });
    s.savePairing(PAIRED, KEY);
    s.clear();
    expect(s.read()).toBeNull();
  });
});
