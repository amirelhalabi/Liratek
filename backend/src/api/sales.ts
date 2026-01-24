import express from 'express';
import { authenticateJWT, requireRole } from '../middleware/auth.js';
import { getSalesService } from '../services/SalesService.js';
import { emitEvent } from '../websocket/io.js';

const router = express.Router();

// All sales routes require auth
router.use(authenticateJWT);

// GET /api/sales/drafts
router.get('/drafts', (_req, res) => {
  const service = getSalesService();
  const drafts = service.getDrafts();
  res.json({ success: true, drafts });
});

// GET /api/sales/today
router.get('/today', (_req, res) => {
  const service = getSalesService();
  const sales = service.getTodaysSales();
  res.json({ success: true, sales });
});

// GET /api/sales/top-products
router.get('/top-products', (_req, res) => {
  const service = getSalesService();
  const products = service.getTopProducts();
  res.json({ success: true, products });
});

// POST /api/sales/process
router.post('/process', requireRole(['admin']), (req, res) => {
  const service = getSalesService();
  const result = service.processSale(req.body);

  if (result.success) {
    emitEvent('sales:processed', {
      saleId: result.saleId,
      at: new Date().toISOString(),
    });
  }

  res.status(result.success ? 200 : 400).json(result);
});

export default router;
