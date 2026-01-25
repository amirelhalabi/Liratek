import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import {
  getSalesService,
  getDebtService,
  getInventoryService,
  getRechargeService,
  getFinancialRepository,
} from '../services';

const router = express.Router();

// All dashboard routes require auth
router.use(authenticateJWT);

// GET /api/dashboard/stats
router.get('/stats', (_req, res) => {
  const service = getSalesService();
  const stats = service.getDashboardStats();
  res.json({ success: true, stats });
});

// GET /api/dashboard/chart?type=Sales|Profit
router.get('/chart', (req, res) => {
  const type = req.query.type === 'Profit' ? 'Profit' : 'Sales';
  const service = getSalesService();
  const chart = service.getChartData(type);
  res.json({ success: true, chart });
});

// GET /api/dashboard/todays-sales
router.get('/todays-sales', (_req, res) => {
  const service = getSalesService();
  const sales = service.getTodaysSales();
  res.json({ success: true, sales });
});

// GET /api/dashboard/drawer-balances
router.get('/drawer-balances', (_req, res) => {
  const service = getSalesService();
  const balances = service.getDrawerBalances();
  res.json({ success: true, balances });
});

// GET /api/dashboard/debt-summary
router.get('/debt-summary', (_req, res) => {
  const service = getDebtService();
  const debt = service.getDebtSummary();
  res.json({ success: true, debt });
});

// GET /api/dashboard/inventory-stock-stats
router.get('/inventory-stock-stats', (_req, res) => {
  const service = getInventoryService();
  const stats = service.getStockStats();
  res.json({ success: true, stats });
});

// GET /api/dashboard/recharge-stock
router.get('/recharge-stock', (_req, res) => {
  const service = getRechargeService();
  const stock = service.getStock();
  res.json({ success: true, stock });
});

// GET /api/dashboard/monthly-pl?month=YYYY-MM
router.get('/monthly-pl', (req, res) => {
  const month = typeof req.query.month === 'string' ? req.query.month : '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ success: false, error: 'Invalid month (expected YYYY-MM)' });
    return;
  }

  const repo = getFinancialRepository();
  const pl = repo.getMonthlyPL(month);
  res.json({ success: true, pl });
});

export default router;
