/**
 * `listTenantDatabaseIdsFromDir()` — the shop-id listing contract's
 * filesystem half (§ 12.2/§ 12.3 W3). Real `fs` against real temp
 * directories (this is exactly what the function is for — a mock would only
 * prove the mock was called correctly, not that the filename pattern is
 * right).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listTenantDatabaseIdsFromDir } from "../tenantDirLister.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-tenant-dir-lister-"));
}

function touch(dir: string, name: string): void {
  fs.writeFileSync(path.join(dir, name), "");
}

describe("listTenantDatabaseIdsFromDir", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] for a directory that does not exist yet", () => {
    const missing = path.join(dir, "does-not-exist");
    expect(listTenantDatabaseIdsFromDir(missing)).toEqual([]);
  });

  it("returns [] for an empty directory", () => {
    expect(listTenantDatabaseIdsFromDir(dir)).toEqual([]);
  });

  it("lists ids from files named exactly <positive integer>.db, sorted ascending", () => {
    touch(dir, "5.db");
    touch(dir, "1.db");
    touch(dir, "42.db");

    expect(listTenantDatabaseIdsFromDir(dir)).toEqual([1, 5, 42]);
  });

  it("ignores -wal and -shm sidecar files", () => {
    touch(dir, "1.db");
    touch(dir, "1.db-wal");
    touch(dir, "1.db-shm");

    expect(listTenantDatabaseIdsFromDir(dir)).toEqual([1]);
  });

  it("ignores an archive/ subdirectory entirely (non-recursive read)", () => {
    touch(dir, "1.db");
    const archiveDir = path.join(dir, "archive");
    fs.mkdirSync(archiveDir);
    touch(archiveDir, "2.db"); // an archived tenant file, deliberately not live

    expect(listTenantDatabaseIdsFromDir(dir)).toEqual([1]);
  });

  it("ignores non-.db files, leading-zero names, and .db-suffixed temp/junk names", () => {
    touch(dir, "1.db");
    touch(dir, "0.db"); // not a positive integer
    touch(dir, "01.db"); // leading zero
    touch(dir, "readme.txt");
    touch(dir, "1.db.tmp");
    touch(dir, "1.db-journal");
    touch(dir, "abc.db");
    touch(dir, ".db");

    expect(listTenantDatabaseIdsFromDir(dir)).toEqual([1]);
  });

  it("propagates a real error that is NOT 'directory missing' (e.g. dir is actually a file)", () => {
    const filePath = path.join(dir, "not-a-directory");
    touch(dir, "not-a-directory");

    expect(() => listTenantDatabaseIdsFromDir(filePath)).toThrow();
  });
});
