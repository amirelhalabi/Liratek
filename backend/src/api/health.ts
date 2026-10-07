/**
 * Health Check Endpoints
 * Provides basic and detailed health status for monitoring
 */

import { Router } from "express";
import { getDatabase } from "../database/connection.js";
import { logger } from "../server.js";
import os from "os";
import { resolveClientIpDetailed } from "../middleware/clientIp.js";

// Get version from package.json
const version = "1.0.0";

const router = Router();

/**
 * Basic health check - fast, no dependencies
 * Used by load balancers and uptime monitors
 */
router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version,
  });
});

/**
 * Which client IP the server resolved for THIS request (LIRA-283).
 *
 * The deploy verifier (`scripts/deploy-api.mjs`) calls it through
 * www.liratek.shop (expects `source: "vercel"` and the caller's real IP) and
 * directly with forged headers (expects `source: "direct"` and NOT the forged
 * value). The owner can also open https://www.liratek.shop/health/client-ip
 * from the shop and compare `ip` with the shop's public address.
 *
 * Unauthenticated like the rest of /health, deliberately: the verifier holds
 * no credentials, and the answer is only the caller's OWN address and which
 * header it came from — never another request's data, never the secret.
 */
router.get("/client-ip", (req, res) => {
  const { ip, source, header, proxyVerified } = resolveClientIpDetailed(req);
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, ip, source, header, proxyVerified });
});

/**
 * Detailed health check - checks all dependencies
 * Used for comprehensive monitoring and diagnostics
 */
router.get("/detailed", async (_req, res) => {
  const checks = {
    database: await checkDatabase(),
    memory: checkMemory(),
    system: checkSystem(),
  };

  const allHealthy = Object.values(checks).every((c) => c.healthy);

  const response = {
    status: allHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version,
    checks,
  };

  // Log unhealthy state
  if (!allHealthy) {
    logger.warn({ checks }, "Health check failed");
  }

  res.status(allHealthy ? 200 : 503).json(response);
});

/**
 * Readiness check - checks if app is ready to serve traffic
 * Used by Kubernetes readiness probes
 */
router.get("/ready", async (_req, res) => {
  try {
    // Check if database is accessible
    const db = getDatabase();
    db.prepare("SELECT 1").get();

    res.json({
      status: "ready",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, "Readiness check failed");
    res.status(503).json({
      status: "not ready",
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * Liveness check - checks if app is alive
 * Used by Kubernetes liveness probes
 */
router.get("/live", (_req, res) => {
  res.json({
    status: "alive",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Health Check Functions
// ============================================================================

async function checkDatabase() {
  try {
    const db = getDatabase();
    const start = Date.now();

    // Connectivity check ONLY. This route is mounted UNAUTHENTICATED
    // (server.ts: `app.use("/health", healthRoutes)`, no /api prefix, no
    // authenticateJWT) for load balancers / uptime monitors — by design,
    // anyone can hit it without a token. In multi-tenant mode that means any
    // anonymous caller could previously read platform-wide business
    // aggregates (`clients`/`products`/`sales_today` counts summed across
    // EVERY tenant) via a raw, unscoped query with no `tenant_id` filter —
    // a cross-tenant data leak, not just an infra detail. A health check
    // only needs to prove the DB is reachable; it has no business reporting
    // any tenant's row counts, so the aggregate query is removed rather than
    // reworked to scope it (there is no tenant context here to scope by,
    // and this endpoint must stay anonymous for monitoring tools to use it).
    db.prepare("SELECT 1 AS test").get();

    const latency = Date.now() - start;

    return {
      healthy: true,
      latency,
    };
  } catch (error) {
    logger.error({ error }, "Database health check failed");
    return {
      healthy: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function checkMemory() {
  const usage = process.memoryUsage();
  const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
  const rssMB = Math.round(usage.rss / 1024 / 1024);

  // Threshold: 90% of heap (reduced false positives during startup)
  const threshold = Math.round(heapTotalMB * 0.9);
  const healthy = heapUsedMB < threshold;

  return {
    healthy,
    heapUsedMB,
    heapTotalMB,
    rssMB,
    threshold,
    percentUsed: Math.round((heapUsedMB / heapTotalMB) * 100),
  };
}

function checkSystem() {
  const loadAverage = os.loadavg();
  const cpuCount = os.cpus().length;
  const freememMB = Math.round(os.freemem() / 1024 / 1024);
  const totalmemMB = Math.round(os.totalmem() / 1024 / 1024);

  // System is healthy if load average is not too high
  const avgLoad = loadAverage[0];
  const healthy = avgLoad < cpuCount * 2; // Rule of thumb: load < 2x CPU cores

  return {
    healthy,
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    cpuCount,
    loadAverage: loadAverage.map((l) => Math.round(l * 100) / 100),
    freememMB,
    totalmemMB,
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid,
  };
}

export default router;
