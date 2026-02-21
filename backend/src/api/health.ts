/**
 * Health Check Endpoints
 * Provides basic and detailed health status for monitoring
 */

import { Router } from "express";
import { getDatabase } from "../database/connection.js";
import { logger } from "../server.js";
import os from "os";

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

    // Test query
    db.prepare("SELECT 1 AS test").get();

    // Get some basic stats
    const stats = db
      .prepare(
        `
      SELECT 
        (SELECT COUNT(*) FROM clients) as clients,
        (SELECT COUNT(*) FROM products) as products,
        (SELECT COUNT(*) FROM sales WHERE date(created_at) = date('now')) as sales_today
    `,
      )
      .get() as { clients: number; products: number; sales_today: number };

    const latency = Date.now() - start;

    return {
      healthy: true,
      latency,
      stats,
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
