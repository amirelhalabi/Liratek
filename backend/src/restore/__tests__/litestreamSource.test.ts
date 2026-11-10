/**
 * LIRA-377 T030 — `litestreamSource` builds the exact `litestream restore`
 * call `docker-entrypoint.sh` proved on Fly, and maps Litestream's two
 * "no copy" errors to their restore codes. Written FIRST (rule 17). The
 * child process is a fake: no litestream binary is needed.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { RestoreSourceError } from "@liratek/core";
import { createLitestreamSource, type LitestreamSpawn } from "../litestreamSource.js";

const ENV = {
  bucket: "liratek-backups",
  endpoint: "https://acct.r2.cloudflarestorage.com",
  accessKeyId: "AKID",
  secretAccessKey: "SECRET",
};

interface Call {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

function fakeSpawn(result: { code: number; stderr?: string; stdout?: string; writeOut?: boolean }): {
  spawn: LitestreamSpawn;
  calls: Call[];
} {
  const calls: Call[] = [];
  const spawn: LitestreamSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts.env });
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      if (result.writeOut) fs.writeFileSync(args[args.indexOf("-o") + 1]!, "SQLite format 3\u0000");
      if (result.stdout) child.stdout.write(result.stdout);
      if (result.stderr) child.stderr.write(result.stderr);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", result.code);
    });
    return child;
  };
  return { spawn, calls };
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-litestream-src-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("litestreamSource.fetchAt", () => {
  it("restores shop <id> at an RFC3339 UTC timestamp from the tenants replica URL, with the LITESTREAM_* keys as AWS_*", async () => {
    const { spawn, calls } = fakeSpawn({ code: 0, writeOut: true });
    const out = path.join(tmp, "5-x.candidate");
    await createLitestreamSource({ env: ENV, spawn }).fetchAt(5, "2026-11-10T12:00:00.000Z", out);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("litestream");
    expect(calls[0]!.args).toEqual([
      "restore",
      "-o",
      out,
      "-timestamp",
      "2026-11-10T12:00:00Z",
      "s3://liratek-backups/tenants/5.db?endpoint=https://acct.r2.cloudflarestorage.com&region=auto",
    ]);
    expect(calls[0]!.env.AWS_ACCESS_KEY_ID).toBe("AKID");
    expect(calls[0]!.env.AWS_SECRET_ACCESS_KEY).toBe("SECRET");
    expect(fs.existsSync(out)).toBe(true);
  });

  it("null = latest: no -timestamp flag", async () => {
    const { spawn, calls } = fakeSpawn({ code: 0, writeOut: true });
    await createLitestreamSource({ env: ENV, spawn }).fetchAt(1, null, path.join(tmp, "o"));
    expect(calls[0]!.args).not.toContain("-timestamp");
  });

  it.each([
    ["Error: timestamp does not exist\n", "OUT_OF_WINDOW"],
    ["time=… level=ERROR msg=\"failed to run\" error=\"no matching backup files available\"\n", "NO_BACKUP_AT_TIME"],
    ["Error: access denied\n", "FAILED"],
  ])("maps stderr %j to %s and leaves no output file", async (stderr, code) => {
    const { spawn } = fakeSpawn({ code: 1, stderr });
    const out = path.join(tmp, "o");
    const err = await createLitestreamSource({ env: ENV, spawn })
      .fetchAt(1, "2026-11-10T12:00:00.000Z", out)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RestoreSourceError);
    expect((err as RestoreSourceError).code).toBe(code);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("exit 0 without an output file is FAILED", async () => {
    const { spawn } = fakeSpawn({ code: 0 });
    const err = await createLitestreamSource({ env: ENV, spawn })
      .fetchAt(1, null, path.join(tmp, "o"))
      .catch((e: unknown) => e);
    expect((err as RestoreSourceError).code).toBe("FAILED");
  });

  it("not configured: refuses without spawning", async () => {
    const { spawn, calls } = fakeSpawn({ code: 0, writeOut: true });
    const err = await createLitestreamSource({ env: null, spawn })
      .fetchAt(1, null, path.join(tmp, "o"))
      .catch((e: unknown) => e);
    expect((err as RestoreSourceError).code).toBe("FAILED");
    expect(calls).toEqual([]);
  });

  it("a spawn error (binary missing) is FAILED", async () => {
    const spawn: LitestreamSpawn = () => {
      const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;
      setImmediate(() => child.emit("error", new Error("spawn litestream ENOENT")));
      return child;
    };
    const err = await createLitestreamSource({ env: ENV, spawn })
      .fetchAt(1, null, path.join(tmp, "o"))
      .catch((e: unknown) => e);
    expect((err as RestoreSourceError).code).toBe("FAILED");
  });

  it("reads its configuration from LITESTREAM_* env, null when any is missing", async () => {
    const { litestreamEnvFrom } = await import("../litestreamSource.js");
    expect(
      litestreamEnvFrom({
        LITESTREAM_BUCKET: "b",
        LITESTREAM_ENDPOINT: "e",
        LITESTREAM_ACCESS_KEY_ID: "a",
        LITESTREAM_SECRET_ACCESS_KEY: "s",
      }),
    ).toEqual({ bucket: "b", endpoint: "e", accessKeyId: "a", secretAccessKey: "s" });
    expect(litestreamEnvFrom({ LITESTREAM_BUCKET: "b" })).toBeNull();
  });
});
