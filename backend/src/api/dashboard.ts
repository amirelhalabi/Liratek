import express from "express";
import { authenticateJWT } from "../middleware/auth.js";
import {
  getSalesService,
  getDebtService,
  getInventoryService,
  getRechargeService,
  getFinancialRepository,
  dashboardChartQuerySchema,
  netProfitWindowQuerySchema,
} from "@liratek/core";

const router = express.Router();

// All dashboard routes require auth
router.use(authenticateJWT);

// GET /api/dashboard/stats
router.get("/stats", (_req, res) => {
  const service = getSalesService();
  const stats = service.getDashboardStats();
  res.json({ success: true, stats });
});

// GET /api/dashboard/chart?type=Sales|Profit
// DC-7 (OWNER_NOTES_2026-09-21.md §7.1): IPC-identical envelope on failure —
// the IPC channel (`dashboard:get-profit-sales-chart`) has no try/catch of
// its own (a thin read pass-through), so a thrown DatabaseError there
// surfaces to the renderer as a rejected promise; here it must surface as
// HTTP 200 with `{ success: false, error }` rather than an uncaught 500, or
// the two transports diverge on the exact same failure. Mirrors the
// `/drawer-balances` route's own envelope-parity fix below.
router.get("/chart", (req, res) => {
  try {
    // DC-10 (OWNER_NOTES_2026-09-21.md §7.2, rule 27): `client_day` is the
    // BROWSER's own calendar day — `backendApi.getProfitSalesChart` always
    // sends one (defaulted to its own `localDay()`), but a malformed/absent
    // value degrades to the parsed `type` alone (matching the pre-existing
    // "default to type=Sales on anything but 'Profit'" contract this route
    // already tested) rather than 400ing a GET whose service layer has its
    // own `clientDay()` fallback anyway.
    const parsed = dashboardChartQuerySchema.safeParse({
      type: req.query.type,
      client_day: req.query.client_day,
    });
    const type = parsed.success
      ? parsed.data.type
      : req.query.type === "Profit"
        ? "Profit"
        : "Sales";
    const clientDay = parsed.success ? parsed.data.client_day : undefined;
    const service = getSalesService();
    const chart = service.getChartData(type, clientDay);
    res.json({ success: true, chart });
  } catch (error) {
    res.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get chart data",
    });
  }
});

// GET /api/dashboard/net-profit-last-30-days?client_day=YYYY-MM-DD
// DC-11 — the "Net Profit — last 30 days" tile. Rule 19c envelope parity:
// HTTP 200 {success:false,error} on a thrown DatabaseError, mirroring
// /chart above and the IPC channel (no try/catch of its own).
router.get("/net-profit-last-30-days", (req, res) => {
  try {
    const parsed = netProfitWindowQuerySchema.safeParse({
      client_day: req.query.client_day,
    });
    const clientDay = parsed.success ? parsed.data.client_day : undefined;
    const service = getSalesService();
    const netProfit = service.getNetProfitLast30Days(clientDay);
    res.json({ success: true, netProfit });
  } catch (error) {
    res.json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get net profit",
    });
  }
});

// GET /api/dashboard/todays-sales
router.get("/todays-sales", (_req, res) => {
  const service = getSalesService();
  const sales = service.getTodaysSales();
  res.json({ success: true, sales });
});

// GET /api/dashboard/drawer-balances
// Rule 19c: REST must stay IPC-identical — the IPC channel
// (`dashboard:get-drawer-balances`) has no try/catch of its own (it's a thin
// read pass-through), so a thrown DatabaseError there surfaces to the
// renderer as a rejected promise; here it must surface as HTTP 200 with
// `{ success: false, error }` rather than an uncaught 500, or the two
// transports diverge on the exact same failure (PRIMARY_CASH_DRAWER_PLAN.md
// §3 Phase C — SalesRepository.getDrawerBalances now also reads
// `shop_base_system`, a second query that can throw independently of the
// drawer_balances read).
router.get("/drawer-balances", (_req, res) => {
  try {
    const service = getSalesService();
    const balances = service.getDrawerBalances();
    res.json({ success: true, balances });
  } catch (error) {
    res.json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get drawer balances",
    });
  }
});

// GET /api/dashboard/drawer-names
router.get("/drawer-names", (_req, res) => {
  const repo = getFinancialRepository();
  const drawerNames = repo.getDrawerNames();
  res.json({ success: true, drawerNames });
});

// GET /api/dashboard/debt-summary
router.get("/debt-summary", (_req, res) => {
  const service = getDebtService();
  const debt = service.getDebtSummary();
  res.json({ success: true, debt });
});

// GET /api/dashboard/inventory-stock-stats
router.get("/inventory-stock-stats", (_req, res) => {
  const service = getInventoryService();
  const stats = service.getStockStats();
  res.json({ success: true, stats });
});

// GET /api/dashboard/recharge-stock
router.get("/recharge-stock", (_req, res) => {
  const service = getRechargeService();
  const stock = service.getStock();
  res.json({ success: true, stock });
});

export default router;
