/**
 * LIRA-377 T030 — core's `RestoreSourcePort` backed by Litestream: write one
 * shop's file as it was at a moment (or its latest copy) to a work path.
 *
 * The call is the one `docker-entrypoint.sh` proved on Fly for per-shop
 * restores (2026-11-10): restore BY REPLICA URL (a `dir:` entry cannot be
 * resolved by path in 0.5.17), credentials passed as `AWS_*`:
 *
 *   litestream restore -o <out> [-timestamp <RFC3339 UTC>] \
 *     "s3://$LITESTREAM_BUCKET/tenants/<id>.db?endpoint=$LITESTREAM_ENDPOINT&region=auto"
 *
 * Litestream's answers mapped to restore codes (research R2):
 *   "timestamp does not exist"          → OUT_OF_WINDOW (before the kept
 *        history OR after the shop's last write — the SERVICE tells the two
 *        apart and clamps, `ShopRestoreService.buildFromTime`);
 *   "no matching backup files available" → NO_BACKUP_AT_TIME;
 *   anything else                        → FAILED.
 *
 * The child process is injected so the unit test needs no binary. Backend
 * only — never reachable from core's `browser.ts` (rule 29).
 */
import { spawn as nodeSpawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import fs from "node:fs";
import type { Readable } from "node:stream";
import { RestoreSourceError, dbLogger, type RestoreSourcePort } from "@liratek/core";

export interface LitestreamEnv {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type LitestreamChild = EventEmitter & {
  stdout: Readable | null;
  stderr: Readable | null;
  kill: (signal?: NodeJS.Signals) => boolean;
};

export type LitestreamSpawn = (
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv },
) => LitestreamChild;

export interface LitestreamSourceOptions {
  /** null = Litestream is not configured on this machine (every fetch fails). */
  env: LitestreamEnv | null;
  spawn?: LitestreamSpawn;
  bin?: string;
  /** Kill the child after this long. Default 120 s. */
  timeoutMs?: number;
}

/** Same rule as the entrypoint: all four set, or Litestream is off. */
export function litestreamEnvFrom(e: NodeJS.ProcessEnv): LitestreamEnv | null {
  const bucket = e.LITESTREAM_BUCKET;
  const endpoint = e.LITESTREAM_ENDPOINT;
  const accessKeyId = e.LITESTREAM_ACCESS_KEY_ID;
  const secretAccessKey = e.LITESTREAM_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return { bucket, endpoint, accessKeyId, secretAccessKey };
}

/** `2026-11-10T12:00:00.000Z` → `2026-11-10T12:00:00Z` (RFC 3339, UTC). */
function rfc3339(isoUtc: string): string {
  return new Date(isoUtc).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const defaultSpawn: LitestreamSpawn = (cmd, args, opts) =>
  nodeSpawn(cmd, args, { env: opts.env, stdio: ["ignore", "pipe", "pipe"] });

function removeQuietly(p: string): void {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    // best effort: the service deletes the candidate path again on failure
  }
}

export function createLitestreamSource(opts: LitestreamSourceOptions): RestoreSourcePort {
  const spawn = opts.spawn ?? defaultSpawn;
  const bin = opts.bin ?? "litestream";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return {
    fetchAt(tenantId: number, isoUtc: string | null, outPath: string): Promise<void> {
      const env = opts.env;
      if (!env) {
        return Promise.reject(
          new RestoreSourceError("FAILED", "Litestream is not configured on this server"),
        );
      }
      const url = `s3://${env.bucket}/tenants/${tenantId}.db?endpoint=${env.endpoint}&region=auto`;
      const args = ["restore", "-o", outPath, ...(isoUtc ? ["-timestamp", rfc3339(isoUtc)] : []), url];

      return new Promise<void>((resolve, reject) => {
        let output = "";
        let settled = false;
        const finish = (error: RestoreSourceError | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) {
            removeQuietly(outPath);
            dbLogger.warn({ tenantId, isoUtc, code: error.code, output: output.slice(-500) }, "litestream restore refused");
            reject(error);
          } else {
            resolve();
          }
        };

        const child = spawn(bin, args, {
          env: { ...process.env, AWS_ACCESS_KEY_ID: env.accessKeyId, AWS_SECRET_ACCESS_KEY: env.secretAccessKey },
        });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(new RestoreSourceError("FAILED", `litestream restore timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        timer.unref?.();

        child.stdout?.on("data", (c: Buffer) => (output += c.toString()));
        child.stderr?.on("data", (c: Buffer) => (output += c.toString()));
        child.on("error", (error: Error) => finish(new RestoreSourceError("FAILED", error.message)));
        child.on("close", (code: number | null) => {
          if (code === 0) {
            if (fs.existsSync(outPath)) finish(null);
            else finish(new RestoreSourceError("FAILED", "litestream restore wrote no file"));
            return;
          }
          if (/timestamp does not exist/i.test(output)) {
            finish(new RestoreSourceError("OUT_OF_WINDOW", "timestamp does not exist"));
          } else if (/no matching backup files available/i.test(output)) {
            finish(new RestoreSourceError("NO_BACKUP_AT_TIME", "no matching backup files available"));
          } else {
            finish(new RestoreSourceError("FAILED", `litestream restore exited ${code}`));
          }
        });
      });
    },
  };
}
