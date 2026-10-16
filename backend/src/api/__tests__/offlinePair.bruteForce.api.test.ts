/**
 * Failed pairing attempts must count toward the auth limiter.
 *
 * `POST /api/offline/pair` is public. It checks a shop admin's password and,
 * on success, hands out a device key that can download the whole shop. Its
 * only guess brake is `authLimiter` (AUTH_RATE_LIMIT_MAX, default 5 per 15
 * minutes), which uses `skipSuccessfulRequests` — and express-rate-limit
 * decides "successful" by status code < 400. The route answers a wrong
 * password with the IPC envelope at HTTP 200, so no failed guess is ever
 * counted. A correct STAFF password also gets its own answer (ADMIN_ONLY),
 * so staff passwords can be confirmed the same way.
 *
 * Same root cause on `POST /api/profits/unlock` (profitsUnlockLimiter): a
 * wrong profits password is answered at HTTP 200, so staff can guess it
 * without ever being limited.
 *
 * Security audit run-1, fingerprint
 * backend/src/api/offline.ts:pair:authLimiter-skips-http200-failures.
 *
 * Harness copied from offlineDevice.api.test.ts (real router, real in-memory
 * DB). Every request comes from ONE client IP so the limiter can see them.
 */
import { jest } from "@jest/globals";
import type { Express } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
let ipCounter = 0;

// Without a proven proxy hop every supertest request shares 127.0.0.1, so
// each test would eat the previous test's budget. Prove the proxy (as the
// Vercel edge does in production) and give each test its own client IP.
const PROXY_SECRET = "offline-pair-proxy-secret-0123456789-abcdef";
process.env.CLIENT_IP_PROXY_SECRET = PROXY_SECRET;
function fromIp(ip: string): Record<string, string> {
  return { "x-liratek-proxy-auth": PROXY_SECRET, "x-vercel-forwarded-for": ip };
}

type PairBody = z.input<typeof import("@liratek/core").pairDeviceSchema>;

function pairFrom(ip: string, body: PairBody) {
  expect(core.pairDeviceSchema.safeParse(body).success).toBe(true);
  return request(app).post("/api/offline/pair").set(fromIp(ip)).send(body);
}

beforeAll(async () => {
  process.env.JWT_SECRET = "offline-pair-bruteforce-secret-0123456789-0123456789";
  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  core = await import("@liratek/core");
  db.exec(fs.readFileSync(path.join(__dirname, "../../../../electron-app/create_db.sql"), "utf8"));
  db.exec(`INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Corner Tech', 'cornertech', 'active')`);
  const ins = db.prepare(
    `INSERT INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (?, 2, ?, ?, ?, 1)`,
  );
  ins.run(20, "owner", core.hashPassword("Owner-pass-2026"), "admin");
  ins.run(21, "cashier", core.hashPassword("Cash-pass-2026"), "staff");

  const offline = (await import("../offline.js")).default;
  app = express();
  app.set("trust proxy", false);
  app.use(express.json());
  app.use("/api/offline", offline);
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

const LIMIT = 5; // authLimiter default (AUTH_RATE_LIMIT_MAX)

describe("POST /api/offline/pair — failed guesses are rate-limited", () => {
  it(`wrong admin passwords: attempt ${LIMIT + 1} from one IP is refused with 429`, async () => {
    const ip = `203.0.113.${++ipCounter}`;
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i++) {
      const res = await pairFrom(ip, {
        shop: "cornertech",
        username: "owner",
        password: `wrong-guess-${i}`,
        deviceName: "Attacker PC",
      });
      statuses.push(res.status);
    }

    expect(statuses[LIMIT]).toBe(429);
  });

  it(`a correct STAFF password (ADMIN_ONLY answer) also counts: attempt ${LIMIT + 1} is refused`, async () => {
    const ip = `203.0.113.${++ipCounter}`;
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i++) {
      const res = await pairFrom(ip, {
        shop: "cornertech",
        username: "cashier",
        password: "Cash-pass-2026",
        deviceName: "Attacker PC",
      });
      statuses.push(res.status);
    }

    expect(statuses[LIMIT]).toBe(429);
  });
});

describe("profitsUnlockLimiter — failed unlocks are rate-limited", () => {
  it(`a 200 {success:false} unlock answer counts: attempt ${LIMIT + 1} is refused`, async () => {
    // The real limiter in front of a stand-in handler that answers a wrong
    // profits password exactly like profits.ts does: HTTP 200, success:false.
    const { profitsUnlockLimiter } = await import("../../middleware/rateLimit.js");
    const unlockApp = express();
    unlockApp.set("trust proxy", false);
    unlockApp.use(express.json());
    unlockApp.post("/api/profits/unlock", profitsUnlockLimiter, (_req, res) => {
      res.json({ success: false, error: "Incorrect password" });
    });

    const ip = `203.0.113.${++ipCounter}`;
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i++) {
      const res = await request(unlockApp)
        .post("/api/profits/unlock")
        .set(fromIp(ip))
        .send({ password: `wrong-${i}` });
      statuses.push(res.status);
    }

    expect(statuses[LIMIT]).toBe(429);
  });
});
